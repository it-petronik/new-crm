import { getDb, hasDatabase, type Database } from "./d1";

export { getDb, hasDatabase, type Database };

/**
 * Preview runs entirely on fictional in-browser data and never touches D1.
 * With D1 the database is a binding rather than a connection string, so this
 * no longer depends on DATABASE_URL.
 */
export function isPreview() {
  return process.env.APP_MODE === "preview";
}
