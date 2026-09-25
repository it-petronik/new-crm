import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Database } from "./d1";
import type { Actor } from "./domain";
import type { Access } from "./collab-access";
import { findPeople } from "./collab-data";
import { conversationMembers, conversations, meetingAttendance, meetings, users, type MeetingRow } from "./schema";
import { inRoomScope } from "./collab";
import { STALE_AFTER_MS, type MeetingView } from "./meetings";

/**
 * Meeting persistence. Callers authorise first (conversation access); every
 * query here is keyed by an id the caller has already been allowed to use.
 */

export const findMeeting = (db: Database, id: string) => db.select().from(meetings).where(eq(meetings.id, id)).get();
export const findMeetingByRoom = (db: Database, room: string) =>
  db.select().from(meetings).where(eq(meetings.providerRoom, room)).get();

/**
 * Inserts a meeting unless the database refuses it: the partial unique
 * index allows one live meeting per conversation, so a concurrent second
 * "Start" inserts nothing and returns null — the caller then resolves to
 * the meeting that won.
 */
export async function insertMeeting(db: Database, row: MeetingRow): Promise<MeetingRow | null> {
  const [created] = await db.insert(meetings).values(row).onConflictDoNothing().returning().all();
  return created ?? null;
}

/**
 * Turns a scheduled meeting live, once. Returns the live row and whether
 * THIS call started it; null when another meeting is already live in the
 * same conversation (the database guard refused it).
 */
export async function goLive(db: Database, id: string, at = new Date()): Promise<{ row: MeetingRow; started: boolean } | null> {
  try {
    const [flipped] = await db
      .update(meetings)
      .set({ status: "live", startedAt: at })
      .where(and(eq(meetings.id, id), eq(meetings.status, "scheduled")))
      .returning()
      .all();
    if (flipped) return { row: flipped, started: true };
  } catch (error) {
    // The driver wraps SQLite's message; the constraint is named in the cause.
    const detail = `${String(error)} ${String((error as { cause?: unknown })?.cause ?? "")}`;
    if (/UNIQUE constraint failed: Meeting\.conversationId/i.test(detail)) return null;
    throw error;
  }
  const row = await findMeeting(db, id);
  return row && row.status === "live" ? { row, started: false } : null;
}

export const updateMeeting = (db: Database, id: string, values: Partial<MeetingRow>) =>
  db.update(meetings).set(values).where(eq(meetings.id, id)).run();

/** Live meetings, upcoming scheduled ones, then the most recent past ones. */
export async function conversationMeetings(db: Database, conversationId: string, now = Date.now()) {
  const current = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.conversationId, conversationId),
        or(eq(meetings.status, "live"), and(eq(meetings.status, "scheduled"), gte(meetings.scheduledAt, new Date(now - STALE_AFTER_MS)))),
      ),
    )
    .orderBy(meetings.scheduledAt)
    .all();
  const past = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.conversationId, conversationId), inArray(meetings.status, ["ended", "cancelled"])))
    .orderBy(desc(meetings.createdAt))
    .limit(10)
    .all();
  return [...current, ...past];
}

/** The live meeting in a conversation, if any (one at a time per conversation). */
export const liveMeeting = (db: Database, conversationId: string) =>
  db.select().from(meetings).where(and(eq(meetings.conversationId, conversationId), eq(meetings.status, "live"))).get();

/* ------------------------------------------------------------ attendance */

export async function markJoined(db: Database, meetingId: string, userId: string, at = new Date()) {
  await db
    .insert(meetingAttendance)
    .values({ meetingId, userId, joinedAt: at, leftAt: null })
    .onConflictDoUpdate({ target: [meetingAttendance.meetingId, meetingAttendance.userId], set: { leftAt: null } })
    .run();
}

export const markLeft = (db: Database, meetingId: string, userId: string, at = new Date()) =>
  db
    .update(meetingAttendance)
    .set({ leftAt: at })
    .where(and(eq(meetingAttendance.meetingId, meetingId), eq(meetingAttendance.userId, userId)))
    .run();

/** Everyone still marked present leaves when the meeting ends. */
export const closeAttendance = (db: Database, meetingId: string, at = new Date()) =>
  db
    .update(meetingAttendance)
    .set({ leftAt: at })
    .where(and(eq(meetingAttendance.meetingId, meetingId), isNull(meetingAttendance.leftAt)))
    .run();

/** Of these people, who is in a live meeting right now. */
export async function inMeeting(db: Database, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ userId: meetingAttendance.userId })
    .from(meetingAttendance)
    .innerJoin(meetings, eq(meetings.id, meetingAttendance.meetingId))
    .where(and(inArray(meetingAttendance.userId, userIds.slice(0, 90)), isNull(meetingAttendance.leftAt), eq(meetings.status, "live")))
    .all();
  return new Set(rows.map((r) => r.userId));
}

/** Live meetings a person is currently connected to (for eviction). */
export const activeMeetingsOf = (db: Database, userId: string) =>
  db
    .select({ meeting: meetings })
    .from(meetingAttendance)
    .innerJoin(meetings, eq(meetings.id, meetingAttendance.meetingId))
    .where(and(eq(meetingAttendance.userId, userId), isNull(meetingAttendance.leftAt), eq(meetings.status, "live")))
    .all();

/** Scheduled meetings starting within the lead time that have had no reminder. */
export const dueReminders = (db: Database, now: number, leadMs: number) =>
  db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "scheduled"),
        isNull(meetings.reminderSentAt),
        gte(meetings.scheduledAt, new Date(now)),
        lte(meetings.scheduledAt, new Date(now + leadMs)),
      ),
    )
    .all();

/* ------------------------------------------------------------------ views */

/** Who may end, cancel or moderate: its starter, a room admin, either side of a call. */
export const canManageFor = (actor: Actor, access: Access) => (r: MeetingRow) =>
  r.createdBy === actor.id || access.canAdmin || access.conversation.kind === "direct";

/**
 * The view readers of the conversation get. Attendance names are included
 * because readers of the conversation can already see its members.
 * `canManage` is the reader's own; a broadcast to many readers leaves it
 * false and each browser works it out from what it already knows.
 */
export async function meetingViews(
  db: Database,
  rows: MeetingRow[],
  canManage: (r: MeetingRow) => boolean = () => false,
): Promise<MeetingView[]> {
  if (!rows.length) return [];
  const attendance = await db
    .select()
    .from(meetingAttendance)
    .where(inArray(meetingAttendance.meetingId, rows.map((r) => r.id).slice(0, 90)))
    .all();
  const people = new Map(
    (await findPeople(db, [...rows.map((r) => r.createdBy), ...attendance.map((a) => a.userId)])).map((p) => [p.id, p.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    title: r.title,
    kind: r.kind,
    media: r.media,
    status: r.status,
    createdBy: { id: r.createdBy, name: people.get(r.createdBy) ?? "Former colleague" },
    scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    durationMin: r.durationMin,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    participants: attendance
      .filter((a) => a.meetingId === r.id)
      .map((a) => ({ id: a.userId, name: people.get(a.userId) ?? "Former colleague" })),
    canManage: canManage(r),
  }));
}

/**
 * Who may read a conversation right now — the same rule as collab-service's
 * `audience`, kept here without the request-bound realtime imports so the
 * scheduled Worker can use it.
 */
export async function conversationAudience(db: Database, conversationId: string): Promise<string[]> {
  const conversation = await db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversation) return [];
  const rows = await db
    .select({ id: users.id, active: users.active, companies: users.companies, branches: users.branches })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId))
    .all();
  return rows
    .filter((m) => m.active && (conversation.kind === "direct" ? m.companies.includes(conversation.company) : inRoomScope(m, conversation)))
    .map((m) => m.id);
}

/** Live meetings nobody has been in for a while, or that have run far too long. */
export async function staleLiveMeetings(db: Database, now: number, idleMs: number, maxMs: number) {
  const live = await db.select().from(meetings).where(eq(meetings.status, "live")).all();
  if (!live.length) return [];
  const attendance = await db
    .select()
    .from(meetingAttendance)
    .where(inArray(meetingAttendance.meetingId, live.map((m) => m.id).slice(0, 90)))
    .all();
  return live.filter((m) => {
    const started = (m.startedAt ?? m.createdAt).getTime();
    if (now - started > maxMs) return true;
    const rows = attendance.filter((a) => a.meetingId === m.id);
    if (rows.some((a) => !a.leftAt)) return false;
    const lastLeft = Math.max(started, ...rows.map((a) => a.leftAt!.getTime()));
    return now - lastLeft > idleMs;
  });
}
