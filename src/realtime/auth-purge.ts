import { drizzle } from "drizzle-orm/d1";
import * as schema from "../lib/schema";
import type { Database } from "../lib/d1";
import { purgeExpiredSessions, purgeRefreshTokens } from "../lib/data";
import type { D1Like } from "./session";

/**
 * Daily housekeeping for sign-ins: expired sessions, expired refresh tokens,
 * and used ones a day past their reuse window. Expiry is enforced on every
 * read; this only keeps the tables small.
 */
export async function purgeSignIns(env: { DB?: D1Like; APP_MODE?: string }) {
  if (!env.DB || env.APP_MODE === "preview") return;
  const db = drizzle(env.DB as never, { schema }) as unknown as Database;
  const now = new Date();
  await purgeRefreshTokens(db, now, new Date(now.getTime() - 86_400_000));
  await purgeExpiredSessions(db);
}
