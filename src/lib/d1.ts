import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

/**
 * Resolves the D1 binding. On Workers it comes from the request context; in
 * `next dev` it comes from the same context, which the Cloudflare adapter
 * populates from wrangler's local D1. There is no connection string: D1 is a
 * binding, which is why no DATABASE_URL is needed at runtime any more.
 */
export async function getDb(): Promise<Database | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    const binding = (context.env as unknown as { DB?: D1Database }).DB;
    if (!binding) return null;
    return drizzle(binding, { schema });
  } catch {
    // No Cloudflare context, e.g. plain Node tooling or preview mode.
    return null;
  }
}

/** True when a D1 binding is reachable, used to decide preview vs live. */
export async function hasDatabase() {
  return (await getDb()) !== null;
}
