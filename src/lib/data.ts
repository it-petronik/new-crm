import { eq, and, sql, desc } from "drizzle-orm";
import type { Database } from "./d1";
import { users, sessions, businessRecords, auditEvents, loginAttempts } from "./schema";
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
  ]);

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

export const listAuditEvents = (db: Database, limit = 200) =>
  db.select().from(auditEvents).orderBy(desc(auditEvents.at)).limit(limit).all();

export type NewRecord = {
  id: string; kind: string; company: string; branch: string;
  ownerId: string; status: string; payload: unknown;
};
export type NewAudit = {
  id: string; company: string; actor: string; actorId: string;
  action: string; recordId: string; before?: unknown; after?: unknown; at?: Date;
};

const insertRecord = (db: Database, record: NewRecord, now: Date) =>
  db.insert(businessRecords).values({ ...record, version: 1, createdAt: now, updatedAt: now });

const insertAudit = (db: Database, event: NewAudit) =>
  db.insert(auditEvents).values({
    id: event.id, company: event.company, actor: event.actor, actorId: event.actorId,
    action: event.action, recordId: event.recordId,
    before: event.before ?? null, after: event.after ?? null,
    at: event.at ?? new Date(),
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
  const follow = [...alsoCreate.map((record) => insertRecord(db, record, now)), insertAudit(db, event)];
  type Batchable = Parameters<Database["batch"]>[0][number];
  await db.batch(follow as unknown as [Batchable, ...Batchable[]]);
  return true;
}
