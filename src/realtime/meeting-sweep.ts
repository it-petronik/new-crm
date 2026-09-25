import { drizzle } from "drizzle-orm/d1";
import * as schema from "../lib/schema";
import type { Database } from "../lib/d1";
import type { CollabEvent } from "../lib/collab";
import { businessStamp } from "../lib/gst";
import { closeRoom, configFrom } from "../lib/livekit";
import { REMINDER_LEAD_MS } from "../lib/meetings";
import {
  closeAttendance,
  conversationAudience,
  dueReminders,
  meetingViews,
  staleLiveMeetings,
  updateMeeting,
} from "../lib/meeting-data";
import { createNotifications, type Deliver } from "../lib/notification-store";
import type { HubEnv } from "./collab-hub";
import type { D1Like } from "./session";

/**
 * Every five minutes (cron "*\/5 * * * *"):
 *
 * - "Meeting starts in 10 minutes" for scheduled meetings about to begin,
 *   to everyone who may read the conversation — once per meeting (the
 *   dedupe key and `reminderSentAt` both guard it).
 * - Closes live meetings everyone has left (after 10 idle minutes) or that
 *   have run for 12 hours, so a forgotten meeting never stays "live".
 *
 * Runs in the Worker's own context (no request), so it delivers through the
 * hub binding directly and reads provider settings from its env.
 */

export const MEETING_CRON = "*/5 * * * *";
const IDLE_MS = 10 * 60_000;
const MAX_MS = 12 * 60 * 60_000;

export type MeetingSweepEnv = Pick<HubEnv, "COLLAB_HUB"> & { DB?: D1Like; APP_MODE?: string } & Record<string, unknown>;

export async function runMeetingSweep(env: MeetingSweepEnv, now = Date.now()) {
  if (!env.DB || env.APP_MODE === "preview") return { reminded: 0, closed: 0 };
  const db = drizzle(env.DB as never, { schema }) as unknown as Database;
  const hubs = env.COLLAB_HUB;
  const deliver: Deliver = async (userIds, event: CollabEvent) => {
    if (!hubs) return;
    const body = JSON.stringify(event);
    await Promise.allSettled(userIds.map((id) => hubs.get(hubs.idFromName(id)).fetch("https://collab-hub/publish", { method: "POST", body })));
  };

  let reminded = 0;
  for (const row of await dueReminders(db, now, REMINDER_LEAD_MS)) {
    const to = await conversationAudience(db, row.conversationId);
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

  const config = configFrom(env);
  let closed = 0;
  for (const row of await staleLiveMeetings(db, now, IDLE_MS, MAX_MS)) {
    if (config) await closeRoom(config, row.providerRoom).catch(() => {});
    const at = new Date(now);
    await updateMeeting(db, row.id, { status: "ended", endedAt: at });
    await closeAttendance(db, row.id, at);
    const [view] = await meetingViews(db, [{ ...row, status: "ended", endedAt: at }]);
    await deliver(await conversationAudience(db, row.conversationId), { type: "meeting.ended", conversationId: row.conversationId, meeting: view });
    closed += 1;
  }
  return { reminded, closed };
}
