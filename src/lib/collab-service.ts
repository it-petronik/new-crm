import { eq, inArray } from "drizzle-orm";
import type { Database } from "./d1";
import type { Actor } from "./domain";
import { conversationMembers, messages, users } from "./schema";
import {
  excerpt,
  inRoomScope,
  type ConversationSummary,
  type MessageView,
} from "./collab";
import {
  counterparts,
  findConversation,
  findPeople,
  listMemberships,
  type MembershipRow,
  type PersonRow,
} from "./collab-data";
import { publish } from "./collab-realtime";

/**
 * Builds the conversation list the client shows. Rows outside the caller's
 * current scope are dropped here — membership alone is never enough — so a
 * person moved to another company stops seeing that company's rooms at once.
 */
export async function conversationSummaries(
  db: Database,
  actor: Actor,
  conversationId?: string,
): Promise<ConversationSummary[]> {
  const rows = (await listMemberships(db, actor.id, conversationId)).filter((r) =>
    r.conversation.kind === "direct"
      ? actor.companies.includes(r.conversation.company)
      : inRoomScope(actor, r.conversation),
  );
  const directIds = rows.filter((r) => r.conversation.kind === "direct").map((r) => r.conversation.id);
  const lastIds = rows.map((r) => r.lastMessageId).filter((id): id is string => !!id);
  const [others, lastRows] = await Promise.all([
    counterparts(db, directIds, actor.id),
    lastIds.length
      ? db.select().from(messages).where(inArray(messages.id, lastIds)).all()
      : Promise.resolve([]),
  ]);
  const authors = new Map((await findPeople(db, lastRows.map((m) => m.authorId))).map((p) => [p.id, p]));
  const lastById = new Map(lastRows.map((m) => [m.id, m]));
  return rows.map((row) => {
    const last = row.lastMessageId ? lastById.get(row.lastMessageId) : undefined;
    return toSummary(
      row,
      others.get(row.conversation.id) ?? null,
      last
        ? {
            authorName: authors.get(last.authorId)?.name ?? "Former member",
            excerpt: last.deletedAt ? "Message deleted" : excerpt(last.body, 90),
            mine: last.authorId === actor.id,
          }
        : null,
    );
  });
}

function toSummary(
  row: MembershipRow,
  counterpart: PersonRow | null,
  lastMessage: ConversationSummary["lastMessage"],
): ConversationSummary {
  const c = row.conversation;
  const direct = c.kind === "direct";
  const canPost = direct
    ? !!counterpart && counterpart.active && counterpart.companies.includes(c.company)
    : !c.archivedAt;
  return {
    id: c.id,
    kind: c.kind,
    title: direct ? (counterpart?.name ?? "Former member") : (c.name ?? "Untitled room"),
    description: c.description,
    visibility: c.visibility,
    company: c.company,
    branch: c.branch,
    archived: !!c.archivedAt,
    myRole: row.role,
    unread: row.unread,
    mentions: row.mentions,
    lastReadMessageId: row.lastRead,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    lastMessage,
    counterpart: counterpart
      ? { id: counterpart.id, name: counterpart.name, role: counterpart.role, active: counterpart.active }
      : null,
    memberCount: row.memberCount,
    canPost,
  };
}

export async function summaryFor(db: Database, actor: Actor, conversationId: string) {
  return (await conversationSummaries(db, actor, conversationId))[0] ?? null;
}

/**
 * Who may receive a realtime event about a conversation, decided at the
 * moment of sending from the database — never from anything a client said.
 *
 * It is exactly the read rule in collab-auth.ts applied to every member:
 * current membership, an active account, and current scope (the room's
 * company/branch, or the direct thread's company). A member deactivated or
 * moved out of scope one request earlier is therefore excluded from the very
 * next event, even while their socket is still open.
 */
export async function audience(db: Database, conversationId: string): Promise<string[]> {
  const conversation = await findConversation(db, conversationId);
  if (!conversation) return [];
  const rows = await db
    .select({
      id: users.id,
      active: users.active,
      companies: users.companies,
      branches: users.branches,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId))
    .all();
  return rows
    .filter((m) =>
      m.active &&
      (conversation.kind === "direct"
        ? m.companies.includes(conversation.company)
        : inRoomScope(m, conversation)),
    )
    .map((m) => m.id);
}

/** Tells everyone entitled to the conversation that something changed. */
export const announceChange = async (db: Database, conversationId: string) =>
  publish(await audience(db, conversationId), { type: "conversation.changed", conversationId });

export const announceMessage = async (
  db: Database,
  type: "message.created" | "message.updated",
  message: MessageView,
) =>
  publish(await audience(db, message.conversationId), {
    type,
    conversationId: message.conversationId,
    message,
  });

export const announceDeleted = async (db: Database, conversationId: string, messageId: string) =>
  publish(await audience(db, conversationId), { type: "message.deleted", conversationId, messageId });
