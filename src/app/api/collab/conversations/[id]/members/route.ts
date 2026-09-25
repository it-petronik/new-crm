import { z } from "zod";
import { evictFromMeetings } from "@/lib/meeting-service";
import { inRoomScope, isId, ROOM_MEMBER_MAX } from "@/lib/collab";
import {
  CollabError,
  collabContext,
  conversationAccess,
  handle,
  json,
  requireAdmin,
  requireRead,
} from "@/lib/collab-auth";
import {
  addMembers,
  findPeople,
  listMembers,
  removeMember,
  setMemberRole,
  updateConversation,
} from "@/lib/collab-data";
import { announceChange } from "@/lib/collab-service";
import { publish } from "@/lib/collab-realtime";
import { auditRoom } from "@/lib/collab-audit";

type Params = { params: Promise<{ id: string }> };

const id = z.string().refine(isId);
const add = z.union([
  z.object({ join: z.literal(true) }).strict(),
  z.object({ userIds: z.array(id).min(1).max(50) }).strict(),
]);
const role = z.object({ userId: id, role: z.enum(["admin", "member"]) }).strict();

/** POST: join a workspace room yourself, or (admins) add people. */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const conversationId = (await params).id;
    const body = add.parse(await request.json());
    const now = new Date();

    if ("join" in body) {
      const access = await conversationAccess(db, actor, conversationId);
      if (!access.canJoin) throw new CollabError(404, "Conversation not found.");
      const members = await listMembers(db, conversationId);
      if (members.length >= ROOM_MEMBER_MAX) throw new CollabError(409, "This room is full.");
      await addMembers(db, conversationId, [actor.id], "member", now);
      await announceChange(db, conversationId);
      return json({ ok: true });
    }

    const access = await requireAdmin(db, actor, conversationId);
    const room = access.conversation;
    if (room.archivedAt) throw new CollabError(409, "Restore the room before adding people.");
    const members = await listMembers(db, conversationId);
    const current = new Set(members.map((m) => m.id));
    const wanted = [...new Set(body.userIds)].filter((u) => !current.has(u));
    if (!wanted.length) return json({ ok: true });
    if (members.length + wanted.length > ROOM_MEMBER_MAX)
      throw new CollabError(409, `Rooms hold at most ${ROOM_MEMBER_MAX} people.`);
    // Only active people whose own access covers the room's company/branch;
    // this is what stops a room from leaking across companies.
    const people = await findPeople(db, wanted);
    if (people.length !== wanted.length || people.some((p) => !p.active || !inRoomScope(p, room)))
      throw new CollabError(400, "Some people can't be added to a room in this company or branch.");
    await addMembers(db, conversationId, wanted, "member", now);
    await auditRoom(db, actor, room, `Added ${wanted.length} ${wanted.length === 1 ? "member" : "members"} to room`, {
      added: people.map((p) => p.name),
    });
    await announceChange(db, conversationId);
    return json({ ok: true });
  });
}

/** PATCH: promote a member to admin or back. Only the owner demotes admins. */
export function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const conversationId = (await params).id;
    const access = await requireAdmin(db, actor, conversationId);
    const body = role.parse(await request.json());
    const members = await listMembers(db, conversationId);
    const target = members.find((m) => m.id === body.userId);
    if (!target) throw new CollabError(404, "That person isn't in this room.");
    if (target.memberRole === "owner") throw new CollabError(403, "The owner's role can't be changed.");
    if (target.memberRole === body.role) return json({ ok: true });
    if (target.memberRole === "admin" && access.membership?.role !== "owner")
      throw new CollabError(403, "Only the room owner can change an admin's role.");
    await setMemberRole(db, conversationId, target.id, body.role);
    await auditRoom(
      db,
      actor,
      access.conversation,
      body.role === "admin" ? `Made ${target.name} a room admin` : `Removed ${target.name} as room admin`,
    );
    await announceChange(db, conversationId);
    return json({ ok: true });
  });
}

/**
 * DELETE ?userId=: leave (your own id) or remove someone (admins). The owner
 * cannot be removed; an owner who leaves hands the room to the longest-serving
 * admin, else the longest-serving member. The last person out archives it.
 */
export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const conversationId = (await params).id;
    const userId = new URL(request.url).searchParams.get("userId") ?? actor.id;
    if (!isId(userId)) throw new CollabError(400, "Check the details and try again.");
    const leaving = userId === actor.id;
    const access = leaving
      ? await requireRead(db, actor, conversationId)
      : await requireAdmin(db, actor, conversationId);
    const room = access.conversation;
    if (room.kind !== "room") throw new CollabError(400, "You can't leave a direct message.");

    const members = await listMembers(db, conversationId);
    const target = members.find((m) => m.id === userId);
    if (!target) throw new CollabError(404, "That person isn't in this room.");
    const remaining = members.filter((m) => m.id !== userId);

    if (!leaving) {
      if (target.memberRole === "owner") throw new CollabError(403, "The room owner can't be removed.");
      if (target.memberRole === "admin" && access.membership?.role !== "owner")
        throw new CollabError(403, "Only the room owner can remove an admin.");
    }

    await removeMember(db, conversationId, userId);
    if (leaving && target.memberRole === "owner" && remaining.length) {
      // listMembers is ordered by joinedAt, so the first match is the
      // longest-serving.
      const heir = remaining.find((m) => m.memberRole === "admin" && m.active)
        ?? remaining.find((m) => m.active)
        ?? remaining[0];
      await setMemberRole(db, conversationId, heir.id, "owner");
      await auditRoom(db, actor, room, `Transferred room ownership to ${heir.name}`);
    }
    if (!remaining.length && !room.archivedAt) {
      await updateConversation(db, conversationId, { archivedAt: new Date(), updatedAt: new Date() });
    }
    if (!leaving) await auditRoom(db, actor, room, `Removed ${target.name} from room`);

    await publish([userId], { type: "conversation.removed", conversationId });
    await announceChange(db, conversationId);
    // No longer a member: disconnected from this conversation's meeting too.
    await evictFromMeetings(db, userId, conversationId);
    return json({ ok: true });
  });
}
