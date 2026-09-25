import { z } from "zod";
import {
  cleanLine,
  cleanText,
  directKey,
  inRoomScope,
  isId,
  ROOM_DESCRIPTION_MAX,
  ROOM_MEMBER_MAX,
  ROOM_NAME_MAX,
  ROOM_NAME_MIN,
  sharedCompany,
  type DiscoverableRoom,
} from "@/lib/collab";
import { CollabError, collabContext, conversationAccess, handle, json, rateLimit } from "@/lib/collab-auth";
import { createConversation, ensureDirect, findDirect, findPeople, listJoinableRooms } from "@/lib/collab-data";
import { announceChange, conversationSummaries, summaryFor } from "@/lib/collab-service";
import { auditRoom } from "@/lib/collab-audit";

const id = z.string().refine(isId);

const roomInput = z.object({
  kind: z.literal("room"),
  name: z.string().max(200),
  description: z.string().max(2000).optional().default(""),
  visibility: z.enum(["private", "workspace"]),
  company: z.string().min(1).max(80),
  branch: z.string().max(80).nullable().optional(),
  memberIds: z.array(id).max(ROOM_MEMBER_MAX - 1).default([]),
});
const directInput = z.object({ kind: z.literal("direct"), userId: id });
const input = z.discriminatedUnion("kind", [roomInput, directInput]);

/**
 * GET: the caller's conversations, or with ?discover=1 the workspace rooms
 * inside their scope that they have not joined. Private rooms are never
 * returned to non-members by either.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    if (new URL(request.url).searchParams.get("discover")) {
      const rows = await listJoinableRooms(db, actor.id, actor.companies);
      const rooms: DiscoverableRoom[] = rows
        .filter((r) => inRoomScope(actor, r.conversation))
        .map((r) => ({
          id: r.conversation.id,
          title: r.conversation.name ?? "Untitled room",
          description: r.conversation.description,
          company: r.conversation.company,
          branch: r.conversation.branch,
          memberCount: Number(r.memberCount) || 0,
        }));
      return json({ rooms });
    }
    return json({ conversations: await conversationSummaries(db, actor) });
  });
}

/** POST: create a room, or open (creating if needed) a direct message. */
export function POST(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const body = input.parse(await request.json());
    const now = new Date();

    if (body.kind === "direct") {
      if (body.userId === actor.id) throw new CollabError(400, "Choose someone other than yourself.");
      const [target] = await findPeople(db, [body.userId]);
      const company = target?.active ? sharedCompany(actor, target) : null;
      if (!target || !company)
        throw new CollabError(404, "That person isn't available to message.");
      const key = directKey(actor.id, target.id);
      const existing = await findDirect(db, key);
      if (existing) {
        const access = await conversationAccess(db, actor, existing.id);
        if (!access.canRead) throw new CollabError(403, "This conversation isn't available to you.");
        return json({ conversation: await summaryFor(db, actor, existing.id) });
      }
      // Only a genuinely new thread counts; reopening an existing one is free.
      await rateLimit(db, actor, "direct");
      const conversation = await ensureDirect(
        db,
        {
          id: crypto.randomUUID(),
          kind: "direct",
          name: null,
          description: null,
          visibility: "private",
          company,
          branch: null,
          directKey: key,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        },
        [actor.id, target.id],
      );
      if (!conversation) throw new CollabError(500, "Could not open the conversation.");
      await announceChange(db, conversation.id);
      return json({ conversation: await summaryFor(db, actor, conversation.id) }, 201);
    }

    const name = cleanLine(body.name);
    if (name.length < ROOM_NAME_MIN || name.length > ROOM_NAME_MAX)
      throw new CollabError(400, `Room names are ${ROOM_NAME_MIN}–${ROOM_NAME_MAX} characters.`);
    const description = cleanText(body.description);
    if (description.length > ROOM_DESCRIPTION_MAX)
      throw new CollabError(400, `Descriptions are at most ${ROOM_DESCRIPTION_MAX} characters.`);
    if (!actor.companies.includes(body.company))
      throw new CollabError(403, "You can only create rooms in your own companies.");
    const branch = body.branch ? cleanLine(body.branch) : null;
    // A branch-scoped person creates rooms inside one of their branches; only
    // group-wide people may open a room to a whole company.
    if (actor.branches.length && (!branch || !actor.branches.includes(branch)))
      throw new CollabError(403, "Choose one of your branches for this room.");
    const scope = { company: body.company, branch };
    await rateLimit(db, actor, "room");

    const memberIds = [...new Set(body.memberIds)].filter((m) => m !== actor.id);
    const people = await findPeople(db, memberIds);
    if (people.length !== memberIds.length || people.some((p) => !p.active || !inRoomScope(p, scope)))
      throw new CollabError(400, "Some people can't be added to a room in this company or branch.");

    const conversationId = crypto.randomUUID();
    const row = {
      id: conversationId,
      kind: "room" as const,
      name,
      description: description || null,
      visibility: body.visibility,
      company: body.company,
      branch,
      directKey: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      archivedAt: null,
      avatarKey: null,
      avatarUpdatedAt: null,
    };
    await createConversation(db, row, [
      { userId: actor.id, role: "owner" },
      ...memberIds.map((userId) => ({ userId, role: "member" as const })),
    ]);
    await auditRoom(db, actor, row, "Created room", {
      visibility: row.visibility,
      members: memberIds.length + 1,
    });
    await announceChange(db, conversationId);
    return json({ conversation: await summaryFor(db, actor, conversationId) }, 201);
  });
}
