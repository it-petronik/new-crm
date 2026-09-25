import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentActor, checkOrigin } from "./auth";
import { getDb, isPreview, type Database } from "./db";
import type { Actor } from "./domain";
import { recordLoginAttempt } from "./data";
import { CollabError } from "./collab-access";

// The access rules themselves live in collab-access.ts (no Next.js imports),
// shared with the Worker's file routes; re-exported so routes keep one import.
export {
  CollabError,
  conversationAccess,
  requireRead,
  requireAdmin,
  type Access,
} from "./collab-access";

/**
 * Collaboration authorization, in one place.
 *
 * Every collaboration route resolves the caller and the conversation through
 * these helpers, so the rules cannot drift between endpoints:
 *
 * - The caller must hold a live session for an active account (currentActor
 *   re-reads the user row on every request, so deactivation is immediate).
 * - Knowing an id grants nothing. A conversation the caller may not read is
 *   reported exactly like one that does not exist (404), so ids cannot be
 *   probed to discover private rooms.
 * - Reading a room needs membership AND the room inside the caller's current
 *   company/branch scope. Reading a direct thread needs participation AND the
 *   thread's company still among the caller's companies.
 * - Administering a room needs owner/admin membership on top of read access.
 */

export type CollabContext = { actor: Actor; db: Database };

/**
 * The caller and database for a collaboration request. Mutations also verify
 * the request origin, the same CSRF guard every other write route uses.
 */
export async function collabContext(request: Request, write: boolean): Promise<CollabContext> {
  if (isPreview()) throw new CollabError(409, "Collaboration is not available in preview.");
  if (write) {
    try {
      checkOrigin(request);
    } catch {
      throw new CollabError(403, "Invalid request origin.");
    }
  }
  const actor = await currentActor();
  if (!actor) throw new CollabError(401, "Sign in required.");
  const db = await getDb();
  if (!db) throw new CollabError(503, "Database unavailable.");
  return { actor, db };
}

/**
 * Conservative per-person write limits. They exist to stop a script or a
 * stuck client flooding a room, not to slow down anyone typing; reads are not
 * limited. Counted with the same atomic D1 upsert that already limits login,
 * password-reset and intake attempts, so no new infrastructure is involved.
 */
export const RATE_LIMITS = {
  message: { max: 30, windowMs: 60_000, error: "You're sending messages too quickly. Wait a moment and try again." },
  room: { max: 10, windowMs: 60 * 60_000, error: "You've created a lot of rooms recently. Try again later." },
  direct: { max: 30, windowMs: 60 * 60_000, error: "You've started a lot of conversations recently. Try again later." },
  upload: { max: 60, windowMs: 10 * 60_000, error: "You've uploaded a lot of files recently. Wait a few minutes and try again." },
  reaction: { max: 120, windowMs: 60_000, error: "Too many reactions at once. Wait a moment." },
  avatar: { max: 10, windowMs: 60 * 60_000, error: "The room image has been changed a lot recently. Try again later." },
} as const;

export async function rateLimit(db: Database, actor: Actor, kind: keyof typeof RATE_LIMITS) {
  const limit = RATE_LIMITS[kind];
  const count = await recordLoginAttempt(db, `collab-${kind}:${actor.id}`, limit.windowMs);
  if (count > limit.max) throw new CollabError(429, limit.error);
}

/** Uniform JSON errors; unexpected failures never echo internals. */
export async function handle(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CollabError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "Check the details and try again." }, { status: 400 });
    console.error("collaboration request failed", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
