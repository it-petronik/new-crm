import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { MeetingRow } from "../src/lib/schema";
import { insertMeeting } from "../src/lib/meeting-data";
import { guestRecentCount, listMeetingMessages, postMeetingMessage, toView } from "../src/lib/meeting-chat";
import { admittedGuest } from "../src/lib/meeting-guest-chat";
import { hashToken, randomToken } from "../src/lib/meeting-guests";
import { CollabError } from "../src/lib/collab-access";
import { d1, migratedDatabase } from "./support/sqlite-d1";

/**
 * Meeting chat on SQLite built from the real migrations (0000–0009) through
 * the real Drizzle D1 driver.
 */

const NOW = Date.now();

function setup() {
  const sqlite = migratedDatabase();
  for (const id of ["owner", "other"])
    sqlite.prepare(`INSERT INTO "User" VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, `${id}@x.test`, id === "owner" ? "Olive Owner" : "Otto Other", "h", "Sales Manager", '["Petronik"]', "[]", "{}", 1, NOW);
  return { sqlite, db: drizzle(d1(sqlite) as never, { schema }) as unknown as Database };
}

let n = 0;
const meeting = (extra: Partial<MeetingRow> = {}): MeetingRow => ({
  id: `chat-meeting-${String(++n).padStart(6, "0")}`,
  conversationId: null,
  createdBy: "owner",
  title: "Chat",
  kind: "instant",
  media: "video",
  status: "live",
  scheduledAt: null,
  durationMin: null,
  startedAt: new Date(NOW),
  endedAt: null,
  providerRoom: `enc-chat-${n}`,
  reminderSentAt: null,
  createdAt: new Date(NOW),
  guestAccess: "admit",
  relatedRecordId: null,
  relatedRecordKind: null,
  ...extra,
});

async function addGuest(sqlite: ReturnType<typeof setup>["sqlite"], meetingId: string, status: string, decidedAt: number | null) {
  const secret = randomToken();
  const id = `guest-${Math.random().toString(16).slice(2, 12)}`;
  sqlite.prepare(`INSERT INTO "MeetingGuestInvite" VALUES (?,?,?,?,?,?,NULL)`).run(`inv-${id}`, meetingId, await hashToken(randomToken()), "owner", NOW, null);
  sqlite.prepare(`INSERT INTO "MeetingGuest" VALUES (?,?,?,?,?,?,?,?,?)`).run(id, meetingId, `inv-${id}`, "Gina", await hashToken(secret), status, NOW - 60_000, decidedAt, null);
  return { id, secret };
}

const key = () => `k${Math.random().toString(16).slice(2, 14)}`;
const rejects = (status: number) => (e: unknown) => e instanceof CollabError && e.status === status;

test("messages: cleaned plain text, bounded, stored once per clientKey, only while live", async () => {
  const { db } = setup();
  const m = (await insertMeeting(db, meeting()))!;
  const k = key();
  const first = await postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "  Hello‮ there\r\n  ", k);
  assert.equal(first.created, true);
  assert.equal(first.row.body, "Hello there");
  // A retry lands once…
  const again = await postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "Hello there", k);
  assert.deepEqual([again.created, again.row.id], [false, first.row.id]);
  // …and someone else can't claim that key.
  await assert.rejects(() => postMeetingMessage(db, m, { userId: "other", name: "Otto Other" }, "x", k), rejects(409));
  await assert.rejects(() => postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "   ", key()), rejects(400));
  await assert.rejects(() => postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "x".repeat(4001), key()), rejects(400));
  // HTML is kept as text (it is never rendered as HTML).
  assert.equal((await postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "<b>hi</b>", key())).row.body, "<b>hi</b>");
  await assert.rejects(() => postMeetingMessage(db, { ...m, status: "ended" }, { userId: "owner", name: "Olive Owner" }, "late", key()), rejects(409));
});

test("the database insists on exactly one sender", () => {
  const { sqlite } = setup();
  sqlite.prepare(`INSERT INTO "Meeting" ("id","createdBy","title","kind","media","status","providerRoom","createdAt","guestAccess") VALUES ('m-1','owner','t','instant','video','live','enc-x',?, 'off')`).run(NOW);
  const insert = (user: string | null, guest: string | null) =>
    sqlite.prepare(`INSERT INTO "MeetingMessage" ("id","meetingId","senderUserId","senderGuestId","senderName","body","clientKey","createdAt") VALUES (?,?,?,?,?,?,?,?)`).run(`msg-${Math.random()}`, "m-1", user, guest, "n", "b", key(), NOW);
  assert.throws(() => insert(null, null), /CHECK/);
  sqlite.prepare(`INSERT INTO "MeetingGuestInvite" VALUES ('i1','m-1','h1','owner',?,NULL,NULL)`).run(NOW);
  sqlite.prepare(`INSERT INTO "MeetingGuest" VALUES ('g1','m-1','i1','G','s1','admitted',?,?,NULL)`).run(NOW, NOW);
  assert.throws(() => insert("owner", "g1"), /CHECK/);
  insert("owner", null);
  insert(null, "g1");
});

test("guests: only while admitted and live, only messages from their admission on; views never leak ids", async () => {
  const { db, sqlite } = setup();
  const m = (await insertMeeting(db, meeting()))!;
  // A message from before the guest was admitted.
  const early = await postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, "internal prep", key());
  sqlite.prepare(`UPDATE "MeetingMessage" SET "createdAt" = ? WHERE "id" = ?`).run(NOW - 30_000, early.row.id);
  const admitted = await addGuest(sqlite, m.id, "admitted", NOW - 10_000);
  const found = (await admittedGuest(db, admitted.secret))!;
  assert.equal(found.guest.id, admitted.id);
  await postMeetingMessage(db, m, { guestId: found.guest.id, name: found.guest.name }, "Hi", key());
  const seen = await listMeetingMessages(db, m.id, { since: found.guest.decidedAt });
  assert.deepEqual(seen.map((r) => r.body), ["Hi"]); // not the earlier one
  const view = toView(seen[0], { guestId: found.guest.id });
  assert.ok(view.seq > 0);
  assert.deepEqual({ ...view, id: "", createdAt: "", seq: 0 }, { id: "", createdAt: "", seq: 0, sender: { name: "Gina", guest: true }, mine: true, body: "Hi", deleted: false });
  assert.doesNotMatch(JSON.stringify(view), /owner|guest-|meetingId/);
  assert.equal(await guestRecentCount(db, found.guest.id), 1);

  for (const status of ["waiting", "declined", "left"]) assert.equal(await admittedGuest(db, (await addGuest(sqlite, m.id, status, NOW)).secret), null, status);
  assert.equal(await admittedGuest(db, "not-a-secret"), null);
  assert.equal(await admittedGuest(db, randomToken()), null);
  // The meeting ends: nothing for guests any more.
  sqlite.prepare(`UPDATE "Meeting" SET "status" = 'ended' WHERE "id" = ?`).run(m.id);
  assert.equal(await admittedGuest(db, admitted.secret), null);
  // Employees can still read it afterwards (the route checks their access).
  assert.equal((await listMeetingMessages(db, m.id)).length, 2);
});

test("paging: after an id, oldest first", async () => {
  const { db } = setup();
  const m = (await insertMeeting(db, meeting()))!;
  const seqs: number[] = [];
  // Same millisecond, random id suffixes: order must still be commit order.
  for (const body of ["one", "two", "three"]) seqs.push((await postMeetingMessage(db, m, { userId: "owner", name: "Olive Owner" }, body, key())).row.seq);
  assert.deepEqual((await listMeetingMessages(db, m.id)).map((r) => r.body), ["one", "two", "three"]);
  assert.deepEqual((await listMeetingMessages(db, m.id, { after: seqs[0] })).map((r) => r.body), ["two", "three"]);
  assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2]);
});
