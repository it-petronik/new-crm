import { eq, and, or, lt, gt, inArray, sql, desc, isNull, ne } from "drizzle-orm";
import type { Database } from "./d1";
import { users, sessions, businessRecords, auditEvents, loginAttempts, passwordResets } from "./schema";
import type { UserRow } from "./schema";

/**
 * The single data layer. API routes call these functions and never touch
 * Drizzle or the D1 binding directly.
 *
 * D1 has no interactive transactions: application code cannot hold a
 * connection open across a BEGIN/COMMIT and branch in between. The atomic
 * primitive is `batch()`, which runs a fixed list of statements and rolls the
 * whole list back if any one fails. Every former `$transaction(async tx => …)`
 * is therefore expressed as: read, decide in application code, then commit the
 * resulting writes in a single guarded batch.
 */

// ---------------------------------------------------------------- users

export const findUserByEmail = (db: Database, email: string) =>
  db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();

export const findUserById = (db: Database, id: string) =>
  db.select().from(users).where(eq(users.id, id)).get();

export const listUsers = (db: Database) =>
  db.select().from(users).orderBy(users.createdAt).all();

export const countUsers = async (db: Database) => {
  const row = await db.select({ total: sql<number>`count(*)` }).from(users).get();
  return Number(row?.total ?? 0);
};

export const createUser = (db: Database, user: Omit<UserRow, "createdAt"> & { createdAt?: Date }) =>
  db.insert(users).values({ ...user, createdAt: user.createdAt ?? new Date() }).run();

export const updateUser = (db: Database, id: string, values: Partial<UserRow>) =>
  db.update(users).set(values).where(eq(users.id, id)).run();

/**
 * Deactivating or changing a user must also drop their live sessions, so the
 * two writes are committed together rather than leaving a window where a
 * revoked account still has a valid session.
 */
export const updateUserAndRevokeSessions = (db: Database, id: string, values: Partial<UserRow>) =>
  db.batch([
    db.update(users).set(values).where(eq(users.id, id)),
    db.delete(sessions).where(eq(sessions.userId, id)),
    // An outstanding reset link is a credential for this account, so an access
    // change retires it with the sessions rather than leaving it usable until
    // it expires on its own.
    db.delete(passwordResets).where(eq(passwordResets.userId, id)),
  ]);

/**
 * Deactivates a user only while another active MD would remain.
 *
 * The count lives inside the statement rather than in a preceding read, so two
 * administrators deactivating each other at the same moment cannot both pass a
 * check and leave the organisation with no administrator. Returns false when
 * the change was refused.
 */
export async function deactivateUnlessLastAdmin(db: Database, id: string): Promise<boolean> {
  await db.run(sql`
    UPDATE "User" SET "active" = 0
    WHERE "id" = ${id}
      AND ("role" <> 'MD' OR EXISTS (
        SELECT 1 FROM "User" WHERE "role" = 'MD' AND "active" = 1 AND "id" <> ${id}
      ))
  `);
  const after = await findUserById(db, id);
  if (after?.active) return false;
  await db.batch([
    db.delete(sessions).where(eq(sessions.userId, id)),
    db.delete(passwordResets).where(eq(passwordResets.userId, id)),
  ]);
  return true;
}

/** True when this user is the only active MD left. */
export async function isLastActiveAdmin(db: Database, id: string) {
  const row = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, "MD"), eq(users.active, true), sql`"id" <> ${id}`))
    .get();
  return Number(row?.total ?? 0) === 0;
}

// ------------------------------------------------------------- sessions

/** Session plus its user in one round trip, replacing Prisma's `include`. */
export async function findSessionWithUser(db: Database, id: string) {
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .get();
  return row ?? null;
}

export const createSession = (db: Database, id: string, userId: string, expiresAt: Date) =>
  db.insert(sessions).values({ id, userId, expiresAt }).run();

export const deleteSession = (db: Database, id: string) =>
  db.delete(sessions).where(eq(sessions.id, id)).run();

/**
 * Drops sessions that have already expired. Expiry is enforced on read, so
 * this is housekeeping rather than a security control: without it, a session
 * abandoned by closing the browser stays in the table for ever.
 */
export const purgeExpiredSessions = (db: Database) =>
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();

// ------------------------------------------------------ login attempts

/**
 * Rate limiting in one atomic statement. The original read the row, decided in
 * application code, then wrote — which could double-count under concurrency.
 * SQLite's UPSERT with RETURNING makes the decision inside the database, so
 * the behaviour is preserved and the race is removed.
 *
 * Returns the attempt count after recording this attempt.
 */
export async function recordLoginAttempt(db: Database, key: string, windowMs = 15 * 60_000) {
  const now = Date.now();
  const resetAt = now + windowMs;
  const row = await db.get<{ count: number }>(sql`
    INSERT INTO ${loginAttempts} ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT("key") DO UPDATE SET
      "count"   = CASE WHEN "LoginAttempt"."resetAt" < ${now} THEN 1 ELSE "LoginAttempt"."count" + 1 END,
      "resetAt" = CASE WHEN "LoginAttempt"."resetAt" < ${now} THEN ${resetAt} ELSE "LoginAttempt"."resetAt" END
    RETURNING "count"
  `);
  return Number(row?.count ?? 1);
}

// ------------------------------------------------------ business records

export const findRecord = (db: Database, id: string) =>
  db.select().from(businessRecords).where(eq(businessRecords.id, id)).get();

export const listRecordsForCompany = (db: Database, company: string) =>
  db.select().from(businessRecords).where(eq(businessRecords.company, company)).all();

export const listAllRecords = (db: Database) =>
  db.select().from(businessRecords).orderBy(desc(businessRecords.createdAt)).all();

/** Upper bound on one workspace page, so a large table cannot exhaust CPU. */
export const RECORD_PAGE_LIMIT = 1000;

/**
 * Records the actor may see, filtered in the database rather than in JS.
 *
 * The predicate is the one the route previously applied after loading every
 * row: the record's company must be one of the actor's, and if the actor is
 * branch-scoped the branch must be one of theirs. Expressing it in SQL lets
 * `BusinessRecord_company_branch_kind_idx` do the work and stops the whole
 * table being read on every request.
 */
export function listRecordsForActor(
  db: Database,
  companies: string[],
  branches: string[],
  limit = RECORD_PAGE_LIMIT,
  offset = 0,
) {
  if (!companies.length) return Promise.resolve([]);
  const scope = branches.length
    ? and(inArray(businessRecords.company, companies), inArray(businessRecords.branch, branches))
    : inArray(businessRecords.company, companies);
  return db
    .select()
    .from(businessRecords)
    .where(scope)
    .orderBy(desc(businessRecords.createdAt))
    .limit(Math.min(limit, RECORD_PAGE_LIMIT))
    .offset(offset)
    .all();
}

/**
 * Recent audit events. The limit is a display window, not a scope control;
 * `AuditEvent_at_idx` makes the ordering an index scan rather than a sort over
 * the whole table. Account events now share this window with record events.
 */
export const listAuditEvents = (db: Database, limit = 200) =>
  db
    .select()
    .from(auditEvents)
    // Chat room administration events are kept for the record only; they
    // must not use up the workspace's display window.
    .where(or(isNull(auditEvents.subject), ne(auditEvents.subject, "collaboration")))
    .orderBy(desc(auditEvents.at))
    .limit(limit)
    .all();

export type NewRecord = {
  id: string; kind: string; company: string; branch: string;
  ownerId: string; status: string; payload: unknown;
};
export type NewAudit = {
  id: string; company: string; actor: string; actorId: string;
  action: string; recordId: string; before?: unknown; after?: unknown; at?: Date;
  /**
   * "account" for user administration, "collaboration" for chat room
   * administration; omitted for business records.
   */
  subject?: "account" | "collaboration";
  /** Branch of the account an "account" event concerns; null means group-wide. */
  branch?: string | null;
};

const insertRecord = (db: Database, record: NewRecord, now: Date) =>
  db.insert(businessRecords).values({ ...record, version: 1, createdAt: now, updatedAt: now });

const insertAudit = (db: Database, event: NewAudit) =>
  db.insert(auditEvents).values({
    id: event.id, company: event.company, actor: event.actor, actorId: event.actorId,
    action: event.action, recordId: event.recordId,
    before: event.before ?? null, after: event.after ?? null,
    at: event.at ?? new Date(),
    subject: event.subject ?? null,
    branch: event.branch ?? null,
  });

/** Writes a single audit entry. */
export const writeAudit = (db: Database, event: NewAudit) => insertAudit(db, event).run();

/** Create a record and its audit entry together, or neither. */
export function createRecordWithAudit(db: Database, record: NewRecord, event: NewAudit) {
  const now = new Date();
  return db.batch([insertRecord(db, record, now), insertAudit(db, event)]);
}

/**
 * Optimistic update, preserving the original `WHERE id = ? AND version = ?`
 * check. Every statement in the batch is guarded by the same version, so if
 * another writer won the race the update matches no rows and the follow-on
 * inserts write nothing either — the batch stays all-or-nothing.
 *
 * Returns false when the version check failed, matching the previous
 * "Another user updated this record" behaviour.
 */
export async function updateRecordWithAudit(
  db: Database,
  id: string,
  expectedVersion: number,
  changed: { status: string; payload: unknown },
  event: NewAudit,
  alsoCreate: NewRecord[] = [],
): Promise<boolean> {
  const now = new Date();
  // Step one is the optimistic update on its own. Only the caller holding the
  // expected version matches, so a stale writer changes nothing and no
  // accompanying rows are written.
  await db
    .update(businessRecords)
    .set({
      status: changed.status,
      payload: changed.payload,
      version: sql`${businessRecords.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(businessRecords.id, id), eq(businessRecords.version, expectedVersion)))
    .run();

  const after = await findRecord(db, id);
  if (after?.version !== expectedVersion + 1) return false;

  // Step two commits everything that accompanies a successful update as one
  // atomic batch: any linked records, then the audit entry.
  //
  // D1 has no interactive transaction spanning both steps, so if this batch
  // fails the record is already changed and its audit entry is missing. That
  // gap cannot be closed with the primitives available, but it must never pass
  // unnoticed, so it is recorded with a stable event name. The identifiers
  // below are record ids, never payloads or credentials.
  const follow = [...alsoCreate.map((record) => insertRecord(db, record, now)), insertAudit(db, event)];
  type Batchable = Parameters<Database["batch"]>[0][number];
  try {
    await db.batch(follow as unknown as [Batchable, ...Batchable[]]);
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "record_update_audit_failed",
        recordId: id,
        auditId: event.id,
        linkedRecords: alsoCreate.length,
        detail: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 200) : "Unknown error",
      }),
    );
    throw cause;
  }
  return true;
}

// ------------------------------------------------------ password resets

/** Minutes a reset link stays valid. */
export const RESET_TTL_MS = 30 * 60_000;

/**
 * Issues a reset link for one user.
 *
 * Any outstanding links for that user are deleted in the same batch, so
 * generating a new link always invalidates the previous one. Only the hash of
 * the token is written; the caller holds the raw token and shows it once.
 */
export function issuePasswordReset(
  db: Database,
  tokenHash: string,
  userId: string,
  issuedBy: { id: string; name: string },
  audit: NewAudit,
) {
  const now = new Date();
  return db.batch([
    db.delete(passwordResets).where(eq(passwordResets.userId, userId)),
    db.insert(passwordResets).values({
      id: tokenHash,
      userId,
      issuedBy: issuedBy.id,
      issuedByName: issuedBy.name,
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      createdAt: now,
    }),
    insertAudit(db, audit),
  ]);
}

/** Looks up a reset by token hash, together with its user. */
export async function findPasswordReset(db: Database, tokenHash: string) {
  const row = await db
    .select({ reset: passwordResets, user: users })
    .from(passwordResets)
    .innerJoin(users, eq(passwordResets.userId, users.id))
    .where(eq(passwordResets.id, tokenHash))
    .get();
  return row ?? null;
}

/**
 * Completes a reset atomically: set the new password, drop every session for
 * that user (including the device performing the reset), drop every
 * outstanding reset token, and record the event.
 *
 * D1 has no interactive transactions, but batch() is all-or-nothing, so there
 * is no state where the password changed while sessions survived.
 */
/**
 * Redeems a reset token. Returns true only for the request that consumed it.
 *
 * D1 has no interactive transactions, so the claim is a single statement:
 * `DELETE … WHERE id = ? AND expiresAt > ? RETURNING userId`. SQLite applies
 * that atomically, so of any number of simultaneous requests exactly one gets
 * a row back and the rest get nothing. Deleting the token *is* the claim,
 * which is what makes single use strict rather than best effort.
 *
 * The dependent writes then run as one `batch()`, which D1 documents as a SQL
 * transaction executed sequentially and rolled back entirely on failure, so
 * the password change, session revocation and audit entry cannot partially
 * apply.
 *
 * Residual behaviour, deliberately fail-closed: if the batch fails after the
 * claim succeeded, the token is already spent and the password is unchanged.
 * The user asks for a new link. The alternative — claiming after the writes —
 * would allow two winners, which is worse.
 */
/**
 * Raised when the token was successfully claimed but its consequences did not
 * commit. Distinct from an ordinary failure because the operational meaning
 * differs: the link is already spent, so the user must be issued a new one.
 * Carries the underlying error as `cause` for logging; it never carries the
 * token, the password or any hash.
 */
export class PasswordResetConsequenceError extends Error {
  constructor(cause: unknown) {
    super("Password reset consequences failed after the token was claimed");
    this.name = "PasswordResetConsequenceError";
    this.cause = cause;
  }
}

export async function redeemPasswordReset(
  db: Database,
  tokenHash: string,
  passwordHash: string,
  event: NewAudit,
): Promise<boolean> {
  const claimed = await db
    .delete(passwordResets)
    .where(and(eq(passwordResets.id, tokenHash), gt(passwordResets.expiresAt, new Date())))
    .returning({ userId: passwordResets.userId });

  const userId = claimed?.[0]?.userId;
  if (!userId) return false; // expired, already spent, or lost the race

  try {
    await db.batch([
      db.update(users).set({ passwordHash }).where(eq(users.id, userId)),
      db.delete(sessions).where(eq(sessions.userId, userId)),
      insertAudit(db, event),
    ]);
  } catch (cause) {
    // The claim already committed, so this is the fail-closed window rather
    // than a generic error. Tagging it lets the route say so in its log.
    throw new PasswordResetConsequenceError(cause);
  }
  return true;
}

/** Removes expired rows opportunistically; no scheduled job is needed. */
export const purgeExpiredResets = (db: Database) =>
  db.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date())).run();
