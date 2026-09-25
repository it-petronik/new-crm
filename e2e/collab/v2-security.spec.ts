import { test, expect } from "@playwright/test";
import { Client, FILES, PNG, ids, openSocket, sized } from "./client";
import { byKey } from "./people";

/**
 * Collaboration V2 security: attachments (IDOR, type spoofing, limits,
 * lifecycle, deletion), reactions, typing, room avatars and audio ranges.
 * Against the built Worker with local D1, Durable Objects and R2.
 * People used here: v1–v24, vd1–vd2, vf1–vf2 (exclusive to this file).
 */

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login("admin");
});

const MB = 1024 * 1024;
const MISSING = "00000000-0000-4000-8000-000000000000";

async function sendWith(client: Client, conversationId: string, attachmentIds: string[], body = "") {
  return client.send(conversationId, body, { attachmentIds });
}

/** Uploads a PNG and sends it; returns the sent attachment. */
async function shared(owner: Client, conversationId: string, thumb = true) {
  const up = await owner.upload(conversationId, FILES.png, { width: "1", height: "1" }, thumb ? { name: "t.png", bytes: PNG } : undefined);
  expect(up.status).toBe(201);
  const sent = await sendWith(owner, conversationId, [up.body.attachment.id], "see attached");
  expect(sent.status).toBe(201);
  return sent.body.message.attachments[0] as { id: string; url: string; thumbUrl: string | null; downloadUrl: string };
}

/* ------------------------------------------------------------- IDOR */

test.describe("attachment access", () => {
  test("members read; strangers get the same 404 as a missing file", async () => {
    const [owner, member, stranger] = await Promise.all(["v1", "v2", "v3"].map(Client.login));
    const room = await owner.createRoom({ members: ["v2"] });
    const file = await shared(owner, room.id);

    for (const url of [file.url, file.thumbUrl!, file.downloadUrl]) expect((await member.file(url)).status, url).toBe(200);
    const download = await member.file(file.downloadUrl);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="photo.png"/);

    const missing = await stranger.file(`/api/collab/files/${MISSING}`);
    for (const url of [file.url, file.thumbUrl!, file.downloadUrl]) {
      const r = await stranger.file(url);
      expect(r.status).toBe(404);
      expect(new TextDecoder().decode(r.bytes)).toBe(new TextDecoder().decode(missing.bytes));
    }
    // No session at all.
    expect((await fetch(`http://localhost:8788${file.url}`)).status).toBe(401);
    // Storage keys are never exposed, and a key-shaped path reaches nothing.
    const page = await member.page(room.id);
    expect(JSON.stringify(page.body)).not.toMatch(/att\/[0-9a-f]{20}/);
    for (const guess of ["/api/collab/files/att%2F0123456789abcdef", "/api/collab/files/att", `/api/collab/files/${"a".repeat(80)}`])
      expect([401, 404]).toContain((await member.file(guess)).status);
    // Browsing another room's media is the same 404 as the room.
    expect((await stranger.get(`/conversations/${room.id}/attachments?kind=media`)).status).toBe(404);
  });

  test("losing membership, activity or scope removes access at once", async () => {
    const [owner, removed, deactivated, movedCompany] = await Promise.all(["v4", "v5", "v6", "v7"].map(Client.login));
    const room = await owner.createRoom({ members: ["v5", "v6", "v7"] });
    const file = await shared(owner, room.id);
    for (const c of [removed, deactivated, movedCompany]) expect((await c.file(file.url)).status).toBe(200);

    await owner.del(`/conversations/${room.id}/members?userId=${removed.id}`);
    expect((await removed.file(file.url)).status).toBe(404);
    expect((await removed.file(file.thumbUrl!)).status).toBe(404);

    await admin.updateUser("v6", { active: false });
    expect((await deactivated.file(file.url)).status).toBe(401);

    await admin.moveUser("v7", ["Afrilube"], []);
    const moved = await Client.login("v7");
    expect((await moved.file(file.url)).status).toBe(404);

    // Branch scope: a Dubai room's file is gone for someone moved to Abu Dhabi.
    const dubai = await Client.login("vd1");
    const branchRoom = await dubai.createRoom({ branch: "Dubai", members: ["vd2"] });
    const branchFile = await shared(dubai, branchRoom.id);
    expect((await (await Client.login("vd2")).file(branchFile.url)).status).toBe(200);
    await admin.moveUser("vd2", ["Petronik"], ["Abu Dhabi"]);
    expect((await (await Client.login("vd2")).file(branchFile.url)).status).toBe(404);
  });

  test("a pending upload is visible to its uploader only and cannot be claimed", async () => {
    const [owner, member] = await Promise.all(["v8", "v9"].map(Client.login));
    const room = await owner.createRoom({ members: ["v9"] });
    const other = await owner.createRoom();
    const up = (await owner.upload(room.id, FILES.pdf)).body.attachment;

    expect((await owner.file(up.url)).status).toBe(200);
    expect((await member.file(up.url)).status).toBe(404);
    // Not listed in browsing while pending.
    expect((await member.get(`/conversations/${room.id}/attachments?kind=files`)).body.items).toEqual([]);
    // Another member cannot send it, and it cannot move to another room.
    expect((await sendWith(member, room.id, [up.id])).status).toBe(400);
    expect((await sendWith(owner, other.id, [up.id])).status).toBe(400);
    expect((await member.del(`/attachments/${up.id}`)).status).toBe(404);

    // A failed send leaves it pending and private.
    expect((await sendWith(owner, room.id, [up.id], "x".repeat(4001))).status).toBe(400);
    expect((await member.file(up.url)).status).toBe(404);

    // Idempotent retry: one message, one link.
    const key = crypto.randomUUID();
    const first = await owner.send(room.id, "", { attachmentIds: [up.id], clientKey: key });
    const again = await owner.send(room.id, "", { attachmentIds: [up.id], clientKey: key });
    expect(first.status).toBe(201);
    expect(again.body.message.id).toBe(first.body.message.id);
    expect(again.body.message.attachments).toHaveLength(1);
    expect((await member.file(up.url)).status).toBe(200);
    // Already linked: cannot be linked a second time.
    expect((await sendWith(owner, room.id, [up.id])).status).toBe(400);

    // Discarding a pending upload makes it unreachable and unusable.
    const spare = (await owner.upload(room.id, FILES.txt)).body.attachment;
    expect((await owner.del(`/attachments/${spare.id}`)).status).toBe(200);
    expect((await owner.file(spare.url)).status).toBe(404);
    expect((await sendWith(owner, room.id, [spare.id])).status).toBe(400);
  });

  test("a deleted message's files are gone at once, everywhere", async () => {
    const [owner, member] = await Promise.all(["v10", "v11"].map(Client.login));
    const room = await owner.createRoom({ members: ["v11"] });
    const file = await shared(owner, room.id);
    const message = (await member.page(room.id)).body.messages.at(-1);
    expect((await member.get(`/conversations/${room.id}/attachments?kind=media`)).body.items).toHaveLength(1);

    await owner.del(`/messages/${message.id}`);
    for (const url of [file.url, file.thumbUrl!, file.downloadUrl]) {
      expect((await member.file(url)).status, url).toBe(404);
      expect((await owner.file(url)).status, url).toBe(404);
    }
    expect((await member.get(`/conversations/${room.id}/attachments?kind=media`)).body.items).toEqual([]);
    const after = (await member.page(room.id)).body.messages.at(-1);
    expect(after).toMatchObject({ deleted: true, attachments: [], reactions: [] });
  });
});

/* ------------------------------------------------------- type spoofing */

test("only genuine, allowed types are accepted and nothing active renders inline", async () => {
  const owner = await Client.login("v12");
  const room = await owner.createRoom();
  for (const f of [FILES.png, FILES.jpg, FILES.pdf, FILES.docx, FILES.xlsx, FILES.doc, FILES.txt, FILES.csv, FILES.webm, FILES.htmlAsTxt])
    expect((await owner.upload(room.id, f, {}, undefined)).status, f.name).toBe(201);
  const rejected = [
    FILES.htmlAsJpg, FILES.textAsPdf, FILES.docxAsJpg, FILES.html, FILES.htm, FILES.svg,
    FILES.svgAsPng, FILES.js, FILES.exe, FILES.exeAsPdf, FILES.zip,
  ];
  for (const f of rejected) {
    // A browser-claimed type cannot help either.
    const r = await owner.upload(room.id, { ...f, type: "image/png" });
    expect(r.status, f.name).toBe(415);
  }
  const zip = await owner.upload(room.id, FILES.zip);
  expect(zip.body.error).toMatch(/ZIP archives aren't accepted/);

  // Served types come from the bytes, never the claim; text never renders.
  const text = (await owner.upload(room.id, { ...FILES.htmlAsTxt, type: "text/html" })).body.attachment;
  expect(text.mimeType).toBe("text/plain; charset=utf-8");
  const served = await owner.file(text.url);
  expect(served.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(served.headers.get("content-disposition")).toMatch(/^attachment;/);
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(served.headers.get("content-security-policy")).toContain("sandbox");

  const image = (await owner.upload(room.id, FILES.png)).body.attachment;
  const img = await owner.file(image.url);
  expect(img.headers.get("content-type")).toBe("image/png");
  expect(img.headers.get("content-disposition")).toMatch(/^inline;/);
  expect(img.headers.get("content-security-policy")).toContain("sandbox");
  expect(img.headers.get("x-frame-options")).toBe("DENY");

  const pdf = (await owner.upload(room.id, FILES.pdf)).body.attachment;
  const p = await owner.file(pdf.url);
  expect(p.headers.get("content-type")).toBe("application/pdf");
  expect(p.headers.get("content-disposition")).toMatch(/^inline;/);
  expect(p.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  expect(p.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(p.headers.get("cache-control")).toBe("private, no-store");

  const docx = (await owner.upload(room.id, FILES.docx)).body.attachment;
  expect((await owner.file(docx.url)).headers.get("content-disposition")).toMatch(/^attachment;/);

  // Hostile filenames are neutralised in storage and in the header.
  const odd = (await owner.upload(room.id, { name: '../../etc/"evil"\r\nX-Injected: 1;.pdf', bytes: FILES.pdf.bytes })).body.attachment;
  expect(odd.name).not.toMatch(/[\\/"\r\n]/);
  const oddHead = (await owner.file(odd.downloadUrl)).headers;
  expect(oddHead.get("x-injected")).toBeNull();
  expect(oddHead.get("content-disposition")).toMatch(/filename\*=UTF-8''/);
});

/* --------------------------------------------------------------- limits */

test("size and count limits are enforced by the server", async () => {
  test.setTimeout(240_000);
  const owner = await Client.login("v13");
  const room = await owner.createRoom();
  const png = (size: number) => ({ name: "big.png", bytes: sized(PNG, size) });
  const pdf = (size: number) => ({ name: "big.pdf", bytes: sized(FILES.pdf.bytes, size) });
  const webm = (size: number) => ({ name: "long.webm", bytes: sized(FILES.webm.bytes, size) });
  expect((await owner.upload(room.id, png(15 * MB))).status).toBe(201);
  expect((await owner.upload(room.id, png(15 * MB + 1))).status).toBe(413);
  expect((await owner.upload(room.id, pdf(25 * MB))).status).toBe(201);
  expect((await owner.upload(room.id, pdf(25 * MB + 1))).status).toBe(413);
  expect((await owner.upload(room.id, webm(10 * MB))).status).toBe(201);
  expect((await owner.upload(room.id, webm(10 * MB + 1))).status).toBe(413);
  expect((await owner.upload(room.id, { name: "empty.txt", bytes: new Uint8Array(0) })).status).toBe(400);

  // Voice duration: kept up to five minutes (with a little slack), dropped beyond.
  const ok = (await owner.upload(room.id, FILES.webm, { durationMs: String(299_000) })).body.attachment;
  const tooLong = (await owner.upload(room.id, FILES.webm, { durationMs: String(10 * 60_000) })).body.attachment;
  expect(ok.durationMs).toBe(299_000);
  expect(tooLong.durationMs).toBeNull();

  // Ten files per message; the eleventh is refused.
  const eleven = [];
  for (let i = 0; i < 11; i++) eleven.push((await owner.upload(room.id, FILES.txt)).body.attachment.id);
  expect((await sendWith(owner, room.id, eleven)).status).toBe(400);
  expect((await sendWith(owner, room.id, eleven.slice(0, 10))).status).toBe(201);

  // Room image: 2 MB.
  const avatar = (size: number) => owner.upload(room.id, { name: "a.png", bytes: sized(PNG, size) }, {}, undefined, {
    path: `/api/collab/conversations/${room.id}/avatar`,
    field: "image",
  });
  expect((await avatar(2 * MB)).status).toBe(200);
  expect((await avatar(2 * MB + 1)).status).toBe(413);
});

/* ------------------------------------------------------------ reactions */

test("reactions: toggle, no duplicates, members only, cleared with the message, live", async () => {
  const [owner, member, stranger] = await Promise.all(["v14", "v15", "v16"].map(Client.login));
  const room = await owner.createRoom({ members: ["v15"] });
  const message = (await owner.send(room.id, "react to me")).body.message;
  const ws = await openSocket(owner.cookie);
  const react = (c: Client, emoji: string, on: boolean) => c.post(`/messages/${message.id}/reactions`, { emoji, on });

  expect((await react(member, "👍", true)).body.reactions).toEqual([{ emoji: "👍", userIds: [member.id] }]);
  await react(member, "👍", true); // repeated: still one
  await react(owner, "👍", true);
  await react(owner, "🎉", true);
  const all = (await react(member, "👍", true)).body.reactions;
  expect(all).toEqual([
    { emoji: "👍", userIds: [member.id, owner.id] },
    { emoji: "🎉", userIds: [owner.id] },
  ]);
  const event = await ws.waitFor((e) => e.type === "reaction" && e.messageId === message.id && e.reactions.length === 2);
  expect(event.reactions[0].userIds).toHaveLength(2);
  expect((await react(member, "👍", false)).body.reactions[0]).toEqual({ emoji: "👍", userIds: [owner.id] });
  // History carries exactly the same state (no duplicates after reload).
  expect((await member.page(room.id)).body.messages.at(-1).reactions).toEqual([
    { emoji: "👍", userIds: [owner.id] },
    { emoji: "🎉", userIds: [owner.id] },
  ]);

  expect((await react(member, "<script>", true)).status).toBe(400);
  expect((await react(member, "💀", true)).status).toBe(400); // not in the set
  expect((await react(stranger, "👍", true)).status).toBe(404);
  await owner.del(`/conversations/${room.id}/members?userId=${member.id}`);
  expect((await react(member, "👍", true)).status).toBe(404);

  await owner.del(`/messages/${message.id}`);
  expect((await react(owner, "👍", true)).status).toBe(409);
  expect((await owner.page(room.id)).body.messages.at(-1).reactions).toEqual([]);
  ws.ws.close();
});

/* --------------------------------------------------------------- typing */

test("typing: members only, never read-only or out of scope, throttled at the sender", async () => {
  const [owner, member, stranger, outsider] = await Promise.all(["v17", "v18", "v19", "vf1"].map(Client.login));
  const room = await owner.createRoom({ members: ["v18"] });
  const ws = await openSocket(member.cookie);
  const type = (c: Client, id: string, state = "start") => c.post(`/conversations/${id}/typing`, { state });

  expect((await type(owner, room.id)).status).toBe(200);
  const event = await ws.waitFor((e) => e.type === "typing" && e.conversationId === room.id);
  expect(event).toMatchObject({ userId: owner.id, name: owner.person.name, state: "start" });
  expect((await type(stranger, room.id)).status).toBe(404);
  expect((await type(outsider, room.id)).status).toBe(404);

  // A flood from one sender produces one event and cheap, quiet refusals.
  const statuses = [];
  for (let i = 0; i < 15; i++) statuses.push((await type(owner, room.id)).status);
  expect(statuses.every((s) => s === 202)).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  expect(ws.events.filter((e) => e.type === "typing" && e.state === "start")).toHaveLength(1);
  expect((await type(owner, room.id, "stop")).status).toBe(200);

  // Archived: read-only.
  await owner.patch(`/conversations/${room.id}`, { archived: true });
  expect((await type(member, room.id)).status).toBe(403);
  // Read-only DM (counterpart deactivated).
  const dm = (await member.openDirect("v19")).body.conversation;
  await admin.updateUser("v19", { active: false });
  expect((await type(member, dm.id)).status).toBe(403);
  // Removed member.
  const room2 = await owner.createRoom({ members: ["v18"] });
  await owner.del(`/conversations/${room2.id}/members?userId=${member.id}`);
  expect((await type(member, room2.id)).status).toBe(404);
  ws.ws.close();
});

/* ---------------------------------------------------------- room images */

test("room images: owners/admins only, validated, replaced and removed cleanly, live", async () => {
  const [owner, member, stranger] = await Promise.all(["v20", "v21", "v22"].map(Client.login));
  const room = await owner.createRoom({ members: ["v21"], visibility: "private" });
  const avatar = (c: Client, file: { name: string; bytes: Uint8Array }) =>
    c.upload(room.id, file, {}, undefined, { path: `/api/collab/conversations/${room.id}/avatar`, field: "image" });
  const ws = await openSocket(member.cookie);

  expect((await avatar(member, FILES.png)).status).toBe(403);
  expect((await avatar(stranger, FILES.png)).status).toBe(404);
  expect((await avatar(owner, FILES.pdf)).status).toBe(415);
  expect((await avatar(owner, FILES.svgAsPng)).status).toBe(415);

  const first = await avatar(owner, FILES.png);
  expect(first.status).toBe(200);
  const v1 = first.body.conversation.avatarVersion;
  expect(v1).toBeGreaterThan(0);
  await ws.waitFor((e) => e.type === "conversation.changed" && e.conversationId === room.id);
  expect((await member.file(`/api/collab/rooms/${room.id}/avatar?v=${v1}`)).status).toBe(200);
  expect((await stranger.file(`/api/collab/rooms/${room.id}/avatar?v=${v1}`)).status).toBe(404);

  await new Promise((r) => setTimeout(r, 5));
  const second = await avatar(owner, { name: "b.jpg", bytes: FILES.jpg.bytes });
  const v2 = second.body.conversation.avatarVersion;
  expect(v2).toBeGreaterThan(v1);
  const now = await member.file(`/api/collab/rooms/${room.id}/avatar?v=${v2}`);
  expect(now.headers.get("content-type")).toBe("image/jpeg");

  const removed = await owner.del(`/conversations/${room.id}/avatar`);
  expect(removed.body.conversation.avatarVersion).toBeNull();
  expect((await member.file(`/api/collab/rooms/${room.id}/avatar?v=${v2}`)).status).toBe(404);
  // Admin (not owner) may manage it too.
  await owner.patch(`/conversations/${room.id}/members`, { userId: member.id, role: "admin" });
  expect((await avatar(member, FILES.png)).status).toBe(200);
  ws.ws.close();
});

/* ---------------------------------------------------------- voice / range */

test("voice notes: authorised, seekable by range, gone when deleted", async () => {
  const [owner, member, stranger] = await Promise.all(["v23", "v24", "v1"].map(Client.login));
  const room = await owner.createRoom({ members: ["v24"] });
  const up = (await owner.upload(room.id, FILES.webm, { durationMs: "4200" })).body.attachment;
  const sent = (await sendWith(owner, room.id, [up.id])).body.message;
  expect(sent.attachments[0]).toMatchObject({ kind: "audio", durationMs: 4200, mimeType: "audio/webm" });

  const full = await member.file(up.url);
  expect(full.status).toBe(200);
  expect(full.headers.get("accept-ranges")).toBe("bytes");
  const part = await member.file(up.url, { Range: "bytes=4-19" });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe(`bytes 4-19/${FILES.webm.bytes.length}`);
  expect([...part.bytes]).toEqual([...FILES.webm.bytes.subarray(4, 20)]);
  const tail = await member.file(up.url, { Range: "bytes=-8" });
  expect([...tail.bytes]).toEqual([...FILES.webm.bytes.subarray(-8)]);

  expect((await stranger.file(up.url)).status).toBe(404);
  await owner.del(`/messages/${sent.id}`);
  expect((await member.file(up.url, { Range: "bytes=0-3" })).status).toBe(404);
});

/* -------------------------------------------------- cache revalidation */

test("private media revalidates through the access check", async () => {
  const [owner, member] = await Promise.all(["v2", "v3"].map(Client.login));
  const room = await owner.createRoom({ members: ["v3"] });
  const file = await shared(owner, room.id);
  const first = await member.file(file.url);
  expect(first.headers.get("cache-control")).toBe("private, no-cache");
  const etag = first.headers.get("etag")!;
  expect((await member.file(file.url, { "If-None-Match": etag })).status).toBe(304);
  await owner.del(`/conversations/${room.id}/members?userId=${member.id}`);
  // A revalidation after removal is refused, not answered 304.
  expect((await member.file(file.url, { "If-None-Match": etag })).status).toBe(404);
  void ids;
  void byKey;
});
