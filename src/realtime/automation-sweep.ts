import { drizzle } from "drizzle-orm/d1";
import * as schema from "../lib/schema";
import type { Database } from "../lib/d1";
import { createNotifications, type Deliver } from "../lib/notification-store";
import { automationSweep } from "../lib/tasks/automation";
import type { HubEnv } from "./collab-hub";
import type { D1Like } from "./session";

/**
 * Every five minutes (with the meeting sweep): creates lead follow-up tasks
 * for follow-ups that have arrived (Dubai business day) and finishes any
 * automation events a request could not process. Every task has a dedupe
 * key, so overlapping or repeated runs add nothing. Never runs in preview.
 */
export type AutomationEnv = Pick<HubEnv, "COLLAB_HUB"> & { DB?: D1Like; APP_MODE?: string };

export async function runAutomationSweep(env: AutomationEnv, now = new Date()) {
  if (!env.DB || env.APP_MODE === "preview") return { created: 0 };
  const db = drizzle(env.DB as never, { schema }) as unknown as Database;
  const hubs = env.COLLAB_HUB;
  const deliver: Deliver = async (userIds, event) => {
    if (!hubs) return;
    const body = JSON.stringify(event);
    await Promise.allSettled(userIds.map((id) => hubs.get(hubs.idFromName(id)).fetch("https://collab-hub/publish", { method: "POST", body })));
  };
  const { drafts, outcomes } = await automationSweep(db, now);
  if (drafts.length) await createNotifications(db, drafts, deliver);
  return { created: outcomes.filter((o) => o.status === "success").length, outcomes: outcomes.length };
}
