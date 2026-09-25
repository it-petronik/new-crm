import { test, expect } from "@playwright/test";
import { Client, ids } from "./client";
import { byKey } from "./people";

/**
 * Authorization and IDOR. People used here: pg1–pg12, pd1–pd5, pa1–pa3,
 * af1–af3 (exclusive to this file).
 */

let admin: Client;
test.beforeAll(async () => {
  admin = await Client.login("admin");
});

const MISSING = "00000000-0000-4000-8000-000000000000";

/**
 * Everything a stranger can try with a conversation id. Each must answer
 * exactly as it does for an id that does not exist — same status, same body —
 * so an id reveals nothing.
 */
async function probe(client: Client, id: string) {
  return {
    detail: await client.get(`/conversations/${id}`),
    page: await client.get(`/conversations/${id}/messages`),
    around: await client.get(`/conversations/${id}/messages?around=${MISSING}`),
    send: await client.post(`/conversations/${id}/messages`, { body: "let me in" }),
    read: await client.post(`/conversations/${id}/read`, { messageId: MISSING }),
    join: await client.post(`/conversations/${id}/members`, { join: true }),
    leave: await client.del(`/conversations/${id}/members?userId=${client.id}`),
  };
}

async function expectIndistinguishable(client: Client, id: string) {
  const real = await probe(client, id);
  const missing = await probe(client, MISSING);
  for (const key of Object.keys(real) as (keyof typeof real)[]) {
    expect(real[key].status, key).toBe(404);
    expect(real[key], key).toEqual(missing[key]);
  }
}

test.describe("private room", () => {
  test("a member reads; a non-member learns nothing from the id", async () => {
    const [owner, member, stranger] = await Promise.all(["pg1", "pg2", "pg3"].map(Client.login));
    const room = await owner.createRoom({ name: "Private ops", members: ["pg2"] });
    await owner.send(room.id, "secret plan");

    expect((await member.get(`/conversations/${room.id}`)).status).toBe(200);
    const page = await member.page(room.id);
    expect(page.status).toBe(200);
    expect(page.body.messages.map((m: any) => m.body)).toContain("secret plan");

    await expectIndistinguishable(stranger, room.id);
    // Not listed, not discoverable, not in anyone else's list.
    expect((await stranger.get("/conversations")).body.conversations.some((c: any) => c.id === room.id)).toBe(false);
    expect((await stranger.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(false);
    // Admin-only listing of addable people is refused too.
    expect((await stranger.get(`/people?conversationId=${room.id}`)).status).toBe(404);
  });

  test("a removed member loses access immediately", async () => {
    const [owner, member] = await Promise.all(["pg4", "pg5"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg5"] });
    await owner.send(room.id, "before removal");
    expect((await member.page(room.id)).status).toBe(200);
    expect((await owner.del(`/conversations/${room.id}/members?userId=${member.id}`)).status).toBe(200);
    await expectIndistinguishable(member, room.id);
    expect((await member.get("/mentions")).status).toBe(200);
  });

  test("a deactivated member is signed out of everything", async () => {
    const [owner, member] = await Promise.all(["pg6", "pg7"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg7"] });
    await admin.updateUser("pg7", { active: false });
    for (const result of [
      await member.get("/conversations"),
      await member.page(room.id),
      await member.send(room.id, "still here?"),
      await member.get("/summary"),
    ])
      expect(result.status).toBe(401);
    // And cannot sign back in.
    await expect(Client.login("pg7")).rejects.toThrow(/401/);
  });

  test("people outside the company cannot discover, read or be added", async () => {
    const [owner, outsider] = await Promise.all(["pg8", "af1"].map(Client.login));
    const room = await owner.createRoom({ visibility: "workspace", name: "Petronik open room" });
    await expectIndistinguishable(outsider, room.id);
    expect((await outsider.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(false);
    const add = await owner.post(`/conversations/${room.id}/members`, { userIds: ids("af1") });
    expect(add.status).toBe(400);
    // Creating a room in someone else's company is refused.
    const foreign = await owner.post("/conversations", {
      kind: "room", name: "Not mine", visibility: "private", company: "Afrilube", memberIds: [],
    });
    expect(foreign.status).toBe(403);
  });

  test("a branch room is invisible to another branch, visible to group-wide", async () => {
    const [dubai, abuDhabi, group] = await Promise.all(["pd1", "pa1", "pg9"].map(Client.login));
    const room = await dubai.createRoom({ visibility: "workspace", branch: "Dubai", name: "Dubai desk" });
    expect(room.branch).toBe("Dubai");
    await expectIndistinguishable(abuDhabi, room.id);
    expect((await abuDhabi.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(false);
    expect((await dubai.post(`/conversations/${room.id}/members`, { userIds: ids("pa1") })).status).toBe(400);
    // A group-wide colleague in the company can see and join it.
    expect((await group.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(true);
    // A branch-scoped person may not open a room to the whole company, or to
    // another branch.
    for (const branch of [null, "Abu Dhabi"]) {
      const r = await dubai.post("/conversations", {
        kind: "room", name: "Too wide", visibility: "private", company: "Petronik", branch, memberIds: [],
      });
      expect(r.status).toBe(403);
    }
  });

  test("moving a member out of the room's branch removes access at once", async () => {
    const [owner] = await Promise.all(["pd2"].map(Client.login));
    const room = await owner.createRoom({ branch: "Dubai", members: ["pd3"] });
    await owner.send(room.id, "branch news");
    await admin.moveUser("pd3", ["Petronik"], ["Abu Dhabi"]);
    const moved = await Client.login("pd3");
    await expectIndistinguishable(moved, room.id);
    expect((await moved.get("/conversations")).body.conversations.some((c: any) => c.id === room.id)).toBe(false);
  });
});

test.describe("workspace room", () => {
  test("eligible people discover and join; private rooms never appear", async () => {
    const [owner, eligible] = await Promise.all(["pg10", "pg11"].map(Client.login));
    const open = await owner.createRoom({ visibility: "workspace", name: "Open floor", description: "All welcome" });
    const hidden = await owner.createRoom({ visibility: "private", name: "Closed door" });

    const rooms = (await eligible.get("/conversations?discover=1")).body.rooms;
    expect(rooms.some((r: any) => r.id === open.id)).toBe(true);
    expect(rooms.some((r: any) => r.id === hidden.id)).toBe(false);

    // Before joining: the public face only, no messages, no members.
    await owner.send(open.id, "welcome");
    const preview = await eligible.get(`/conversations/${open.id}`);
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({ title: "Open floor", memberCount: 1 });
    expect(preview.body.members).toBeUndefined();
    expect((await eligible.page(open.id)).status).toBe(404);

    expect((await eligible.post(`/conversations/${open.id}/members`, { join: true })).status).toBe(200);
    expect((await eligible.page(open.id)).body.messages.map((m: any) => m.body)).toContain("welcome");
    // Joining a private room is impossible even with its id.
    expect((await eligible.post(`/conversations/${hidden.id}/members`, { join: true })).status).toBe(404);
  });

  test("ineligible company or branch cannot discover or join", async () => {
    const [owner, otherCompany, otherBranch] = await Promise.all(["pd4", "af2", "pa2"].map(Client.login));
    const room = await owner.createRoom({ visibility: "workspace", branch: "Dubai" });
    for (const outsider of [otherCompany, otherBranch]) {
      expect((await outsider.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(false);
      expect((await outsider.post(`/conversations/${room.id}/members`, { join: true })).status).toBe(404);
      expect((await outsider.get(`/conversations/${room.id}`)).status).toBe(404);
    }
  });
});

test.describe("direct messages", () => {
  test("participants read; a third person cannot; duplicates collapse", async () => {
    const [a, b, c] = await Promise.all(["pg12", "pd5", "pa3"].map(Client.login));
    const first = await a.openDirect("pd5");
    expect(first.status).toBe(201);
    const id = first.body.conversation.id;
    // Same pair, either direction, even concurrently: one thread.
    const again = await Promise.all([a.openDirect("pd5"), b.openDirect("pg12"), a.openDirect("pd5")]);
    for (const r of again) expect(r.body.conversation.id).toBe(id);
    await a.send(id, "hi");
    expect((await b.page(id)).body.messages[0].body).toBe("hi");
    await expectIndistinguishable(c, id);
    // DM titles are the other person, from each side.
    expect((await a.listEntry(id)).title).toBe(byKey("pd5").name);
    expect((await b.listEntry(id)).title).toBe(byKey("pg12").name);
  });

  test("a deactivated participant makes the thread read-only", async () => {
    const [a] = await Promise.all(["pg2"].map(Client.login));
    const dm = (await a.openDirect("pg3")).body.conversation;
    await a.send(dm.id, "before");
    await admin.updateUser("pg3", { active: false });
    const entry = await a.listEntry(dm.id);
    expect(entry.canPost).toBe(false);
    expect(entry.counterpart.active).toBe(false);
    expect((await a.send(dm.id, "after")).status).toBe(403);
    // History stays readable to the remaining participant.
    expect((await a.page(dm.id)).body.messages.map((m: any) => m.body)).toEqual(["before"]);
    // A new DM with an inactive person cannot be started.
    expect((await a.openDirect("pg7")).status).toBe(404);
  });

  test("losing the thread's company removes access; no DM across companies", async () => {
    const [a, b] = await Promise.all(["pg4", "af3"].map(Client.login));
    const dm = (await a.openDirect("pg5")).body.conversation;
    await a.send(dm.id, "company talk");
    expect((await b.openDirect("pg4")).status).toBe(404);
    expect((await a.openDirect("pg4")).status).toBe(400);
    await admin.moveUser("pg4", ["Afrilube"], []);
    const moved = await Client.login("pg4");
    await expectIndistinguishable(moved, dm.id);
    // Reopening the same pair is refused rather than re-granting history.
    expect((await moved.openDirect("pg5")).status).toBe(404);
  });
});

test.describe("messages", () => {
  test("send, edit and delete are for members and authors only", async () => {
    const [owner, member, stranger] = await Promise.all(["pg8", "pg9", "pg10"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg9"] });
    const mine = (await owner.send(room.id, "owner words")).body.message;
    const theirs = (await member.send(room.id, "member words")).body.message;
    expect((await stranger.send(room.id, "intrude")).status).toBe(404);

    // Own message: edit and delete allowed.
    const edited = await owner.patch(`/messages/${mine.id}`, { body: "owner words, revised" });
    expect(edited.status).toBe(200);
    expect(edited.body.message.editedAt).not.toBeNull();

    // Someone else's message: refused for a member, invisible to a stranger.
    expect((await owner.patch(`/messages/${theirs.id}`, { body: "hijack" })).status).toBe(403);
    expect((await owner.del(`/messages/${theirs.id}`)).status).toBe(403);
    expect((await stranger.patch(`/messages/${theirs.id}`, { body: "hijack" })).status).toBe(404);
    expect((await stranger.del(`/messages/${theirs.id}`)).status).toBe(404);
    expect((await stranger.del(`/messages/${MISSING}`)).body).toEqual((await stranger.del(`/messages/${theirs.id}`)).body);

    // Delete own, then it is a placeholder with no words left.
    const reply = (await member.send(room.id, "replying", { replyToId: mine.id })).body.message;
    expect((await owner.del(`/messages/${mine.id}`)).status).toBe(200);
    const page = (await member.page(room.id)).body.messages;
    const deleted = page.find((m: any) => m.id === mine.id);
    expect(deleted).toMatchObject({ deleted: true, body: "", mentions: [] });
    expect(JSON.stringify(page)).not.toContain("owner words");
    expect(page.find((m: any) => m.id === reply.id).replyTo).toMatchObject({ deleted: true, excerpt: "" });
    // A deleted message cannot be edited, re-deleted or replied to.
    expect((await owner.patch(`/messages/${mine.id}`, { body: "undo" })).status).toBe(409);
    expect((await owner.del(`/messages/${mine.id}`)).status).toBe(409);
    expect((await member.send(room.id, "late reply", { replyToId: mine.id })).status).toBe(400);
  });

  test("an archived room is read-only", async () => {
    const [owner, member] = await Promise.all(["pg11", "pg12"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg12"] });
    const kept = (await member.send(room.id, "kept")).body.message;
    expect((await owner.patch(`/conversations/${room.id}`, { archived: true })).status).toBe(200);
    expect((await member.send(room.id, "too late")).status).toBe(403);
    expect((await member.patch(`/messages/${kept.id}`, { body: "changed" })).status).toBe(403);
    expect((await member.page(room.id)).body.messages.map((m: any) => m.body)).toEqual(["kept"]);
    expect((await owner.post(`/conversations/${room.id}/members`, { userIds: ids("pg1") })).status).toBe(409);
    expect((await owner.patch(`/conversations/${room.id}`, { archived: false })).status).toBe(200);
    expect((await member.send(room.id, "back")).status).toBe(201);
  });
});

test.describe("room administration", () => {
  test("members cannot administer; admins can within limits; owner-only is enforced", async () => {
    const [owner, admin1, admin2, member] = await Promise.all(["pg1", "pg2", "pg5", "pg6"].map(Client.login));
    const room = await owner.createRoom({ members: ["pg2", "pg5", "pg6"], name: "Governed" });

    // A plain member: every admin action refused.
    expect((await member.patch(`/conversations/${room.id}`, { name: "Mine now" })).status).toBe(403);
    expect((await member.patch(`/conversations/${room.id}`, { archived: true })).status).toBe(403);
    expect((await member.post(`/conversations/${room.id}/members`, { userIds: ids("pg9") })).status).toBe(403);
    expect((await member.del(`/conversations/${room.id}/members?userId=${admin1.id}`)).status).toBe(403);
    expect((await member.patch(`/conversations/${room.id}/members`, { userId: member.id, role: "admin" })).status).toBe(403);
    expect((await member.get(`/people?conversationId=${room.id}`)).status).toBe(403);

    // The owner promotes two admins.
    for (const who of [admin1, admin2])
      expect((await owner.patch(`/conversations/${room.id}/members`, { userId: who.id, role: "admin" })).status).toBe(200);

    // An admin renames, adds and removes members...
    expect((await admin1.patch(`/conversations/${room.id}`, { name: "Governed well" })).status).toBe(200);
    expect((await admin1.post(`/conversations/${room.id}/members`, { userIds: ids("pg9") })).status).toBe(200);
    expect((await admin1.del(`/conversations/${room.id}/members?userId=${byKey("pg9").id}`)).status).toBe(200);
    // ...but cannot touch the owner or another admin.
    expect((await admin1.del(`/conversations/${room.id}/members?userId=${owner.id}`)).status).toBe(403);
    expect((await admin1.del(`/conversations/${room.id}/members?userId=${admin2.id}`)).status).toBe(403);
    expect((await admin1.patch(`/conversations/${room.id}/members`, { userId: admin2.id, role: "member" })).status).toBe(403);
    expect((await admin1.patch(`/conversations/${room.id}/members`, { userId: owner.id, role: "member" })).status).toBe(403);
    // The owner can.
    expect((await owner.patch(`/conversations/${room.id}/members`, { userId: admin2.id, role: "member" })).status).toBe(200);
    // Nobody removes the owner, including the owner via the admin path.
    expect((await owner.del(`/conversations/${room.id}/members?userId=${owner.id}`)).status).toBe(200); // = leave
    const detail = (await admin1.get(`/conversations/${room.id}`)).body;
    // Ownership passed to the longest-serving admin.
    expect(detail.members.find((m: any) => m.id === admin1.id).memberRole).toBe("owner");
    expect(detail.members.some((m: any) => m.id === owner.id)).toBe(false);
    await expect.poll(async () => (await owner.get(`/conversations/${room.id}`)).status).toBe(404);
  });

  test("with no admin, ownership passes to the longest-serving member; last out archives", async () => {
    const [owner, first, second] = await Promise.all(["pg10", "pg11", "pg12"].map(Client.login));
    const room = await owner.createRoom({ visibility: "workspace", members: ["pg11", "pg12"] });
    expect((await owner.del(`/conversations/${room.id}/members?userId=${owner.id}`)).status).toBe(200);
    const detail = (await first.get(`/conversations/${room.id}`)).body;
    expect(detail.members.find((m: any) => m.memberRole === "owner").id).toBe(first.id);

    const eligible = await Client.login("pg9");
    expect((await eligible.get(`/conversations/${room.id}`)).body.preview).toBeTruthy();
    expect((await second.del(`/conversations/${room.id}/members?userId=${second.id}`)).status).toBe(200);
    expect((await first.del(`/conversations/${room.id}/members?userId=${first.id}`)).status).toBe(200);
    // Empty and archived: no longer joinable or discoverable.
    expect((await eligible.get(`/conversations/${room.id}`)).status).toBe(404);
    expect((await eligible.get("/conversations?discover=1")).body.rooms.some((r: any) => r.id === room.id)).toBe(false);
  });

  test("direct messages have no room administration", async () => {
    const [a] = await Promise.all(["pg6"].map(Client.login));
    const dm = (await a.openDirect("pg8")).body.conversation;
    expect((await a.patch(`/conversations/${dm.id}`, { name: "Renamed" })).status).toBe(400);
    expect((await a.post(`/conversations/${dm.id}/members`, { userIds: ids("pg9") })).status).toBe(400);
    expect((await a.del(`/conversations/${dm.id}/members?userId=${a.id}`)).status).toBe(400);
  });
});
