import { and, desc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Database } from "./d1";
import { roles, canRead, type Actor, type RecordItem } from "./domain";
import { inRoomScope, messageId, type CollabEvent } from "./collab";
import {
  businessRecords,
  conversationMembers,
  conversations,
  messages,
  notificationPreferences,
  notifications,
  users,
  type NotificationRow,
  type UserRow,
} from "./schema";
import {
  ACTION_TYPES,
  DEFAULT_PREFERENCES,
  NOTIFICATION_PAGE,
  targetFor,
  type NotificationInbox,
  type NotificationPreferences,
  type NotificationView,
} from "./notification-types";
import type { NotificationDraft, Person } from "./notification-rules";

/**
 * Persistence and delivery for notifications.
 *
 * Free of Next.js imports so the scheduled Worker can use it too: callers
 * pass `deliver`, which hands an event to people's realtime hubs (the API
 * routes use collab-realtime's `publish`; the Worker uses its binding).
 *
 * Write once, then deliver: a row is inserted only if its (recipient,
 * dedupeKey) is new, and only newly inserted rows are pushed, so a retried
 * request or a repeated scheduled run never produces a second toast.
 */

export type Deliver = (userIds: string[], event: CollabEvent) => Promise<unknown>;

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;
const chunks = <T>(list: T[], size = CHUNK) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export const RETENTION_DAYS = 120;

/**
 * Ids are time-ordered, and the inbox is "newest first" by id. Two
 * notifications created in the same millisecond would otherwise share a
 * time prefix and order by their random suffix, so each id takes a
 * strictly later millisecond than the last one this instance issued.
 */
let lastIdTime = 0;
function nextIdTime(now: number) {
  lastIdTime = Math.max(now, lastIdTime + 1);
  return lastIdTime;
}

export function toPerson(row: UserRow): Person {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Actor["role"],
    companies: row.companies,
    branches: row.branches,
    email: row.email,
    moduleAccess: (row.moduleAccess || undefined) as Actor["moduleAccess"],
    active: row.active && (roles as readonly string[]).includes(row.role),
  };
}

export async function activePeople(db: Database): Promise<Person[]> {
  return (await db.select().from(users).all()).map(toPerson).filter((p) => p.active);
}

function view(row: NotificationRow, actorName: string | null): NotificationView {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title: row.title,
    body: row.body,
    actor: row.actorId ? { id: row.actorId, name: actorName ?? "Former colleague" } : null,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    target: targetFor(row),
    needsAction: !row.readAt && (ACTION_TYPES.has(row.type) || row.priority === "urgent"),
  };
}

/**
 * Stores the drafts (skipping any already recorded) and pushes each new one
 * to its recipient's open tabs. Returns how many were new.
 */
export async function createNotifications(db: Database, drafts: NotificationDraft[], deliver: Deliver, names?: Map<string, string>) {
  if (!drafts.length) return 0;
  const now = Date.now();
  const inserted: NotificationRow[] = [];
  for (const group of chunks(drafts, 10)) {
    const rows = await Promise.all(
      group.map((d) =>
        db
          .insert(notifications)
          .values({
            id: messageId(nextIdTime(now)),
            recipientId: d.recipientId,
            actorId: d.actorId,
            type: d.type,
            category: d.category,
            title: d.title.slice(0, 160),
            body: d.body.slice(0, 280),
            entityType: d.entityType,
            entityId: d.entityId,
            conversationId: d.conversationId ?? null,
            messageId: d.messageId ?? null,
            priority: d.priority,
            dedupeKey: d.dedupeKey,
            createdAt: new Date(now),
            readAt: null,
          })
          .onConflictDoNothing()
          .returning()
          .all(),
      ),
    );
    inserted.push(...rows.flat());
  }
  if (!inserted.length) return 0;
  const actorIds = [...new Set(inserted.map((r) => r.actorId).filter((id): id is string => !!id))].filter((id) => !names?.has(id));
  const known = new Map(names);
  if (actorIds.length)
    for (const row of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds)).all())
      known.set(row.id, row.name);
  await Promise.allSettled(
    inserted.map((row) =>
      deliver([row.recipientId], {
        type: "notification.created",
        conversationId: "",
        notification: view(row, row.actorId ? (known.get(row.actorId) ?? null) : null),
      }),
    ),
  );
  return inserted.length;
}

/**
 * Hides what the reader may no longer see. A notification is a note that
 * something happened, never a grant: each item's record or conversation is
 * re-checked against CURRENT access, and one the reader has lost keeps only
 * its generic title, with no body and nowhere to go.
 */
async function redact(db: Database, actor: Actor, rows: NotificationView[], source: NotificationRow[]) {
  const recordIds = [...new Set(source.filter((r) => targetFor(r)?.kind === "record").map((r) => r.entityId))];
  // Meetings inherit their conversation's access, so they are checked the same way.
  const conversationIds = [
    ...new Set(
      source
        .filter((r) => r.entityType === "conversation" || r.entityType === "meeting")
        .map((r) => r.conversationId ?? r.entityId),
    ),
  ];
  const messageIds = [...new Set(source.map((r) => r.messageId).filter((id): id is string => !!id))];

  const readable = new Set<string>();
  for (const ids of chunks(recordIds)) {
    const found = await db.select({ id: businessRecords.id, payload: businessRecords.payload }).from(businessRecords).where(inArray(businessRecords.id, ids)).all();
    for (const row of found) {
      const record = row.payload as RecordItem;
      if (!record.deletedAt && canRead(actor, record)) readable.add(row.id);
    }
  }
  const reachable = new Set<string>();
  for (const ids of chunks(conversationIds)) {
    const found = await db
      .select({ conversation: conversations })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, actor.id), inArray(conversationMembers.conversationId, ids)))
      .all();
    for (const { conversation: c } of found)
      if (c.kind === "direct" ? actor.companies.includes(c.company) : inRoomScope(actor, c)) reachable.add(c.id);
  }
  const deletedMessages = new Set<string>();
  for (const ids of chunks(messageIds)) {
    const found = await db.select({ id: messages.id, deletedAt: messages.deletedAt }).from(messages).where(inArray(messages.id, ids)).all();
    for (const m of found) if (m.deletedAt) deletedMessages.add(m.id);
  }

  return rows.map((item, i) => {
    const row = source[i];
    const target = item.target;
    const allowed =
      !target ||
      target.kind === "profile" ||
      (target.kind === "record" && readable.has(target.recordId)) ||
      ((target.kind === "conversation" || target.kind === "meeting") && reachable.has(target.conversationId));
    if (!allowed) return { ...item, body: "No longer available to you.", target: null, needsAction: false };
    if (row.messageId && deletedMessages.has(row.messageId)) return { ...item, body: "Message deleted" };
    return item;
  });
}

export async function unreadCount(db: Database, userId: string) {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
    .get();
  return Number(row?.n ?? 0);
}

export async function preferencesFor(db: Database, userId: string): Promise<NotificationPreferences> {
  const row = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).get();
  return row ? { desktop: row.desktop, preview: row.preview } : DEFAULT_PREFERENCES;
}

export async function savePreferences(db: Database, userId: string, prefs: NotificationPreferences) {
  await db
    .insert(notificationPreferences)
    .values({ userId, ...prefs, updatedAt: new Date() })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...prefs, updatedAt: new Date() } })
    .run();
}

/** One page of the reader's inbox, newest first, with details re-authorised. */
export async function inbox(db: Database, actor: Actor, before?: string): Promise<NotificationInbox> {
  const found = await db
    .select({ row: notifications, actorName: users.name })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(and(eq(notifications.recipientId, actor.id), before ? lt(notifications.id, before) : undefined))
    .orderBy(desc(notifications.id))
    .limit(NOTIFICATION_PAGE + 1)
    .all();
  const page = found.slice(0, NOTIFICATION_PAGE);
  const items = await redact(db, actor, page.map((f) => view(f.row, f.actorName)), page.map((f) => f.row));
  return {
    items,
    unread: await unreadCount(db, actor.id),
    nextBefore: found.length > NOTIFICATION_PAGE ? page[page.length - 1].row.id : null,
    preferences: await preferencesFor(db, actor.id),
  };
}

/** Marks the reader's own notifications read or unread; returns those changed. */
export async function setRead(db: Database, userId: string, ids: string[], read: boolean) {
  const changed: string[] = [];
  for (const group of chunks(ids.slice(0, 200), 80)) {
    const rows = await db
      .update(notifications)
      .set({ readAt: read ? new Date() : null })
      .where(
        and(
          eq(notifications.recipientId, userId),
          inArray(notifications.id, group),
          read ? isNull(notifications.readAt) : sql`${notifications.readAt} IS NOT NULL`,
        ),
      )
      .returning({ id: notifications.id })
      .all();
    changed.push(...rows.map((r) => r.id));
  }
  return changed;
}

/** Everything up to `upTo` (the newest id the reader has) becomes read. */
export async function readAll(db: Database, userId: string, upTo: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt), lte(notifications.id, upTo)))
    .run();
}

/**
 * Once an approval is decided, nobody else needs to act on it: every
 * outstanding "approval required" for that record is marked read.
 * Returns the ids per recipient so their open tabs can be told.
 */
export async function resolveApproval(db: Database, recordId: string) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.entityId, recordId), eq(notifications.type, "approval.requested"), isNull(notifications.readAt)))
    .returning({ id: notifications.id, recipientId: notifications.recipientId })
    .all();
  const byRecipient = new Map<string, string[]>();
  for (const r of rows) byRecipient.set(r.recipientId, [...(byRecipient.get(r.recipientId) ?? []), r.id]);
  return byRecipient;
}

/**
 * Reading a conversation up to a message also reads the chat notifications
 * it covers, so the inbox and the chat badge never disagree.
 */
export async function readConversation(db: Database, userId: string, conversationId: string, upToMessageId: string) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, userId),
        eq(notifications.conversationId, conversationId),
        isNull(notifications.readAt),
        lte(notifications.messageId, upToMessageId),
      ),
    )
    .returning({ id: notifications.id })
    .all();
  return rows.map((r) => r.id);
}

export async function purgeOldNotifications(db: Database, now = Date.now()) {
  await db
    .delete(notifications)
    .where(lt(notifications.createdAt, new Date(now - RETENTION_DAYS * 86_400_000)))
    .run();
}
