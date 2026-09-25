import { test, expect } from "@playwright/test";
import { Client, ids, upgradeStatus } from "./client";
import { byKey, PAGING_ROOM, WORKER } from "./people";

/**
 * Mentions, read cursors, pagination, idempotency, input handling,
 * origin/session checks and rate limits. People used here: pg13–pg27, pd6,
 * af4–af5, pg39–pg40, rl1–rl32 (exclusive to this file).
 */

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login("admin");
});

/* ------------------------------------------------------------- mentions */

test.describe("mentions", () => {
  test("only current, active, in-scope members named in the text are mentioned", async () => {
    const [author, member, removed] = await Promise.all(["pg13", "pg14", "pg15"].map(Client.login));
    const room = await author.createRoom({ members: ["pg14", "pg15", "pg16"] });
    await author.del(`/conversations/${room.id}/members?userId=${removed.id}`);
    const name = (k: string) => byKey(k).name;

    const sent = await author.send(room.id, `@${name("pg14")} @${name("pg15")} @${name("af4")} hello @${name("pg13")}`, {
      mentionIds: [
        member.id, //                  valid
        removed.id, //                 no longer a member
        byKey("af4").id, //            another company, never a member
        byKey("pg17").id, //           a real colleague, not in the room
        "00000000-0000-4000-8000-000000000000", // nobody
        author.id, //                  self
        byKey("pg16").id, //           a member, but not named in the text
      ],
    });
    expect(sent.status).toBe(201);
    expect(sent.body.message.mentions).toEqual([{ id: member.id, name: name("pg14") }]);
  });

  test("malformed mention payloads are rejected", async () => {
    const author = await Client.login("pg16");
    const room = await author.createRoom();
    for (const mentionIds of ["pg14", [42], ["../../etc"], Array.from({ length: 41 }, (_, i) => `abcdefgh-${i}`)])
      expect((await author.send(room.id, "x", { mentionIds })).status).toBe(400);
  });

  test("a member deactivated or moved out of scope can no longer be mentioned", async () => {
    const [author] = await Promise.all(["pg17"].map(Client.login));
    const room = await author.createRoom({ members: ["pg18", "pd6"] });
    await admin.moveUser("pd6", ["Petronik"], ["Abu Dhabi"]); // room is company-wide: still in scope
    await admin.moveUser("pg18", ["Afrilube"], []); //           out of the room's company
    const sent = await author.send(room.id, `@${byKey("pg18").name} @${byKey("pd6").name}`, {
      mentionIds: ids("pg18", "pd6"),
    });
    expect(sent.body.message.mentions.map((m: any) => m.id)).toEqual(ids("pd6"));
  });

  test("the Mentions view lists mentions, and drops them when access is lost", async () => {
    const [author, target] = await Promise.all(["pg19", "pg20"].map(Client.login));
    const room = await author.createRoom({ members: ["pg20"] });
    const sent = (await author.send(room.id, `ping @${target.person.name}`, { mentionIds: [target.id] })).body.message;
    const view = (await target.get("/mentions")).body;
    expect(view.items[0]).toMatchObject({ unread: true, conversation: { id: room.id } });
    expect(view.items[0].message.id).toBe(sent.id);
    expect((await target.summary()).mentions).toBe(1);

    await author.del(`/conversations/${room.id}/members?userId=${target.id}`);
    expect((await target.get("/mentions")).body.items).toEqual([]);
    expect((await target.summary()).mentions).toBe(0);
    expect((await target.get("/mentions?before=../x")).status).toBe(400);
  });

  test("editing recomputes mentions; deleting removes them", async () => {
    const [author, target] = await Promise.all(["pg21", "pg22"].map(Client.login));
    const room = await author.createRoom({ members: ["pg22"] });
    const m = (await author.send(room.id, "plain")).body.message;
    const edited = await author.patch(`/messages/${m.id}`, { body: `now @${target.person.name}`, mentionIds: [target.id] });
    expect(edited.body.message.mentions.map((x: any) => x.id)).toEqual([target.id]);
    expect((await target.get("/mentions")).body.items.length).toBe(1);
    await author.del(`/messages/${m.id}`);
    expect((await target.get("/mentions")).body.items).toEqual([]);
  });
});

/* ---------------------------------------------------------- read cursor */

test.describe("read cursor and unread", () => {
  test("server-side unread: starts caught up, counts, advances, never rewinds", async () => {
    const [owner, reader] = await Promise.all(["pg23", "pg24"].map(Client.login));
    const room = await owner.createRoom();
    await owner.send(room.id, "history before joining");
    await owner.post(`/conversations/${room.id}/members`, { userIds: [reader.id] });
    // New member: caught up despite existing history.
    expect((await reader.listEntry(room.id)).unread).toBe(0);

    const first = (await owner.send(room.id, "one")).body.message;
    const second = (await owner.send(room.id, "two")).body.message;
    expect((await reader.listEntry(room.id)).unread).toBe(2);
    expect((await reader.summary()).unread).toBe(2);
    // The author's own sends never count as unread for them.
    expect((await owner.listEntry(room.id)).unread).toBe(0);

    // Reading pages of history does not mark anything read.
    await reader.page(room.id);
    await reader.page(room.id, `?before=${second.id}`);
    expect((await reader.listEntry(room.id)).unread).toBe(2);

    expect((await reader.post(`/conversations/${room.id}/read`, { messageId: second.id })).status).toBe(200);
    expect((await reader.listEntry(room.id)).unread).toBe(0);
    // An older cursor never moves it backwards.
    await reader.post(`/conversations/${room.id}/read`, { messageId: first.id });
    expect((await reader.listEntry(room.id)).lastReadMessageId).toBe(second.id);
    expect((await reader.listEntry(room.id)).unread).toBe(0);

    // Another device (a second session) sees the same state.
    const otherDevice = await Client.login("pg24");
    expect((await otherDevice.listEntry(room.id)).unread).toBe(0);
    await owner.send(room.id, "three");
    expect((await otherDevice.listEntry(room.id)).unread).toBe(1);
    expect((await reader.listEntry(room.id)).unread).toBe(1);

    // A cursor from another conversation, or a non-message, is refused.
    const elsewhere = await owner.createRoom({ members: ["pg24"] });
    const foreign = (await owner.send(elsewhere.id, "elsewhere")).body.message;
    expect((await reader.post(`/conversations/${room.id}/read`, { messageId: foreign.id })).status).toBe(400);
    expect((await reader.post(`/conversations/${room.id}/read`, { messageId: "not an id!" })).status).toBe(400);
  });

  test("mentions count separately; deleted messages stop counting", async () => {
    const [owner, reader] = await Promise.all(["pg25", "pg26"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg26"] });
    await owner.send(room.id, "plain");
    const mention = (await owner.send(room.id, `@${reader.person.name} look`, { mentionIds: [reader.id] })).body.message;
    expect(await reader.listEntry(room.id)).toMatchObject({ unread: 2, mentions: 1 });
    await owner.del(`/messages/${mention.id}`);
    expect(await reader.listEntry(room.id)).toMatchObject({ unread: 1, mentions: 0 });
    // Reading up to a deleted message is still a valid cursor.
    await reader.post(`/conversations/${room.id}/read`, { messageId: mention.id });
    expect(await reader.listEntry(room.id)).toMatchObject({ unread: 0, mentions: 0 });
  });
});

/* ------------------------------------------------------------ pagination */

test("pagination: bounded pages, stable cursors, edits, deletes and jumps", async () => {
  const [a, b] = await Promise.all(PAGING_ROOM.members.map(Client.login));
  const room = PAGING_ROOM.id;
  const bodies = (page: any) => page.messages.map((m: any) => m.body);
  const label = (n: number) => `History ${String(n).padStart(3, "0")}`;

  const first = (await b.page(room)).body;
  expect(first.messages).toHaveLength(40);
  expect(first).toMatchObject({ hasOlder: true, hasNewer: false });
  expect(bodies(first)).toEqual(Array.from({ length: 40 }, (_, i) => label(56 + i)));

  // A message arrives while paging back: older pages are unaffected...
  const live = (await a.send(room, "arrived mid-scroll")).body.message;
  const second = (await b.page(room, `?before=${first.messages[0].id}`)).body;
  expect(bodies(second)).toEqual(Array.from({ length: 40 }, (_, i) => label(16 + i)));
  const third = (await b.page(room, `?before=${second.messages[0].id}`)).body;
  expect(bodies(third)).toEqual(Array.from({ length: 15 }, (_, i) => label(1 + i)));
  expect(third.hasOlder).toBe(false);
  // ...and the new one is exactly what "after" the first page returns.
  const after = (await b.page(room, `?after=${first.messages.at(-1).id}`)).body;
  expect(after.messages.map((m: any) => m.id)).toEqual([live.id]);
  expect(after.hasNewer).toBe(false);

  // No duplicates, nothing missing, strictly ordered.
  const all = [...third.messages, ...second.messages, ...first.messages, ...after.messages].map((m: any) => m.id);
  expect(new Set(all).size).toBe(PAGING_ROOM.count + 1);
  expect([...all].sort()).toEqual(all);

  // Deleted and edited history keeps its place in the pages.
  const oldest = third.messages[0]; // authored by members[0]
  const secondOldest = third.messages[1]; // authored by members[1]
  await a.del(`/messages/${oldest.id}`);
  await b.patch(`/messages/${secondOldest.id}`, { body: "History 002 (corrected)" });
  const reread = (await b.page(room, `?before=${second.messages[0].id}`)).body.messages;
  expect(reread).toHaveLength(15);
  expect(reread[0]).toMatchObject({ id: oldest.id, deleted: true, body: "" });
  expect(reread[1]).toMatchObject({ id: secondOldest.id, body: "History 002 (corrected)" });
  expect(reread[1].editedAt).not.toBeNull();

  // Replying to a message far outside the loaded window.
  const target = third.messages[2];
  const reply = (await a.send(room, "about that old one", { replyToId: target.id })).body.message;
  expect(reply.replyTo).toMatchObject({ id: target.id, excerpt: label(3), deleted: false });
  const around = (await b.page(room, `?around=${target.id}`)).body;
  expect(around.messages.map((m: any) => m.id)).toContain(target.id);
  expect(around.messages.length).toBeLessThanOrEqual(40);
  expect(around).toMatchObject({ hasOlder: false, hasNewer: true });

  // Malformed cursors are refused; a foreign cursor cannot pull foreign rows.
  for (const q of ["?before=%27%20OR%201%3D1", "?after=x", "?around=" + "a".repeat(80)])
    expect((await b.page(room, q)).status).toBe(400);
  const other = await a.createRoom();
  const foreign = (await a.send(other.id, "not for b")).body.message;
  const leaked = (await b.page(room, `?around=${foreign.id}`)).body.messages;
  expect(leaked.every((m: any) => m.conversationId === room)).toBe(true);
});

/* ----------------------------------------------------------- idempotency */

test("idempotency: one message per author and key", async () => {
  const [a, b] = await Promise.all([Client.login("pg27"), Client.login("af5")]);
  const room = await a.createRoom();
  const other = await b.createRoom();
  const key = crypto.randomUUID();

  const once = await a.send(room.id, "exactly once", { clientKey: key });
  const retry = await a.send(room.id, "exactly once", { clientKey: key });
  expect(once.status).toBe(201);
  expect(retry.status).toBe(200);
  expect(retry.body.message.id).toBe(once.body.message.id);

  // A burst of network-style replays.
  const burstKey = crypto.randomUUID();
  const burst = await Promise.all(Array.from({ length: 5 }, () => a.send(room.id, "burst", { clientKey: burstKey })));
  expect(burst.every((r) => r.status === 200 || r.status === 201)).toBe(true);
  expect(new Set(burst.map((r) => r.body.message.id)).size).toBe(1);

  // Same text, different keys: two messages. Same key, different author: its own message.
  await a.send(room.id, "twice", { clientKey: crypto.randomUUID() });
  await a.send(room.id, "twice", { clientKey: crypto.randomUUID() });
  const theirs = await b.send(other.id, "same key, other author", { clientKey: key });
  expect(theirs.status).toBe(201);
  expect(theirs.body.message.id).not.toBe(once.body.message.id);
  // The same key reused in another conversation is a conflict, not a leak.
  const second = await a.createRoom();
  const reused = await a.send(second.id, "reuse", { clientKey: key });
  expect(reused.status).toBe(409);
  expect(JSON.stringify(reused.body)).not.toContain("exactly once");

  const page = (await a.page(room.id)).body.messages.map((m: any) => m.body);
  expect(page.filter((t: string) => t === "exactly once")).toHaveLength(1);
  expect(page.filter((t: string) => t === "burst")).toHaveLength(1);
  expect(page.filter((t: string) => t === "twice")).toHaveLength(2);
});

/* ------------------------------------------------------------------ input */

test("input: limits, cleaning, literal text and malformed requests", async () => {
  const a = await Client.login("pg13");
  const room = await a.createRoom();
  const send = (body: unknown) => a.post(`/conversations/${room.id}/messages`, { body });

  expect((await send("")).status).toBe(400);
  expect((await send("   \n\t  ")).status).toBe(400);
  expect((await send("x".repeat(4001))).status).toBe(400);
  expect((await send("x".repeat(4000))).status).toBe(201);
  expect((await send(42)).status).toBe(400);

  const multiline = (await send("line one\nline two\n\n\n\n\n\nline three")).body.message.body;
  expect(multiline).toBe("line one\nline two\n\n\nline three");
  expect((await send("a\u0000b\u0007c\u001bd\u007fe")).body.message.body).toBe("abcde");
  expect((await send("safe‮gnp.exe⁦x⁩")).body.message.body).toBe("safegnp.exex");
  const html = `<img src=x onerror=alert(1)><script>alert("x")</script> & "quotes"`;
  expect((await send(html)).body.message.body).toBe(html); // stored verbatim as text
  expect((await send("see https://example.com/path?q=1")).body.message.body).toBe("see https://example.com/path?q=1");

  // Malformed ids never reach a query.
  for (const bad of ["x", "../../api/users", "%27%3B--", "a".repeat(65)])
    expect((await a.get(`/conversations/${bad}`)).status).toBe(404);
  expect((await a.request("GET", "/api/collab/conversations/abc%2Fdef/messages")).status).toBe(404);
  expect((await a.patch(`/messages/nope`, { body: "x" })).status).toBe(404);
  expect((await a.request("POST", `/api/collab/conversations/${room.id}/messages`, undefined, { raw: "{not json" })).status).toBe(400);
  expect((await a.post(`/conversations/${room.id}/messages`, { body: "x", extra: true })).status).toBe(400);
  expect((await a.post(`/conversations/${room.id}/messages`, { body: "x", replyToId: "bad id" })).status).toBe(400);

  // Room names and descriptions.
  const room$ = (name: unknown, extra: Record<string, unknown> = {}) =>
    a.post("/conversations", { kind: "room", name, visibility: "private", company: "Petronik", memberIds: [], ...extra });
  expect((await room$("a")).status).toBe(400);
  expect((await room$("x".repeat(81))).status).toBe(400);
  expect((await room$("\u0000\u0001")).status).toBe(400);
  expect((await room$("Fine", { description: "d".repeat(281) })).status).toBe(400);
  expect((await room$("Fine", { visibility: "public" })).status).toBe(400);
  expect((await room$("Fine", { kind: "channel" })).status).toBe(400);
  expect((await a.patch(`/conversations/${room.id}`, { name: "x" })).status).toBe(400);
  expect((await a.patch(`/conversations/${room.id}`, { owner: "me" })).status).toBe(400);
  // Duplicate members collapse to one membership each.
  const dup = await a.createRoom({ members: ["pg14", "pg14", "pg14", "pg13"] });
  expect(dup.memberCount).toBe(2);
});

/* ------------------------------------------------------- origin, session */

test("every mutation needs the right origin and a live session", async () => {
  const a = await Client.login("pg14");
  const room = await a.createRoom();
  const msg = (await a.send(room.id, "target")).body.message;
  const mutations: [string, string, unknown][] = [
    ["POST", "/api/collab/conversations", { kind: "room", name: "Nope", visibility: "private", company: "Petronik", memberIds: [] }],
    ["PATCH", `/api/collab/conversations/${room.id}`, { name: "Nope" }],
    ["POST", `/api/collab/conversations/${room.id}/members`, { userIds: ids("pg15") }],
    ["PATCH", `/api/collab/conversations/${room.id}/members`, { userId: byKey("pg15").id, role: "admin" }],
    ["DELETE", `/api/collab/conversations/${room.id}/members?userId=${a.id}`, undefined],
    ["POST", `/api/collab/conversations/${room.id}/messages`, { body: "nope" }],
    ["POST", `/api/collab/conversations/${room.id}/read`, { messageId: msg.id }],
    ["PATCH", `/api/collab/messages/${msg.id}`, { body: "nope" }],
    ["DELETE", `/api/collab/messages/${msg.id}`, undefined],
  ];
  for (const [method, path, body] of mutations) {
    expect((await a.request(method, path, body, { origin: "https://attacker.example" })).status, `${method} ${path} foreign`).toBe(403);
    expect((await a.request(method, path, body, { origin: null })).status, `${method} ${path} no origin`).toBe(403);
    expect((await a.request(method, path, body, { cookie: null })).status, `${method} ${path} no session`).toBe(401);
    expect((await a.request(method, path, body, { cookie: "enercore_session=forged" })).status, `${method} ${path} forged`).toBe(401);
  }
  for (const path of ["/conversations", "/summary", "/mentions", "/people", `/conversations/${room.id}/messages`])
    expect((await a.request("GET", `/api/collab${path}`, undefined, { cookie: null })).status, path).toBe(401);
  // Nothing above changed anything.
  const page = (await a.page(room.id)).body.messages;
  expect(page.map((m: any) => m.body)).toEqual(["target"]);
  expect((await a.get(`/conversations/${room.id}`)).body.members).toHaveLength(1);

  // The socket applies the same checks.
  expect(await upgradeStatus({ Origin: WORKER, Cookie: a.cookie })).toBe(101);
  expect(await upgradeStatus({ Origin: "https://attacker.example", Cookie: a.cookie })).toBe(403);
  expect(await upgradeStatus({ Cookie: a.cookie })).toBe(403);
  expect(await upgradeStatus({ Origin: WORKER })).toBe(401);
  expect(await upgradeStatus({ Origin: WORKER, Cookie: "enercore_session=forged" })).toBe(401);
  // A plain request to the socket path is not an upgrade.
  expect((await a.request("GET", "/api/collab/socket")).status).toBe(426);
});

test("an inactive account is refused by the API and the socket", async () => {
  const a = await Client.login("pg15");
  const cookie = a.cookie;
  expect(await upgradeStatus({ Origin: WORKER, Cookie: cookie })).toBe(101);
  await admin.updateUser("pg15", { active: false });
  expect((await a.get("/conversations")).status).toBe(401);
  expect((await a.post("/conversations", { kind: "direct", userId: byKey("pg16").id })).status).toBe(401);
  expect(await upgradeStatus({ Origin: WORKER, Cookie: cookie })).toBe(401);
});

/* ---------------------------------------------------------- rate limits */

test("sending, room creation and DM creation are rate limited with a clean 429", async () => {
  const a = await Client.login("pg26");
  const room = await a.createRoom();
  // One room already created above; nine more are allowed, the eleventh is not.
  const rooms = [];
  for (let i = 0; i < 10; i++) rooms.push((await a.post("/conversations", { kind: "room", name: `Burst ${i}`, visibility: "private", company: "Petronik", memberIds: [] })).status);
  expect(rooms.slice(0, 9).every((s) => s === 201)).toBe(true);
  expect(rooms[9]).toBe(429);

  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await a.send(room.id, `m${i}`)).status);
  expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
  const limited = await a.send(room.id, "one too many");
  expect(limited.status).toBe(429);
  expect(limited.body.error).toMatch(/too quickly/);
  // Reads are not limited.
  for (let i = 0; i < 40; i++) expect((await a.page(room.id)).status).toBe(200);

  // DM creation: reopening an existing thread is free; new threads count,
  // and the 31st new thread within the hour is refused.
  const b = await Client.login("pg27");
  expect((await b.openDirect("pg13")).status).toBe(201);
  for (let i = 0; i < 5; i++) expect((await b.openDirect("pg13")).status).toBe(200);
  // Dedicated targets (rl1–rl32): no other test's people are touched.
  const created: number[] = [];
  for (let i = 1; i <= 30; i++) created.push((await b.openDirect(`rl${i}`)).status);
  expect(created.slice(0, 29).every((s) => s === 201)).toBe(true);
  expect(created[29]).toBe(429);
});
