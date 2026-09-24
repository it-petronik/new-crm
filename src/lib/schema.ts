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
    // Records are listed newest-first; without this the ordering is a sort
    // over the whole table.
    index("BusinessRecord_createdAt_idx").on(table.createdAt),
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
    /**
     * What the event is about. NULL means a business record, which is every
     * row written before this column existed, so historical rows keep their
     * previous visibility exactly. "account" marks a user-administration
     * event, whose recordId is a User id and therefore never matches a
     * business record.
     *
     * Deliberately a stored column rather than something derived from the
     * action text: those strings are user-facing and have already been
     * renamed once.
     */
    subject: text("subject").$type<"account" | null>(),
    /**
     * Branch scope for account events, so a branch-scoped administrator does
     * not see accounts outside their branch. NULL means group-wide, which
     * mirrors `inAdminScope`: a group-wide target sits inside no branch list,
     * so a branch-scoped actor cannot see it.
     */
    branch: text("branch"),
  },
  (table) => [
    index("AuditEvent_company_at_idx").on(table.company, table.at),
    // The workspace reads recent events across all companies, which the
    // composite index above cannot serve without a company predicate.
    index("AuditEvent_at_idx").on(table.at),
  ],
);

/**
 * Administrator-issued password reset links.
 *
 * Only the SHA-256 of the token is stored, so a database leak yields nothing
 * usable. Single use is enforced by deleting the row rather than by a flag, so
 * replay is structurally impossible rather than dependent on a check.
 */
export const passwordResets = sqliteTable(
  "PasswordReset",
  {
    // SHA-256 hex of the raw token. The raw token is never persisted.
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Who issued it, for the audit trail. Never the token itself.
    issuedBy: text("issuedBy").notNull(),
    issuedByName: text("issuedByName").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("PasswordReset_userId_idx").on(table.userId),
    index("PasswordReset_expiresAt_idx").on(table.expiresAt),
  ],
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
export type PasswordResetRow = typeof passwordResets.$inferSelect;
