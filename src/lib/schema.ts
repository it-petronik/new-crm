import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from "drizzle-orm/sqlite-core";

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

/**
 * "Keep me signed in": one long-lived, rotating credential per device.
 *
 * - `id` is the SHA-256 of the raw token; the raw token lives only in the
 *   device's HttpOnly cookie.
 * - A device's tokens share a `familyId`. Each successful refresh marks the
 *   presented token used (`usedAt`) and issues its successor in the same
 *   family, so presenting a used token again is detectable (reuse) and
 *   revokes the whole family.
 * - `sessionId` is the active Session issued with it, so signing out a device
 *   ends both.
 * - `expiresAt` slides 30 days from the last refresh; `familyCreatedAt` caps
 *   a family's life however active it is.
 */
export const refreshTokens = sqliteTable(
  "RefreshToken",
  {
    id: text("id").primaryKey(),
    familyId: text("familyId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("sessionId"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    familyCreatedAt: integer("familyCreatedAt", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("usedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("RefreshToken_familyId_idx").on(table.familyId),
    index("RefreshToken_userId_idx").on(table.userId),
    index("RefreshToken_sessionId_idx").on(table.sessionId),
    index("RefreshToken_expiresAt_idx").on(table.expiresAt),
  ],
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
    // V2: an uploaded room image, stored in R2 under this opaque key. NULL
    // means the generated initials avatar. Never image bytes in D1.
    avatarKey: text("avatarKey"),
    avatarUpdatedAt: integer("avatarUpdatedAt", { mode: "timestamp_ms" }),
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

/* ------------------------------------------------------------------------
 * Collaboration Hub V2 — additive only.
 * --------------------------------------------------------------------- */

/**
 * A file attached to a message: metadata only. The bytes live in R2 under an
 * opaque random `storageKey` (never derived from the user's filename), and
 * are served only through the authorised file route, which re-checks
 * conversation access on every request.
 *
 * `messageId` is NULL while the upload is pending (picked in the composer but
 * not yet sent); only the uploader can see a pending attachment, and unsent
 * ones are purged after a day. Deleting the message sets `deletedAt`, which
 * makes the file unreachable at once; the R2 object is purged after the
 * retention window (see purgeAttachments).
 */
export const attachments = sqliteTable(
  "Attachment",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("messageId").references(() => messages.id, { onDelete: "cascade" }),
    uploaderId: text("uploaderId").notNull(),
    storageKey: text("storageKey").notNull(),
    // Client-generated preview for images, validated and stored like the file.
    thumbKey: text("thumbKey"),
    originalName: text("originalName").notNull(),
    // Server-determined from the file's bytes, never the browser's claim.
    mimeType: text("mimeType").notNull(),
    kind: text("kind").$type<"image" | "pdf" | "document" | "audio">().notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("durationMs"),
    // Order within its message, as the sender arranged the files. Uploads
    // run in parallel, so upload order is not the order they were picked.
    position: integer("position"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    // A room's media / files browser, newest first (ids are time-ordered).
    index("Attachment_conversationId_kind_id_idx").on(table.conversationId, table.kind, table.id),
    index("Attachment_messageId_idx").on(table.messageId),
    index("Attachment_deletedAt_idx").on(table.deletedAt),
  ],
);

/** One row per (message, person, emoji); the primary key forbids duplicates. */
export const messageReactions = sqliteTable(
  "MessageReaction",
  {
    messageId: text("messageId")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
    emoji: text("emoji").notNull(),
    conversationId: text("conversationId").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId, table.emoji] })],
);

/**
 * When someone was last connected. Live online/away state is NOT stored
 * here — the Durable Objects hold it — this row is written only when a
 * person's final connection closes, so it costs one write per session, not
 * one per heartbeat.
 */
export const collabPresence = sqliteTable("CollabPresence", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastSeenAt: integer("lastSeenAt", { mode: "timestamp_ms" }).notNull(),
});

/* ------------------------------------------------------------------------
 * Notifications — one inbox for the whole CRM. Additive only.
 * --------------------------------------------------------------------- */

/**
 * Something that happened which one person should know about: a lead
 * assigned to them, an approval waiting, a mention. One row per recipient,
 * so read state is per person and follows them across devices.
 *
 * A row never grants anything. `entityType`/`entityId` say what it is about;
 * opening it goes through the normal access checks again, and the inbox
 * hides the details of anything the reader can no longer see. No URLs are
 * stored: the destination is derived from the entity when read.
 *
 * `dedupeKey` is deterministic for the event (e.g. `assigned:{record}:
 * {owner}:{version}`), and unique per recipient, so a retried request, a
 * repeated scheduled run or a replayed event can never notify twice.
 *
 * Ids are time-ordered (like message ids), so one index serves the
 * newest-first inbox and its cursor.
 */
export const notifications = sqliteTable(
  "Notification",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipientId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // NULL for the system (scheduled reminders).
    actorId: text("actorId"),
    type: text("type").notNull(),
    category: text("category")
      .$type<"assignment" | "approval" | "collaboration" | "reminder" | "update" | "security">()
      .notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // A record kind ("leads", "quotations", …), "conversation" or "account".
    entityType: text("entityType").notNull(),
    entityId: text("entityId").notNull(),
    conversationId: text("conversationId"),
    messageId: text("messageId"),
    priority: text("priority").$type<"normal" | "important" | "urgent">().notNull().default("normal"),
    dedupeKey: text("dedupeKey").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("readAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("Notification_recipientId_dedupeKey_key").on(table.recipientId, table.dedupeKey),
    // The inbox, newest first, and its unread count.
    index("Notification_recipientId_id_idx").on(table.recipientId, table.id),
    index("Notification_recipientId_readAt_idx").on(table.recipientId, table.readAt),
    // Resolving an approval clears everyone's "approval required" for it.
    index("Notification_entityId_type_idx").on(table.entityId, table.type),
    // Retention purge.
    index("Notification_createdAt_idx").on(table.createdAt),
  ],
);

/**
 * Per-person notification preferences. Absent row = defaults (desktop off,
 * previews on). Security notifications are not governed by these: they are
 * always recorded and always shown in the inbox.
 */
export const notificationPreferences = sqliteTable("NotificationPreference", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  desktop: integer("desktop", { mode: "boolean" }).notNull().default(false),
  preview: integer("preview", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

/* ------------------------------------------------------------------------
 * Collaboration Meetings (V3) — additive only.
 *
 * A meeting belongs to one conversation and inherits its access: nobody can
 * join a meeting they could not read the conversation of. Audio and video
 * never touch D1; the managed provider (LiveKit) carries the media and holds
 * the live room state. These rows are only what the CRM needs to show and
 * authorise: what exists, when, and who took part.
 * --------------------------------------------------------------------- */

export const meetings = sqliteTable(
  "Meeting",
  {
    id: text("id").primaryKey(),
    // NULL for a standalone meeting (its own invitees and its own meeting chat).
    conversationId: text("conversationId").references(() => conversations.id, { onDelete: "cascade" }),
    createdBy: text("createdBy").notNull(),
    title: text("title").notNull(),
    // "instant": started now; "scheduled": has a start time.
    kind: text("kind").$type<"instant" | "scheduled">().notNull(),
    // What joining offers first: a voice call starts with the camera off.
    media: text("media").$type<"video" | "voice">().notNull(),
    status: text("status").$type<"scheduled" | "live" | "ended" | "cancelled" | "missed">().notNull(),
    scheduledAt: integer("scheduledAt", { mode: "timestamp_ms" }),
    durationMin: integer("durationMin"),
    startedAt: integer("startedAt", { mode: "timestamp_ms" }),
    endedAt: integer("endedAt", { mode: "timestamp_ms" }),
    // The provider's room name: random, never derived from anything guessable.
    providerRoom: text("providerRoom").notNull(),
    reminderSentAt: integer("reminderSentAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    // Guests (people without an account): "off", "open" (anyone with a
    // valid link) or "admit" (the host lets each one in).
    guestAccess: text("guestAccess").$type<"off" | "open" | "admit">().notNull().default("off"),
    // An optional CRM record the meeting is about (a lead, customer,
    // quotation or order). Its kind is copied from the record by the server,
    // never taken from a client. It grants nothing either way: seeing the
    // meeting never lets anyone read the record, and reading the record never
    // lets anyone into a private meeting.
    relatedRecordId: text("relatedRecordId"),
    relatedRecordKind: text("relatedRecordKind").$type<"leads" | "customers" | "quotations" | "orders">(),
  },
  (table) => [
    index("Meeting_conversationId_createdAt_idx").on(table.conversationId, table.createdAt),
    index("Meeting_status_scheduledAt_idx").on(table.status, table.scheduledAt),
    uniqueIndex("Meeting_providerRoom_key").on(table.providerRoom),
    // The database itself allows at most ONE live meeting per conversation:
    // two people pressing Start at the same moment get one meeting, never
    // two (the loser's insert is ignored and it joins the winner's).
    uniqueIndex("Meeting_one_live_per_conversation").on(table.conversationId).where(sql`"status" = 'live'`),
    index("Meeting_relatedRecordId_idx").on(table.relatedRecordId),
  ],
);

/**
 * Who took part, for history and for "In a meeting". Updated from the
 * provider's webhooks (joined / left), never from the browser.
 */
export const meetingAttendance = sqliteTable(
  "MeetingAttendance",
  {
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
    joinedAt: integer("joinedAt", { mode: "timestamp_ms" }).notNull(),
    // NULL while connected.
    leftAt: integer("leftAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.userId] }),
    index("MeetingAttendance_userId_leftAt_idx").on(table.userId, table.leftAt),
  ],
);

/** Internal invitees of a standalone meeting (a room's meeting uses the room's members). */
export const meetingInvitees = sqliteTable(
  "MeetingInvitee",
  {
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedBy: text("invitedBy").notNull(),
    invitedAt: integer("invitedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.userId] }), index("MeetingInvitee_userId_idx").on(table.userId)],
);

/**
 * A guest link. Only the SHA-256 of its random token is stored; the raw
 * token exists only in the URL given to the organiser. It grants joining
 * THIS meeting while valid — never a CRM session, never recordings.
 */
export const meetingGuestInvites = sqliteTable(
  "MeetingGuestInvite",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull(),
    createdBy: text("createdBy").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    // NULL = valid until the meeting ends.
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
    revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("MeetingGuestInvite_tokenHash_key").on(table.tokenHash), index("MeetingGuestInvite_meetingId_idx").on(table.meetingId)],
);

/**
 * A guest asking to join: their chosen name and the host's decision. The
 * guest holds a random secret (only its hash is here) to learn the decision
 * and to receive their meeting token; it is useless for anything else.
 */
export const meetingGuests = sqliteTable(
  "MeetingGuest",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    inviteId: text("inviteId").notNull(),
    name: text("name").notNull(),
    secretHash: text("secretHash").notNull(),
    status: text("status").$type<"waiting" | "admitted" | "declined" | "left">().notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decidedAt", { mode: "timestamp_ms" }),
    decidedBy: text("decidedBy"),
  },
  (table) => [uniqueIndex("MeetingGuest_secretHash_key").on(table.secretHash), index("MeetingGuest_meetingId_status_idx").on(table.meetingId, table.status)],
);

/**
 * A meeting's own chat — for meetings without a Collaboration conversation
 * (standalone), and the channel guests share with employees in any meeting.
 * Room and DM meetings keep using their conversation for employees.
 *
 * Exactly one sender: an employee (`senderUserId`) or an admitted guest
 * (`senderGuestId`). `senderName` is taken by the server at send time from
 * the account or the guest's admission — never from the client. Plain text
 * only. `clientKey` makes a retried send land once.
 */
export const meetingMessages = sqliteTable(
  "MeetingMessage",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    senderUserId: text("senderUserId").references(() => users.id),
    senderGuestId: text("senderGuestId").references(() => meetingGuests.id, { onDelete: "cascade" }),
    senderName: text("senderName").notNull(),
    body: text("body").notNull(),
    clientKey: text("clientKey").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    editedAt: integer("editedAt", { mode: "timestamp_ms" }),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("MeetingMessage_meetingId_id_idx").on(table.meetingId, table.id),
    uniqueIndex("MeetingMessage_meetingId_clientKey_key").on(table.meetingId, table.clientKey),
    check("MeetingMessage_one_sender", sql`("senderUserId" IS NULL) <> ("senderGuestId" IS NULL)`),
  ],
);

/**
 * Attendance, one row per connection. Reconnecting starts a new session,
 * so nothing is overwritten and totals are the sum of sessions. Written
 * from the provider's webhooks.
 */
export const meetingSessions = sqliteTable(
  "MeetingSession",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    participantIdentity: text("participantIdentity").notNull(),
    userId: text("userId"),
    guestName: text("guestName"),
    kind: text("kind").$type<"internal" | "guest">().notNull(),
    joinedAt: integer("joinedAt", { mode: "timestamp_ms" }).notNull(),
    leftAt: integer("leftAt", { mode: "timestamp_ms" }),
    durationSeconds: integer("durationSeconds"),
  },
  (table) => [
    index("MeetingSession_meetingId_joinedAt_idx").on(table.meetingId, table.joinedAt),
    index("MeetingSession_userId_leftAt_idx").on(table.userId, table.leftAt),
    index("MeetingSession_identity_idx").on(table.meetingId, table.participantIdentity, table.leftAt),
  ],
);

/** What happened in a meeting, for its report: started, ended, screen share, recording. */
export const meetingActivity = sqliteTable(
  "MeetingActivity",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorName: text("actorName"),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("MeetingActivity_meetingId_at_idx").on(table.meetingId, table.at)],
);

/**
 * A cloud recording (LiveKit Egress). Metadata only: the file lives in
 * private object storage under `fileKey` and is served only after the
 * meeting's normal access check. Guests never reach recordings.
 */
export const meetingRecordings = sqliteTable(
  "MeetingRecording",
  {
    id: text("id").primaryKey(),
    meetingId: text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    egressId: text("egressId"),
    startedBy: text("startedBy").notNull(),
    startedAt: integer("startedAt", { mode: "timestamp_ms" }).notNull(),
    stoppedAt: integer("stoppedAt", { mode: "timestamp_ms" }),
    status: text("status").$type<"starting" | "recording" | "processing" | "saved" | "failed">().notNull(),
    fileKey: text("fileKey"),
    durationSeconds: integer("durationSeconds"),
    error: text("error"),
  },
  (table) => [
    index("MeetingRecording_meetingId_idx").on(table.meetingId),
    uniqueIndex("MeetingRecording_egressId_key").on(table.egressId),
    // At most one recording running per meeting.
    uniqueIndex("MeetingRecording_one_active").on(table.meetingId).where(sql`"status" IN ('starting', 'recording')`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type MeetingRow = typeof meetings.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type BusinessRecordRow = typeof businessRecords.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMemberRow = typeof conversationMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export type MeetingMessageRow = typeof meetingMessages.$inferSelect;
