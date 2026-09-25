import type { Kind, Module } from "./domain";

/**
 * Notifications: shared types and pure helpers, imported by the server (which
 * creates and lists them) and the browser (inbox, toast, desktop alert).
 * Nothing here touches the database or the DOM.
 */

export type NotificationCategory = "assignment" | "approval" | "collaboration" | "reminder" | "update" | "security";
export type NotificationPriority = "normal" | "important" | "urgent";

/**
 * Where a notification leads. Always derived on the server from the stored
 * entity fields — never a stored URL — and opening it re-applies the normal
 * access checks.
 */
export type NotificationTarget =
  | { kind: "record"; recordKind: Kind; recordId: string }
  | { kind: "conversation"; conversationId: string; messageId: string | null }
  | { kind: "profile" };

export type NotificationView = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  actor: { id: string; name: string } | null;
  priority: NotificationPriority;
  createdAt: string;
  readAt: string | null;
  /** Null when the reader can no longer open what it is about. */
  target: NotificationTarget | null;
  /** Unread and asks the reader to do something (approve, pick up, act). */
  needsAction: boolean;
};

export type NotificationPreferences = { desktop: boolean; preview: boolean };
export const DEFAULT_PREFERENCES: NotificationPreferences = { desktop: false, preview: true };

export type NotificationInbox = {
  items: NotificationView[];
  unread: number;
  nextBefore: string | null;
  preferences: NotificationPreferences;
};

/** Realtime events on the person's existing channel (conversationId is ""). */
export type NotificationEvent =
  | { type: "notification.created"; conversationId: ""; notification: NotificationView }
  | { type: "notification.read"; conversationId: ""; ids: string[]; read: boolean }
  | { type: "notification.read_all"; conversationId: ""; upTo: string };

export const NOTIFICATION_PAGE = 40;
export const UNREAD_BADGE_CAP = 99;

export const badgeCount = (n: number) => (n > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(n));

/** "(4) Enercore CRM", "(99+) Enercore CRM", or the bare title at zero. */
export const titleWithCount = (base: string, unread: number) =>
  unread > 0 ? `(${badgeCount(unread)}) ${base}` : base;

/** The module a record kind lives in; leave requests sit under People & HR. */
export const moduleForKind = (kind: Kind): Module => (kind === "leave" ? "hr" : kind);

const RECORD_KINDS: readonly string[] = [
  "leads", "quotations", "orders", "logistics", "accounts", "customers",
  "suppliers", "products", "hr", "marketing", "it", "leave",
];

/** The trusted destination for a stored entity reference. */
export function targetFor(row: {
  entityType: string;
  entityId: string;
  conversationId: string | null;
  messageId: string | null;
}): NotificationTarget | null {
  if (RECORD_KINDS.includes(row.entityType))
    return { kind: "record", recordKind: row.entityType as Kind, recordId: row.entityId };
  if (row.entityType === "conversation")
    return { kind: "conversation", conversationId: row.conversationId ?? row.entityId, messageId: row.messageId };
  if (row.entityType === "account") return { kind: "profile" };
  return null;
}

/** Things that wait on the reader, shown under "Needs action". */
export const ACTION_TYPES = new Set([
  "approval.requested",
  "record.assigned",
  "ticket.created",
  "shipment.to_plan",
  "invoice.to_issue",
  "shipment.delayed",
  "shipment.documents",
  "payment.overdue",
  "followup.overdue",
  "chat.mention",
]);
