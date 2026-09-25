import { z } from "zod";
import { cleanText, isId, MENTION_MAX, MESSAGE_MAX, validMentions } from "@/lib/collab";
import { CollabError, collabContext, handle, json, requireRead } from "@/lib/collab-auth";
import type { Database } from "@/lib/db";
import type { Actor } from "@/lib/domain";
import {
  editMessage,
  findMessage,
  hydrateMessages,
  listMembers,
  softDeleteMessage,
} from "@/lib/collab-data";
import { announceDeleted, announceMessage, audience } from "@/lib/collab-service";

type Params = { params: Promise<{ id: string }> };

const id = z.string().refine(isId);
const edit = z
  .object({
    body: z.string().max(MESSAGE_MAX * 2),
    mentionIds: z.array(id).max(MENTION_MAX * 2).default([]),
  })
  .strict();

/**
 * Resolves a message the caller may act on. A message in a conversation the
 * caller cannot read is "not found", exactly like one that does not exist;
 * one they can read but did not write is refused explicitly.
 */
async function ownMessage(db: Database, actor: Actor, messageId: string) {
  const notFound = new CollabError(404, "Message not found.");
  if (!isId(messageId)) throw notFound;
  const message = await findMessage(db, messageId);
  if (!message) throw notFound;
  const access = await requireRead(db, actor, message.conversationId).catch(() => {
    throw notFound;
  });
  if (message.authorId !== actor.id)
    throw new CollabError(403, "You can only change your own messages.");
  if (message.deletedAt) throw new CollabError(409, "This message was deleted.");
  return { message, access };
}

/** PATCH: edit your own message; mentions are recomputed from the new text. */
export function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { message, access } = await ownMessage(db, actor, (await params).id);
    if (!access.canPost)
      throw new CollabError(403, "Messages in this conversation can no longer be edited.");
    const input = edit.parse(await request.json());
    const body = cleanText(input.body);
    if (!body) throw new CollabError(400, "A message can't be empty. Delete it instead.");
    if (body.length > MESSAGE_MAX)
      throw new CollabError(400, `Messages are at most ${MESSAGE_MAX.toLocaleString()} characters.`);
    const entitled = new Set(await audience(db, message.conversationId));
    const members = (await listMembers(db, message.conversationId)).filter((m) => entitled.has(m.id));
    const mentions = validMentions(body, input.mentionIds, members, actor.id);
    const now = new Date();
    if (body !== message.body) await editMessage(db, { ...message, body }, mentions, now);
    const [view] = await hydrateMessages(db, [
      body !== message.body ? { ...message, body, editedAt: now } : message,
    ]);
    if (body !== message.body) await announceMessage(db, "message.updated", view);
    return json({ message: view });
  });
}

/** DELETE: remove your own message. Its text is erased, not hidden. */
export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { message } = await ownMessage(db, actor, (await params).id);
    await softDeleteMessage(db, message.id, new Date());
    await announceDeleted(db, message.conversationId, message.id);
    return json({ ok: true });
  });
}
