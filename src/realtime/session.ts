import { roles, type Actor } from "../lib/domain";

/**
 * Session authentication for requests the Worker answers itself (the
 * realtime socket, Collaboration files). The same checks as `currentActor`:
 * the cookie's SHA-256 must match an unexpired session of an ACTIVE account
 * with a valid role. Anything else is no session.
 */

export type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

const COOKIE = "enercore_session";

export function readCookie(header: string | null, name = COOKIE) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SessionActor = { actor: Actor; session: string; expiresAt: number };

export async function sessionActor(request: Request, db: D1Like): Promise<SessionActor | null> {
  const token = readCookie(request.headers.get("Cookie"));
  if (!token) return null;
  const session = await sha256(token);
  const row = await db
    .prepare(
      `SELECT s."expiresAt" AS expiresAt, u."id" AS id, u."name" AS name, u."role" AS role,
              u."companies" AS companies, u."branches" AS branches, u."active" AS active
         FROM "Session" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."id" = ?`,
    )
    .bind(session)
    .first<{ expiresAt: number; id: string; name: string; role: string; companies: string; branches: string; active: number }>();
  if (!row || !row.active || Number(row.expiresAt) <= Date.now() || !(roles as readonly string[]).includes(row.role))
    return null;
  const list = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    actor: { id: row.id, name: row.name, role: row.role as Actor["role"], companies: list(row.companies), branches: list(row.branches) },
    session,
    expiresAt: Number(row.expiresAt),
  };
}
