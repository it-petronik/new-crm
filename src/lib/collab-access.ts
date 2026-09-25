import type { Database } from "./d1";
import type { Actor } from "./domain";
import type { ConversationMemberRow, ConversationRow } from "./schema";
import { inRoomScope, isId } from "./collab";
import { findConversation, findMembership, findPeople, type PersonRow } from "./collab-data";

/**
 * The Collaboration access rules, free of any Next.js dependency so that the
 * Worker entry (file downloads, room avatars) applies exactly the same checks
 * as the API routes. collab-auth.ts re-exports these; there is one
 * implementation.
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

