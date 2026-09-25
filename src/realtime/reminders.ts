import { drizzle } from "drizzle-orm/d1";
import { and, inArray, notInArray } from "drizzle-orm";
import * as schema from "../lib/schema";
import { businessRecords } from "../lib/schema";
import type { Database } from "../lib/d1";
import type { RecordItem } from "../lib/domain";
import { businessToday } from "../lib/gst";
import { authorised, reminderDrafts } from "../lib/notification-rules";
import { activePeople, createNotifications, purgeOldNotifications, type Deliver } from "../lib/notification-store";
import type { HubEnv } from "./collab-hub";
import type { D1Like } from "./session";

/**
 * The scheduled half of notifications: conditions that become true with
 * time rather than because someone did something — a follow-up due today or
 * overdue, a quotation about to expire, an overdue payment, a late shipment
 * or ticket. Generated here on the server, never by a browser.
 *
 * Runs once a day at 08:00 Gulf time (cron "0 4 * * *" UTC). Each reminder's
 * dedupe key includes the date it concerns, so a retried or repeated run
 * adds nothing, and people with the CRM open receive them live through the
 * same hubs as every other notification.
 */

export const REMINDER_CRON = "0 4 * * *";

export type RemindersEnv = Pick<HubEnv, "COLLAB_HUB"> & { DB?: D1Like; APP_MODE?: string };

const KINDS = ["leads", "quotations", "accounts", "logistics", "it"];
// Statuses that never need a reminder; filtered in SQL to keep the scan small.
const CLOSED = ["Won", "Lost", "On Hold", "Accepted", "Rejected", "Expired", "Draft", "Paid", "Cancelled", "Delivered", "Resolved", "Recorded"];

export async function runReminders(env: RemindersEnv, now = new Date()) {
  if (!env.DB || env.APP_MODE === "preview") return 0;
  const db = drizzle(env.DB as never, { schema }) as unknown as Database;
  const hubs = env.COLLAB_HUB;
  const deliver: Deliver = async (userIds, event) => {
    if (!hubs) return;
    const body = JSON.stringify(event);
    await Promise.allSettled(
      userIds.map((id) => hubs.get(hubs.idFromName(id)).fetch("https://collab-hub/publish", { method: "POST", body })),
    );
  };

  const rows = await db
    .select({ payload: businessRecords.payload })
    .from(businessRecords)
    .where(and(inArray(businessRecords.kind, KINDS), notInArray(businessRecords.status, CLOSED)))
    .all();
  const records = rows.map((r) => r.payload as RecordItem).filter((r) => !r.deletedAt);
  const people = await activePeople(db);
  const today = businessToday(now);
  const soon = businessToday(new Date(now.getTime() + 3 * 86_400_000));
  const drafts = authorised(reminderDrafts(records, people, today, soon), people, new Map(records.map((r) => [r.id, r])));
  const created = await createNotifications(db, drafts, deliver);
  await purgeOldNotifications(db, now.getTime());
  return created;
}
