import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { Actor } from "../src/lib/domain";
import type { MeetingRow } from "../src/lib/schema";
import {
  findMeeting,
  goLive,
  inMeeting,
  insertMeeting,
  liveMeeting,
  openSession,
  closeSession,
} from "../src/lib/meeting-data";
import { endMeeting, evictFromMeetings, requireMeeting } from "../src/lib/meeting-service";
import { runMeetingSweep } from "../src/realtime/meeting-sweep";
import { CollabError } from "../src/lib/collab-access";
import { d1, migratedDatabase } from "./support/sqlite-d1";

/**
 * Meetings against SQLite built from the real migrations (0000–0006),
 * through the real Drizzle D1 driver: the one-live-meeting guard under
 * concurrency, access (organiser, member, outsider, removed, inactive,
 * other company or branch), attendance, ending, eviction, reminders and
 * cleanup. The provider is absent here, so nothing reaches LiveKit.
 */

const NOW = Date.now();
type U = { id: string; role?: string; companies?: string[]; branches?: string[]; active?: boolean };

function setup(users: U[]) {
  const sqlite = migratedDatabase();
  for (const u of users)
    sqlite
      .prepare(`INSERT INTO "User" VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(u.id, `${u.id}@x.test`, u.id, "h", u.role ?? "Sales Manager", JSON.stringify(u.companies ?? ["Petronik"]), JSON.stringify(u.branches ?? []), "{}", u.active === false ? 0 : 1, NOW);
  const binding = d1(sqlite);
  const db = drizzle(binding as never, { schema }) as unknown as Database;
  const room = (id: string, members: [string, string][], branch: string | null = null) => {
    sqlite
      .prepare(`INSERT INTO "Conversation" ("id","kind","name","visibility","company","branch","createdBy","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, "room", "Ops", "private", "Petronik", branch, members[0][0], NOW, NOW);
    for (const [user, role] of members) sqlite.prepare(`INSERT INTO "ConversationMember" VALUES (?,?,?,?,NULL)`).run(id, user, role, NOW);
  };
  return { sqlite, binding, db, room };
}

let seq = 0;
const meeting = (conversationId: string, extra: Partial<MeetingRow> = {}): MeetingRow => ({
  id: `meeting-${String(++seq).padStart(8, "0")}`,
  conversationId,
  createdBy: "owner",
  title: "Standup",
  kind: "instant",
  media: "video",
  status: "live",
  scheduledAt: null,
  durationMin: null,
  startedAt: new Date(NOW),
  endedAt: null,
  providerRoom: `enc-${seq}-${Math.random().toString(16).slice(2)}`,
  reminderSentAt: null,
  createdAt: new Date(NOW),
  guestAccess: "off",
  relatedRecordId: null,
  relatedRecordKind: null,
  ...extra,
});
const actor = (id: string, extra: Partial<Actor> = {}): Actor => ({ id, name: id, role: "Sales Manager", companies: ["Petronik"], branches: [], ...extra });

test("repeated and concurrent Start resolve to ONE live meeting per conversation", async () => {
  const { db, room } = setup([{ id: "owner" }, { id: "member" }]);
  room("room-00001", [["owner", "owner"], ["member", "member"]]);
  const first = await insertMeeting(db, meeting("room-00001"));
  assert.ok(first);
  // Pressing Start again: the database refuses a second live meeting.
  assert.equal(await insertMeeting(db, meeting("room-00001")), null);
  assert.equal((await liveMeeting(db, "room-00001"))?.id, first!.id);

  // Ten people pressing Start at the same moment in another room.
  room("room-00002", [["owner", "owner"]]);
  const results = await Promise.all(Array.from({ length: 10 }, () => insertMeeting(db, meeting("room-00002"))));
  assert.equal(results.filter(Boolean).length, 1);
  // Scheduled meetings are not limited: many may be planned.
  for (let i = 0; i < 3; i++)
    assert.ok(await insertMeeting(db, meeting("room-00002", { kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW + (i + 1) * 3_600_000) })));
});

test("a scheduled meeting goes live once; never beside another live one", async () => {
  const { db, room } = setup([{ id: "owner" }]);
  room("room-00003", [["owner", "owner"]]);
  const planned = (await insertMeeting(db, meeting("room-00003", { kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW) })))!;
  const [a, b] = await Promise.all([goLive(db, planned.id), goLive(db, planned.id)]);
  assert.equal([a?.started, b?.started].filter(Boolean).length, 1);
  assert.equal((await findMeeting(db, planned.id))?.status, "live");
  const other = (await insertMeeting(db, meeting("room-00003", { kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW) })))!;
  assert.equal(await goLive(db, other.id), null);
});

test("meeting access is exactly the conversation's: members yes, everyone else an identical 404", async () => {
  const { db, sqlite, room } = setup([
    { id: "owner" },
    { id: "member" },
    { id: "outsider" },
    { id: "inactive", active: false },
    { id: "abroad", companies: ["Afrilube"] },
    { id: "dubai", branches: ["Dubai"] },
  ]);
  room("room-00004", [["owner", "owner"], ["member", "member"], ["inactive", "member"], ["abroad", "member"], ["dubai", "member"]], "Main");
  const m = (await insertMeeting(db, meeting("room-00004", { createdBy: "member" })))!;

  const ok = await requireMeeting(db, actor("member"), m.id);
  assert.equal(ok.canManage, true); // organiser
  assert.equal((await requireMeeting(db, actor("owner"), m.id)).canManage, true); // room owner
  sqlite.prepare(`INSERT INTO "User" VALUES ('plain','p@x.test','plain','h','Sales Manager','["Petronik"]','[]','{}',1,?)`).run(NOW);
  sqlite.prepare(`INSERT INTO "ConversationMember" VALUES ('room-00004','plain','member',?,NULL)`).run(NOW);
  assert.equal((await requireMeeting(db, actor("plain"), m.id)).canManage, false);

  const refused = async (who: Actor, id: string = m.id) => {
    await assert.rejects(() => requireMeeting(db, who, id), (e: unknown) => e instanceof CollabError && e.status === 404 && e.message === "Meeting not found.");
  };
  await refused(actor("outsider"));
  await refused(actor("abroad", { companies: ["Afrilube"] }));
  await refused(actor("dubai", { branches: ["Dubai"] }));
  await refused(actor("member"), "not-a-meeting-id-000");
  await refused(actor("member"), "../../etc");
  // Removed from the room: refused at once.
  sqlite.prepare(`DELETE FROM "ConversationMember" WHERE "userId" = 'member'`).run();
  await refused(actor("member"));
});

test("attendance, In a meeting, ending and the guard freeing up", async () => {
  const { db, room } = setup([{ id: "owner" }, { id: "member" }]);
  room("room-00005", [["owner", "owner"], ["member", "member"]]);
  const m = (await insertMeeting(db, meeting("room-00005")))!;
  await openSession(db, { meetingId: m.id, identity: "owner", userId: "owner", guestName: null, at: new Date() });
  await openSession(db, { meetingId: m.id, identity: "member", userId: "member", guestName: null, at: new Date() });
  assert.deepEqual([...(await inMeeting(db, ["owner", "member", "nobody"]))].sort(), ["member", "owner"]);
  await closeSession(db, m.id, "member");
  assert.deepEqual([...(await inMeeting(db, ["owner", "member"]))], ["owner"]);
  // Rejoining clears the leave.
  await openSession(db, { meetingId: m.id, identity: "member", userId: "member", guestName: null, at: new Date() });
  assert.equal((await inMeeting(db, ["member"])).size, 1);

  const ended = await endMeeting(db, m.id);
  assert.equal(ended?.status, "ended");
  assert.equal((await inMeeting(db, ["owner", "member"])).size, 0);
  // Ending twice changes nothing; a new meeting may now start.
  assert.equal((await endMeeting(db, m.id))?.status, "ended");
  assert.ok(await insertMeeting(db, meeting("room-00005")));
});

test("losing access disconnects from the conversation's live meeting", async () => {
  const { db, sqlite, room } = setup([{ id: "owner" }, { id: "member" }, { id: "other" }]);
  room("room-00006", [["owner", "owner"], ["member", "member"], ["other", "member"]]);
  const m = (await insertMeeting(db, meeting("room-00006")))!;
  for (const u of ["member", "other"]) await openSession(db, { meetingId: m.id, identity: u, userId: u, guestName: null, at: new Date() });
  // Still a member: nothing happens.
  await evictFromMeetings(db, "other");
  assert.equal((await inMeeting(db, ["other"])).size, 1);
  // Removed from the room: out.
  sqlite.prepare(`DELETE FROM "ConversationMember" WHERE "userId" = 'member'`).run();
  await evictFromMeetings(db, "member", "room-00006");
  assert.equal((await inMeeting(db, ["member"])).size, 0);
  // Deactivated: out, wherever they were.
  sqlite.prepare(`UPDATE "User" SET "active" = 0 WHERE "id" = 'other'`).run();
  await evictFromMeetings(db, "other");
  assert.equal((await inMeeting(db, ["other"])).size, 0);
});

test("the sweep: one reminder 10 minutes before, idle meetings closed, 12-hour limit", async () => {
  const { binding, db, room } = setup([{ id: "owner" }, { id: "member" }]);
  room("room-00007", [["owner", "owner"], ["member", "member"]]);
  room("room-00008", [["owner", "owner"]]);
  room("room-00009", [["owner", "owner"]]);
  room("room-00010", [["owner", "owner"]]);
  const soon = (await insertMeeting(db, meeting("room-00007", { kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW + 8 * 60_000) })))!;
  const later = (await insertMeeting(db, meeting("room-00007", { kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW + 3 * 3_600_000) })))!;
  // Everyone left 15 minutes ago.
  const idle = (await insertMeeting(db, meeting("room-00008", { startedAt: new Date(NOW - 60 * 60_000) })))!;
  await openSession(db, { meetingId: idle.id, identity: "owner", userId: "owner", guestName: null, at: new Date(NOW - 50 * 60_000) });
  await closeSession(db, idle.id, "owner", new Date(NOW - 15 * 60_000));
  // Still in use.
  const busy = (await insertMeeting(db, meeting("room-00009", { startedAt: new Date(NOW - 60 * 60_000) })))!;
  await openSession(db, { meetingId: busy.id, identity: "owner", userId: "owner", guestName: null, at: new Date(NOW - 50 * 60_000) });
  // Thirteen hours old, someone still connected: closed anyway.
  const marathon = (await insertMeeting(db, meeting("room-00010", { startedAt: new Date(NOW - 13 * 3_600_000) })))!;
  await openSession(db, { meetingId: marathon.id, identity: "owner", userId: "owner", guestName: null, at: new Date(NOW - 13 * 3_600_000) });

  const delivered: { to: string; type: string }[] = [];
  const hub = {
    idFromName: (n: string) => n,
    get: (to: unknown) => ({
      fetch: async (_: string, init?: RequestInit) => {
        delivered.push({ to: String(to), type: JSON.parse(String(init?.body)).type });
        return new Response(null, { status: 204 });
      },
    }),
  };
  const env = { DB: binding as never, COLLAB_HUB: hub, APP_MODE: "production" };
  const first = await runMeetingSweep(env, NOW);
  assert.deepEqual(first, { reminded: 2, closed: 2, missed: 0 });
  assert.ok((await findMeeting(db, soon.id))?.reminderSentAt);
  assert.equal((await findMeeting(db, later.id))?.reminderSentAt, null);
  assert.equal((await findMeeting(db, idle.id))?.status, "ended");
  assert.equal((await findMeeting(db, busy.id))?.status, "live");
  assert.equal((await findMeeting(db, marathon.id))?.status, "ended");
  assert.ok(delivered.some((d) => d.type === "notification.created" && d.to === "member"));
  assert.ok(delivered.some((d) => d.type === "meeting.ended"));
  // Nothing twice.
  assert.deepEqual(await runMeetingSweep(env, NOW + 60_000), { reminded: 0, closed: 0, missed: 0 });
  // Preview never runs it.
  assert.deepEqual(await runMeetingSweep({ ...env, APP_MODE: "preview" }, NOW), { reminded: 0, closed: 0, missed: 0 });
});
