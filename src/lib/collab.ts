/**
 * Collaboration Hub: shared types, limits and pure rules.
 *
 * Imported by both the server (API routes, data layer) and the client (the
 * hub UI), so nothing here touches the database, cookies or the DOM. The
 * rules that decide access live here as pure functions so the server applies
 * exactly the same predicate the client uses for hints — but only the
 * server's answer ever grants anything.
 */

export const MESSAGE_MAX = 4000;
export const ROOM_NAME_MIN = 2;
export const ROOM_NAME_MAX = 80;
export const ROOM_DESCRIPTION_MAX = 280;
export const ROOM_MEMBER_MAX = 250;
export const MENTION_MAX = 20;
export const MESSAGE_PAGE = 40;
export const MENTION_PAGE = 30;
/** Unread counts are capped; the badge shows "99+" beyond this. */
export const UNREAD_CAP = 99;

export type ConversationKind = "room" | "direct";
export type RoomVisibility = "private" | "workspace";
export type MemberRole = "owner" | "admin" | "member";

export type Person = { id: string; name: string; role: string };

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  /** Room name, or the other person's name for a direct message. */
  title: string;
  description: string | null;
  visibility: RoomVisibility;
  company: string;
  branch: string | null;
  archived: boolean;
  myRole: MemberRole;
  unread: number;
  /** Unread messages in this conversation that mention the reader. */
  mentions: number;
  lastReadMessageId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  lastMessage: { authorName: string; excerpt: string; mine: boolean } | null;
  /** Direct messages only. */
  counterpart: (Person & { active: boolean }) | null;
  memberCount: number;
  /** False when the reader may read but not write (archived, inactive DM). */
  canPost: boolean;
};

export type DiscoverableRoom = {
  id: string;
  title: string;
  description: string | null;
  company: string;
  branch: string | null;
  memberCount: number;
};

export type ConversationMemberView = Person & {
  memberRole: MemberRole;
  active: boolean;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  members: ConversationMemberView[];
  canAdmin: boolean;
};

export type ReplyPreview = {
  id: string;
  authorName: string;
  excerpt: string;
  deleted: boolean;
};

export type MessageView = {
  id: string;
  conversationId: string;
  author: Person;
  /** Plain text. Empty when deleted. Never HTML. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: ReplyPreview | null;
  mentions: { id: string; name: string }[];
  clientKey: string | null;
};

export type MessagePage = {
  messages: MessageView[];
  /** Older messages exist before the first one returned. */
  hasOlder: boolean;
  /** Newer messages exist after the last one returned (a jumped-to window). */
  hasNewer: boolean;
};

export type MentionItem = {
  message: MessageView;
  conversation: { id: string; kind: ConversationKind; title: string };
  unread: boolean;
};

export type CollabSummary = { unread: number; mentions: number };

/** Everything the realtime channel can say. Always about one conversation. */
export type CollabEvent =
  | { type: "message.created"; conversationId: string; message: MessageView }
  | { type: "message.updated"; conversationId: string; message: MessageView }
  | { type: "message.deleted"; conversationId: string; messageId: string }
  | { type: "conversation.changed"; conversationId: string }
  | { type: "conversation.removed"; conversationId: string }
  | { type: "read"; conversationId: string; lastReadMessageId: string };

/* ------------------------------------------------------------------ text */

// C0 controls except tab and newline, DEL, and the bidirectional overrides
// that can make a message display differently from what it says.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/**
 * Normalises user text before it is stored: unified newlines, no control or
 * bidi-override characters, no more than two consecutive blank lines, and no
 * surrounding whitespace. The result is still plain text — nothing is
 * escaped, because nothing is ever rendered as HTML.
 */
export function cleanText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** A single-line cleaned value, for room names. */
export function cleanLine(value: string) {
  return cleanText(value).replace(/\s+/g, " ");
}

export function excerpt(body: string, max = 120) {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/* ------------------------------------------------------------------- ids */

const ID = /^[A-Za-z0-9-]{8,64}$/;
/** Shape check only; existence and access are always checked separately. */
export const isId = (value: unknown): value is string =>
  typeof value === "string" && ID.test(value);

/**
 * Time-ordered message id: 10 base-36 characters of epoch milliseconds, then
 * 12 random hex characters. Lexical order is creation order, so one index on
 * (conversationId, id) serves paging, cursors and unread counts, and a read
 * cursor is just "the newest id I have seen".
 */
export function messageId(now = Date.now()) {
  const time = now.toString(36).padStart(10, "0");
  const random = [...crypto.getRandomValues(new Uint8Array(6))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${time}${random}`;
}

/** Unordered pair key for a direct message; unique in the database. */
export const directKey = (a: string, b: string) => [a, b].sort().join(":");

/* ----------------------------------------------------------------- scope */

type Scoped = { companies: string[]; branches: string[] };

/**
 * Whether a person's organisational access covers a room.
 *
 * A room belongs to one company and optionally one branch. A branch-scoped
 * person (non-empty `branches`) reaches company-wide rooms and rooms in their
 * own branches; a group-wide person reaches every room in their companies.
 * Applied on every request, so a person moved out of a company loses the room
 * immediately without any membership cleanup.
 */
export function inRoomScope(person: Scoped, room: { company: string; branch: string | null }) {
  if (!person.companies.includes(room.company)) return false;
  if (room.branch && person.branches.length && !person.branches.includes(room.branch)) return false;
  return true;
}

/** The first company two people share, in the first person's order. */
export function sharedCompany(a: Scoped, b: Scoped) {
  return a.companies.find((c) => b.companies.includes(c)) ?? null;
}

/**
 * Mentions a message may carry: people who are current, active members of
 * the conversation, other than the author, and whose "@Name" actually appears
 * in the text. Anything else is dropped rather than rejected, so a stale
 * mention in a draft cannot block sending.
 */
export function validMentions(
  body: string,
  requested: string[],
  members: { id: string; name: string; active: boolean }[],
  authorId: string,
) {
  const unique = [...new Set(requested)].slice(0, MENTION_MAX);
  return unique.filter((id) => {
    if (id === authorId) return false;
    const member = members.find((m) => m.id === id);
    return !!member && member.active && body.includes(`@${member.name}`);
  });
}
