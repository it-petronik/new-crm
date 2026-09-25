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

type Row = { userId: string; expiresAt: number; active: number; role: string } | null;
function gatewayEnv(row: Row, overrides: Record<string, unknown> = {}) {
  const forwarded: Request[] = [];
  return {
    forwarded,
    env: {
      APP_MODE: "production",
      APP_URL: "https://crm.example",
      DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) },
      COLLAB_HUB: {
        idFromName: (name: string) => name,
        get: (id: unknown) => ({
          fetch: async (request: Request) => {
            forwarded.push(request);
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
const live: Row = { userId: "u-real-0001", expiresAt: Date.now() + 60_000, active: 1, role: "Sales Manager" };

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
  (globalThis as any).WebSocketPair = class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  };
  (globalThis as any).WebSocketRequestResponsePair = class {};
  const state = {
    acceptWebSocket: (s: FakeSocket) => sockets.push(s),
    getWebSockets: () => sockets.filter((s) => s.closed === null),
    setWebSocketAutoResponse: () => {},
  };
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            lookups++;
            return sessionRow;
          },
        }),
      }),
    },
  };
  return { instance: new CollabHub(state as never, env as never), sockets, lookups: () => lookups };
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

test("hub: caps sockets per person and ignores client messages", async () => {
  const { instance, sockets } = hub();
  for (let i = 0; i < 14; i++)
    await connect(instance, { "X-Collab-User": "u-1-000000", "X-Collab-Session": `s${i}`, "X-Collab-Expires": String(Date.now() + 60_000) });
  assert.ok(sockets.filter((s) => s.closed === null).length <= 12);
  assert.equal(instance.webSocketMessage(), undefined);
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
