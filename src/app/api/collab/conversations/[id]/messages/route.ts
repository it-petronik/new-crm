import { z } from "zod";
import { cleanText, isId, MENTION_MAX, MESSAGE_MAX, messageId, validMentions } from "@/lib/collab";
import { CollabError, collabContext, handle, json, rateLimit, requireRead } from "@/lib/collab-auth";
import { ATTACHMENTS_PER_MESSAGE } from "@/lib/collab-files";
import {
  pendingAttachments,
  findByClientKey,
  findMessage,
  hydrateMessages,
  insertMessage,
  listMembers,
  messagePage,
} from "@/lib/collab-data";
import { announceMessage, audience } from "@/lib/collab-service";
import { notifyMessage } from "@/lib/notify";

type Params = { params: Promise<{ id: string }> };

const id = z.string().refine(isId);
const send = z
  .object({
    body: z.string().max(MESSAGE_MAX * 2),
    replyToId: id.nullable().optional(),
    mentionIds: z.array(id).max(MENTION_MAX * 2).default([]),
    clientKey: id.optional(),
    attachmentIds: z.array(id).max(ATTACHMENTS_PER_MESSAGE).default([]),
  })
  .strict();

/**
 * GET: one page of messages. `before`, `after` and `around` are message-id
 * cursors; at most one is honoured. The conversation is fixed by the URL and
 * every query filters on it, so a cursor from another conversation simply
 * returns nothing of that conversation.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const access = await requireRead(db, actor, (await params).id);
    const search = new URL(request.url).searchParams;
    const cursor = (name: string) => {
      const value = search.get(name);
      if (value === null) return undefined;
      if (!isId(value)) throw new CollabError(400, "Invalid cursor.");
      return value;
    };
    const before = cursor("before");
    const after = before ? undefined : cursor("after");
    const around = before || after ? undefined : cursor("around");
    return json(await messagePage(db, access.conversation.id, { before, after, around }));
  });
}

/** POST: send a message. Idempotent per `clientKey`, so a retry never doubles. */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireRead(db, actor, (await params).id);
    if (!access.canPost)
      throw new CollabError(
        403,
        access.conversation.archivedAt
          ? "This room is archived."
          : "You can't send messages in this conversation.",
      );
    const input = send.parse(await request.json());
    const conversationId = access.conversation.id;

    if (input.clientKey) {
      const existing = await findByClientKey(db, actor.id, input.clientKey);
      if (existing) {
        if (existing.conversationId !== conversationId)
          throw new CollabError(409, "Duplicate message key.");
        return json({ message: (await hydrateMessages(db, [existing]))[0] });
      }
    }

    // After the idempotency check, so retrying a send never counts twice.
    await rateLimit(db, actor, "message");
    const body = cleanText(input.body);
    // Text, files, or both — but not neither.
    const attachmentIds = [...new Set(input.attachmentIds)];
    if (!body && !attachmentIds.length) throw new CollabError(400, "Write a message first.");
    // Every file must be the sender's own pending upload in this
    // conversation; insertMessage re-applies the same guard atomically.
    if (attachmentIds.length) {
      const pending = await pendingAttachments(db, attachmentIds, conversationId, actor.id);
      if (pending.length !== attachmentIds.length)
        throw new CollabError(400, "An attachment is no longer available. Remove it and try again.");
    }
    if (body.length > MESSAGE_MAX)
      throw new CollabError(400, `Messages are at most ${MESSAGE_MAX.toLocaleString()} characters.`);

    let replyToId: string | null = null;
    let replyToAuthorId: string | null = null;
    if (input.replyToId) {
      const target = await findMessage(db, input.replyToId);
      if (!target || target.conversationId !== conversationId || target.deletedAt)
        throw new CollabError(400, "The message you're replying to is no longer available.");
      replyToId = target.id;
      replyToAuthorId = target.authorId;
    }

    // Mentionable = members who could read this conversation right now.
    const entitled = new Set(await audience(db, conversationId));
    const members = (await listMembers(db, conversationId)).filter((m) => entitled.has(m.id));
    const mentions = validMentions(body, input.mentionIds, members, actor.id);
    const now = new Date();
    const row = {
      id: messageId(now.getTime()),
      conversationId,
      authorId: actor.id,
      body,
      replyToId,
      clientKey: input.clientKey ?? null,
    };
    try {
      await insertMessage(db, row, mentions, now, attachmentIds);
    } catch (error) {
      // Two copies of the same send racing: the unique (author, clientKey)
      // index lets exactly one land. The loser returns the winner's message
      // instead of failing, so a replay is never an error or a duplicate.
      const winner = input.clientKey ? await findByClientKey(db, actor.id, input.clientKey) : undefined;
      if (!winner || winner.conversationId !== conversationId) throw error;
      return json({ message: (await hydrateMessages(db, [winner]))[0] });
    }
    const [message] = await hydrateMessages(db, [
      { ...row, createdAt: now, editedAt: null, deletedAt: null },
    ]);
    await announceMessage(db, "message.created", message);
    await notifyMessage(db, {
      id: row.id,
      conversationId,
      body,
      hasFiles: attachmentIds.length > 0,
      author: actor,
      direct: access.conversation.kind === "direct",
      roomName: access.conversation.name,
      mentionIds: mentions,
      replyToAuthorId,
      audience: [...entitled],
    });
    return json({ message }, 201);
  });
}
