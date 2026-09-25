import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import type { MeetingRow } from "../src/lib/schema";
import {
  closeSession,
  insertMeeting,
  meetingViews,
  openSession,
  revokeGuestInvites,
  setInvitees,
  visibleMeetings,
  inMeeting,
} from "../src/lib/meeting-data";
import { evictFromMeetings, requireMeeting } from "../src/lib/meeting-service";
import { resolveLink } from "../src/lib/meeting-links";
import { cleanGuestName, expiryFor, hashToken, looksLikeToken, randomToken } from "../src/lib/meeting-guests";
import { buildReport } from "../src/lib/meeting-report-data";
import { attachRelated, linkableRecord } from "../src/lib/meeting-related";
import { runMeetingSweep } from "../src/realtime/meeting-sweep";
import { CollabError } from "../src/lib/collab-access";
import { toCsv } from "../src/lib/export";
import { deviceOptions, cleanLabel } from "../src/components/meetings/device-setup";
import { d1, migratedDatabase } from "./support/sqlite-d1";

/**
 * Meetings V3.1 against SQLite built from the real migrations (0000–0007)
 * through the real Drizzle D1 driver: standalone access and eviction, guest
 * links, attendance sessions and reports, missed meetings, the CRM relation,
 * CSV safety and friendly device labels.
 */

const NOW = Date.now();
type U = { id: string; role?: string; companies?: string[]; active?: boolean };

function setup(users: U[]) {
  const sqlite = migratedDatabase();
  for (const u of users)
    sqlite
      .prepare(`INSERT INTO "User" VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(u.id, `${u.id}@x.test`, u.id, "h", u.role ?? "Sales Manager", JSON.stringify(u.companies ?? ["Petronik"]), "[]", "{}", u.active === false ? 0 : 1, NOW);
  const binding = d1(sqlite);
  return { sqlite, binding, db: drizzle(binding as never, { schema }) as unknown as Database };
}
const actor = (id: string, extra: Partial<Actor> = {}): Actor => ({ id, name: id, role: "Sales Manager", companies: ["Petronik"], branches: [], ...extra });

let seq = 0;
const standalone = (extra: Partial<MeetingRow> = {}): MeetingRow => ({
  id: `standalone-${String(++seq).padStart(6, "0")}`,
  conversationId: null,
  createdBy: "owner",
  title: "Product meeting",
  kind: "instant",
  media: "video",
  status: "live",
  scheduledAt: null,
  durationMin: null,
  startedAt: new Date(NOW - 60 * 60_000),
  endedAt: null,
  providerRoom: `enc-${seq}-${Math.random().toString(16).slice(2)}`,
  reminderSentAt: null,
  createdAt: new Date(NOW - 60 * 60_000),
  guestAccess: "off",
  relatedRecordId: null,
  relatedRecordKind: null,
  ...extra,
});

const lead = (id: string, ownerId: string): RecordItem => ({
  id, kind: "leads", company: "Petronik", branch: "Main", title: "ABC Trading", contact: "", product: "Base Oil",
  quantity: 1, unit: "MT", amount: 1, currency: "USD", status: "New", ownerId, owner: ownerId, due: "2026-10-01",
  detail: "", source: "", createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
});
const insertRecord = (sqlite: DatabaseSync, r: RecordItem) =>
  sqlite.prepare(`INSERT INTO "BusinessRecord" VALUES (?,?,?,?,?,?,?,1,?,?)`).run(r.id, r.kind, r.company, r.branch, r.ownerId, r.status, JSON.stringify(r), NOW, NOW);

const notFound = (e: unknown) => e instanceof CollabError && e.status === 404;

/* ------------------------------------------------------------- standalone */

test("standalone meetings: organiser and invitees only; removing an invitee disconnects them", async () => {
  const { db } = setup([{ id: "owner" }, { id: "invitee" }, { id: "colleague" }]);
  const m = (await insertMeeting(db, standalone()))!;
  await setInvitees(db, m.id, ["invitee"], "owner");
  assert.equal((await requireMeeting(db, actor("owner"), m.id)).canManage, true);
  assert.equal((await requireMeeting(db, actor("invitee"), m.id)).canManage, false);
  await assert.rejects(() => requireMeeting(db, actor("colleague"), m.id), notFound);
  // It appears at once in the invitee's meetings, and nowhere else.
  assert.ok((await visibleMeetings(db, actor("invitee"))).some((r) => r.id === m.id));
  assert.ok(!(await visibleMeetings(db, actor("colleague"))).some((r) => r.id === m.id));

  await openSession(db, { meetingId: m.id, identity: "invitee", userId: "invitee", guestName: null, at: new Date() });
  assert.equal((await inMeeting(db, ["invitee"])).size, 1);
  const { removed } = await setInvitees(db, m.id, [], "owner");
  assert.deepEqual(removed, ["invitee"]);
  await evictFromMeetings(db, "invitee", undefined, m.id);
  assert.equal((await inMeeting(db, ["invitee"])).size, 0);
  await assert.rejects(() => requireMeeting(db, actor("invitee"), m.id), notFound);
  // Standalone meetings are each their own session: two live at once is fine.
  assert.ok(await insertMeeting(db, standalone()));
});

/* ------------------------------------------------------------ guest links */

async function addLink(sqlite: DatabaseSync, meetingId: string, expiresAt: number | null) {
  const token = randomToken();
  sqlite
    .prepare(`INSERT INTO "MeetingGuestInvite" VALUES (?,?,?,?,?,?,NULL)`)
    .run(`invite-${Math.random().toString(16).slice(2, 12)}`, meetingId, await hashToken(token), "owner", NOW, expiresAt);
  return token;
}

test("guest links: 256-bit tokens stored only as hashes; expiry, revocation, regeneration and ending all close them", async () => {
  const { db, sqlite } = setup([{ id: "owner" }]);
  const m = (await insertMeeting(db, standalone({ guestAccess: "admit" })))!;
  const token = await addLink(sqlite, m.id, null);
  assert.ok(looksLikeToken(token));
  assert.equal(token.length, 43);
  // Only the hash is stored: the raw token appears nowhere in the database.
  const dump = JSON.stringify(sqlite.prepare(`SELECT * FROM "MeetingGuestInvite"`).all());
  assert.ok(!dump.includes(token));
  assert.ok(dump.includes(await hashToken(token)));

  assert.equal((await resolveLink(db, token))?.meeting.id, m.id);
  assert.equal(await resolveLink(db, "not-a-token"), null);
  assert.equal(await resolveLink(db, randomToken()), null);

  // Expired.
  const soon = await addLink(sqlite, m.id, NOW + 60_000);
  assert.ok(await resolveLink(db, soon, NOW));
  assert.equal(await resolveLink(db, soon, NOW + 61_000), null);
  assert.equal(expiryFor("meeting_end"), null);
  assert.ok(Math.abs(expiryFor("1h", NOW)!.getTime() - (NOW + 3_600_000)) < 5);

  // Regenerating revokes every earlier link.
  await revokeGuestInvites(db, m.id);
  assert.equal(await resolveLink(db, token), null);
  const fresh = await addLink(sqlite, m.id, null);
  assert.ok(await resolveLink(db, fresh));

  // Guests switched off, or the meeting over: nothing works.
  sqlite.prepare(`UPDATE "Meeting" SET "guestAccess" = 'off'`).run();
  assert.equal(await resolveLink(db, fresh), null);
  sqlite.prepare(`UPDATE "Meeting" SET "guestAccess" = 'open', "status" = 'ended'`).run();
  assert.equal(await resolveLink(db, fresh), null);

  assert.equal(cleanGuestName("  Ahmed   Khan "), "Ahmed Khan");
  assert.equal(cleanGuestName("‮evil"), "evil");
  assert.equal(cleanGuestName(""), null);
  assert.equal(cleanGuestName("x".repeat(61)), null);
});

/* -------------------------------------------------- attendance and report */

test("attendance: reconnects add up, first/last are right, guests and absentees are reported", async () => {
  const { db, sqlite } = setup([{ id: "owner" }, { id: "attender" }, { id: "absent" }]);
  const start = NOW - 60 * 60_000;
  const m = (await insertMeeting(db, standalone({ startedAt: new Date(start) })))!;
  await setInvitees(db, m.id, ["attender", "absent"], "owner");
  const at = (min: number) => new Date(start + min * 60_000);
  // The attender connects twice: 0–10 min, then 20–35 min.
  await openSession(db, { meetingId: m.id, identity: "attender", userId: "attender", guestName: null, at: at(0) });
  // A duplicate "joined" for someone already connected changes nothing.
  await openSession(db, { meetingId: m.id, identity: "attender", userId: "attender", guestName: null, at: at(1) });
  await closeSession(db, m.id, "attender", at(10));
  await openSession(db, { meetingId: m.id, identity: "attender", userId: "attender", guestName: null, at: at(20) });
  await closeSession(db, m.id, "attender", at(35));
  // A guest for 5 minutes; the organiser throughout.
  await openSession(db, { meetingId: m.id, identity: "guest:g1", userId: null, guestName: "Ahmed", at: at(5) });
  await closeSession(db, m.id, "guest:g1", at(10));
  await openSession(db, { meetingId: m.id, identity: "owner", userId: "owner", guestName: null, at: at(0) });
  sqlite.prepare(`UPDATE "Meeting" SET "status" = 'ended', "endedAt" = ?`).run(start + 40 * 60_000);
  const row = { ...m, status: "ended" as const, endedAt: new Date(start + 40 * 60_000) };
  const [view] = await meetingViews(db, [row]);
  const report = await buildReport(db, row, view);

  const attender = report.participants.find((p) => p.identity === "attender")!;
  assert.equal(attender.sessions, 2);
  assert.equal(attender.totalSeconds, 25 * 60);
  assert.equal(attender.firstJoined, at(0).toISOString());
  assert.equal(attender.lastLeft, at(35).toISOString());
  const guest = report.participants.find((p) => p.kind === "guest")!;
  assert.deepEqual([guest.name, guest.totalSeconds], ["Ahmed", 5 * 60]);
  // Still connected when it ended: counted to the end.
  assert.equal(report.participants.find((p) => p.identity === "owner")!.totalSeconds, 40 * 60);
  assert.deepEqual(report.absent.map((p) => p.id), ["absent"]);
  assert.deepEqual(report.attended.sort(), ["attender", "owner"]);
  assert.ok(report.activity.some((a) => a.type === "joined" && a.actorName === "Ahmed (guest)"));
  assert.equal(view.attendeeCount, 3);
});

test("a scheduled meeting nobody started becomes 'missed' and stays in history", async () => {
  const { db, binding } = setup([{ id: "owner" }]);
  const m = (await insertMeeting(db, standalone({ kind: "scheduled", status: "scheduled", startedAt: null, scheduledAt: new Date(NOW - 3 * 60 * 60_000) })))!;
  const result = await runMeetingSweep({ DB: binding as never, APP_MODE: "production" }, NOW);
  assert.equal(result.missed, 1);
  const mine = await visibleMeetings(db, actor("owner"));
  assert.equal(mine.find((r) => r.id === m.id)?.status, "missed");
  // And only once.
  assert.equal((await runMeetingSweep({ DB: binding as never, APP_MODE: "production" }, NOW)).missed, 0);
});

/* ------------------------------------------------------------ CRM relation */

test("CRM relation: linkable only by readers; shown only to readers; grants nothing either way", async () => {
  const { db, sqlite } = setup([
    { id: "owner", role: "Sales Executive" },
    { id: "manager" },
    { id: "exec", role: "Sales Executive" },
  ]);
  insertRecord(sqlite, lead("LEAD-1", "owner"));
  // The owner (a Sales Executive) can read their lead and link it; the kind comes from the record.
  assert.deepEqual(await linkableRecord(db, actor("owner", { role: "Sales Executive" }), "LEAD-1"), { id: "LEAD-1", kind: "leads" });
  // Another executive can't read it, so can't link it.
  await assert.rejects(() => linkableRecord(db, actor("exec", { role: "Sales Executive" }), "LEAD-1"), (e: unknown) => e instanceof CollabError && e.status === 400);
  await assert.rejects(() => linkableRecord(db, actor("owner"), "NO-SUCH"), (e: unknown) => e instanceof CollabError);
  assert.equal(await linkableRecord(db, actor("owner"), null), null);

  const m = (await insertMeeting(db, standalone({ createdBy: "owner", relatedRecordId: "LEAD-1", relatedRecordKind: "leads" })))!;
  await setInvitees(db, m.id, ["exec"], "owner");
  const [view] = await meetingViews(db, [m]);
  assert.equal(view.related, null); // never in a broadcast view
  // The owner sees the lead; the invited executive sees the meeting but not the lead.
  assert.deepEqual((await attachRelated(db, actor("owner", { role: "Sales Executive" }), [view], [m]))[0].related, { id: "LEAD-1", kind: "leads", title: "ABC Trading" });
  assert.equal((await attachRelated(db, actor("exec", { role: "Sales Executive" }), [view], [m]))[0].related, null);
  // Reading the lead (a manager) does not open the private meeting.
  await assert.rejects(() => requireMeeting(db, actor("manager"), m.id), notFound);
  assert.ok(!(await visibleMeetings(db, actor("manager"))).some((r) => r.id === m.id));
});

/* ---------------------------------------------------- export and devices */

test("CSV export neutralises formulas", () => {
  const csv = toCsv([["=HYPERLINK(\"http://evil\")", "+1", "-2", "@SUM(A1)", "Plain, with comma"]]);
  assert.equal(csv, `"'=HYPERLINK(""http://evil"")",'+1,'-2,'@SUM(A1),"Plain, with comma"`);
});

test("device pickers show friendly names only — never device ids", () => {
  const dev = (deviceId: string, label: string, kind: MediaDeviceKind = "audioinput") => ({ deviceId, label, kind, groupId: "g", toJSON() {} }) as MediaDeviceInfo;
  const id = "5f2c0c1e9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6";
  const options = deviceOptions(
    [
      dev("default", "Default - MacBook Air Microphone (Built-in)"),
      dev("communications", "Communications - AirPods"),
      dev(id, "AirPods Microphone (05ac:0a1b)"),
      dev(id + "2", ""),
      dev("cam", "FaceTime HD Camera", "videoinput"),
    ],
    "audioinput",
  );
  assert.deepEqual(options.map((o) => o.label), ["System default (MacBook Air Microphone (Built-in))", "AirPods Microphone", "Microphone 2"]);
  for (const o of options) assert.ok(!o.label.includes(id));
  assert.deepEqual(deviceOptions([dev("x", "")], "audioinput").map((o) => o.label), ["Default microphone"]);
  assert.deepEqual(deviceOptions([dev("y", "", "videoinput")], "videoinput").map((o) => o.label), ["Default camera"]);
  assert.equal(cleanLabel("External USB Microphone (1234:abcd)"), "External USB Microphone");
});
