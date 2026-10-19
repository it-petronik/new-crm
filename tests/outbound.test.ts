import test from "node:test";
import assert from "node:assert/strict";
import type { D1Database } from "@cloudflare/workers-types";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import {
  outboundCommand as act,
  outboundView,
} from "../src/lib/outbound/store";
import {
  command,
  recipient,
  render,
  canCommunicate,
  canManageTemplates,
  type Message,
} from "../src/lib/outbound/model";
import { connections, prepareSubmission } from "../src/lib/outbound/transport";
import { submitSmtp, type MailSocket } from "../src/lib/outbound/smtp";
import type { Actor, RecordItem } from "../src/lib/domain";
const actor: Actor = {
  id: "sender",
  name: "Sender",
  role: "MD",
  companies: ["Petronik"],
  branches: [],
};
const other: Actor = { ...actor, id: "other" };
const record = {
  id: "lead",
  title: "Fictional Buyer",
  kind: "leads",
  company: "Petronik",
  branch: "Main",
  ownerId: actor.id,
  contact: "Buyer",
  product: "SN500",
  email: "BUYER@example.invalid",
  phone: "+971 50 123 4567",
} as RecordItem;
const sandbox = { MAIL_MODE: "sandbox", APP_URL: "http://localhost:8788" };
function fixture() {
  const sqlite = migratedDatabase();
  for (const user of [actor, other])
    sqlite
      .prepare(
        "INSERT INTO User(id,email,name,passwordHash,role,companies,branches,active,createdAt) VALUES(?,?,?,?,?,?,?,1,1)",
      )
      .run(
        user.id,
        `${user.id}@example.invalid`,
        user.name,
        "fictional",
        "MD",
        '["Petronik"]',
        "[]",
      );
  sqlite
    .prepare(
      "INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,'New',?,1,1,1)",
    )
    .run(
      record.id,
      record.kind,
      record.company,
      record.branch,
      record.ownerId,
      JSON.stringify(record),
    );
  return { sqlite, db: d1(sqlite) as unknown as D1Database };
}
const draft = (extra: Record<string, unknown> = {}) => ({
  action: "draft",
  id: crypto.randomUUID(),
  recordId: record.id,
  channel: "email",
  templateId: null,
  subject: "Your enquiry",
  body: "Hello Buyer, please confirm quantity.",
  ...extra,
});
const template = (extra: Record<string, unknown> = {}) => ({
  action: "template",
  id: crypto.randomUUID(),
  company: "Petronik",
  name: "Enquiry reply",
  channel: "email",
  subject: "Hello {{contact}}",
  body: "Hello {{contact}}, regarding {{product}}. Regards {{sender}}",
  ...extra,
});
async function ready(db: D1Database, c = draft()) {
  await act(db, actor, c, sandbox);
  await act(db, actor, { action: "ready", id: c.id, version: 1 }, sandbox);
  return c;
}
test("template rendering uses only explicit non-financial facts", () => {
  assert.equal(
    render(
      "{{contact}} · {{company}} · {{product}} · {{sender}}",
      record,
      actor,
    ),
    "Buyer · Petronik · SN500 · Sender",
  );
  assert.equal(
    command.safeParse(template({ body: "{{amount}}" })).success,
    false,
  );
});
test("recipient validates email and international phone without guessing country", () => {
  assert.equal(recipient(record, "email"), "buyer@example.invalid");
  assert.equal(recipient(record, "whatsapp"), "+971501234567");
  assert.throws(() =>
    recipient({ ...record, phone: "0501234567" }, "whatsapp"),
  );
  assert.throws(() =>
    recipient(
      { ...record, email: "to@example.invalid\r\nBcc:bad@x.invalid" },
      "email",
    ),
  );
});
test("communication respects kind, role, branch, owner and read-only grants", () => {
  assert.equal(canCommunicate(actor, record), true);
  for (const a of [
    { ...actor, companies: ["Afrilube"] },
    { ...actor, branches: ["Other"] },
    { ...actor, role: "HR Manager" as const },
    { ...actor, moduleAccess: { leads: "read" as const } },
  ])
    assert.equal(canCommunicate(a, record), false);
  assert.equal(canCommunicate(actor, { ...record, kind: "hr" }), false);
  assert.equal(
    canCommunicate({ ...other, role: "Sales Executive" }, record),
    false,
  );
});
test("only company managers may manage templates", () => {
  assert.equal(canManageTemplates(actor, "Petronik"), true);
  assert.equal(
    canManageTemplates({ ...actor, role: "Sales Executive" }, "Petronik"),
    false,
  );
  assert.equal(
    canManageTemplates({ ...actor, branches: ["Main"] }, "Petronik"),
    false,
  );
});
test("draft retries deduplicate exact content and refuse changed replay", async () => {
  const { db } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox);
  assert.equal((await act(db, actor, c, sandbox)).duplicate, true);
  await assert.rejects(() =>
    act(db, actor, { ...c, body: "Changed" }, sandbox),
  );
  assert.equal((await outboundView(db, actor, sandbox)).messages.length, 1);
});
test("even managers cannot read or mutate another person's drafts", async () => {
  const { db } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox);
  assert.equal((await outboundView(db, other, sandbox)).messages.length, 0);
  await assert.rejects(() =>
    act(db, other, { action: "ready", id: c.id, version: 1 }, sandbox),
  );
});
test("revoked scope removes message and history including on replay", async () => {
  const { db } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox);
  const revoked = { ...actor, companies: [] };
  const v = await outboundView(db, revoked, sandbox);
  assert.equal(v.messages.length, 0);
  assert.equal(v.history.length, 0);
  await assert.rejects(() => act(db, revoked, c, sandbox));
});
test("soft-deleted record cannot be used to send or view stored personal data", async () => {
  const { db, sqlite } = fixture(),
    c = await ready(db);
  sqlite
    .prepare(
      "UPDATE BusinessRecord SET payload=json_set(payload,'$.deletedAt','2026-10-19') WHERE id='lead'",
    )
    .run();
  assert.equal((await outboundView(db, actor, sandbox)).messages.length, 0);
  await assert.rejects(() =>
    act(
      db,
      actor,
      {
        action: "send",
        id: c.id,
        version: 2,
        confirmed: true,
        consent: "Customer requested this follow-up",
      },
      sandbox,
    ),
  );
});
test("scheduled review becomes due without sending or mutating on GET", async () => {
  const { db, sqlite } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox, 1000);
  await act(
    db,
    actor,
    { action: "schedule", id: c.id, version: 1, at: 2000 },
    sandbox,
    1000,
  );
  assert.equal(
    (await outboundView(db, actor, sandbox, 1500)).messages[0].status,
    "scheduled",
  );
  assert.equal(
    (await outboundView(db, actor, sandbox, 3000)).messages[0].status,
    "ready",
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM OutboundMessage").get()!.status,
    "scheduled",
  );
});
test("schedule refuses past and more than ninety days ahead", async () => {
  const { db } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox, 1000);
  for (const at of [999, 1000, 1000 + 91 * 86400000])
    await assert.rejects(() =>
      act(
        db,
        actor,
        { action: "schedule", id: c.id, version: 1, at },
        sandbox,
        1000,
      ),
    );
});
test("stale edits fail without creating misleading history", async () => {
  const { db } = fixture(),
    c = draft();
  await act(db, actor, c, sandbox);
  await act(
    db,
    actor,
    {
      action: "edit",
      id: c.id,
      version: 1,
      subject: "Edited",
      body: "Updated message",
    },
    sandbox,
  );
  await assert.rejects(() =>
    act(db, actor, { action: "ready", id: c.id, version: 1 }, sandbox),
  );
  assert.equal((await outboundView(db, actor, sandbox)).history.length, 2);
});
test("confirmation and permission evidence are mandatory", async () => {
  const { db } = fixture(),
    c = await ready(db);
  await assert.rejects(() =>
    act(
      db,
      actor,
      {
        action: "send",
        id: c.id,
        version: 2,
        confirmed: false,
        consent: "Consent given",
      },
      sandbox,
    ),
  );
  await assert.rejects(() =>
    act(
      db,
      actor,
      { action: "send", id: c.id, version: 2, confirmed: true, consent: "" },
      sandbox,
    ),
  );
});
test("sandbox capture never calls a real provider and cannot be repeated", async () => {
  const { db } = fixture(),
    c = await ready(db);
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("Unexpected network");
  };
  const send = {
    action: "send",
    id: c.id,
    version: 2,
    confirmed: true,
    consent: "Customer requested follow-up",
  };
  const result = await act(db, actor, send, sandbox, Date.now(), fetcher);
  assert.equal(result.status, "captured");
  assert.equal(calls, 0);
  await assert.rejects(() => act(db, actor, send, sandbox));
  const view = await outboundView(db, actor, sandbox);
  assert.equal(view.history.length, 4);
  assert.equal(view.messages[0].status, "captured");
  assert.equal(view.messages[0].consent, "Customer requested follow-up");
});
test("disconnected sending leaves the ready draft intact", async () => {
  const { db } = fixture(),
    c = await ready(db);
  await assert.rejects(() =>
    act(
      db,
      actor,
      {
        action: "send",
        id: c.id,
        version: 2,
        confirmed: true,
        consent: "Customer requested follow-up",
      },
      {},
    ),
  );
  const m = (await outboundView(db, actor, {})).messages[0];
  assert.equal(m.status, "ready");
  assert.equal(m.version, 2);
});
test("recipient changes force a fresh reviewed draft", async () => {
  const { db, sqlite } = fixture(),
    c = await ready(db);
  sqlite
    .prepare(
      "UPDATE BusinessRecord SET payload=json_set(payload,'$.email','new@example.invalid') WHERE id='lead'",
    )
    .run();
  await assert.rejects(() =>
    act(
      db,
      actor,
      {
        action: "send",
        id: c.id,
        version: 2,
        confirmed: true,
        consent: "Customer requested follow-up",
      },
      sandbox,
    ),
  );
});
test("templates are company scoped, immutable revisions and archivable", async () => {
  const { db } = fixture(),
    t = template();
  await act(db, actor, t, sandbox);
  assert.equal((await act(db, actor, t, sandbox)).duplicate, true);
  await assert.rejects(() =>
    act(db, actor, { ...t, body: "Different revision" }, sandbox),
  );
  await assert.rejects(() =>
    act(db, actor, draft({ templateId: t.id, channel: "whatsapp" }), sandbox),
  );
  await act(
    db,
    actor,
    { action: "archive-template", id: t.id, version: 1 },
    sandbox,
  );
  assert.equal((await outboundView(db, actor, sandbox)).templates.length, 0);
  await assert.rejects(() =>
    act(db, actor, draft({ templateId: t.id }), sandbox),
  );
});
test("database enforces locked messages and retained immutable events", async () => {
  const { db, sqlite } = fixture(),
    c = await ready(db);
  await act(
    db,
    actor,
    {
      action: "send",
      id: c.id,
      version: 2,
      confirmed: true,
      consent: "Customer requested follow-up",
    },
    sandbox,
  );
  assert.throws(() =>
    sqlite.exec("UPDATE OutboundMessage SET body='changed',version=version+1"),
  );
  assert.throws(() => sqlite.exec("DELETE FROM OutboundMessage"));
  assert.throws(() => sqlite.exec("UPDATE OutboundEvent SET action='changed'"));
  assert.throws(() => sqlite.exec("DELETE FROM OutboundEvent"));
});
test("production cannot enable sandbox by client URL or mode alone", () => {
  assert.equal(
    connections({ MAIL_MODE: "sandbox", APP_URL: "https://crm.enercore.ae" }, [
      "Petronik",
    ])[0].email,
    "disconnected",
  );
  assert.equal(
    connections({ OUTBOUND_CONFIG: "broken", OUTBOUND_ENABLED: "true" }, [
      "Petronik",
    ])[0].email,
    "disconnected",
  );
});
test("WhatsApp requires exact trusted template mapping and uses Meta template API", async () => {
  const m = {
    ...draft(),
    recipient: "+971501234567",
    channel: "whatsapp",
    company: "Petronik",
    templateId: "approved",
    body: "Hello Buyer",
  } as unknown as Message;
  const env = {
    OUTBOUND_ENABLED: "true",
    OUTBOUND_CONFIG: JSON.stringify({
      Petronik: {
        whatsapp: {
          token: "fictional-token",
          phoneId: "123456",
          version: "v23.0",
          templates: {
            approved: {
              name: "enquiry_follow_up",
              language: "en_US",
              body: "Hello {{contact}}",
            },
          },
        },
      },
    }),
  };
  let calls = 0;
  const fetcher = (async (url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://graph.facebook.com/v23.0/123456/messages");
    const payload = JSON.parse(init.body as string);
    assert.equal(payload.type, "template");
    assert.equal(payload.template.components[0].parameters[0].text, "Buyer");
    return Response.json({ messages: [{ id: "fictional-meta-id" }] });
  }) as typeof fetch;
  assert.equal(
    (await prepareSubmission(env, m, record, actor, fetcher)()).status,
    "accepted",
  );
  assert.equal(calls, 1);
  assert.throws(() =>
    prepareSubmission(
      env,
      { ...m, body: "Unapproved free text" },
      record,
      actor,
      fetcher,
    ),
  );
  assert.equal(
    (
      await prepareSubmission(env, m, record, actor, async () => {
        throw new Error("timeout");
      })()
    ).status,
    "uncertain",
  );
});
function smtpSocket(replies: string[]) {
  const written: string[] = [];
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(replies.shift()!));
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
      const next = replies.shift();
      if (next) controller.enqueue(encoder.encode(next));
    },
  });
  return {
    socket: { readable, writable, close: async () => {} } satisfies MailSocket,
    written,
  };
}
const account = {
  host: "mail.example.invalid",
  username: "sender@example.invalid",
  password: "fictional-password",
  from: "sender@example.invalid",
  replyTo: "sender@example.invalid",
};
test("cPanel SMTP TLS submission waits for DATA acceptance and safely encodes content", async () => {
  const f = smtpSocket([
    "220 fictional\r\n",
    "250-fictional\r\n250 AUTH PLAIN\r\n",
    "235 OK\r\n",
    "250 OK\r\n",
    "250 OK\r\n",
    "354 Send message\r\n",
    "250 queued\r\n",
  ]);
  const result = await submitSmtp(
    account,
    {
      id: crypto.randomUUID(),
      recipient: "buyer@example.invalid",
      subject: "Quotation Δ",
      body: "Hello\n.\nUnicode Δ",
    },
    async () => f.socket,
  );
  assert.equal(result.status, "accepted");
  assert.ok(f.written[1].startsWith("AUTH PLAIN "));
  assert.ok(f.written.at(-1)!.includes("Content-Transfer-Encoding: base64"));
  assert.ok(!f.written.at(-1)!.includes("\r\n.\r\nUnicode"));
});
test("SMTP rejected recipient is not falsely marked accepted", async () => {
  const f = smtpSocket([
    "220 fictional\r\n",
    "250 OK\r\n",
    "235 OK\r\n",
    "250 OK\r\n",
    "550 No recipient\r\n",
  ]);
  assert.equal(
    (
      await submitSmtp(
        account,
        {
          id: crypto.randomUUID(),
          recipient: "buyer@example.invalid",
          subject: "Hi",
          body: "Hello",
        },
        async () => f.socket,
      )
    ).status,
    "rejected",
  );
  assert.equal(
    f.written.some((s) => s.startsWith("DATA")),
    false,
  );
});
test("simultaneous confirmed requests claim once, and uncertain submission is locked", async () => {
  const { db } = fixture(),
    t = template({
      channel: "whatsapp",
      subject: "",
      body: "Hello {{contact}}",
    });
  await act(db, actor, t, sandbox);
  const c = await ready(
    db,
    draft({
      channel: "whatsapp",
      subject: "",
      body: "Hello Buyer",
      templateId: t.id,
    }),
  );
  const env = {
    OUTBOUND_ENABLED: "true",
    OUTBOUND_CONFIG: JSON.stringify({
      Petronik: {
        whatsapp: {
          token: "fictional-token",
          phoneId: "123456",
          version: "v23.0",
          templates: {
            [t.id]: {
              name: "enquiry",
              language: "en_US",
              body: "Hello {{contact}}",
            },
          },
        },
      },
    }),
  };
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("Simulated unknown delivery");
  };
  const send = {
    action: "send",
    id: c.id,
    version: 2,
    confirmed: true,
    consent: "Fictional customer opt-in evidence",
  };
  const result = await Promise.allSettled([
    act(db, actor, send, env, Date.now(), fetcher),
    act(db, actor, send, env, Date.now(), fetcher),
  ]);
  assert.equal(calls, 1);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const view = await outboundView(db, actor, env);
  assert.equal(view.messages[0].status, "uncertain");
  await assert.rejects(() =>
    act(
      db,
      actor,
      { action: "ready", id: c.id, version: view.messages[0].version },
      env,
    ),
  );
  assert.equal(calls, 1);
});
test("sandbox submissions enforce the same hourly cap as real transports", async () => {
  const { db } = fixture();
  for (let i = 0; i < 20; i++) {
    const c = await ready(db);
    await act(
      db,
      actor,
      {
        action: "send",
        id: c.id,
        version: 2,
        confirmed: true,
        consent: "Fictional permission evidence",
      },
      sandbox,
    );
  }
  const c = await ready(db);
  await assert.rejects(
    () =>
      act(
        db,
        actor,
        {
          action: "send",
          id: c.id,
          version: 2,
          confirmed: true,
          consent: "Fictional permission evidence",
        },
        sandbox,
      ),
    /Hourly safety limit/,
  );
});
