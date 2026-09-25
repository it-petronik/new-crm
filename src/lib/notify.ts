import { excerpt } from "./collab";
import type { Database } from "./d1";
import type { Actor, RecordItem } from "./domain";
import { afterResponse, publish } from "./collab-realtime";
import { authorised, recordChangeDrafts, type NotificationDraft } from "./notification-rules";
import { activePeople, createNotifications, readConversation, resolveApproval } from "./notification-store";

/**
 * The one entry point API routes use to raise notifications. Everything runs
 * after the response (see afterResponse) and is best effort: the business
 * change has already been committed and is never affected by a failure here.
 */

/** A record was created or changed through the records API. */
export function notifyRecordChange(
  db: Database,
  change: { actor: Actor; before?: RecordItem; after: RecordItem; version: number; created?: RecordItem[] },
) {
  return afterResponse("record", async () => {
    const people = await activePeople(db);
    const drafts = recordChangeDrafts({ ...change, people });
    const records = new Map([change.after, ...(change.created ?? [])].map((r) => [r.id, r]));
    await createNotifications(db, authorised(drafts, people, records), publish, new Map([[change.actor.id, change.actor.name]]));
    // A decided approval needs nobody else: clear it from every approver.
    const decided =
      change.before?.status === "Pending Approval" && change.after.status !== "Pending Approval";
    if (decided)
      for (const [recipient, ids] of await resolveApproval(db, change.after.id))
        await publish([recipient], { type: "notification.read", conversationId: "", ids, read: true });
  });
}

/**
 * A chat message: notifies only a direct-message recipient, people
 * @mentioned, and the author of the message replied to. Ordinary room
 * traffic raises no notification — the Collaboration badge covers it.
 * `audience` is who may read the conversation right now; nobody else is
 * ever notified.
 */
export function notifyMessage(
  db: Database,
  message: {
    id: string;
    conversationId: string;
    body: string;
    hasFiles: boolean;
    author: Actor;
    direct: boolean;
    roomName: string | null;
    mentionIds: string[];
    replyToAuthorId: string | null;
    audience: string[];
  },
) {
  return afterResponse("message", async () => {
    const m = message;
    const text = excerpt(m.body, 140) || (m.hasFiles ? "Sent an attachment" : "");
    const where = m.direct ? "" : m.roomName ? ` in ${m.roomName}` : "";
    const drafts: NotificationDraft[] = [];
    for (const recipient of m.audience) {
      if (recipient === m.author.id) continue;
      const kind = m.mentionIds.includes(recipient)
        ? "chat.mention"
        : m.replyToAuthorId === recipient
          ? "chat.reply"
          : m.direct
            ? "chat.direct"
            : null;
      if (!kind) continue;
      drafts.push({
        recipientId: recipient,
        actorId: m.author.id,
        type: kind,
        category: "collaboration",
        title:
          kind === "chat.mention"
            ? `${m.author.name} mentioned you${where}`
            : kind === "chat.reply"
              ? `${m.author.name} replied to you${where}`
              : m.author.name,
        body: text,
        entityType: "conversation",
        entityId: m.conversationId,
        conversationId: m.conversationId,
        messageId: m.id,
        priority: kind === "chat.mention" ? "important" : "normal",
        // One per message per person, whichever reason applies first.
        dedupeKey: `chat:${m.id}`,
      });
    }
    await createNotifications(db, drafts, publish, new Map([[m.author.id, m.author.name]]));
  });
}

/** The reader caught up in a conversation: its chat notifications are read. */
export function notifyConversationRead(db: Database, userId: string, conversationId: string, upTo: string) {
  return afterResponse("conversation-read", async () => {
    const ids = await readConversation(db, userId, conversationId, upTo);
    if (ids.length) await publish([userId], { type: "notification.read", conversationId: "", ids, read: true });
  });
}

/**
 * Something was done to a person's own account. Always recorded — these
 * cannot be turned off — and never carries a token, link or password.
 */
export function notifyAccount(
  db: Database,
  event: { userId: string; actor: { id: string; name: string } | null; type: string; title: string; body: string; key: string },
) {
  return afterResponse("account", async () => {
    await createNotifications(
      db,
      [
        {
          recipientId: event.userId,
          actorId: event.actor?.id ?? null,
          type: event.type,
          category: "security",
          title: event.title,
          body: event.body,
          entityType: "account",
          entityId: event.userId,
          priority: "important",
          dedupeKey: event.key,
        },
      ],
      publish,
      event.actor ? new Map([[event.actor.id, event.actor.name]]) : undefined,
    );
  });
}
