import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cleanLine,
  cleanText,
  directKey,
  excerpt,
  inRoomScope,
  isId,
  messageId,
  sharedCompany,
  validMentions,
} from "../src/lib/collab";
import { MessageText } from "../src/components/collaboration/message-text";
import { CollabHub, SESSION_ENDED } from "../src/realtime/collab-hub";
import { collabSocket } from "../src/realtime/gateway";

/* ------------------------------------------------------------ pure rules */

test("message ids sort by creation time and are well-formed ids", () => {
  const ids = [1_000, 1_001, 5_000_000, Date.now(), Date.now() + 1].map((t) => messageId(t));
  assert.deepEqual([...ids].sort(), ids);
  for (const id of ids) assert.ok(isId(id), id);
  assert.notEqual(messageId(42), messageId(42), "random suffix keeps same-millisecond ids distinct");
});

test("id shape check rejects anything that is not a plain id", () => {
  for (const bad of ["", "short", "a".repeat(65), "../../x", "abc def ghi", "a'b;--cdef", 42, null, undefined])
    assert.equal(isId(bad), false, String(bad));
  assert.equal(isId(crypto.randomUUID()), true);
});

test("direct keys are order-independent", () => {
  assert.equal(directKey("b-user-0001", "a-user-0001"), directKey("a-user-0001", "b-user-0001"));
});

test("cleanText keeps text as text and strips what can deceive", () => {
  assert.equal(cleanText("  a\r\nb\rc  "), "a\nb\nc");
  assert.equal(cleanText("a\u0000\u0008\u000b\u001f\u007fb"), "ab");
  assert.equal(cleanText("x‮evil‬⁦y⁩"), "xevily");
  assert.equal(cleanText("1\n\n\n\n\n\n2"), "1\n\n\n2");
  assert.equal(cleanText("<b>&amp;</b>"), "<b>&amp;</b>", "no escaping or stripping of markup: it is never HTML");
  assert.equal(cleanText("tab\there"), "tab\there");
  assert.equal(cleanLine("  Many   words\nhere "), "Many words here");
});

test("excerpt is single-line and bounded", () => {
  assert.equal(excerpt("a\n\nb"), "a b");
  assert.equal(excerpt("x".repeat(200), 10), "xxxxxxxxx…");
});

test("room scope: company always, branch only for branch-scoped people", () => {
  const groupWide = { companies: ["Petronik"], branches: [] };
  const dubai = { companies: ["Petronik"], branches: ["Dubai"] };
  const other = { companies: ["Afrilube"], branches: [] };
  const companyRoom = { company: "Petronik", branch: null };
  const dubaiRoom = { company: "Petronik", branch: "Dubai" };
  const abuDhabiRoom = { company: "Petronik", branch: "Abu Dhabi" };
  assert.equal(inRoomScope(groupWide, companyRoom), true);
  assert.equal(inRoomScope(groupWide, dubaiRoom), true);
  assert.equal(inRoomScope(dubai, companyRoom), true);
  assert.equal(inRoomScope(dubai, dubaiRoom), true);
  assert.equal(inRoomScope(dubai, abuDhabiRoom), false);
  assert.equal(inRoomScope(other, companyRoom), false);
  assert.equal(sharedCompany(groupWide, other), null);
  assert.equal(sharedCompany({ companies: ["Afrilube", "Petronik"], branches: [] }, groupWide), "Petronik");
});

test("mentions: active members, named in the text, not the author, bounded", () => {
  const members = [
    { id: "u-ann-0001", name: "Ann Lee", active: true },
    { id: "u-bob-0001", name: "Bob Ray", active: false },
    { id: "u-cat-0001", name: "Cat Sun", active: true },
  ];
  const body = "@Ann Lee @Bob Ray @Me Self";
  assert.deepEqual(
    validMentions(body, ["u-ann-0001", "u-bob-0001", "u-cat-0001", "u-me-00001", "u-ann-0001", "u-zzz-0001"], members, "u-me-00001"),
    ["u-ann-0001"],
  );
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `u-many-${String(i).padStart(4, "0")}`, name: `P${i}`, active: true }));
  const text = many.map((m) => `@${m.name}`).join(" ");
  assert.equal(validMentions(text, many.map((m) => m.id), many, "author-0001").length, 20);
});

/* ----------------------------------------------------- safe rendering */

test("message text renders as text: markup is inert, links are isolated", () => {
  const html = renderToStaticMarkup(
    createElement(MessageText, {
      body: `<script>alert(1)</script><img src=x onerror=alert(2)> @Ann Lee see https://example.com/a?b=1.`,
      mentions: [{ id: "u-ann-0001", name: "Ann Lee" }],
      meId: "u-ann-0001",
    }),
  );
  assert.ok(!html.includes("<script>"), html);
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.match(html, /<span class="collab-mention is-me">@Ann Lee<\/span>/);
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1" target="_blank" rel="noopener noreferrer nofollow" class="collab-link">/);
  // Trailing punctuation is not swallowed into the link.
  assert.ok(html.includes("b=1</a>."));
  // Only http(s) becomes a link.
  const js = renderToStaticMarkup(createElement(MessageText, { body: "javascript:alert(1) data:text/html,x", mentions: [], meId: "x" }));
  assert.ok(!js.includes("<a"), js);
});

test("no collaboration code renders raw HTML", () => {
  const files = [
    ...readdirSync("src/components/collaboration").map((f) => join("src/components/collaboration", f)),
    ...readdirSync("src/lib").filter((f) => f.startsWith("collab")).map((f) => join("src/lib", f)),
  ];
  assert.ok(files.length >= 12, "scanned the collaboration sources");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/dangerouslySetInnerHTML\s*[=:]/.test(source), file);
    assert.ok(!/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(source), file);
  }
});

/* --------------------------------------------------------- the gateway */

type Row = {
  id: string; name: string; expiresAt: number; active: number; role: string; companies: string; branches: string;
} | null;
function gatewayEnv(row: Row, overrides: Record<string, unknown> = {}) {
  const forwarded: { url: string; headers: Headers }[] = [];
  return {
    forwarded,
    env: {
      APP_MODE: "production",
      APP_URL: "https://crm.example",
      DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
      COLLAB_HUB: {
        idFromName: (name: string) => name,
        get: (id: unknown) => ({
          fetch: async (url: string, init?: RequestInit) => {
            forwarded.push({ url, headers: new Headers(init?.headers) });
            return new Response(`hub:${String(id)}`);
          },
        }),
      },
      ...overrides,
    },
  };
}
const upgrade = (headers: Record<string, string>) =>
  new Request("https://crm.example/api/collab/socket", { headers: { Upgrade: "websocket", ...headers } });
const live: Row = {
  id: "u-real-0001", name: "Real Person", expiresAt: Date.now() + 60_000, active: 1, role: "Sales Manager",
  companies: '["Petronik"]', branches: "[]",
};

test("gateway: authenticates, then routes only to the caller's own hub", async () => {
  const { env, forwarded } = gatewayEnv(live);
  const response = await collabSocket(
    upgrade({
      Origin: "https://crm.example",
      Cookie: "other=1; enercore_session=tok",
      // Client-supplied identity headers must be ignored.
      "X-Collab-User": "u-victim-01",
    }),
    env as never,
  );
  assert.equal(await response.text(), "hub:u-real-0001");
  assert.equal(forwarded[0].headers.get("X-Collab-User"), "u-real-0001");
  assert.equal(forwarded[0].headers.get("Cookie"), null, "the hub never sees the raw cookie");
});

test("gateway: refuses preview, bad origin, no/unknown/expired session, inactive, bad role", async () => {
  const origin = { Origin: "https://crm.example", Cookie: "enercore_session=tok" };
  const cases: [string, Row, Record<string, string>, Record<string, unknown>, number][] = [
    ["preview", live, origin, { APP_MODE: "preview" }, 404],
    ["foreign origin", live, { ...origin, Origin: "https://evil.example" }, {}, 403],
    ["no origin", live, { Cookie: origin.Cookie }, {}, 403],
    ["no cookie", live, { Origin: origin.Origin }, {}, 401],
    ["unknown session", null, origin, {}, 401],
    ["expired", { ...live!, expiresAt: Date.now() - 1 }, origin, {}, 401],
    ["inactive", { ...live!, active: 0 }, origin, {}, 401],
    ["invalid role", { ...live!, role: "Superuser" }, origin, {}, 401],
    ["no binding", live, origin, { COLLAB_HUB: undefined }, 503],
    // The presence directory is a hub under a reserved name; no session may
    // ever be routed there.
    ["reserved hub name", { ...live!, id: "presence-directory" }, origin, {}, 401],
  ];
  for (const [name, row, headers, overrides, status] of cases) {
    const { env, forwarded } = gatewayEnv(row, overrides);
    const response = await collabSocket(upgrade(headers), env as never);
    assert.equal(response.status, status, name);
    assert.equal(forwarded.length, 0, `${name} must not reach a hub`);
  }
  const plain = await collabSocket(new Request("https://crm.example/api/collab/socket"), gatewayEnv(live).env as never);
  assert.equal(plain.status, 426);
});

/* --------------------------------------------------------- the hub */

class FakeSocket {
  sent: string[] = [];
  closed: number | null = null;
  attachment: unknown;
  send(data: string) {
    if (this.closed !== null) throw new Error("closed");
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed = code ?? 1000;
  }
  serializeAttachment(v: unknown) {
    this.attachment = structuredClone(v);
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

function hub(sessionRow: { expiresAt: number; active: number } | null = { expiresAt: Date.now() + 3_600_000, active: 1 }) {
  const sockets: FakeSocket[] = [];
  let lookups = 0;
  let writes = 0;
  const pings = new Map<FakeSocket, Date>();
  const alarms: number[] = [];
  (globalThis as any).WebSocketPair = class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  };
  (globalThis as any).WebSocketRequestResponsePair = class {};
  const store = new Map<string, unknown>();
  const state = {
    acceptWebSocket: (s: FakeSocket) => sockets.push(s),
    getWebSockets: () => sockets.filter((s) => s.closed === null),
    setWebSocketAutoResponse: () => {},
    getWebSocketAutoResponseTimestamp: (s: FakeSocket) => pings.get(s) ?? null,
    storage: {
      setAlarm: async (t: number) => void alarms.push(t),
      deleteAlarm: async () => void alarms.push(-1),
      get: async (key: string | string[]) =>
        Array.isArray(key) ? new Map(key.filter((k) => store.has(k)).map((k) => [k, store.get(k)])) : store.get(key),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === "string") store.set(key, value);
        else for (const [k, v] of Object.entries(key)) store.set(k, v);
      },
    },
  };
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            lookups++;
            return sessionRow;
          },
          run: async () => {
            writes++;
            return {};
          },
          all: async () => ({ results: [] }),
        }),
      }),
    },
  };
  return {
    instance: new CollabHub(state as never, env as never),
    sockets,
    lookups: () => lookups,
    writes: () => writes,
    store,
    pings,
    alarms,
  };
}

const connect = (h: CollabHub, headers: Record<string, string>) =>
  h.fetch(new Request("https://collab-hub/connect", { headers: { Upgrade: "websocket", ...headers } })).catch((e) => e);

test("hub: connect needs the gateway's identity headers", async () => {
  const { instance, sockets } = hub();
  const refused = await connect(instance, {});
  assert.equal(refused.status, 401);
  assert.equal(sockets.length, 0);
  // A 101 response cannot be constructed outside the Workers runtime, so the
  // accepted path is asserted by what the hub did before returning.
  await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": "s", "X-Collab-Expires": String(Date.now() + 60_000) });
  assert.equal(sockets.length, 1);
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: "ready" });
  assert.equal((await instance.fetch(new Request("https://collab-hub/anything"))).status, 404);
});

test("hub: publishes to live sessions, closes expired and revoked ones", async () => {
  const { instance, sockets, lookups } = hub(null);
  const now = Date.now();
  await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": "a", "X-Collab-Expires": String(now + 60_000) });
  await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": "b", "X-Collab-Expires": String(now - 1) });
  const publish = () => instance.fetch(new Request("https://collab-hub/publish", { method: "POST", body: '{"type":"x"}' }));

  assert.equal((await publish()).status, 204);
  assert.deepEqual(sockets[0].sent.slice(1), ['{"type":"x"}'], "live session receives");
  assert.equal(sockets[1].closed, SESSION_ENDED, "expired session is closed, not fed");
  assert.equal(lookups(), 0, "recently checked sessions are not re-read");

  // Past the revalidation window, a session that no longer exists is closed.
  (sockets[0].attachment as any).checkedAt = now - 61_000;
  await publish();
  assert.equal(sockets[0].closed, SESSION_ENDED);
  assert.equal(sockets[0].sent.length, 2, "nothing delivered after revocation");
  assert.equal(lookups(), 1);
});

test("hub: caps sockets per person; a client can only report its own activity", async () => {
  const { instance, sockets, store } = hub();
  for (let i = 0; i < 14; i++)
    await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": `s${i}`, "X-Collab-Expires": String(Date.now() + 60_000) });
  const open = sockets.filter((s) => s.closed === null);
  assert.ok(open.length <= 12);
  assert.equal(store.get("status"), "online");

  // Anything but an activity report is ignored: nothing is echoed or relayed.
  const before = open.map((s) => s.sent.length);
  for (const junk of ['{"type":"message.created","conversationId":"x"}', "not json", '{"type":"activity","state":"root"}', "x".repeat(500)])
    await instance.webSocketMessage(open[0] as never, junk);
  assert.deepEqual(open.map((s) => s.sent.length), before);
  assert.equal(store.get("status"), "online");

  // Every tab idle → away; one tab active again → online.
  for (const s of open) await instance.webSocketMessage(s as never, '{"type":"activity","state":"idle"}');
  assert.equal(store.get("status"), "away");
  await instance.webSocketMessage(open[0] as never, '{"type":"activity","state":"active"}');
  assert.equal(store.get("status"), "online");

  // Closing tabs one by one: offline only when the last one goes. (Once the
  // one active tab closes, the rest are idle, so the person is away.)
  for (const [i, s] of open.entries()) {
    s.closed = 1000;
    await instance.webSocketClose(s as never, 1000, "");
    assert.equal(store.get("status"), i === open.length - 1 ? "offline" : "away");
  }
});

test("hub: repeated typing events are dropped at the recipient", async () => {
  const { instance, sockets } = hub();
  await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": "a", "X-Collab-Expires": String(Date.now() + 60_000) });
  const typing = JSON.stringify({ type: "typing", conversationId: "c-1-000000", userId: "u-2-000000", name: "B", state: "start" });
  for (let i = 0; i < 20; i++)
    await instance.fetch(new Request("https://collab-hub/publish", { method: "POST", body: typing }));
  assert.equal(sockets[0].sent.filter((m) => m.includes('"typing"')).length, 1);
});

/* ------------------------------------------------ preview-mode refusal */

test("every collaboration API refuses preview mode before anything else", async () => {
  const previous = process.env.APP_MODE;
  process.env.APP_MODE = "preview";
  try {
    const { collabContext, CollabError } = await import("../src/lib/collab-auth");
    for (const write of [true, false]) {
      await assert.rejects(
        collabContext(new Request("https://crm.example/api/collab/conversations", { method: "POST" }), write),
        (e: unknown) => e instanceof CollabError && e.status === 409,
      );
    }
  } finally {
    process.env.APP_MODE = previous;
  }
});

/* ------------------------------------------------------ presence expiry */

test("hub: a dead tab expires without taking a live device offline; D1 written once", async () => {
  const { instance, sockets, store, pings, alarms, writes } = hub();
  const now = Date.now();
  for (const s of ["laptop", "phone"])
    await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": s, "X-Collab-Expires": String(now + 3_600_000) });
  const [laptop, phone] = sockets;
  assert.equal(store.get("status"), "online");
  assert.ok(alarms.some((t) => t > now), "a heartbeat is scheduled while connected");

  // The laptop vanished without a close: no ping for 200 s. The phone pings.
  (laptop.attachment as any).connectedAt = now - 200_000;
  (phone.attachment as any).connectedAt = now - 200_000;
  pings.set(phone, new Date(now - 10_000));
  await instance.alarm();
  assert.equal(laptop.closed, 1001, "the dead tab is closed");
  assert.equal(phone.closed, null);
  assert.equal(store.get("status"), "online", "the live device keeps its owner online");
  assert.equal(writes(), 0, "no D1 write while still online");

  // Then the phone dies too: offline, last seen at its final ping, one write.
  pings.set(phone, new Date(now - 200_000));
  await instance.alarm();
  assert.equal(phone.closed, 1001);
  assert.equal(store.get("status"), "offline");
  assert.equal(writes(), 1);
  assert.equal(alarms.at(-1), -1, "the heartbeat stops when nobody is connected");

  // Further heartbeats (none are scheduled, but if one fired) write nothing.
  await instance.alarm();
  assert.equal(writes(), 1);
});

test("directory: an unconfirmed online entry expires to offline at its last heartbeat", async () => {
  const { instance } = hub();
  const now = Date.now();
  const set = (userId: string, status: string, at: number, expiresAt: number | null) =>
    instance.fetch(new Request("https://collab-hub/directory/set", { method: "POST", body: JSON.stringify({ userId, status, at, expiresAt }) }));
  await set("u-fresh-0001", "online", now, now + 60_000);
  await set("u-dead-00001", "online", now - 400_000, now - 220_000); // its hub stopped beating
  await set("u-away-00001", "away", now, now + 60_000);
  await set("u-gone-00001", "offline", now - 5_000, null);
  const response = await instance.fetch(
    new Request("https://collab-hub/directory/get", {
      method: "POST",
      body: JSON.stringify({ userIds: ["u-fresh-0001", "u-dead-00001", "u-away-00001", "u-gone-00001", "u-none-00001"] }),
    }),
  );
  const out = (await response.json()) as Record<string, { status: string; at: number }>;
  assert.equal(out["u-fresh-0001"].status, "online");
  assert.deepEqual(out["u-dead-00001"], { status: "offline", at: now - 400_000 });
  assert.equal(out["u-away-00001"].status, "away");
  assert.equal(out["u-gone-00001"].status, "offline");
  assert.equal(out["u-none-00001"], undefined, "unknown people are simply absent");
});

test("typing gate: one start per conversation per 2 s, stop always allowed", async () => {
  const { instance } = hub();
  const gate = async (conversationId: string, state: string) =>
    ((await (await instance.fetch(new Request("https://collab-hub/typing-gate", { method: "POST", body: JSON.stringify({ conversationId, state }) }))).json()) as { allow: boolean }).allow;
  assert.equal(await gate("c-a-000000", "start"), true);
  for (let i = 0; i < 10; i++) assert.equal(await gate("c-a-000000", "start"), false);
  assert.equal(await gate("c-b-000000", "start"), true, "per conversation");
  assert.equal(await gate("c-a-000000", "stop"), true);
});

test("ZIP and other archives are not accepted", async () => {
  const { detectFile } = await import("../src/lib/collab-files");
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.equal(detectFile(zip, "files.zip"), null);
});

/* ------------------------------------------------------------ last seen */

test("last-seen wording: relative when recent, GST clock today, then days", async () => {
  const { presenceLabel } = await import("../src/lib/collab-client");
  const { businessTime, businessToday, businessDate } = await import("../src/lib/gst");
  const ago = (ms: number) => ({ status: "offline" as const, lastSeenAt: new Date(Date.now() - ms).toISOString() });
  assert.equal(presenceLabel({ status: "online", lastSeenAt: null }), "Online");
  assert.equal(presenceLabel({ status: "away", lastSeenAt: null }), "Away");
  assert.equal(presenceLabel({ status: "offline", lastSeenAt: null }), "Offline");
  assert.equal(presenceLabel(ago(20_000)), "Last seen just now");
  assert.equal(presenceLabel(ago(4 * 60_000)), "Last seen 4 min ago");
  // Two hours ago: a GST clock time if still today in Dubai, else yesterday.
  const twoHours = new Date(Date.now() - 2 * 3600_000);
  assert.equal(
    presenceLabel(ago(2 * 3600_000)),
    businessToday(twoHours) === businessToday() ? `Last seen ${businessTime(twoHours)}` : "Last seen yesterday",
  );
  const threeDays = new Date(Date.now() - 3 * 86_400_000);
  assert.equal(presenceLabel(ago(3 * 86_400_000)), `Last seen ${businessDate(threeDays)}`);
  // Clock times are 12-hour with am/pm, never a bare 24-hour time.
  assert.match(businessTime(new Date("2026-09-25T10:35:00Z")), /^2:35 pm$/);
});
