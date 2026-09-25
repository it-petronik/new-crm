import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentActor, checkOrigin } from "./auth";
import { getDb, isPreview, type Database } from "./db";
import type { Actor } from "./domain";
import type { ConversationMemberRow, ConversationRow } from "./schema";
import { inRoomScope, isId } from "./collab";
import { findConversation, findMembership, findPeople, type PersonRow } from "./collab-data";
import { recordLoginAttempt } from "./data";

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

export class CollabError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const notFound = () => new CollabError(404, "Conversation not found.");

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

export type Access = {
  conversation: ConversationRow;
  membership: ConversationMemberRow | null;
  /** The caller may read messages and member details. */
  canRead: boolean;
  /** The caller may send, and edit their own messages. */
  canPost: boolean;
  /** Owner or admin of a room within scope. */
  canAdmin: boolean;
  /** A workspace room within scope that the caller has not joined. */
  canJoin: boolean;
  /** Direct messages only: the other participant. */
  counterpart: PersonRow | null;
};

export async function conversationAccess(
  db: Database,
  actor: Actor,
  id: unknown,
): Promise<Access> {
  if (!isId(id)) throw notFound();
  const conversation = await findConversation(db, id);
  if (!conversation) throw notFound();
  const membership = (await findMembership(db, id, actor.id)) ?? null;
  const archived = !!conversation.archivedAt;

  if (conversation.kind === "direct") {
    const canRead = !!membership && actor.companies.includes(conversation.company);
    let counterpart: PersonRow | null = null;
    if (canRead) {
      const otherId = (conversation.directKey ?? "").split(":").find((p) => p !== actor.id);
      counterpart = otherId ? ((await findPeople(db, [otherId]))[0] ?? null) : null;
    }
    // Writing needs the other person to still be active and still in the
    // company the thread belongs to; history stays readable either way.
    const canPost =
      canRead &&
      !!counterpart &&
      counterpart.active &&
      counterpart.companies.includes(conversation.company);
    return { conversation, membership, canRead, canPost, canAdmin: false, canJoin: false, counterpart };
  }

  const scoped = inRoomScope(actor, conversation);
  const canRead = !!membership && scoped;
  return {
    conversation,
    membership,
    canRead,
    canPost: canRead && !archived,
    canAdmin: canRead && (membership?.role === "owner" || membership?.role === "admin"),
    canJoin: !membership && scoped && conversation.visibility === "workspace" && !archived,
    counterpart: null,
  };
}

/** Read access, or a 404 indistinguishable from a missing conversation. */
export async function requireRead(db: Database, actor: Actor, id: unknown) {
  const access = await conversationAccess(db, actor, id);
  if (!access.canRead) throw notFound();
  return access;
}

export async function requireAdmin(db: Database, actor: Actor, id: unknown) {
  const access = await requireRead(db, actor, id);
  if (access.conversation.kind !== "room")
    throw new CollabError(400, "Direct messages have no room settings.");
  if (!access.canAdmin) throw new CollabError(403, "Only room owners and admins can do that.");
  return access;
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
