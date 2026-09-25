import { test, expect } from "@playwright/test";
import { Client, openSocket, type Socket } from "./client";

/**
 * Realtime delivery through the real gateway and CollabHub Durable Object.
 * People used here: pg28–pg33, pd7, pd8, af6 (exclusive to this file).
 */

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login("admin");
});

const about = (conversationId: string, type?: string) => (e: any) =>
  e.conversationId === conversationId && (!type || e.type === type);

test("events reach current members on every device, and nobody else", async () => {
  const [owner, member, colleague, outsider] = await Promise.all(["pg28", "pg29", "pg30", "af6"].map(Client.login));
  const room = await owner.createRoom({ members: ["pg29"], visibility: "private" });
  const memberPhone = await Client.login("pg29");
  const sockets: Socket[] = await Promise.all([
    openSocket(owner.cookie),
    openSocket(member.cookie),
    openSocket(memberPhone.cookie),
    openSocket(colleague.cookie),
    openSocket(outsider.cookie),
  ]);
  const [ownerWs, memberWs, phoneWs, colleagueWs, outsiderWs] = sockets;

  const sent = (await owner.send(room.id, "live hello")).body.message;
  for (const s of [ownerWs, memberWs, phoneWs]) {
    const event = await s.waitFor(about(room.id, "message.created"));
    expect(event.message).toMatchObject({ id: sent.id, body: "live hello" });
  }
  // Same company but not a member, and another company: nothing at all.
  await Promise.all([colleagueWs.none(about(room.id)), outsiderWs.none(about(room.id))]);

  // Edit and delete propagate; a delete carries no words.
  await owner.patch(`/messages/${sent.id}`, { body: "live hello, edited" });
  expect((await memberWs.waitFor(about(room.id, "message.updated"))).message.body).toBe("live hello, edited");
  await owner.del(`/messages/${sent.id}`);
  const deleted = await memberWs.waitFor(about(room.id, "message.deleted"));
  expect(deleted).toEqual({ type: "message.deleted", conversationId: room.id, messageId: sent.id });

  // A read on one device reaches the reader's other devices only.
  const next = (await owner.send(room.id, "read me")).body.message;
  await memberWs.waitFor((e) => e.type === "message.created" && e.message.id === next.id);
  await member.post(`/conversations/${room.id}/read`, { messageId: next.id });
  expect(await phoneWs.waitFor(about(room.id, "read"))).toMatchObject({ lastReadMessageId: next.id });
  await ownerWs.none(about(room.id, "read"), 1000);

  await Promise.all([colleagueWs.none(about(room.id), 500), outsiderWs.none(about(room.id), 500)]);
  for (const s of sockets) s.ws.close();
});

test("a removed member stops receiving immediately", async () => {
  const [owner, member] = await Promise.all(["pg31", "pg32"].map(Client.login));
  const room = await owner.createRoom({ members: ["pg32"] });
  const ws = await openSocket(member.cookie);
  await owner.send(room.id, "while a member");
  await ws.waitFor(about(room.id, "message.created"));

  await owner.del(`/conversations/${room.id}/members?userId=${member.id}`);
  await ws.waitFor(about(room.id, "conversation.removed"));
  await owner.send(room.id, "after removal");
  await ws.none((e) => e.type === "message.created" && e.message.body === "after removal");
  ws.ws.close();
});

test("a deactivated or moved member's open socket gets nothing further", async () => {
  const [owner, leaver, mover] = await Promise.all(["pg33", "pd7", "pd8"].map(Client.login));
  const room = await owner.createRoom({ members: ["pd7", "pd8"], branch: null });
  const leaverWs = await openSocket(leaver.cookie);
  const moverWs = await openSocket(mover.cookie);
  await owner.send(room.id, "everyone");
  await leaverWs.waitFor(about(room.id, "message.created"));
  await moverWs.waitFor(about(room.id, "message.created"));

  // Both keep their membership rows and their sockets stay open, but the
  // audience is recomputed from current access on every event.
  await admin.updateUser("pd7", { active: false });
  await admin.moveUser("pd8", ["Afrilube"], []);
  await owner.send(room.id, "not for you two");
  await Promise.all([
    leaverWs.none((e) => e.type === "message.created" && e.message.body === "not for you two"),
    moverWs.none((e) => e.type === "message.created" && e.message.body === "not for you two"),
  ]);
  leaverWs.ws.close();
  moverWs.ws.close();
});

test("the socket carries no client-originated mutations", async () => {
  const [owner] = await Promise.all(["pg30"].map(Client.login));
  const room = await owner.createRoom();
  const ws = await openSocket(owner.cookie);
  ws.ws.send(JSON.stringify({ type: "message.created", conversationId: room.id, message: { body: "forged" } }));
  ws.ws.send(JSON.stringify({ method: "POST", path: `/api/collab/conversations/${room.id}/messages`, body: "forged" }));
  ws.ws.send("ping");
  await ws.waitFor((e) => e.type === "pong");
  // Nothing was echoed or created, and the socket is still healthy.
  await ws.none((e) => e.type === "message.created", 1000);
  expect((await owner.page(room.id)).body.messages).toEqual([]);
  await owner.send(room.id, "real");
  expect((await ws.waitFor(about(room.id, "message.created"))).message.body).toBe("real");
  ws.ws.close();
});

test("signing out ends live delivery on the next event after revalidation", async () => {
  test.setTimeout(150_000);
  const [owner, member] = await Promise.all(["pg28", "pg29"].map(Client.login));
  const room = await owner.createRoom({ members: ["pg29"] });
  const ws = await openSocket(member.cookie);
  // A real client pings every 45 s; keep this one alive the same way, so it
  // is ended by session revalidation (4401), not pruned as a dead tab.
  const alive = setInterval(() => {
    try {
      ws.ws.send("ping");
    } catch {}
  }, 1000);
  // Sign out: the session row is deleted, the socket is still open.
  expect((await member.request("DELETE", "/api/auth")).status).toBe(200);
  // Within the revalidation window the hub has not re-checked yet; the
  // audience still includes this active member, whose other sessions are
  // legitimately live. After the window, the socket is closed, not fed.
  await new Promise((r) => setTimeout(r, 62_000));
  await owner.send(room.id, "after sign-out");
  expect(await ws.closed).toBe(4401);
  clearInterval(alive);
  expect(ws.events.some((e) => e.type === "message.created" && e.message.body === "after sign-out")).toBe(false);
});
