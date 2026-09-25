import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { Database } from "./d1";
import {
  attachments,
  collabPresence,
  conversations,
  conversationMembers,
  messages,
  messageMentions,
  messageReactions,
  users,
  type AttachmentRow,
  type ConversationRow,
  type MessageRow,
} from "./schema";
import {
  attachmentUrls,
  excerpt,
  type AttachmentKind,
  type AttachmentView,
  type ReactionView,
  MENTION_PAGE,
  MESSAGE_PAGE,
  UNREAD_CAP,
  type ConversationMemberView,
  type MemberRole,
  type MessagePage,
  type MessageView,
  type Person,
} from "./collab";

/**
 * Collaboration data layer. Route handlers call these after authorization has
 * been decided in collab-auth.ts; nothing here decides who may see what, it
 * only fetches exactly what it is asked for. Every query is bounded.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/* ---------------------------------------------------------------- people */

export type PersonRow = Person & { companies: string[]; branches: string[]; active: boolean };

const personColumns = {
  id: users.id,
  name: users.name,
  role: users.role,
  companies: users.companies,
  branches: users.branches,
  active: users.active,
};

export async function findPeople(db: Database, ids: string[]): Promise<PersonRow[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return db.select(personColumns).from(users).where(inArray(users.id, unique)).all();
}

/** Active people, for search. The caller applies company scope. */
export const listActivePeople = (db: Database) =>
  db.select(personColumns).from(users).where(eq(users.active, true)).orderBy(asc(users.name)).all();

/* --------------------------------------------------------- conversations */

export const findConversation = (db: Database, id: string) =>
  db.select().from(conversations).where(eq(conversations.id, id)).get();

export const findDirect = (db: Database, key: string) =>
  db.select().from(conversations).where(eq(conversations.directKey, key)).get();

export const findMembership = (db: Database, conversationId: string, userId: string) =>
  db
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .get();

export async function listMembers(db: Database, conversationId: string): Promise<ConversationMemberView[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      active: users.active,
      memberRole: conversationMembers.role,
      joinedAt: conversationMembers.joinedAt,
      companies: users.companies,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId))
    // People added in one request share a joinedAt; insertion order (rowid)
    // breaks the tie, so "longest-serving" is always well defined.
    .orderBy(asc(conversationMembers.joinedAt), sql`"ConversationMember"."rowid"`)
    .all();
  return rows.map(({ joinedAt: _joined, ...m }) => m);
}

export async function memberCount(db: Database, conversationId: string) {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId))
    .get();
  return Number(row?.n ?? 0);
}

export const latestMessageId = async (db: Database, conversationId: string) =>
  (
    await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.id))
      .limit(1)
      .get()
  )?.id ?? null;

export type MembershipRow = {
  conversation: ConversationRow;
  role: MemberRole;
  lastRead: string | null;
  unread: number;
  mentions: number;
  memberCount: number;
  lastMessageId: string | null;
};

/**
 * Every conversation a person belongs to, newest activity first, with unread
 * and mention counts computed in the database. The unread subquery is capped,
 * so a thread with thousands of unread messages costs no more than one with a
 * hundred: it walks `Message_conversationId_id_idx` from the read cursor.
 */
export async function listMemberships(
  db: Database,
  userId: string,
  conversationId?: string,
): Promise<MembershipRow[]> {
  const rows = await db
    .select({
      conversation: conversations,
      role: conversationMembers.role,
      lastRead: conversationMembers.lastReadMessageId,
      unread: sql<number>`(SELECT COUNT(*) FROM (SELECT 1 FROM "Message" x WHERE x."conversationId" = "Conversation"."id" AND x."id" > COALESCE("ConversationMember"."lastReadMessageId", '') AND x."authorId" <> ${userId} AND x."deletedAt" IS NULL LIMIT ${UNREAD_CAP + 1}))`,
      mentions: sql<number>`(SELECT COUNT(*) FROM "MessageMention" mm WHERE mm."userId" = ${userId} AND mm."conversationId" = "Conversation"."id" AND mm."messageId" > COALESCE("ConversationMember"."lastReadMessageId", ''))`,
      memberCount: sql<number>`(SELECT COUNT(*) FROM "ConversationMember" cm WHERE cm."conversationId" = "Conversation"."id")`,
      lastMessageId: sql<string | null>`(SELECT x."id" FROM "Message" x WHERE x."conversationId" = "Conversation"."id" ORDER BY x."id" DESC LIMIT 1)`,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, userId),
        conversationId ? eq(conversationMembers.conversationId, conversationId) : undefined,
      ),
    )
    .orderBy(desc(sql`COALESCE("Conversation"."lastMessageAt", "Conversation"."createdAt")`))
    .limit(300)
    .all();
  return rows.map((r) => ({
    ...r,
    unread: Number(r.unread) || 0,
    mentions: Number(r.mentions) || 0,
    memberCount: Number(r.memberCount) || 0,
  }));
}

/** The other participant of each direct conversation, keyed by conversation. */
export async function counterparts(db: Database, conversationIds: string[], userId: string) {
  if (!conversationIds.length) return new Map<string, PersonRow>();
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId, ...personColumns })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(
      and(
        inArray(conversationMembers.conversationId, conversationIds),
        ne(conversationMembers.userId, userId),
      ),
    )
    .all();
  return new Map(rows.map(({ conversationId, ...person }) => [conversationId, person]));
}

/** Workspace rooms in the given companies that the person has not joined. */
export const listJoinableRooms = (db: Database, userId: string, companies: string[]) =>
  companies.length
    ? db
        .select({
          conversation: conversations,
          memberCount: sql<number>`(SELECT COUNT(*) FROM "ConversationMember" cm WHERE cm."conversationId" = "Conversation"."id")`,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.kind, "room"),
            eq(conversations.visibility, "workspace"),
            isNull(conversations.archivedAt),
            inArray(conversations.company, companies),
            sql`NOT EXISTS (SELECT 1 FROM "ConversationMember" cm WHERE cm."conversationId" = "Conversation"."id" AND cm."userId" = ${userId})`,
          ),
        )
        .orderBy(asc(conversations.name))
        .limit(200)
        .all()
    : Promise.resolve([]);

/* -------------------------------------------------------------- messages */

export const findMessage = (db: Database, id: string) =>
  db.select().from(messages).where(eq(messages.id, id)).get();

export const findByClientKey = (db: Database, authorId: string, clientKey: string) =>
  db
    .select()
    .from(messages)
    .where(and(eq(messages.authorId, authorId), eq(messages.clientKey, clientKey)))
    .get();

/**
 * One page of a conversation, oldest-first in the result.
 *
 * - no cursor: the newest page;
 * - `before`: the page immediately older than that id;
 * - `after`: the page immediately newer than that id;
 * - `around`: a window centred on that id, used to jump to a replied-to
 *   message that is not loaded yet.
 *
 * Cursors are message ids, which sort by time, so paging never skips or
 * repeats a message however many arrive in the meantime.
 */
export async function pageMessages(
  db: Database,
  conversationId: string,
  cursor: { before?: string; after?: string; around?: string },
): Promise<{ rows: MessageRow[]; hasOlder: boolean; hasNewer: boolean }> {
  const inConversation = eq(messages.conversationId, conversationId);
  if (cursor.after) {
    const rows = await db
      .select()
      .from(messages)
      .where(and(inConversation, gt(messages.id, cursor.after)))
      .orderBy(asc(messages.id))
      .limit(MESSAGE_PAGE + 1)
      .all();
    return { rows: rows.slice(0, MESSAGE_PAGE), hasOlder: true, hasNewer: rows.length > MESSAGE_PAGE };
  }
  if (cursor.around) {
    const half = Math.floor(MESSAGE_PAGE / 2);
    const [older, newer] = await Promise.all([
      db
        .select()
        .from(messages)
        .where(and(inConversation, lte(messages.id, cursor.around)))
        .orderBy(desc(messages.id))
        .limit(half + 1)
        .all(),
      db
        .select()
        .from(messages)
        .where(and(inConversation, gt(messages.id, cursor.around)))
        .orderBy(asc(messages.id))
        .limit(half + 1)
        .all(),
    ]);
    return {
      rows: [...older.slice(0, half).reverse(), ...newer.slice(0, half)],
      hasOlder: older.length > half,
      hasNewer: newer.length > half,
    };
  }
  const rows = await db
    .select()
    .from(messages)
    .where(cursor.before ? and(inConversation, lt(messages.id, cursor.before)) : inConversation)
    .orderBy(desc(messages.id))
    .limit(MESSAGE_PAGE + 1)
    .all();
  return {
    rows: rows.slice(0, MESSAGE_PAGE).reverse(),
    hasOlder: rows.length > MESSAGE_PAGE,
    hasNewer: false,
  };
}

/**
 * Turns stored rows into what the client renders: author names, a compact
 * preview of the replied-to message and the resolved mentions. Deleted
 * messages carry no body and no mentions, and a reply to a deleted message
 * says so instead of quoting it.
 */
export async function hydrateMessages(db: Database, rows: MessageRow[]): Promise<MessageView[]> {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((id): id is string => !!id))];
  const live = rows.filter((r) => !r.deletedAt).map((r) => r.id);
  const [replies, mentionRows] = await Promise.all([
    replyIds.length
      ? db.select().from(messages).where(inArray(messages.id, replyIds)).all()
      : Promise.resolve([] as MessageRow[]),
    live.length
      ? db
          .select({ messageId: messageMentions.messageId, id: users.id, name: users.name })
          .from(messageMentions)
          .innerJoin(users, eq(users.id, messageMentions.userId))
          .where(inArray(messageMentions.messageId, live))
          .all()
      : Promise.resolve([] as { messageId: string; id: string; name: string }[]),
  ]);
  const [files, reactions] = await Promise.all([messageAttachments(db, live), messageReactionMap(db, live)]);
  const people = new Map(
    (await findPeople(db, [...rows.map((r) => r.authorId), ...replies.map((r) => r.authorId)])).map(
      (p) => [p.id, p],
    ),
  );
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  const personOf = (id: string): Person => {
    const p = people.get(id);
    return p ? { id: p.id, name: p.name, role: p.role } : { id, name: "Former member", role: "" };
  };
  return rows.map((r) => {
    const reply = r.replyToId ? replyMap.get(r.replyToId) : undefined;
    return {
      id: r.id,
      conversationId: r.conversationId,
      author: personOf(r.authorId),
      body: r.deletedAt ? "" : r.body,
      createdAt: r.createdAt.toISOString(),
      editedAt: iso(r.editedAt),
      deleted: !!r.deletedAt,
      // A reply must quote a message in the same conversation; anything else
      // is treated as missing rather than leaked.
      replyTo:
        r.replyToId && reply && reply.conversationId === r.conversationId
          ? {
              id: reply.id,
              authorName: personOf(reply.authorId).name,
              excerpt: reply.deletedAt ? "" : excerpt(reply.body, 140),
              deleted: !!reply.deletedAt,
            }
          : r.replyToId
            ? { id: r.replyToId, authorName: "", excerpt: "", deleted: true }
            : null,
      mentions: r.deletedAt
        ? []
        : mentionRows.filter((m) => m.messageId === r.id).map(({ id, name }) => ({ id, name })),
      clientKey: r.clientKey,
      // A deleted message shows neither its files nor its reactions.
      attachments: r.deletedAt ? [] : (files.get(r.id) ?? []),
      reactions: r.deletedAt ? [] : (reactions.get(r.id) ?? []),
    };
  });
}

/* ----------------------------------------------------------- attachments */

export function attachmentView(a: AttachmentRow): AttachmentView {
  return {
    id: a.id,
    kind: a.kind,
    name: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    width: a.width,
    height: a.height,
    durationMs: a.durationMs,
    createdAt: a.createdAt.toISOString(),
    ...attachmentUrls(a.id, !!a.thumbKey),
  };
}

/** Metadata only — never bytes — for the given messages, in upload order. */
async function messageAttachments(db: Database, messageIds: string[]) {
  const map = new Map<string, AttachmentView[]>();
  if (!messageIds.length) return map;
  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.messageId, messageIds), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.position), asc(attachments.id))
    .all();
  for (const row of rows) {
    const list = map.get(row.messageId!) ?? [];
    list.push(attachmentView(row));
    map.set(row.messageId!, list);
  }
  return map;
}

export const findAttachment = (db: Database, id: string) =>
  db.select().from(attachments).where(eq(attachments.id, id)).get();

export const insertAttachment = (db: Database, row: typeof attachments.$inferInsert) =>
  db.insert(attachments).values(row).run();

/** Pending uploads by this person in this conversation, for linking on send. */
export const pendingAttachments = (db: Database, ids: string[], conversationId: string, uploaderId: string) =>
  ids.length
    ? db
        .select()
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, ids),
            eq(attachments.conversationId, conversationId),
            eq(attachments.uploaderId, uploaderId),
            isNull(attachments.messageId),
            isNull(attachments.deletedAt),
          ),
        )
        .all()
    : Promise.resolve([] as AttachmentRow[]);

/**
 * A room's media or files, newest first, from live messages only, paged by
 * attachment id (time-ordered). Never loads the whole room.
 */
export async function pageAttachments(
  db: Database,
  conversationId: string,
  kinds: AttachmentKind[],
  before: string | undefined,
  limit: number,
) {
  const rows = await db
    .select({ attachment: attachments, authorId: messages.authorId })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(
      and(
        eq(attachments.conversationId, conversationId),
        inArray(attachments.kind, kinds),
        isNull(attachments.deletedAt),
        isNull(messages.deletedAt),
        before ? lt(attachments.id, before) : undefined,
      ),
    )
    .orderBy(desc(attachments.id))
    .limit(limit + 1)
    .all();
  const people = new Map((await findPeople(db, rows.map((r) => r.authorId))).map((p) => [p.id, p.name]));
  return {
    items: rows.slice(0, limit).map((r) => ({
      ...attachmentView(r.attachment),
      messageId: r.attachment.messageId!,
      authorName: people.get(r.authorId) ?? "Former member",
    })),
    nextBefore: rows.length > limit ? rows[limit - 1].attachment.id : null,
  };
}

/** Unsent uploads and the files of deleted messages past their retention. */
export async function purgeableAttachments(db: Database, now: number, limit = 200) {
  const pendingBefore = new Date(now - PENDING_RETENTION_MS);
  const deletedBefore = new Date(now - DELETED_RETENTION_MS);
  return db
    .select()
    .from(attachments)
    .where(
      sql`(${attachments.messageId} IS NULL AND ${attachments.createdAt} < ${pendingBefore.getTime()})
        OR (${attachments.deletedAt} IS NOT NULL AND ${attachments.deletedAt} < ${deletedBefore.getTime()})`,
    )
    .limit(limit)
    .all();
}
export const PENDING_RETENTION_MS = 24 * 3600_000;
export const DELETED_RETENTION_MS = 30 * 24 * 3600_000;

export const deleteAttachmentRows = (db: Database, ids: string[]) =>
  ids.length ? db.delete(attachments).where(inArray(attachments.id, ids)).run() : Promise.resolve();

export const discardPendingAttachment = (db: Database, id: string, now: Date) =>
  db
    .update(attachments)
    .set({ deletedAt: now })
    .where(and(eq(attachments.id, id), isNull(attachments.messageId)))
    .run();

/* ------------------------------------------------------------- reactions */

async function messageReactionMap(db: Database, messageIds: string[]) {
  const map = new Map<string, ReactionView[]>();
  if (!messageIds.length) return map;
  const rows = await db
    .select()
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(asc(messageReactions.createdAt))
    .all();
  for (const row of rows) {
    const list = map.get(row.messageId) ?? [];
    const existing = list.find((r) => r.emoji === row.emoji);
    if (existing) existing.userIds.push(row.userId);
    else list.push({ emoji: row.emoji, userIds: [row.userId] });
    map.set(row.messageId, list);
  }
  return map;
}

export async function reactionsFor(db: Database, messageId: string) {
  return (await messageReactionMap(db, [messageId])).get(messageId) ?? [];
}

/** Adds or removes one person's emoji; the primary key prevents duplicates. */
export async function setReaction(
  db: Database,
  row: { messageId: string; userId: string; emoji: string; conversationId: string },
  on: boolean,
) {
  if (on)
    await db.insert(messageReactions).values({ ...row, createdAt: new Date() }).onConflictDoNothing().run();
  else
    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, row.messageId),
          eq(messageReactions.userId, row.userId),
          eq(messageReactions.emoji, row.emoji),
        ),
      )
      .run();
}

/* -------------------------------------------------------------- presence */

export async function lastSeen(db: Database, userIds: string[]) {
  if (!userIds.length) return new Map<string, Date>();
  const rows = await db.select().from(collabPresence).where(inArray(collabPresence.userId, userIds)).all();
  return new Map(rows.map((r) => [r.userId, r.lastSeenAt]));
}

export async function messagePage(
  db: Database,
  conversationId: string,
  cursor: { before?: string; after?: string; around?: string },
): Promise<MessagePage> {
  const { rows, hasOlder, hasNewer } = await pageMessages(db, conversationId, cursor);
  return { messages: await hydrateMessages(db, rows), hasOlder, hasNewer };
}

/* ------------------------------------------------------------ mutations */

export async function insertMessage(
  db: Database,
  message: { id: string; conversationId: string; authorId: string; body: string; replyToId: string | null; clientKey: string | null },
  mentionIds: string[],
  now: Date,
  attachmentIds: string[] = [],
) {
  // One batch: the message, its mentions, its attachments, the conversation's
  // activity time and the author's own read cursor all land or none do. The
  // attachment link is guarded to the author's own pending uploads in this
  // conversation, so it cannot claim anyone else's file.
  await db.batch([
    db.insert(messages).values({ ...message, createdAt: now }),
    ...attachmentIds.map((id, position) =>
      db
        .update(attachments)
        .set({ messageId: message.id, position })
        .where(
          and(
            eq(attachments.id, id),
            eq(attachments.conversationId, message.conversationId),
            eq(attachments.uploaderId, message.authorId),
            isNull(attachments.messageId),
            isNull(attachments.deletedAt),
          ),
        ),
    ),
    ...mentionIds.map((userId) =>
      db.insert(messageMentions).values({
        messageId: message.id,
        userId,
        conversationId: message.conversationId,
        createdAt: now,
      }),
    ),
    db
      .update(conversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, message.conversationId)),
    advanceReadStatement(db, message.conversationId, message.authorId, message.id),
  ]);
}

export async function editMessage(
  db: Database,
  message: { id: string; conversationId: string; body: string },
  mentionIds: string[],
  now: Date,
) {
  await db.batch([
    db
      .update(messages)
      .set({ body: message.body, editedAt: now })
      .where(and(eq(messages.id, message.id), isNull(messages.deletedAt))),
    db.delete(messageMentions).where(eq(messageMentions.messageId, message.id)),
    ...mentionIds.map((userId) =>
      db.insert(messageMentions).values({
        messageId: message.id,
        userId,
        conversationId: message.conversationId,
        createdAt: now,
      }),
    ),
  ]);
}

/**
 * Soft delete: the row stays for reply context; the words, mentions and
 * reactions go, and the attachments become unreachable at once (the file
 * route refuses them). Their R2 objects are purged after the retention
 * window by the scheduled purge — see purgeableAttachments.
 */
export async function softDeleteMessage(db: Database, id: string, now: Date) {
  await db.batch([
    db.update(messages).set({ body: "", deletedAt: now }).where(eq(messages.id, id)),
    db.delete(messageMentions).where(eq(messageMentions.messageId, id)),
    db.delete(messageReactions).where(eq(messageReactions.messageId, id)),
    db.update(attachments).set({ deletedAt: now }).where(and(eq(attachments.messageId, id), isNull(attachments.deletedAt))),
  ]);
}

/** Moves a read cursor forward only; an older id never un-reads anything. */
const advanceReadStatement = (db: Database, conversationId: string, userId: string, id: string) =>
  db
    .update(conversationMembers)
    .set({ lastReadMessageId: id })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        sql`("lastReadMessageId" IS NULL OR "lastReadMessageId" < ${id})`,
      ),
    );

export const advanceRead = (db: Database, conversationId: string, userId: string, id: string) =>
  advanceReadStatement(db, conversationId, userId, id).run();

export async function createConversation(
  db: Database,
  conversation: typeof conversations.$inferInsert,
  members: { userId: string; role: MemberRole }[],
) {
  const now = conversation.createdAt;
  await db.batch([
    db.insert(conversations).values(conversation),
    ...members.map((m) =>
      db.insert(conversationMembers).values({
        conversationId: conversation.id,
        userId: m.userId,
        role: m.role,
        joinedAt: now,
        lastReadMessageId: null,
      }),
    ),
  ]);
}

/**
 * Creates a direct thread unless one already exists for the pair. The unique
 * index on `directKey` decides races: the loser's insert is ignored, and both
 * callers then read back the same single thread.
 */
export async function ensureDirect(
  db: Database,
  conversation: typeof conversations.$inferInsert & { directKey: string },
  participants: [string, string],
) {
  const inserted = await db
    .insert(conversations)
    .values(conversation)
    .onConflictDoNothing({ target: conversations.directKey })
    .returning({ id: conversations.id })
    .all();
  if (inserted.length) {
    await db.batch([
      db.insert(conversationMembers).values({
        conversationId: conversation.id, userId: participants[0], role: "member",
        joinedAt: conversation.createdAt, lastReadMessageId: null,
      }),
      db.insert(conversationMembers).values({
        conversationId: conversation.id, userId: participants[1], role: "member",
        joinedAt: conversation.createdAt, lastReadMessageId: null,
      }),
    ]);
  }
  return findDirect(db, conversation.directKey);
}

export async function addMembers(
  db: Database,
  conversationId: string,
  userIds: string[],
  role: MemberRole,
  now: Date,
) {
  if (!userIds.length) return;
  // New members start "caught up": the room's history is readable, but it is
  // not dumped on them as hundreds of unread messages.
  const latest = await latestMessageId(db, conversationId);
  await db.batch([
    db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId)),
    ...userIds.map((userId) =>
      db
        .insert(conversationMembers)
        .values({ conversationId, userId, role, joinedAt: now, lastReadMessageId: latest })
        .onConflictDoNothing(),
    ),
  ]);
}

export const removeMember = (db: Database, conversationId: string, userId: string) =>
  db
    .delete(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .run();

export const setMemberRole = (db: Database, conversationId: string, userId: string, role: MemberRole) =>
  db
    .update(conversationMembers)
    .set({ role })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .run();

export const updateConversation = (
  db: Database,
  id: string,
  values: Partial<
    Pick<ConversationRow, "name" | "description" | "visibility" | "archivedAt" | "updatedAt" | "avatarKey" | "avatarUpdatedAt">
  >,
) => db.update(conversations).set(values).where(eq(conversations.id, id)).run();

/* -------------------------------------------------------------- mentions */

/**
 * Recent messages mentioning a person, newest first, only from conversations
 * they still belong to. Scope is re-checked by the caller.
 */
export async function listMentionRows(db: Database, userId: string, before?: string) {
  return db
    .select({
      message: messages,
      conversation: conversations,
      lastRead: conversationMembers.lastReadMessageId,
    })
    .from(messageMentions)
    .innerJoin(messages, eq(messages.id, messageMentions.messageId))
    .innerJoin(conversations, eq(conversations.id, messageMentions.conversationId))
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, messageMentions.conversationId),
        eq(conversationMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(messageMentions.userId, userId),
        isNull(messages.deletedAt),
        before ? lt(messageMentions.messageId, before) : undefined,
      ),
    )
    .orderBy(desc(messageMentions.messageId))
    .limit(MENTION_PAGE + 1)
    .all();
}
