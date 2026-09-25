import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import type { CollabEvent } from "../src/lib/collab";
import {
  createNotifications,
  inbox,
  readAll,
  readConversation,
  resolveApproval,
  setRead,
  unreadCount,
  type Deliver,
} from "../src/lib/notification-store";
import type { NotificationDraft } from "../src/lib/notification-rules";
import { notifyMessage } from "../src/lib/notify";
import { runReminders } from "../src/realtime/reminders";
import { d1, migratedDatabase } from "./support/sqlite-d1";

/**
 * Notification persistence, delivery and re-authorisation, against SQLite
 * built from the real migrations (0000–0005) through the real Drizzle D1
 * driver. Realtime delivery is a recorder standing in for the hubs.
 */

const now = Date.now();
type Row = { id: string; role: string; companies?: string[]; branches?: string[] };

function setup(users: Row[]) {
  const sqlite = migratedDatabase();
  for (const u of users)
    sqlite
      .prepare(`INSERT INTO "User" VALUES (?,?,?,?,?,?,?,?,1,?)`)
      .run(u.id, `${u.id}@x.test`, u.id, "h", u.role, JSON.stringify(u.companies ?? ["Petronik"]), JSON.stringify(u.branches ?? []), "{}", now);
  const binding = d1(sqlite);
  const db = drizzle(binding as never, { schema }) as unknown as Database;
  const sent: { to: string; event: CollabEvent }[] = [];
  const deliver: Deliver = async (ids, event) => {
    for (const to of ids) sent.push({ to, event });
  };
  return { sqlite, binding, db, sent, deliver };
}

const actorOf = (id: string, role: Actor["role"], companies = ["Petronik"]): Actor => ({ id, name: id, role, companies, branches: [] });

const draft = (recipientId: string, extra: Partial<NotificationDraft> = {}): NotificationDraft => ({
  recipientId,
  actorId: "boss",
  type: "record.assigned",
  category: "assignment",
  title: "New lead assigned to you",
  body: "ABC Trading · Base Oil SN500",
  entityType: "leads",
  entityId: "LEAD-1",
  priority: "normal",
  dedupeKey: `assigned:LEAD-1:${recipientId}:2`,
  ...extra,
});

function insertRecord(sqlite: DatabaseSync, r: RecordItem) {
  sqlite
    .prepare(`INSERT INTO "BusinessRecord" VALUES (?,?,?,?,?,?,?,1,?,?)`)
    .run(r.id, r.kind, r.company, r.branch, r.ownerId, r.status, JSON.stringify(r), now, now);
}
const lead = (id: string, ownerId: string, extra: Partial<RecordItem> = {}): RecordItem => ({
  id, kind: "leads", company: "Petronik", branch: "Main", title: "ABC Trading", contact: "", product: "Base Oil SN500",
  quantity: 1, unit: "MT", amount: 1, currency: "USD", status: "New", ownerId, owner: ownerId, due: "2026-09-25",
  detail: "", source: "", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), ...extra,
});

test("a notification is stored and delivered once, however often it is raised", async () => {
  const { db, sent, deliver } = setup([{ id: "boss", role: "Sales Manager" }, { id: "edwin", role: "Sales Executive" }]);
  assert.equal(await createNotifications(db, [draft("edwin")], deliver), 1);
  assert.equal(await createNotifications(db, [draft("edwin")], deliver), 0);
  assert.equal(await createNotifications(db, [draft("edwin"), draft("edwin")], deliver), 0);
  assert.equal(sent.length, 1);
  const event = sent[0].event as Extract<CollabEvent, { type: "notification.created" }>;
  assert.equal(sent[0].to, "edwin");
  assert.equal(event.type, "notification.created");
  assert.equal(event.notification.actor?.name, "boss");
  assert.deepEqual(event.notification.target, { kind: "record", recordKind: "leads", recordId: "LEAD-1" });
  assert.equal(await unreadCount(db, "edwin"), 1);
});

test("the inbox holds only the reader's own notifications; read, unread and read-all work", async () => {
  const { db, sqlite, deliver } = setup([
    { id: "boss", role: "Sales Manager" },
    { id: "edwin", role: "Sales Executive" },
    { id: "eric", role: "Sales Executive" },
  ]);
  insertRecord(sqlite, lead("LEAD-1", "edwin"));
  insertRecord(sqlite, lead("LEAD-2", "eric"));
  await createNotifications(db, [draft("edwin"), draft("eric", { entityId: "LEAD-2", dedupeKey: "k-eric" })], deliver);
  await createNotifications(db, [draft("edwin", { dedupeKey: "second", type: "lead.status", title: "Lead marked Won" })], deliver);

  const edwin = actorOf("edwin", "Sales Executive");
  const box = await inbox(db, edwin);
  assert.equal(box.items.length, 2);
  assert.equal(box.unread, 2);
  assert.ok(box.items.every((n) => n.target?.kind === "record" && n.target.recordId === "LEAD-1"));
  // Newest first.
  assert.equal(box.items[0].title, "Lead marked Won");

  // Another person's id changes nothing for them.
  const ericItem = (await inbox(db, actorOf("eric", "Sales Executive"))).items[0];
  assert.deepEqual(await setRead(db, "edwin", [ericItem.id], true), []);
  assert.equal(await unreadCount(db, "eric"), 1);

  const [first] = box.items;
  assert.deepEqual(await setRead(db, "edwin", [first.id], true), [first.id]);
  assert.deepEqual(await setRead(db, "edwin", [first.id], true), []);
  assert.equal(await unreadCount(db, "edwin"), 1);
  assert.deepEqual(await setRead(db, "edwin", [first.id], false), [first.id]);
  assert.equal(await unreadCount(db, "edwin"), 2);

  await readAll(db, "edwin", first.id);
  assert.equal(await unreadCount(db, "edwin"), 0);
  assert.equal(await unreadCount(db, "eric"), 1);
  const after = await inbox(db, edwin);
  assert.ok(after.items.every((n) => n.readAt && !n.needsAction));
});

test("losing access strips a notification's details and destination", async () => {
  const { db, sqlite, deliver } = setup([{ id: "boss", role: "Sales Manager" }, { id: "edwin", role: "Sales Executive" }]);
  insertRecord(sqlite, lead("LEAD-1", "edwin"));
  await createNotifications(db, [draft("edwin")], deliver);
  const edwin = actorOf("edwin", "Sales Executive");
  assert.equal((await inbox(db, edwin)).items[0].body, "ABC Trading · Base Oil SN500");

  // Reassigned away from an executive: they can no longer read it.
  const moved = lead("LEAD-1", "eric");
  sqlite.prepare(`UPDATE "BusinessRecord" SET "payload" = ?, "ownerId" = 'eric'`).run(JSON.stringify(moved));
  const [hidden] = (await inbox(db, edwin)).items;
  assert.equal(hidden.body, "No longer available to you.");
  assert.equal(hidden.target, null);
  assert.equal(hidden.needsAction, false);

  // Moved to another company: the same, even for a manager.
  const boss = actorOf("boss", "Sales Manager", ["Afrilube"]);
  await createNotifications(db, [draft("boss", { dedupeKey: "boss-1" })], deliver);
  assert.equal((await inbox(db, boss)).items[0].target, null);
  // A deleted record, likewise.
  sqlite.prepare(`UPDATE "BusinessRecord" SET "payload" = ?`).run(JSON.stringify({ ...lead("LEAD-1", "boss"), deletedAt: "x" }));
  assert.equal((await inbox(db, actorOf("boss", "Sales Manager"))).items[0].target, null);
});

test("a decided approval is cleared for every approver", async () => {
  const { db, deliver } = setup([
    { id: "a1", role: "Sales Manager" },
    { id: "a2", role: "Sales Manager" },
  ]);
  const ask = (to: string) => draft(to, { type: "approval.requested", category: "approval", entityType: "quotations", entityId: "Q-1", dedupeKey: "approval:Q-1:2" });
  await createNotifications(db, [ask("a1"), ask("a2")], deliver);
  const cleared = await resolveApproval(db, "Q-1");
  assert.deepEqual([...cleared.keys()].sort(), ["a1", "a2"]);
  assert.equal(await unreadCount(db, "a1"), 0);
  assert.equal(await unreadCount(db, "a2"), 0);
});

/* --------------------------------------------------------- collaboration */

function chatSetup() {
  const s = setup([
    { id: "leila", role: "Sales Manager" },
    { id: "omar", role: "Sales Manager" },
    { id: "sara", role: "Sales Manager" },
  ]);
  for (const [id, kind, name] of [["dm-000001", "direct", null], ["room-00001", "room", "Ops"]] as const)
    s.sqlite
      .prepare(`INSERT INTO "Conversation" ("id","kind","name","visibility","company","createdBy","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, kind, name, "private", "Petronik", "leila", now, now);
  for (const [c, u] of [["dm-000001", "leila"], ["dm-000001", "omar"], ["room-00001", "leila"], ["room-00001", "omar"], ["room-00001", "sara"]])
    s.sqlite.prepare(`INSERT INTO "ConversationMember" VALUES (?,?,?,?,NULL)`).run(c, u, "member", now);
  return s;
}
let seq = 0;
const message = (conversationId: string, extra: Partial<Parameters<typeof notifyMessage>[1]> = {}) => ({
  id: `msg-${String(++seq).padStart(6, "0")}`,
  conversationId,
  body: "Please check the shipment",
  hasFiles: false,
  author: actorOf("leila", "Sales Manager"),
  direct: false,
  roomName: "Ops",
  mentionIds: [],
  replyToAuthorId: null,
  audience: ["leila", "omar", "sara"],
  ...extra,
});

test("DMs, mentions and replies notify; ordinary room messages do not", async () => {
  const { db, sqlite } = chatSetup();
  const count = () => Number((sqlite.prepare(`SELECT count(*) AS n FROM "Notification"`).get() as { n: number }).n);

  await notifyMessage(db, message("room-00001"));
  assert.equal(count(), 0);

  await notifyMessage(db, message("dm-000001", { direct: true, roomName: null, audience: ["leila", "omar"] }));
  const dm = (await inbox(db, actorOf("omar", "Sales Manager"))).items[0];
  assert.equal(dm.type, "chat.direct");
  assert.equal(dm.title, "leila");
  assert.deepEqual(dm.target, { kind: "conversation", conversationId: "dm-000001", messageId: `msg-${String(seq).padStart(6, "0")}` });

  await notifyMessage(db, message("room-00001", { mentionIds: ["sara"], replyToAuthorId: "omar" }));
  const sara = (await inbox(db, actorOf("sara", "Sales Manager"))).items[0];
  assert.equal(sara.type, "chat.mention");
  assert.equal(sara.title, "leila mentioned you in Ops");
  assert.equal(sara.priority, "important");
  const omar = (await inbox(db, actorOf("omar", "Sales Manager"))).items[0];
  assert.equal(omar.type, "chat.reply");
  assert.equal(omar.title, "leila replied to you in Ops");
  // Never the author; never anyone outside the audience.
  await notifyMessage(db, message("room-00001", { mentionIds: ["leila", "stranger"], audience: ["leila", "omar"] }));
  assert.equal((await inbox(db, actorOf("leila", "Sales Manager"))).items.length, 0);
  assert.equal(count(), 3);
});

test("reading a conversation clears its chat notifications up to that message only", async () => {
  const { db } = chatSetup();
  const first = message("dm-000001", { direct: true, roomName: null, audience: ["leila", "omar"] });
  const second = message("dm-000001", { direct: true, roomName: null, audience: ["leila", "omar"] });
  await notifyMessage(db, first);
  await notifyMessage(db, second);
  await notifyMessage(db, message("room-00001", { mentionIds: ["omar"] }));
  assert.equal(await unreadCount(db, "omar"), 3);
  assert.equal((await readConversation(db, "omar", "dm-000001", first.id)).length, 1);
  assert.equal(await unreadCount(db, "omar"), 2);
  assert.equal((await readConversation(db, "omar", "dm-000001", second.id)).length, 1);
  // The mention in the room is untouched.
  assert.equal(await unreadCount(db, "omar"), 1);
});

test("a deleted message's notification keeps no text", async () => {
  const { db, sqlite } = chatSetup();
  const m = message("dm-000001", { direct: true, roomName: null, audience: ["leila", "omar"] });
  sqlite.prepare(`INSERT INTO "Message" ("id","conversationId","authorId","body","createdAt","deletedAt") VALUES (?,?,?,?,?,?)`).run(m.id, m.conversationId, "leila", "", now, now);
  await notifyMessage(db, m);
  assert.equal((await inbox(db, actorOf("omar", "Sales Manager"))).items[0].body, "Message deleted");
  // And a conversation the reader has left is hidden entirely.
  sqlite.prepare(`DELETE FROM "ConversationMember" WHERE "userId" = 'omar'`).run();
  assert.equal((await inbox(db, actorOf("omar", "Sales Manager"))).items[0].target, null);
});

/* ------------------------------------------------------------- reminders */

test("scheduled reminders use the Gulf business date and never repeat", async () => {
  const { binding, sqlite, db } = setup([
    { id: "edwin", role: "Sales Executive" },
    { id: "acct", role: "Accounts Manager" },
  ]);
  // 21:30 UTC on 24 Sep is 01:30 on 25 Sep in Dubai: "today" is the 25th.
  const at = new Date("2026-09-24T21:30:00Z");
  insertRecord(sqlite, lead("L-TODAY", "edwin", { due: "2026-09-25" }));
  insertRecord(sqlite, lead("L-LATE", "edwin", { due: "2026-09-20" }));
  insertRecord(sqlite, lead("L-WON", "edwin", { due: "2026-09-20", status: "Won" }));
  insertRecord(sqlite, { ...lead("INV-1", "edwin", { due: "2026-09-10", status: "Sent" }), kind: "accounts" });
  const delivered: string[] = [];
  const hub = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: async () => {
        delivered.push(String(id));
        return new Response(null, { status: 204 });
      },
    }),
  };
  const env = { DB: binding as never, COLLAB_HUB: hub, APP_MODE: "production" };
  const created = await runReminders(env, at);
  const titles = (await inbox(db, actorOf("edwin", "Sales Executive"))).items.map((n) => n.title).sort();
  assert.deepEqual(titles, ["Follow-up due today", "Follow-up overdue"]);
  // The invoice goes to Accounts: a Sales Executive may not read invoices.
  assert.deepEqual((await inbox(db, actorOf("acct", "Accounts Manager"))).items.map((n) => n.title), ["Payment overdue"]);
  assert.equal(created, 3);
  assert.equal(delivered.length, 3);
  // A second run the same day, and a retried run, add nothing.
  assert.equal(await runReminders(env, at), 0);
  assert.equal(await runReminders(env, new Date("2026-09-25T10:00:00Z")), 0);
  // Preview never runs them.
  assert.equal(await runReminders({ ...env, APP_MODE: "preview" }, at), 0);
});
