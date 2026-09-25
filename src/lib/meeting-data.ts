import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "./d1";
import type { Actor } from "./domain";
import type { Access } from "./collab-access";
import { findPeople } from "./collab-data";
import {
  conversationMembers,
  conversations,
  meetingActivity,
  meetingAttendance,
  meetingGuestInvites,
  meetingGuests,
  meetingInvitees,
  meetingRecordings,
  meetingSessions,
  meetings,
  users,
  type MeetingRow,
} from "./schema";
import { inRoomScope, messageId } from "./collab";
import { STALE_AFTER_MS, type MeetingScope, type MeetingView } from "./meetings";

/**
 * Meeting persistence. Callers authorise first (requireMeeting / conversation
 * access); every query here is keyed by an id the caller may already use.
 */

// D1 binds at most 100 parameters per statement.
const CHUNK = 90;
const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

export const findMeeting = (db: Database, id: string) => db.select().from(meetings).where(eq(meetings.id, id)).get();
export const findMeetingByRoom = (db: Database, room: string) =>
  db.select().from(meetings).where(eq(meetings.providerRoom, room)).get();

/**
 * Inserts a meeting unless the database refuses it: the partial unique
 * index allows one live meeting per conversation, so a concurrent second
 * "Start" inserts nothing and returns null — the caller then resolves to
 * the meeting that won. Standalone meetings (no conversation) are never
 * refused: each is its own session.
 */
export async function insertMeeting(db: Database, row: MeetingRow): Promise<MeetingRow | null> {
  const [created] = await db.insert(meetings).values(row).onConflictDoNothing().returning().all();
  return created ?? null;
}

export const updateMeeting = (db: Database, id: string, values: Partial<MeetingRow>) =>
  db.update(meetings).set(values).where(eq(meetings.id, id)).run();

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
    .where(and(eq(meetings.conversationId, conversationId), inArray(meetings.status, ["ended", "cancelled", "missed"])))
    .orderBy(desc(meetings.createdAt))
    .limit(10)
    .all();
  return [...current, ...past];
}

/** The live meeting in a conversation, if any (one at a time per conversation). */
export const liveMeeting = (db: Database, conversationId: string) =>
  db.select().from(meetings).where(and(eq(meetings.conversationId, conversationId), eq(meetings.status, "live"))).get();

/**
 * Every meeting this person may see: those of conversations they can read
 * right now, and standalone meetings they organise or are invited to.
 * Current ones in full; past ones, the most recent `pastLimit` per group.
 */
export async function visibleMeetings(db: Database, actor: Actor, pastLimit = 60) {
  const memberships = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(eq(conversationMembers.userId, actor.id))
    .all();
  const readable = memberships
    .map((m) => m.conversation)
    .filter((c) => (c.kind === "direct" ? actor.companies.includes(c.company) : inRoomScope(actor, c)))
    .map((c) => c.id);
  const invited = (await db.select({ id: meetingInvitees.meetingId }).from(meetingInvitees).where(eq(meetingInvitees.userId, actor.id)).all()).map((r) => r.id);

  const scopes = [
    and(isNull(meetings.conversationId), eq(meetings.createdBy, actor.id)),
    ...chunks(invited).map((ids) => inArray(meetings.id, ids)),
    ...chunks(readable).map((ids) => inArray(meetings.conversationId, ids)),
  ];
  const rows: MeetingRow[] = [];
  for (const scope of scopes) {
    rows.push(...(await db.select().from(meetings).where(and(scope, inArray(meetings.status, ["live", "scheduled"]))).all()));
    rows.push(
      ...(await db
        .select()
        .from(meetings)
        .where(and(scope, inArray(meetings.status, ["ended", "cancelled", "missed"])))
        .orderBy(desc(meetings.createdAt))
        .limit(pastLimit)
        .all()),
    );
  }
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

/* -------------------------------------------------------------- invitees */

export const listInvitees = (db: Database, meetingId: string) =>
  db
    .select({ id: users.id, name: users.name, role: users.role, active: users.active })
    .from(meetingInvitees)
    .innerJoin(users, eq(users.id, meetingInvitees.userId))
    .where(eq(meetingInvitees.meetingId, meetingId))
    .all();

export const isInvitee = async (db: Database, meetingId: string, userId: string) =>
  !!(await db
    .select({ id: meetingInvitees.userId })
    .from(meetingInvitees)
    .where(and(eq(meetingInvitees.meetingId, meetingId), eq(meetingInvitees.userId, userId)))
    .get());

/** Replaces a standalone meeting's invitees; returns who was newly added and removed. */
export async function setInvitees(db: Database, meetingId: string, userIds: string[], by: string) {
  const before = new Set((await listInvitees(db, meetingId)).map((i) => i.id));
  const after = new Set(userIds);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  for (const ids of chunks(removed))
    await db.delete(meetingInvitees).where(and(eq(meetingInvitees.meetingId, meetingId), inArray(meetingInvitees.userId, ids))).run();
  const now = new Date();
  for (const userId of added)
    await db.insert(meetingInvitees).values({ meetingId, userId, invitedBy: by, invitedAt: now }).onConflictDoNothing().run();
  return { added, removed };
}

/* ------------------------------------------------------------ audiences */

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

/**
 * Everyone entitled to a meeting right now: its conversation's readers, or
 * a standalone meeting's organiser and active invitees.
 */
export async function meetingAudience(db: Database, meeting: Pick<MeetingRow, "id" | "conversationId" | "createdBy">): Promise<string[]> {
  if (meeting.conversationId) return conversationAudience(db, meeting.conversationId);
  const invitees = (await listInvitees(db, meeting.id)).filter((i) => i.active).map((i) => i.id);
  const organiser = await db.select({ active: users.active }).from(users).where(eq(users.id, meeting.createdBy)).get();
  return [...new Set([...(organiser?.active ? [meeting.createdBy] : []), ...invitees])];
}

/* ------------------------------------------------------------ attendance */

/**
 * One session per connection: joining opens one, leaving closes the most
 * recent open one for that identity. Reconnecting therefore adds a session
 * rather than overwriting the first, and totals are the sum.
 */
export async function openSession(
  db: Database,
  s: { meetingId: string; identity: string; userId: string | null; guestName: string | null; at: Date },
) {
  // A duplicate "joined" for an identity already connected changes nothing.
  const open = await db
    .select({ id: meetingSessions.id })
    .from(meetingSessions)
    .where(and(eq(meetingSessions.meetingId, s.meetingId), eq(meetingSessions.participantIdentity, s.identity), isNull(meetingSessions.leftAt)))
    .get();
  if (open) return;
  await db
    .insert(meetingSessions)
    .values({
      id: messageId(s.at.getTime()),
      meetingId: s.meetingId,
      participantIdentity: s.identity,
      userId: s.userId,
      guestName: s.guestName,
      kind: s.userId ? "internal" : "guest",
      joinedAt: s.at,
      leftAt: null,
      durationSeconds: null,
    })
    .run();
}

async function closeRows(db: Database, rows: { id: string; joinedAt: Date }[], at: Date) {
  for (const s of rows)
    await db
      .update(meetingSessions)
      .set({ leftAt: at, durationSeconds: Math.max(0, Math.round((at.getTime() - s.joinedAt.getTime()) / 1000)) })
      .where(eq(meetingSessions.id, s.id))
      .run();
}

export async function closeSession(db: Database, meetingId: string, identity: string, at = new Date()) {
  const open = await db
    .select({ id: meetingSessions.id, joinedAt: meetingSessions.joinedAt })
    .from(meetingSessions)
    .where(and(eq(meetingSessions.meetingId, meetingId), eq(meetingSessions.participantIdentity, identity), isNull(meetingSessions.leftAt)))
    .all();
  await closeRows(db, open, at);
}

/** Everyone still connected leaves when the meeting ends. */
export async function closeAllSessions(db: Database, meetingId: string, at = new Date()) {
  const open = await db
    .select({ id: meetingSessions.id, joinedAt: meetingSessions.joinedAt })
    .from(meetingSessions)
    .where(and(eq(meetingSessions.meetingId, meetingId), isNull(meetingSessions.leftAt)))
    .all();
  await closeRows(db, open, at);
  // The earlier attendance table, for meetings started before sessions existed.
  await db.update(meetingAttendance).set({ leftAt: at }).where(and(eq(meetingAttendance.meetingId, meetingId), isNull(meetingAttendance.leftAt))).run();
}

export const meetingSessionsOf = (db: Database, meetingId: string) =>
  db.select().from(meetingSessions).where(eq(meetingSessions.meetingId, meetingId)).orderBy(meetingSessions.joinedAt).all();

/** Of these people, who is in a live meeting right now. */
export async function inMeeting(db: Database, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await db
    .select({ userId: meetingSessions.userId })
    .from(meetingSessions)
    .innerJoin(meetings, eq(meetings.id, meetingSessions.meetingId))
    .where(and(inArray(meetingSessions.userId, userIds.slice(0, CHUNK)), isNull(meetingSessions.leftAt), eq(meetings.status, "live")))
    .all();
  return new Set(rows.map((r) => r.userId).filter((u): u is string => !!u));
}

/** Live meetings a person is currently connected to (for eviction). */
export async function activeMeetingsOf(db: Database, userId: string) {
  const rows = await db
    .select({ meeting: meetings })
    .from(meetingSessions)
    .innerJoin(meetings, eq(meetings.id, meetingSessions.meetingId))
    .where(and(eq(meetingSessions.userId, userId), isNull(meetingSessions.leftAt), eq(meetings.status, "live")))
    .all();
  return [...new Map(rows.map((r) => [r.meeting.id, r])).values()];
}

/* -------------------------------------------------------------- activity */

export const logActivity = (db: Database, meetingId: string, type: string, actorName: string | null, at = new Date()) =>
  db.insert(meetingActivity).values({ id: messageId(at.getTime()), meetingId, type, actorName, at }).run();

export const activityOf = (db: Database, meetingId: string) =>
  db.select().from(meetingActivity).where(eq(meetingActivity.meetingId, meetingId)).orderBy(meetingActivity.at).all();

/* ------------------------------------------------------ guests & invites */

export const activeGuestInvite = (db: Database, meetingId: string) =>
  db
    .select()
    .from(meetingGuestInvites)
    .where(and(eq(meetingGuestInvites.meetingId, meetingId), isNull(meetingGuestInvites.revokedAt)))
    .orderBy(desc(meetingGuestInvites.createdAt))
    .get();

export const revokeGuestInvites = (db: Database, meetingId: string, at = new Date()) =>
  db
    .update(meetingGuestInvites)
    .set({ revokedAt: at })
    .where(and(eq(meetingGuestInvites.meetingId, meetingId), isNull(meetingGuestInvites.revokedAt)))
    .run();

export const findGuestInviteByHash = (db: Database, tokenHash: string) =>
  db.select().from(meetingGuestInvites).where(eq(meetingGuestInvites.tokenHash, tokenHash)).get();

export const findGuestBySecret = (db: Database, secretHash: string) =>
  db.select().from(meetingGuests).where(eq(meetingGuests.secretHash, secretHash)).get();

export const findGuest = (db: Database, id: string) => db.select().from(meetingGuests).where(eq(meetingGuests.id, id)).get();

export const waitingGuests = (db: Database, meetingId: string) =>
  db
    .select({ id: meetingGuests.id, name: meetingGuests.name, createdAt: meetingGuests.createdAt })
    .from(meetingGuests)
    .where(and(eq(meetingGuests.meetingId, meetingId), eq(meetingGuests.status, "waiting")))
    .orderBy(meetingGuests.createdAt)
    .all();

/* ------------------------------------------------------------- recordings */

export const recordingsOf = (db: Database, meetingId: string) =>
  db.select().from(meetingRecordings).where(eq(meetingRecordings.meetingId, meetingId)).orderBy(desc(meetingRecordings.startedAt)).all();

export const findRecording = (db: Database, id: string) => db.select().from(meetingRecordings).where(eq(meetingRecordings.id, id)).get();
export const findRecordingByEgress = (db: Database, egressId: string) =>
  db.select().from(meetingRecordings).where(eq(meetingRecordings.egressId, egressId)).get();
export const activeRecording = (db: Database, meetingId: string) =>
  db
    .select()
    .from(meetingRecordings)
    .where(and(eq(meetingRecordings.meetingId, meetingId), inArray(meetingRecordings.status, ["starting", "recording"])))
    .get();

/* ------------------------------------------------------------------ sweep */

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

/** Scheduled meetings whose window has passed without anyone starting them. */
export const missedMeetings = (db: Database, now: number) =>
  db
    .select()
    .from(meetings)
    .where(and(eq(meetings.status, "scheduled"), isNotNull(meetings.scheduledAt), lt(meetings.scheduledAt, new Date(now - STALE_AFTER_MS))))
    .all();

/** Live meetings nobody has been in for a while, or that have run far too long. */
export async function staleLiveMeetings(db: Database, now: number, idleMs: number, maxMs: number) {
  const live = await db.select().from(meetings).where(eq(meetings.status, "live")).all();
  if (!live.length) return [];
  const rows: { meetingId: string; leftAt: Date | null }[] = [];
  for (const ids of chunks(live.map((m) => m.id))) {
    rows.push(...(await db.select({ meetingId: meetingSessions.meetingId, leftAt: meetingSessions.leftAt }).from(meetingSessions).where(inArray(meetingSessions.meetingId, ids)).all()));
    rows.push(...(await db.select({ meetingId: meetingAttendance.meetingId, leftAt: meetingAttendance.leftAt }).from(meetingAttendance).where(inArray(meetingAttendance.meetingId, ids)).all()));
  }
  return live.filter((m) => {
    const started = (m.startedAt ?? m.createdAt).getTime();
    if (now - started > maxMs) return true;
    const mine = rows.filter((a) => a.meetingId === m.id);
    if (mine.some((a) => !a.leftAt)) return false;
    const lastLeft = Math.max(started, ...mine.map((a) => a.leftAt!.getTime()));
    return now - lastLeft > idleMs;
  });
}

/* ------------------------------------------------------------------ views */

/** Who may end, cancel or moderate: its organiser, a room admin, either side of a call. */
export const canManageFor = (actor: Actor, access: Access | null) => (r: MeetingRow) =>
  r.createdBy === actor.id || !!access?.canAdmin || access?.conversation.kind === "direct";

/**
 * The views readers get. Names are included only for people the reader can
 * already see (conversation members, a meeting's invitees and attendees).
 * `canManage` is the reader's own; a broadcast to many readers leaves it
 * false and each browser works it out from what it already knows.
 */
export async function meetingViews(
  db: Database,
  rows: MeetingRow[],
  canManage: (r: MeetingRow) => boolean = () => false,
  viewerId?: string,
): Promise<MeetingView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const sessions: { meetingId: string; participantIdentity: string; userId: string | null; guestName: string | null }[] = [];
  const legacy: { meetingId: string; userId: string }[] = [];
  const inviteeRows: { meetingId: string }[] = [];
  const recs: { meetingId: string; status: string }[] = [];
  for (const group of chunks(ids)) {
    sessions.push(
      ...(await db
        .select({ meetingId: meetingSessions.meetingId, participantIdentity: meetingSessions.participantIdentity, userId: meetingSessions.userId, guestName: meetingSessions.guestName })
        .from(meetingSessions)
        .where(inArray(meetingSessions.meetingId, group))
        .all()),
    );
    legacy.push(...(await db.select({ meetingId: meetingAttendance.meetingId, userId: meetingAttendance.userId }).from(meetingAttendance).where(inArray(meetingAttendance.meetingId, group)).all()));
    inviteeRows.push(...(await db.select({ meetingId: meetingInvitees.meetingId }).from(meetingInvitees).where(inArray(meetingInvitees.meetingId, group)).all()));
    recs.push(...(await db.select({ meetingId: meetingRecordings.meetingId, status: meetingRecordings.status }).from(meetingRecordings).where(inArray(meetingRecordings.meetingId, group)).all()));
  }
  const convIds = [...new Set(rows.map((r) => r.conversationId).filter((c): c is string => !!c))];
  const convs = new Map<string, { kind: string; name: string | null; directKey: string | null; members: number }>();
  for (const group of chunks(convIds)) {
    const found = await db.select().from(conversations).where(inArray(conversations.id, group)).all();
    const counts = await db
      .select({ id: conversationMembers.conversationId, n: sql<number>`count(*)` })
      .from(conversationMembers)
      .where(inArray(conversationMembers.conversationId, group))
      .groupBy(conversationMembers.conversationId)
      .all();
    for (const c of found) convs.set(c.id, { kind: c.kind, name: c.name, directKey: c.directKey, members: Number(counts.find((x) => x.id === c.id)?.n ?? 0) });
  }
  const peopleIds = [
    ...rows.map((r) => r.createdBy),
    ...sessions.map((s) => s.userId).filter((u): u is string => !!u),
    ...legacy.map((l) => l.userId),
    ...[...convs.values()].flatMap((c) => (c.kind === "direct" ? (c.directKey ?? "").split(":") : [])),
  ];
  const people = new Map((await findPeople(db, peopleIds)).map((p) => [p.id, p.name]));

  return rows.map((r) => {
    const conv = r.conversationId ? convs.get(r.conversationId) : undefined;
    const scope: MeetingScope = !r.conversationId ? "standalone" : conv?.kind === "direct" ? "direct" : "room";
    const counterpart = conv?.kind === "direct" ? (conv.directKey ?? "").split(":").find((id) => id !== (viewerId ?? r.createdBy)) : undefined;
    const attendees = new Map<string, string>();
    for (const s of sessions.filter((x) => x.meetingId === r.id))
      attendees.set(s.participantIdentity, s.userId ? (people.get(s.userId) ?? "Former colleague") : `${s.guestName ?? "Guest"} (guest)`);
    for (const l of legacy.filter((x) => x.meetingId === r.id)) if (!attendees.has(l.userId)) attendees.set(l.userId, people.get(l.userId) ?? "Former colleague");
    const myRecs = recs.filter((x) => x.meetingId === r.id);
    return {
      id: r.id,
      conversationId: r.conversationId,
      scope,
      conversationTitle: scope === "room" ? (conv?.name ?? "Room") : scope === "direct" && counterpart ? (people.get(counterpart) ?? "Former colleague") : null,
      guestAccess: r.guestAccess,
      inviteeCount: scope === "standalone" ? inviteeRows.filter((i) => i.meetingId === r.id).length + 1 : (conv?.members ?? 0),
      attendeeCount: attendees.size,
      recording: { active: myRecs.some((x) => x.status === "starting" || x.status === "recording"), available: myRecs.filter((x) => x.status === "saved").length },
      // Filled per reader by attachRelated (meeting-related.ts), never here.
      related: null,
      title: r.title,
      kind: r.kind,
      media: r.media,
      status: r.status,
      createdBy: { id: r.createdBy, name: people.get(r.createdBy) ?? "Former colleague" },
      scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
      durationMin: r.durationMin,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      participants: [...attendees.entries()].map(([id, name]) => ({ id, name })),
      canManage: canManage(r),
    };
  });
}

/** People by id, with scope fields, for checking invitees (the caller applies scope). */
export const peopleByIds = (db: Database, ids: string[]) =>
  ids.length
    ? db
        .select({ id: users.id, name: users.name, role: users.role, companies: users.companies, branches: users.branches, active: users.active })
        .from(users)
        .where(inArray(users.id, ids.slice(0, CHUNK)))
        .all()
    : Promise.resolve([]);
