import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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
    subject: text("subject").$type<"account" | "collaboration" | null>(),
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

/* ------------------------------------------------------------------------
 * Collaboration Hub
 *
 * Additive tables only: nothing here references or alters a CRM table other
 * than User ids, and chat traffic never writes to AuditEvent (only room
 * administration does, marked subject = "collaboration").
 * --------------------------------------------------------------------- */

/**
 * A room or a direct message thread.
 *
 * `directKey` is the two participants' ids sorted and joined, e.g. "a:b". The
 * unique index on it is what makes a duplicate DM thread impossible even when
 * both people press "Message" at the same moment; rooms leave it NULL, and
 * SQLite allows any number of NULLs in a unique index.
 */
export const conversations = sqliteTable(
  "Conversation",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"room" | "direct">().notNull(),
    name: text("name"),
    description: text("description"),
    // "private": members only, never listed to anyone else.
    // "workspace": discoverable and joinable by anyone inside company/branch.
    visibility: text("visibility").$type<"private" | "workspace">().notNull(),
    company: text("company").notNull(),
    // NULL = the whole company.
    branch: text("branch"),
    directKey: text("directKey"),
    createdBy: text("createdBy").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    // Drives list ordering; NULL until the first message.
    lastMessageAt: integer("lastMessageAt", { mode: "timestamp_ms" }),
    archivedAt: integer("archivedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("Conversation_directKey_key").on(table.directKey),
    // Room discovery: workspace rooms within a company.
    index("Conversation_company_visibility_idx").on(table.company, table.visibility),
  ],
);

/**
 * Membership, role and the per-person read cursor.
 *
 * Unread state lives here rather than in the browser so it follows the person
 * across devices: `lastReadMessageId` is the newest message they have seen.
 * Message ids sort by time, so "unread" is simply `id > lastReadMessageId`.
 */
export const conversationMembers = sqliteTable(
  "ConversationMember",
  {
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member">().notNull(),
    joinedAt: integer("joinedAt", { mode: "timestamp_ms" }).notNull(),
    lastReadMessageId: text("lastReadMessageId"),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    // "My conversations" starts from the person, not the conversation.
    index("ConversationMember_userId_idx").on(table.userId),
  ],
);

/**
 * A chat message. The body is plain text, never HTML; the client renders it
 * as text nodes. Deletion is soft so replies can still say "message deleted",
 * but the body is cleared at the same moment, so nothing deleted is retained.
 *
 * Ids are time-ordered (see `messageId` in collab.ts), which lets one index
 * serve newest-first paging, cursors and unread counts.
 */
export const messages = sqliteTable(
  "Message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    authorId: text("authorId").notNull(),
    body: text("body").notNull(),
    replyToId: text("replyToId"),
    // Client-generated idempotency key, so a retried send is not a duplicate.
    clientKey: text("clientKey"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("editedAt", { mode: "timestamp_ms" }),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("Message_conversationId_id_idx").on(table.conversationId, table.id),
    uniqueIndex("Message_authorId_clientKey_key").on(table.authorId, table.clientKey),
  ],
);

/** Who a message mentions; only ever people who were members when it was sent. */
export const messageMentions = sqliteTable(
  "MessageMention",
  {
    messageId: text("messageId")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
    conversationId: text("conversationId").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    // The Mentions view: newest first for one person.
    index("MessageMention_userId_messageId_idx").on(table.userId, table.messageId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BusinessRecordRow = typeof businessRecords.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMemberRow = typeof conversationMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
