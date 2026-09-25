import type { Database } from "./d1";
import type { MeetingRow } from "./schema";
import { afterResponse, publish } from "./collab-realtime";
import { createNotifications } from "./notification-store";
import type { NotificationDraft } from "./notification-rules";
import { closeRoom, removeFromRoom, stopRecording } from "./livekit";
import { providerConfig } from "./livekit-config";
import {
  activeMeetingsOf,
  activeRecording,
  canManageFor,
  closeAllSessions,
  closeSession,
  findMeeting,
  isInvitee,
  logActivity,
  meetingAudience,
  meetingViews,
  updateMeeting,
} from "./meeting-data";
import { meetingRecordings, conversationMembers, conversations, meetingGuests } from "./schema";
import { and, eq, inArray } from "drizzle-orm";
import { businessStamp } from "./gst";
import type { MeetingEvent, MeetingView } from "./meetings";
import type { Actor } from "./domain";
import { isId } from "./collab";
import { CollabError, requireRead, type Access } from "./collab-access";

/**
 * Meeting access, signalling and side effects.
 *
 * Everything is addressed to the people entitled to the meeting RIGHT NOW
 * (`meetingAudience`: the conversation's readers, or a standalone meeting's
 * organiser and invitees), so a private meeting is never announced to
 * anyone outside it. Nobody is notified of their own action.
 */

/* ---------------------------------------------------------------- access */

/**
 * The one way a meeting is reached. A conversation meeting needs read
 * access to its conversation right now; a standalone meeting needs the
 * caller to be its organiser or an invitee. Anything else is the same
 * "not found" as a meeting that does not exist.
 */
export async function requireMeeting(db: Database, actor: Actor, id: unknown) {
  const missing = () => new CollabError(404, "Meeting not found.");
  if (!isId(id)) throw missing();
  const meeting = await findMeeting(db, id);
  if (!meeting) throw missing();
  let access: Access | null = null;
  if (meeting.conversationId) {
    try {
      access = await requireRead(db, actor, meeting.conversationId);
    } catch {
      throw missing();
    }
  } else if (meeting.createdBy !== actor.id && !(await isInvitee(db, meeting.id, actor.id))) {
    throw missing();
  }
  return { meeting, access, canManage: canManageFor(actor, access)(meeting) };
}

/** The reader's own view of one meeting. */
export async function viewFor(db: Database, actor: Actor, meeting: MeetingRow, canManage: boolean): Promise<MeetingView> {
  return (await meetingViews(db, [meeting], () => canManage, actor.id))[0];
}

/** Who can admit guests and moderate: the organiser, room admins, either side of a DM. */
export async function hostsOf(db: Database, row: MeetingRow): Promise<string[]> {
  if (!row.conversationId) return [row.createdBy];
  const audience = await meetingAudience(db, row);
  const conversation = await db.select({ kind: conversations.kind }).from(conversations).where(eq(conversations.id, row.conversationId)).get();
  if (conversation?.kind === "direct") return audience;
  const admins = await db
    .select({ userId: conversationMembers.userId, role: conversationMembers.role })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, row.conversationId))
    .all();
  return audience.filter((id) => id === row.createdBy || admins.some((a) => a.userId === id && (a.role === "owner" || a.role === "admin")));
}

/* ------------------------------------------------------------ signalling */

type Kind = "meeting.started" | "meeting.updated" | "meeting.ended";

/** Tells everyone entitled to the meeting (optionally not one person). */
export async function announce(db: Database, type: Kind, row: MeetingRow, except?: string) {
  const [view] = await meetingViews(db, [row]);
  const to = (await meetingAudience(db, row)).filter((id) => id !== except);
  // The acting person's other tabs still need the event, just no notification.
  const everyone = except ? [...to, except] : to;
  await publish(everyone, { type, conversationId: row.conversationId ?? "", meeting: view } as MeetingEvent);
  return to;
}

const draft = (
  row: MeetingRow,
  recipientId: string,
  actorId: string | null,
  d: Pick<NotificationDraft, "type" | "title" | "body" | "priority" | "dedupeKey">,
): NotificationDraft => ({
  recipientId,
  actorId,
  category: "collaboration",
  entityType: "meeting",
  entityId: row.id,
  conversationId: row.conversationId,
  ...d,
});

const when = (row: MeetingRow) => (row.scheduledAt ? businessStamp(row.scheduledAt) : "");

/**
 * A meeting went live. Everyone else entitled is notified; a DM call also
 * rings the other person.
 */
export function meetingStarted(db: Database, row: MeetingRow, starter: { id: string; name: string }, context: { direct: boolean; roomName: string | null }) {
  return afterResponse("meeting-started", async () => {
    const to = await announce(db, "meeting.started", row, starter.id);
    await logActivity(db, row.id, "started", starter.name);
    if (context.direct) {
      const [view] = await meetingViews(db, [row]);
      await publish(to, { type: "meeting.invited", conversationId: row.conversationId ?? "", meeting: view, from: starter });
    }
    const video = row.media === "video";
    await createNotifications(
      db,
      to.map((id) =>
        draft(row, id, starter.id, {
          type: context.direct ? "meeting.invited" : "meeting.started",
          title: context.direct
            ? `${starter.name} is calling you${video ? " (video)" : ""}`
            : row.conversationId
              ? `${video ? "Video" : "Voice"} meeting started`
              : `${starter.name} started ${row.title}`,
          body: context.direct ? row.title : row.conversationId ? `${starter.name} · ${context.roomName ?? row.title}` : "Join from the meeting page.",
          priority: "important",
          dedupeKey: `meeting-started:${row.id}`,
        }),
      ),
      publish,
      new Map([[starter.id, starter.name]]),
    );
  });
}

/** A meeting was scheduled: announced (the organiser's tabs too) and people told. */
export function meetingScheduled(db: Database, row: MeetingRow, by: { id: string; name: string }) {
  return afterResponse("meeting-scheduled", async () => {
    const to = await announce(db, "meeting.updated", row, by.id);
    await createNotifications(
      db,
      to.map((id) =>
        draft(row, id, by.id, {
          type: row.conversationId ? "meeting.scheduled" : "meeting.invitation",
          title: row.conversationId ? `${by.name} scheduled a meeting` : `${by.name} invited you to ${row.title}`,
          body: `${row.title}${when(row) ? ` · ${when(row)}` : ""}`,
          priority: "normal",
          dedupeKey: `meeting-invite:${row.id}`,
        }),
      ),
      publish,
      new Map([[by.id, by.name]]),
    );
  });
}

/** People newly added to a standalone meeting are invited (a live one says so). */
export function inviteesAdded(db: Database, row: MeetingRow, by: { id: string; name: string }, userIds: string[]) {
  return afterResponse("meeting-invitees", async () => {
    await announce(db, "meeting.updated", row, by.id);
    const live = row.status === "live";
    await createNotifications(
      db,
      userIds
        .filter((id) => id !== by.id)
        .map((id) =>
          draft(row, id, by.id, {
            type: "meeting.invitation",
            title: `${by.name} invited you to ${row.title}`,
            body: live ? "It's happening now." : when(row) || "Open it to join.",
            priority: live ? "important" : "normal",
            dedupeKey: `meeting-invite:${row.id}`,
          }),
        ),
      publish,
      new Map([[by.id, by.name]]),
    );
  });
}

/** The time changed, or the meeting was cancelled: everyone else is told. */
export function meetingChanged(db: Database, row: MeetingRow, by: { id: string; name: string }, change: "rescheduled" | "cancelled") {
  return afterResponse("meeting-changed", async () => {
    const to = await announce(db, "meeting.updated", row, by.id);
    await createNotifications(
      db,
      to.map((id) =>
        draft(row, id, by.id, {
          type: change === "cancelled" ? "meeting.cancelled" : "meeting.rescheduled",
          title: change === "cancelled" ? `${row.title} was cancelled` : `${row.title} was rescheduled`,
          body: change === "cancelled" ? `By ${by.name}` : `Now ${when(row)} · by ${by.name}`,
          priority: "normal",
          dedupeKey: change === "cancelled" ? `meeting-cancelled:${row.id}` : `meeting-rescheduled:${row.id}:${row.scheduledAt?.getTime() ?? 0}`,
        }),
      ),
      publish,
      new Map([[by.id, by.name]]),
    );
  });
}

/** A guest is waiting: the hosts only — live, and in their inbox. */
export function guestWaiting(db: Database, row: MeetingRow, guest: { id: string; name: string }) {
  return afterResponse("meeting-guest-waiting", async () => {
    const hosts = await hostsOf(db, row);
    await publish(hosts, { type: "meeting.guest_waiting", conversationId: row.conversationId ?? "", meetingId: row.id, guest });
    await createNotifications(
      db,
      hosts.map((id) =>
        draft(row, id, null, {
          type: "meeting.guest_waiting",
          title: `${guest.name} is waiting to join`,
          body: row.title,
          priority: "important",
          dedupeKey: `guest-waiting:${guest.id}`,
        }),
      ),
      publish,
    );
  });
}

/* ----------------------------------------------------------------- ending */

/**
 * Ends a meeting for everyone: any recording is stopped, the provider room
 * is closed (disconnecting every participant and guest), attendance is
 * closed, waiting guests are turned away, and everyone entitled is told.
 * History, sessions and reports are kept. Idempotent.
 */
export async function endMeeting(db: Database, id: string, by: string | null = null, at = new Date()) {
  const row = await findMeeting(db, id);
  if (!row || row.status === "ended" || row.status === "cancelled" || row.status === "missed") return row;
  const config = await providerConfig();
  const recording = await activeRecording(db, row.id);
  if (recording) {
    if (config && recording.egressId) await stopRecording(config, row.providerRoom, recording.egressId).catch(() => {});
    await db.update(meetingRecordings).set({ status: "processing", stoppedAt: at }).where(eq(meetingRecordings.id, recording.id)).run();
  }
  if (config) await closeRoom(config, row.providerRoom).catch(() => {});
  await updateMeeting(db, id, { status: "ended", endedAt: at });
  await closeAllSessions(db, id, at);
  await db
    .update(meetingGuests)
    .set({ status: "declined", decidedAt: at })
    .where(and(eq(meetingGuests.meetingId, id), inArray(meetingGuests.status, ["waiting"])))
    .run();
  await logActivity(db, id, "ended", by, at);
  const ended = { ...row, status: "ended" as const, endedAt: at };
  await afterResponse("meeting-ended", () => announce(db, "meeting.ended", ended));
  return ended;
}

/**
 * Someone lost access (removed from the conversation or the invitee list,
 * deactivated, moved out of scope): they are disconnected from any live
 * meeting they may no longer join — optionally only one conversation's.
 * A fresh join token is already impossible for them; this closes the one
 * they are using.
 */
export async function evictFromMeetings(db: Database, userId: string, conversationId?: string, meetingId?: string) {
  const config = await providerConfig();
  for (const { meeting } of await activeMeetingsOf(db, userId)) {
    if (conversationId && meeting.conversationId !== conversationId) continue;
    if (meetingId && meeting.id !== meetingId) continue;
    if ((await meetingAudience(db, meeting)).includes(userId)) continue;
    if (config) await removeFromRoom(config, meeting.providerRoom, userId).catch(() => {});
    await closeSession(db, meeting.id, userId);
  }
}
