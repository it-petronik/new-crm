import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../lib/schema";
import { meetingGuests, meetingRecordings } from "../lib/schema";
import type { Database } from "../lib/d1";
import type { CollabEvent } from "../lib/collab";
import { businessStamp } from "../lib/gst";
import { closeRoom, configFrom, stopRecording } from "../lib/livekit";
import { REMINDER_LEAD_MS } from "../lib/meetings";
import {
  activeRecording,
  closeAllSessions,
  dueReminders,
  logActivity,
  meetingAudience,
  meetingViews,
  missedMeetings,
  staleLiveMeetings,
  updateMeeting,
} from "../lib/meeting-data";
import { createNotifications, type Deliver } from "../lib/notification-store";
import type { HubEnv } from "./collab-hub";
import type { D1Like } from "./session";

/**
 * Every five minutes (cron "*\/5 * * * *"):
 *
 * - "Meeting starts in 10 minutes" for scheduled meetings about to begin, to
 *   everyone entitled (a room's readers, or a standalone meeting's organiser
 *   and invitees) — once per meeting (dedupe key and `reminderSentAt`).
 * - Scheduled meetings whose window passed without anyone starting them
 *   become "missed": kept in history, no longer "upcoming".
 * - Live meetings everyone left 10 minutes ago, or running 12 hours, are
 *   closed: any recording stopped, the room closed, attendance closed.
 *
 * Runs in the Worker's own context (no request), so it delivers through the
 * hub binding directly and reads provider settings from its env.
 */

export const MEETING_CRON = "*/5 * * * *";
const IDLE_MS = 10 * 60_000;
const MAX_MS = 12 * 60 * 60_000;

export type MeetingSweepEnv = Pick<HubEnv, "COLLAB_HUB"> & { DB?: D1Like; APP_MODE?: string } & Record<string, unknown>;

export async function runMeetingSweep(env: MeetingSweepEnv, now = Date.now()) {
  if (!env.DB || env.APP_MODE === "preview") return { reminded: 0, closed: 0, missed: 0 };
  const db = drizzle(env.DB as never, { schema }) as unknown as Database;
  const hubs = env.COLLAB_HUB;
  const deliver: Deliver = async (userIds, event: CollabEvent) => {
    if (!hubs) return;
    const body = JSON.stringify(event);
    await Promise.allSettled(userIds.map((id) => hubs.get(hubs.idFromName(id)).fetch("https://collab-hub/publish", { method: "POST", body })));
  };
  const tell = async (row: schema.MeetingRow, type: "meeting.updated" | "meeting.ended") => {
    const [view] = await meetingViews(db, [row]);
    await deliver(await meetingAudience(db, row), { type, conversationId: row.conversationId ?? "", meeting: view });
  };

  let reminded = 0;
  for (const row of await dueReminders(db, now, REMINDER_LEAD_MS)) {
    const to = await meetingAudience(db, row);
    reminded += await createNotifications(
      db,
      to.map((recipientId) => ({
        recipientId,
        actorId: null,
        type: "meeting.reminder",
        category: "collaboration" as const,
        title: "Meeting starts in 10 minutes",
        body: `${row.title}${row.scheduledAt ? ` · ${businessStamp(row.scheduledAt)}` : ""}`,
        entityType: "meeting",
        entityId: row.id,
        conversationId: row.conversationId,
        priority: "important" as const,
        dedupeKey: `meeting-reminder:${row.id}`,
      })),
      deliver,
    );
    await updateMeeting(db, row.id, { reminderSentAt: new Date(now) });
  }

  let missed = 0;
  for (const row of await missedMeetings(db, now)) {
    await updateMeeting(db, row.id, { status: "missed" });
    await tell({ ...row, status: "missed" }, "meeting.updated");
    missed += 1;
  }

  const config = configFrom(env);
  let closed = 0;
  for (const row of await staleLiveMeetings(db, now, IDLE_MS, MAX_MS)) {
    const at = new Date(now);
    const recording = await activeRecording(db, row.id);
    if (recording) {
      if (config && recording.egressId) await stopRecording(config, row.providerRoom, recording.egressId).catch(() => {});
      await db.update(meetingRecordings).set({ status: "processing", stoppedAt: at }).where(eq(meetingRecordings.id, recording.id)).run();
    }
    if (config) await closeRoom(config, row.providerRoom).catch(() => {});
    await updateMeeting(db, row.id, { status: "ended", endedAt: at });
    await closeAllSessions(db, row.id, at);
    await db.update(meetingGuests).set({ status: "declined", decidedAt: at }).where(and(eq(meetingGuests.meetingId, row.id), eq(meetingGuests.status, "waiting"))).run();
    await logActivity(db, row.id, "ended", null, at);
    await tell({ ...row, status: "ended", endedAt: at }, "meeting.ended");
    closed += 1;
  }
  return { reminded, closed, missed };
}
