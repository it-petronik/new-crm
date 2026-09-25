import type { Database } from "./d1";
import type { MeetingRow } from "./schema";
import { audience } from "./collab-service";
import { afterResponse, publish } from "./collab-realtime";
import { createNotifications } from "./notification-store";
import type { NotificationDraft } from "./notification-rules";
import { closeRoom, removeFromRoom } from "./livekit";
import { providerConfig } from "./livekit-config";
import { activeMeetingsOf, closeAttendance, findMeeting, markLeft, meetingViews, updateMeeting } from "./meeting-data";
import { businessStamp } from "./gst";
import type { MeetingEvent } from "./meetings";
import type { Actor } from "./domain";
import { isId } from "./collab";
import { CollabError, requireRead, type Access } from "./collab-access";
import { canManageFor } from "./meeting-data";

/**
 * Meeting signalling and its side effects. Everything goes only to the
 * people who may read the meeting's conversation RIGHT NOW (the same
 * `audience` rule chat events use), so a private meeting is never announced
 * to anyone outside it.
 */

type Kind = Exclude<MeetingEvent["type"], "meeting.invited">;

/** Tells every current reader of the conversation (optionally not one person). */
export async function announce(db: Database, type: Kind, row: MeetingRow, except?: string) {
  const [view] = await meetingViews(db, [row]);
  const to = (await audience(db, row.conversationId)).filter((id) => id !== except);
  await publish(to, { type, conversationId: row.conversationId, meeting: view } as MeetingEvent);
  return to;
}

/**
 * A new live meeting: the realtime event, plus a notification for everyone
 * but its starter. In a direct conversation it is a call to the other
 * person, who also gets the ringing invitation.
 */
export function meetingStarted(
  db: Database,
  row: MeetingRow,
  starter: { id: string; name: string },
  context: { direct: boolean; roomName: string | null },
) {
  return afterResponse("meeting-started", async () => {
    const to = await announce(db, "meeting.started", row, starter.id);
    const [view] = await meetingViews(db, [row]);
    if (context.direct)
      await publish(to, { type: "meeting.invited", conversationId: row.conversationId, meeting: view, from: starter });
    const video = row.media === "video";
    const drafts: NotificationDraft[] = to.map((recipientId) => ({
      recipientId,
      actorId: starter.id,
      type: context.direct ? "meeting.invited" : "meeting.started",
      category: "collaboration",
      title: context.direct
        ? `${starter.name} is calling you${video ? " (video)" : ""}`
        : `${video ? "Video" : "Voice"} meeting started`,
      body: context.direct ? row.title : `${starter.name} · ${context.roomName ?? row.title}`,
      entityType: "meeting",
      entityId: row.id,
      conversationId: row.conversationId,
      priority: "important",
      dedupeKey: `meeting-started:${row.id}`,
    }));
    await createNotifications(db, drafts, publish, new Map([[starter.id, starter.name]]));
  });
}

/** A meeting was scheduled: announced, and the conversation's readers told. */
export function meetingScheduled(db: Database, row: MeetingRow, by: { id: string; name: string }) {
  return afterResponse("meeting-scheduled", async () => {
    const to = await announce(db, "meeting.updated", row, by.id);
    const when = row.scheduledAt ? businessStamp(row.scheduledAt) : "";
    await createNotifications(
      db,
      to.map((recipientId) => ({
        recipientId,
        actorId: by.id,
        type: "meeting.scheduled",
        category: "collaboration",
        title: `${by.name} scheduled a meeting`,
        body: `${row.title}${when ? ` · ${when}` : ""}`,
        entityType: "meeting",
        entityId: row.id,
        conversationId: row.conversationId,
        priority: "normal",
        dedupeKey: `meeting-scheduled:${row.id}`,
      })),
      publish,
      new Map([[by.id, by.name]]),
    );
  });
}

/**
 * Ends a meeting for everyone: the provider room is closed (disconnecting
 * every participant), attendance is closed, and readers are told.
 * Idempotent: ending an ended meeting changes nothing.
 */
export async function endMeeting(db: Database, id: string, at = new Date()) {
  const row = await findMeeting(db, id);
  if (!row || row.status === "ended" || row.status === "cancelled") return row;
  const config = await providerConfig();
  if (config) await closeRoom(config, row.providerRoom).catch(() => {});
  await updateMeeting(db, id, { status: "ended", endedAt: at });
  await closeAttendance(db, id, at);
  const ended = { ...row, status: "ended" as const, endedAt: at };
  await afterResponse("meeting-ended", () => announce(db, "meeting.ended", ended));
  return ended;
}

/**
 * Someone lost access (removed from the conversation, deactivated, moved
 * out of scope): they are disconnected from any meeting they are in that
 * they may no longer read — optionally only the given conversation's.
 * A fresh join token is already impossible for them; this closes the one
 * they are using.
 */
export async function evictFromMeetings(db: Database, userId: string, conversationId?: string) {
  const config = await providerConfig();
  for (const { meeting } of await activeMeetingsOf(db, userId)) {
    if (conversationId && meeting.conversationId !== conversationId) continue;
    if (!conversationId && (await audience(db, meeting.conversationId)).includes(userId)) continue;
    if (config) await removeFromRoom(config, meeting.providerRoom, userId).catch(() => {});
    await markLeft(db, meeting.id, userId);
  }
}

/**
 * The one way a meeting is reached: it must exist AND the caller must be
 * able to read its conversation right now. Otherwise it is an ordinary
 * "not found", indistinguishable from a meeting that does not exist.
 */
export async function requireMeeting(db: Database, actor: Actor, id: unknown) {
  if (!isId(id)) throw new CollabError(404, "Meeting not found.");
  const meeting = await findMeeting(db, id);
  if (!meeting) throw new CollabError(404, "Meeting not found.");
  let access: Access;
  try {
    access = await requireRead(db, actor, meeting.conversationId);
  } catch {
    throw new CollabError(404, "Meeting not found.");
  }
  return { meeting, access, canManage: canManageFor(actor, access)(meeting) };
}
