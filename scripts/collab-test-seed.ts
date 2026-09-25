/**
 * Prints SQL that seeds the LOCAL collaboration test database with fictional
 * people and one room of history. Output goes to a file that
 * collab-test-server.sh applies with `wrangler d1 execute --local`; this
 * script itself connects to nothing.
 */
import { hashPassword } from "../src/lib/password";
import { messageId } from "../src/lib/collab";
import { people, PASSWORD, PAGING_ROOM, byKey } from "../e2e/collab/people";

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function main() {
  const hash = await hashPassword(PASSWORD);
  const now = Date.now();
  const lines: string[] = [];
  for (const p of people)
    lines.push(
      `INSERT INTO "User" ("id","email","name","passwordHash","role","companies","branches","moduleAccess","active","createdAt") VALUES (` +
        [q(p.id), q(p.email), q(p.name), q(hash), q(p.role), q(JSON.stringify(p.companies)), q(JSON.stringify(p.branches)), q("{}"), 1, now].join(",") +
        `);`,
    );

  // A private room with 95 messages, a minute apart, oldest first.
  const start = now - PAGING_ROOM.count * 60_000;
  lines.push(
    `INSERT INTO "Conversation" ("id","kind","name","description","visibility","company","branch","directKey","createdBy","createdAt","updatedAt","lastMessageAt","archivedAt") VALUES (` +
      [q(PAGING_ROOM.id), q("room"), q(PAGING_ROOM.name), "NULL", q("private"), q("Petronik"), "NULL", "NULL", q(byKey(PAGING_ROOM.members[0]).id), start, now, now, "NULL"].join(",") +
      `);`,
  );
  const ids: string[] = [];
  for (let i = 0; i < PAGING_ROOM.count; i++) {
    const at = start + i * 60_000;
    const id = messageId(at);
    ids.push(id);
    const author = byKey(PAGING_ROOM.members[i % 2]).id;
    lines.push(
      `INSERT INTO "Message" ("id","conversationId","authorId","body","replyToId","clientKey","createdAt","editedAt","deletedAt") VALUES (` +
        [q(id), q(PAGING_ROOM.id), q(author), q(`History ${String(i + 1).padStart(3, "0")}`), "NULL", "NULL", at, "NULL", "NULL"].join(",") +
        `);`,
    );
  }
  // Both members start caught up, as real new members do.
  for (const [i, key] of PAGING_ROOM.members.entries())
    lines.push(
      `INSERT INTO "ConversationMember" ("conversationId","userId","role","joinedAt","lastReadMessageId") VALUES (` +
        [q(PAGING_ROOM.id), q(byKey(key).id), q(i === 0 ? "owner" : "member"), start, q(ids[ids.length - 1])].join(",") +
        `);`,
    );
  process.stdout.write(lines.join("\n") + "\n");
}

void main();
