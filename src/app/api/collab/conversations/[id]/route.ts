import { z } from "zod";
import {
  cleanLine,
  cleanText,
  ROOM_DESCRIPTION_MAX,
  ROOM_NAME_MAX,
  ROOM_NAME_MIN,
  type ConversationDetail,
  type DiscoverableRoom,
} from "@/lib/collab";
import { CollabError, collabContext, conversationAccess, handle, json, requireAdmin } from "@/lib/collab-auth";
import { listMembers, memberCount, updateConversation } from "@/lib/collab-data";
import { announceChange, summaryFor } from "@/lib/collab-service";
import { auditRoom } from "@/lib/collab-audit";

type Params = { params: Promise<{ id: string }> };

const patch = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    visibility: z.enum(["private", "workspace"]).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

/**
 * GET: full detail for a member. A workspace room the caller could join
 * returns only its public face (name, description, size) — never messages or
 * the member list. Anything else is a 404.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const access = await conversationAccess(db, actor, (await params).id);
    const c = access.conversation;
    if (access.canRead) {
      const summary = await summaryFor(db, actor, c.id);
      if (!summary) throw new CollabError(404, "Conversation not found.");
      const detail: ConversationDetail = {
        conversation: summary,
        members: await listMembers(db, c.id),
        canAdmin: access.canAdmin,
      };
      return json(detail);
    }
    if (access.canJoin) {
      const preview: DiscoverableRoom = {
        id: c.id,
        title: c.name ?? "Untitled room",
        description: c.description,
        company: c.company,
        branch: c.branch,
        memberCount: await memberCount(db, c.id),
      };
      return json({ preview });
    }
    throw new CollabError(404, "Conversation not found.");
  });
}

/** PATCH: rename, describe, change visibility, archive or restore a room. */
export function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireAdmin(db, actor, (await params).id);
    const room = access.conversation;
    const body = patch.parse(await request.json());
    const now = new Date();
    const values: Parameters<typeof updateConversation>[2] = { updatedAt: now };
    const changes: string[] = [];

    if (body.name !== undefined) {
      const name = cleanLine(body.name);
      if (name.length < ROOM_NAME_MIN || name.length > ROOM_NAME_MAX)
        throw new CollabError(400, `Room names are ${ROOM_NAME_MIN}–${ROOM_NAME_MAX} characters.`);
      if (name !== room.name) {
        values.name = name;
        changes.push(`Renamed room from "${room.name}"`);
      }
    }
    if (body.description !== undefined) {
      const description = cleanText(body.description);
      if (description.length > ROOM_DESCRIPTION_MAX)
        throw new CollabError(400, `Descriptions are at most ${ROOM_DESCRIPTION_MAX} characters.`);
      if ((description || null) !== room.description) values.description = description || null;
    }
    if (body.visibility && body.visibility !== room.visibility) {
      values.visibility = body.visibility;
      changes.push(body.visibility === "private" ? "Made room private" : "Opened room to workspace");
    }
    if (body.archived !== undefined && body.archived !== !!room.archivedAt) {
      values.archivedAt = body.archived ? now : null;
      changes.push(body.archived ? "Archived room" : "Restored room");
    }
    if (Object.keys(values).length === 1) return json({ conversation: await summaryFor(db, actor, room.id) });

    await updateConversation(db, room.id, values);
    const updated = { ...room, ...values };
    for (const change of changes) await auditRoom(db, actor, updated, change);
    await announceChange(db, room.id);
    return json({ conversation: await summaryFor(db, actor, room.id) });
  });
}
