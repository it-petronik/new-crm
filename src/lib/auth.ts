import { cookies } from "next/headers";
import { getDb } from "./d1";
import { findSessionWithUser, createSession, deleteSession } from "./data";
import { type Actor, roles } from "./domain";

export const sessionCookie = "enercore_session";

/** Session tokens are stored hashed, so a leaked row cannot be replayed. */
export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export async function startSession(userId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expires = new Date(Date.now() + 8 * 3600000);
  await createSession(db, await hashToken(token), userId, expires);
  (await cookies()).set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
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
