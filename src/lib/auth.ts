import { cookies } from "next/headers";
import { getDb } from "./d1";
import {
  findSessionWithUser,
  createSession,
  deleteSession,
  claimRefreshToken,
  findRefreshToken,
  findRefreshBySession,
  rotateDevice,
  revokeRefreshFamily,
  retireRefreshFamily,
  revokeAllSessions,
  findUserById,
} from "./data";
import { type Actor, roles } from "./domain";

export const sessionCookie = "enercore_session";
/** "Keep me signed in": the device's rotating refresh credential. */
export const refreshCookie = "enercore_refresh";

/**
 * Sessions:
 *
 * - The ACTIVE session is what every request checks: 8 hours, as before.
 * - With "Keep me signed in", the device also holds a REFRESH credential
 *   (30 days, sliding). When the active session has lapsed, the browser
 *   presents it once to /api/auth/refresh and gets a fresh pair: the old
 *   refresh token is marked used, a new one issued in the same family.
 * - Presenting a used refresh token again (outside a few seconds' grace for
 *   two tabs refreshing at once) is treated as theft: the whole family —
 *   every session it issued — is revoked.
 * - A family lives at most 90 days, however active.
 *
 * Both are random 256-bit values in HttpOnly cookies; D1 stores only their
 * SHA-256. Nothing is readable by page JavaScript.
 */
export const ACTIVE_SESSION_MS = 8 * 3600_000;
export const REFRESH_MS = 30 * 86_400_000;
export const REFRESH_FAMILY_MAX_MS = 90 * 86_400_000;
/** Another tab's refresh a moment ago is a race, not a replay. */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/** Session tokens are stored hashed, so a leaked row cannot be replayed. */
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const randomHex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
const looksLikeSecret = (value: string | undefined): value is string => !!value && /^[0-9a-f]{64}$/.test(value);

const cookieBase = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });

export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  const db = await getDb();
  if (!db) return null;
  const found = await findSessionWithUser(db, await hashToken(token));
  if (!found) return null;
  const { session, user } = found;
  if (
    session.expiresAt.getTime() < Date.now() ||
    !user.active ||
    !roles.includes(user.role as Actor["role"])
  )
    return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role as Actor["role"],
    companies: user.companies,
    branches: user.branches,
    email: user.email,
    moduleAccess: (user.moduleAccess || undefined) as Actor["moduleAccess"],
  };
}

async function setPair(session: { token: string; expires: Date }, refresh: { token: string; expires: Date } | null) {
  const jar = await cookies();
  jar.set(sessionCookie, session.token, { ...cookieBase(), expires: session.expires });
  if (refresh) jar.set(refreshCookie, refresh.token, { ...cookieBase(), expires: refresh.expires });
  else jar.delete(refreshCookie);
}

/**
 * Signs a person in on this device. `remember` adds the refresh credential;
 * without it the device gets the plain 8-hour session and nothing longer.
 * Any refresh credential this browser already held (an earlier sign-in,
 * perhaps as someone else) is retired: its cookie is about to be replaced,
 * so nothing may renew from it again. Its short session is left to expire.
 */
export async function startSession(userId: string, remember = false) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const earlier = (await cookies()).get(refreshCookie)?.value;
  if (looksLikeSecret(earlier)) {
    const row = await findRefreshToken(db, await hashToken(earlier));
    if (row) await retireRefreshFamily(db, row.familyId);
  }
  const now = Date.now();
  const token = randomHex();
  const expires = new Date(now + ACTIVE_SESSION_MS);
  const sessionId = await hashToken(token);
  if (!remember) {
    await createSession(db, sessionId, userId, expires);
    return setPair({ token, expires }, null);
  }
  const refresh = randomHex();
  const refreshExpires = new Date(now + REFRESH_MS);
  await rotateDevice(
    db,
    {
      sessionId,
      userId,
      sessionExpiresAt: expires,
      token: { id: await hashToken(refresh), familyId: crypto.randomUUID(), userId, sessionId, createdAt: new Date(now), expiresAt: refreshExpires, familyCreatedAt: new Date(now), usedAt: null },
    },
    null,
  );
  await setPair({ token, expires }, { token: refresh, expires: refreshExpires });
}

export type RefreshOutcome = "renewed" | "raced" | "invalid";

/**
 * Presents this device's refresh credential: on success a new active
 * session and a new refresh token (the presented one is now used). Returns
 * "raced" when another tab refreshed with the same token a moment ago —
 * its new cookies are already on their way — and "invalid" otherwise, after
 * revoking the family if the token was replayed.
 */
export async function refreshSession(): Promise<RefreshOutcome> {
  const db = await getDb();
  if (!db) return "invalid";
  const presented = (await cookies()).get(refreshCookie)?.value;
  if (!looksLikeSecret(presented)) return "invalid";
  const id = await hashToken(presented);
  const now = new Date();
  const claimed = await claimRefreshToken(db, id, now, new Date(now.getTime() - REFRESH_FAMILY_MAX_MS));
  if (!claimed) {
    const known = await findRefreshToken(db, id);
    if (known?.usedAt) {
      if (now.getTime() - known.usedAt.getTime() <= REFRESH_REUSE_GRACE_MS) return "raced";
      // A used token presented again: someone kept a copy. End the device.
      console.warn("refresh token reuse detected; family revoked");
      await revokeRefreshFamily(db, known.familyId);
    } else if (known) await revokeRefreshFamily(db, known.familyId); // expired or past the family limit
    return "invalid";
  }
  // The person must still be allowed in.
  const user = await findSessionUser(db, claimed.userId);
  if (!user) {
    await revokeRefreshFamily(db, claimed.familyId);
    return "invalid";
  }
  const token = randomHex();
  const refresh = randomHex();
  const expires = new Date(now.getTime() + ACTIVE_SESSION_MS);
  const refreshExpires = new Date(now.getTime() + REFRESH_MS);
  const sessionId = await hashToken(token);
  await rotateDevice(
    db,
    {
      sessionId,
      userId: claimed.userId,
      sessionExpiresAt: expires,
      token: { id: await hashToken(refresh), familyId: claimed.familyId, userId: claimed.userId, sessionId, createdAt: now, expiresAt: refreshExpires, familyCreatedAt: claimed.familyCreatedAt, usedAt: null },
    },
    claimed.sessionId,
  );
  await setPair({ token, expires }, { token: refresh, expires: refreshExpires });
  return "renewed";
}

async function findSessionUser(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: string) {
  const user = await findUserById(db, userId);
  return user && user.active && roles.includes(user.role as Actor["role"]) ? user : null;
}

/**
 * Signs this device out: its active session and its refresh family (found
 * from the refresh cookie, or from the session it issued), then clears both
 * cookies. Other devices stay signed in.
 */
export async function endDevice() {
  const jar = await cookies();
  const db = await getDb();
  const token = jar.get(sessionCookie)?.value;
  const refresh = jar.get(refreshCookie)?.value;
  if (db) {
    const sessionId = token ? await hashToken(token) : null;
    const family =
      (looksLikeSecret(refresh) ? await findRefreshToken(db, await hashToken(refresh)) : undefined) ??
      (sessionId ? await findRefreshBySession(db, sessionId) : undefined);
    if (family) await revokeRefreshFamily(db, family.familyId);
    if (sessionId) await deleteSession(db, sessionId);
  }
  jar.delete(sessionCookie);
  jar.delete(refreshCookie);
}

/** Signs a person out on every device. */
export async function endEverywhere(userId: string) {
  const db = await getDb();
  if (db) await revokeAllSessions(db, userId);
  const jar = await cookies();
  jar.delete(sessionCookie);
  jar.delete(refreshCookie);
}

export async function endSession(token: string) {
  const db = await getDb();
  if (db) await deleteSession(db, await hashToken(token));
}

export function checkOrigin(request: Request) {
  const configured = process.env.APP_URL;
  if (!configured || request.headers.get("origin") !== new URL(configured).origin)
    throw new Error("Invalid request origin. Configure APP_URL.");
}

/** A same-site path to return to after signing in; anything else is "/". */
export function safeNext(value: unknown) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) && value.length <= 2000 ? value : "/";
}
