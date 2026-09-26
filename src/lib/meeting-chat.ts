import { and, desc, eq, getTableColumns, gt, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "./d1";
import { meetingMessages, type MeetingMessageRow, type MeetingRow } from "./schema";
import { MESSAGE_MAX, cleanText, messageId } from "./collab";
import { CollabError } from "./collab-access";
import { meetingAudience } from "./meeting-data";
import { publish } from "./collab-realtime";
import { providerConfig } from "./livekit-config";
import { sendRoomData } from "./livekit";
import { MEETING_CHAT_TOPIC, type MeetingMessageView } from "./meetings";

/**
 * Meeting chat: a meeting's own messages, tied to the meeting — for
 * standalone meetings, and the channel guests share with employees in any
 * meeting. (Room and DM meetings keep their Collaboration conversation for
 * employees; nothing is copied between the two.)
 *
 * Access is always the caller's CURRENT meeting access, checked by the
 * route: an employee through `requireMeeting`, a guest through their
 * admission (only while admitted and the meeting is live, and only messages
 * from their admission onwards). Knowing a meeting id grants nothing.
 *
 * Kept as plain, queryable rows so a future summary can read a meeting's
 * chat alongside its attendance and activity — with the same access rules.
 */

export type Sender = { userId: string; name: string } | { guestId: string; name: string };

const PAGE = 200;

/** A stored message with its commit order (SQLite's rowid, assigned in insert order). */
export type StoredMessage = MeetingMessageRow & { seq: number };
const seq = sql<number>`"MeetingMessage"."rowid"`;

export const toView = (row: StoredMessage, viewer: { userId?: string; guestId?: string }): MeetingMessageView => ({
  id: row.id,
  seq: Number(row.seq),
  sender: { name: row.senderName, guest: !!row.senderGuestId },
  mine: (!!viewer.userId && row.senderUserId === viewer.userId) || (!!viewer.guestId && row.senderGuestId === viewer.guestId),
  body: row.deletedAt ? "" : row.body,
  createdAt: row.createdAt.toISOString(),
  deleted: !!row.deletedAt,
});

/**
 * The newest messages, oldest first, optionally only after a cursor and/or
 * from a moment on. The cursor is commit order (rowid), not the id: two
 * messages in the same millisecond can have ids out of order, and a cursor
 * on them could skip one for good.
 */
export async function listMeetingMessages(db: Database, meetingId: string, options: { after?: number | null; since?: Date | null } = {}): Promise<StoredMessage[]> {
  const rows = await db
    .select({ row: meetingMessages, seq })
    .from(meetingMessages)
    .where(
      and(
        eq(meetingMessages.meetingId, meetingId),
        options.after ? gt(seq, options.after) : undefined,
        options.since ? gte(meetingMessages.createdAt, options.since) : undefined,
      ),
    )
    .orderBy(desc(seq))
    .limit(PAGE)
    .all();
  return rows.reverse().map((r) => ({ ...r.row, seq: Number(r.seq) }));
}

/** Messages this guest has sent in the last minute (their own rate limit). */
export async function guestRecentCount(db: Database, guestId: string, now = Date.now()) {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(meetingMessages)
    .where(and(eq(meetingMessages.senderGuestId, guestId), gt(meetingMessages.createdAt, new Date(now - 60_000)), isNull(meetingMessages.deletedAt)))
    .get();
  return Number(row?.n ?? 0);
}

/**
 * Stores a message once (a retry with the same clientKey returns the first
 * one). Plain text, cleaned like Collaboration messages; the sender's name
 * comes from the server, never the client.
 */
export async function postMeetingMessage(db: Database, meeting: MeetingRow, sender: Sender, rawBody: string, clientKey: string) {
  if (meeting.status !== "live") throw new CollabError(409, "The meeting has ended. The chat is read-only now.");
  const body = cleanText(rawBody);
  if (!body) throw new CollabError(400, "Write a message first.");
  if (body.length > MESSAGE_MAX) throw new CollabError(400, `Keep messages under ${MESSAGE_MAX} characters.`);
  const now = new Date();
  const [row] = await db
    .insert(meetingMessages)
    .values({
      id: messageId(now.getTime()),
      meetingId: meeting.id,
      senderUserId: "userId" in sender ? sender.userId : null,
      senderGuestId: "guestId" in sender ? sender.guestId : null,
      senderName: sender.name,
      body,
      clientKey,
      createdAt: now,
      editedAt: null,
      deletedAt: null,
    })
    .onConflictDoNothing()
    .returning({ ...getTableColumns(meetingMessages), seq })
    .all()
    .then((r) => r.map((x) => ({ ...x, seq: Number(x.seq) })));
  if (row) return { row, created: true };
  // Already stored (a retried send): return it — only to the same sender.
  const found = await db
    .select({ row: meetingMessages, seq })
    .from(meetingMessages)
    .where(and(eq(meetingMessages.meetingId, meeting.id), eq(meetingMessages.clientKey, clientKey)))
    .get();
  const existing = found ? { ...found.row, seq: Number(found.seq) } : undefined;
  const same = existing && ("userId" in sender ? existing.senderUserId === sender.userId : existing.senderGuestId === sender.guestId);
  if (!existing || !same) throw new CollabError(409, "Message not sent. Try again.");
  return { row: existing, created: false };
}

/**
 * Tells everyone a message arrived: the people in the call through the
 * provider's data channel (guests included — they have no Enercore
 * connection), and employees elsewhere (the meeting's details) through
 * Collaboration's live events. Neither carries the text.
 */
export async function announceMeetingMessage(db: Database, meeting: MeetingRow, id: string) {
  const config = await providerConfig();
  await Promise.all([
    config ? sendRoomData(config, meeting.providerRoom, MEETING_CHAT_TOPIC, { id }).catch(() => {}) : Promise.resolve(),
    meetingAudience(db, meeting)
      .then((to) => publish(to, { type: "meeting.message", conversationId: meeting.conversationId ?? "", meetingId: meeting.id, messageId: id }))
      .catch(() => {}),
  ]);
}
