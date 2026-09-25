import type { Database } from "./d1";
import type { Actor } from "./domain";
import type { ConversationRow } from "./schema";
import { writeAudit } from "./data";

/**
 * Room administration goes to the existing audit trail, marked
 * subject = "collaboration" so the Activity feed never shows it (a private
 * room's name is not for everyone). Ordinary chat — sending, editing,
 * deleting messages, reading — is deliberately NOT audited here.
 */
export function auditRoom(db: Database, actor: Actor, room: ConversationRow, action: string, after?: unknown) {
  return writeAudit(db, {
    id: crypto.randomUUID(),
    company: room.company,
    actor: actor.name,
    actorId: actor.id,
    action: `${action}: ${room.name ?? "room"}`,
    recordId: room.id,
    after,
    subject: "collaboration",
    branch: room.branch,
  });
}
