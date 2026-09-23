import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * D1 (SQLite) equivalent of the original MySQL schema.
 *
 * Conversions applied, because SQLite has no native equivalents:
 * - `Json` columns become TEXT holding JSON. Drizzle's `{ mode: "json" }`
 *   serialises on write and parses on read, so callers still see objects.
 * - `DateTime` becomes INTEGER epoch milliseconds with `{ mode: "timestamp_ms" }`.
 *   Storing text dates would make range comparisons string comparisons.
 * - `Boolean` becomes INTEGER 0/1 with `{ mode: "boolean" }`; SQLite has no
 *   boolean type.
 * - Ids stay application-generated TEXT (crypto.randomUUID), as before. No
 *   AUTOINCREMENT is introduced, so id semantics are unchanged.
 * - `@db.VarChar(191)` on email existed only for MySQL's utf8mb4 index limit.
 *   SQLite has no such limit, so it is plain TEXT with a unique index.
 */

export const users = sqliteTable("User", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("passwordHash").notNull(),
  role: text("role").notNull(),
  companies: text("companies", { mode: "json" }).$type<string[]>().notNull(),
  branches: text("branches", { mode: "json" }).$type<string[]>().notNull(),
  moduleAccess: text("moduleAccess", { mode: "json" }).$type<Record<string, string> | null>(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "Session",
  {
    id: text("id").primaryKey(),
    // Foreign key with cascade delete, matching the original relation.
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("Session_expiresAt_idx").on(table.expiresAt)],
);

export const businessRecords = sqliteTable(
  "BusinessRecord",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    company: text("company").notNull(),
    branch: text("branch").notNull(),
    ownerId: text("ownerId").notNull(),
    status: text("status").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("BusinessRecord_company_branch_kind_idx").on(table.company, table.branch, table.kind),
    index("BusinessRecord_ownerId_kind_idx").on(table.ownerId, table.kind),
  ],
);

export const auditEvents = sqliteTable(
  "AuditEvent",
  {
    id: text("id").primaryKey(),
    company: text("company").notNull(),
    actor: text("actor").notNull(),
    actorId: text("actorId").notNull(),
    action: text("action").notNull(),
    recordId: text("recordId").notNull(),
    before: text("before", { mode: "json" }).$type<unknown>(),
    after: text("after", { mode: "json" }).$type<unknown>(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("AuditEvent_company_at_idx").on(table.company, table.at)],
);

export const loginAttempts = sqliteTable("LoginAttempt", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: integer("resetAt", { mode: "timestamp_ms" }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BusinessRecordRow = typeof businessRecords.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
