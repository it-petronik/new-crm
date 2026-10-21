import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import type { Actor, RecordItem } from "../src/lib/domain";
import { createRecordWithAudit, updateRecordWithAudit } from "../src/lib/data";
import { transition } from "../src/lib/workflow";
import { bucketOf, canEditRule, pastDueTime } from "../src/lib/tasks/model";
import { TaskError, createTask, listTasks, taskDetail, tasksForRecord, updateTask, assignableFor } from "../src/lib/tasks/store";
import { automationOutbox, automationSweep, previewRule, processEvents, ruleHistory, runLeadFollowUps, saveRule } from "../src/lib/tasks/automation";

/**
 * Phase 8: tasks and task automation against the real migrations. Fictional
 * people and records only. "Now" is fixed at 2026-10-08 10:00 in Dubai.
 */
const NOW = new Date("2026-10-08T06:00:00.000Z");
const TODAY = "2026-10-08";

const md: Actor = { id: "md", name: "Mira Director", role: "MD", companies: ["Petronik"], branches: [] };
const salesManager: Actor = { id: "sm", name: "Sami Manager", role: "Sales Manager", companies: ["Petronik"], branches: [] };
const seller: Actor = { id: "s1", name: "Sara Seller", role: "Sales Executive", companies: ["Petronik"], branches: ["Main"] };
const seller2: Actor = { id: "s2", name: "Omar Seller", role: "Sales Executive", companies: ["Petronik"], branches: ["Main"] };
const dubaiManager: Actor = { id: "bm", name: "Dana Branch", role: "Branch Manager", companies: ["Petronik"], branches: ["Dubai"] };
const otherCompany: Actor = { id: "oc", name: "Femi Other", role: "MD", companies: ["Afrilube"], branches: [] };
const itAdmin: Actor = { id: "it", name: "Ivan Support", role: "IT Administrator", companies: ["Petronik"], branches: [] };
const logistics: Actor = { id: "lm", name: "Lina Logistics", role: "Logistics Manager", companies: ["Petronik"], branches: [] };
const employee: Actor = { id: "emp", name: "Eli Employee", role: "Employee", companies: ["Petronik"], branches: ["Main"] };
const inactive: Actor = { id: "gone", name: "Gary Former", role: "Sales Executive", companies: ["Petronik"], branches: ["Main"] };
const everyone = [md, salesManager, seller, seller2, dubaiManager, otherCompany, itAdmin, logistics, employee, inactive];

function setup() {
  const sqlite = migratedDatabase();
  const db = drizzle(d1(sqlite) as never, { schema }) as Database;
  for (const p of everyone)
    sqlite
      .prepare("INSERT INTO User(id,email,name,passwordHash,role,companies,branches,moduleAccess,active,createdAt) VALUES(?,?,?,?,?,?,?,NULL,?,1)")
      .run(p.id, `${p.id}@tasks.test`, p.name, "x", p.role, JSON.stringify(p.companies), JSON.stringify(p.branches), p.id === "gone" ? 0 : 1);
  return { sqlite, db };
}
const count = (s: DatabaseSync, t: string, where = "1") => Number((s.prepare(`SELECT count(*) n FROM ${t} WHERE ${where}`).get() as { n: number }).n);
const record = (id: string, values: Partial<RecordItem> = {}): RecordItem => ({
  id, kind: "leads", title: `Fictional ${id}`, company: "Petronik", branch: "Main", ownerId: "s1", owner: "Sara Seller", status: "New",
  contact: "", product: "Base Oil SN500", quantity: 0, unit: "MT", amount: 0, currency: "USD", due: TODAY, source: "Test", detail: "",
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", attributes: { leadCapturedById: salesManager.id }, ...values,
});
function insert(sqlite: DatabaseSync, r: RecordItem) {
  sqlite.prepare("INSERT INTO BusinessRecord(id,kind,company,branch,ownerId,status,payload,version,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,1,1,1)").run(r.id, r.kind, r.company, r.branch, r.ownerId, r.status, JSON.stringify(r));
  return r;
}
const base = (values: Record<string, unknown> = {}) => ({ title: "Call the buyer", description: "", priority: "normal", dueDate: TODAY, dueTime: null, assigneeId: "s1", linkedRecordId: null, company: "Petronik", requestId: crypto.randomUUID(), ...values });
const rejects = (p: Promise<unknown>, status: number, text?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof TaskError && e.status === status && (!text || text.test(e.message)));

/* ----------------------------------------------------------------- tasks */

test("My Day buckets follow the Dubai business day; past-due times are flagged", () => {
  assert.equal(bucketOf({ status: "open", dueDate: "2026-10-07" }, TODAY), "overdue");
  assert.equal(bucketOf({ status: "in_progress", dueDate: TODAY }, TODAY), "today");
  assert.equal(bucketOf({ status: "open", dueDate: "2026-10-09" }, TODAY), "upcoming");
  assert.equal(bucketOf({ status: "cancelled", dueDate: "2026-10-01" }, TODAY), "completed");
  // 23:30 UTC on the 7th is already the 8th in Dubai.
  assert.equal(bucketOf({ status: "open", dueDate: TODAY }, "2026-10-08"), "today");
  assert.equal(pastDueTime({ status: "open", dueDate: TODAY, dueTime: "09:00" }, NOW), true);
  assert.equal(pastDueTime({ status: "open", dueDate: TODAY, dueTime: "11:00" }, NOW), false);
  assert.equal(pastDueTime({ status: "completed", dueDate: TODAY, dueTime: "09:00" }, NOW), false);
});

test("a task is one write with its audit; a retried request returns the same task", async () => {
  const { db, sqlite } = setup();
  const input = base();
  const first = await createTask(db, seller, input, NOW);
  const again = await createTask(db, seller, input, NOW);
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.task.id, first.task.id);
  assert.equal(count(sqlite, "Task"), 1);
  assert.equal(count(sqlite, "AuditEvent", "subject='task'"), 1);
  assert.equal(first.draft, null, "no notification for your own task");
  // Task history never reaches the Activity feed's record events.
  assert.equal(count(sqlite, "AuditEvent", "subject IS NULL"), 0);
});

test("retrying a task request cannot reveal an earlier task after company access is revoked", async () => {
  const { db } = setup();
  const input = base({ assigneeId: md.id });
  await createTask(db, md, input, NOW);
  const changedAccess: Actor = { ...md, companies: ["Afrilube"] };
  await rejects(createTask(db, changedAccess, { ...input, company: "Afrilube" }, NOW), 404);
});

test("lists: views, counts, search, filters, sorting and pagination", async () => {
  const { db } = setup();
  for (const [title, dueDate, priority] of [["Overdue call", "2026-10-06", "high"], ["Today call", TODAY, "urgent"], ["Next week", "2026-10-15", "low"], ["Tomorrow", "2026-10-09", "normal"]] as const)
    await createTask(db, seller, base({ title, dueDate, priority }), NOW);
  const done = await createTask(db, seller, base({ title: "Finished one" }), NOW);
  await updateTask(db, seller, { action: "status", id: done.task.id, expectedVersion: 1, status: "completed" }, NOW);
  const today = await listTasks(db, seller, { view: "today", scope: "mine" }, NOW);
  assert.deepEqual(today.counts, { today: 1, overdue: 1, upcoming: 2, completed: 1 });
  assert.deepEqual(today.items.map((t) => t.title), ["Today call"]);
  const upcoming = await listTasks(db, seller, { view: "upcoming", scope: "mine" }, NOW);
  assert.deepEqual(upcoming.items.map((t) => t.title), ["Tomorrow", "Next week"]);
  const byPriority = await listTasks(db, seller, { view: "upcoming", scope: "mine", sort: "priority" }, NOW);
  assert.deepEqual(byPriority.items.map((t) => t.title), ["Tomorrow", "Next week"]);
  const found = await listTasks(db, seller, { view: "upcoming", scope: "mine", q: "week" }, NOW);
  assert.deepEqual(found.items.map((t) => t.title), ["Next week"]);
  const low = await listTasks(db, seller, { view: "upcoming", scope: "mine", priority: ["low"] }, NOW);
  assert.equal(low.total, 1);
  const completed = await listTasks(db, seller, { view: "completed", scope: "mine" }, NOW);
  assert.equal(completed.items[0].status, "completed");
  for (let i = 0; i < 23; i++) await createTask(db, seller, base({ title: `Bulk ${String(i).padStart(2, "0")}`, dueDate: "2026-10-20" }), NOW);
  const page2 = await listTasks(db, seller, { view: "upcoming", scope: "mine", page: 2, pageSize: 20 }, NOW);
  assert.equal(page2.total, 25);
  assert.equal(page2.pages, 2);
  assert.equal(page2.items.length, 5);
  // A wildcard typed by someone is literal text, not a pattern.
  assert.equal((await listTasks(db, seller, { view: "upcoming", scope: "mine", q: "%" }, NOW)).total, 0);
});

test("visibility: assignee and creator; team roles in scope; nobody outside", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, record("dubai-lead", { branch: "Dubai", ownerId: "bm" }));
  const mine = await createTask(db, seller, base(), NOW);
  const dubai = await createTask(db, dubaiManager, base({ assigneeId: "bm", linkedRecordId: "dubai-lead" }), NOW);
  await rejects(taskDetail(db, seller2, mine.task.id), 404);
  await rejects(taskDetail(db, otherCompany, mine.task.id), 404);
  assert.ok(await taskDetail(db, md, mine.task.id));
  // A branch manager sees their branch's team work, not another branch's.
  await rejects(taskDetail(db, dubaiManager, mine.task.id), 404);
  assert.equal((await listTasks(db, dubaiManager, { view: "today", scope: "team" }, NOW)).items.map((t) => t.id).join(), dubai.task.id);
  // Team view is only for team roles: an executive asking for it gets their own.
  const asked = await listTasks(db, seller2, { view: "today", scope: "team" }, NOW);
  assert.equal(asked.scope, "mine");
  assert.equal(asked.total, 0);
  const team = await listTasks(db, md, { view: "today", scope: "team" }, NOW);
  assert.equal(team.total, 2);
  assert.equal((await listTasks(db, otherCompany, { view: "today", scope: "team" }, NOW)).total, 0);
});

test("assignment: only team roles assign others; every assignee is checked independently", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, record("lead-s1"));
  insert(sqlite, record("lead-s2", { ownerId: "s2", owner: "Omar Seller" }));
  await rejects(createTask(db, seller, base({ assigneeId: "s2" }), NOW), 403, /yourself/);
  const given = await createTask(db, salesManager, base({ assigneeId: "s2" }), NOW);
  assert.equal(given.task.assignee.name, "Omar Seller");
  assert.equal(given.draft?.recipientId, "s2", "the assignee is notified");
  assert.equal(given.draft?.type, "task.assigned");
  await rejects(createTask(db, salesManager, base({ assigneeId: "gone" }), NOW), 400, /inactive/);
  await rejects(createTask(db, salesManager, base({ assigneeId: "oc" }), NOW), 400, /does not work/);
  await rejects(createTask(db, salesManager, base({ assigneeId: "nobody" }), NOW), 400);
  // Omar cannot open Sara's lead, so he cannot be given a task about it.
  await rejects(createTask(db, salesManager, base({ assigneeId: "s2", linkedRecordId: "lead-s1" }), NOW), 400, /cannot open the linked record/);
  // A task never grants access: the link stays restricted for Omar even on his own task.
  const linked = await createTask(db, salesManager, base({ assigneeId: "s1", linkedRecordId: "lead-s1" }), NOW);
  await rejects(updateTask(db, salesManager, { action: "assign", id: linked.task.id, expectedVersion: 1, assigneeId: "s2" }, NOW), 400, /cannot open/);
  const people = await assignableFor(db, salesManager, { company: "Petronik", linkedRecordId: "lead-s1" });
  assert.ok(people.some((p) => p.id === "s1"));
  assert.ok(!people.some((p) => ["s2", "gone", "oc"].includes(p.id)));
  assert.deepEqual((await assignableFor(db, seller, { company: "Petronik" })).map((p) => p.id), ["s1"]);
});

test("links: same company, readable, linkable kind; the database refuses a cross-company link", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, record("afri", { company: "Afrilube" }));
  insert(sqlite, record("lead-s2", { ownerId: "s2" }));
  insert(sqlite, record("hr-1", { kind: "hr", ownerId: "s1" }));
  insert(sqlite, record("lead-mine"));
  await rejects(createTask(db, seller, base({ linkedRecordId: "afri" }), NOW), 404);
  await rejects(createTask(db, md, base({ assigneeId: "md", linkedRecordId: "afri" }), NOW), 404);
  await rejects(createTask(db, seller, base({ linkedRecordId: "lead-s2" }), NOW), 404, /isn't available/);
  await rejects(createTask(db, md, base({ assigneeId: "md", linkedRecordId: "hr-1" }), NOW), 400, /can't be linked/);
  await rejects(createTask(db, seller, base({ company: "Afrilube" }), NOW), 403);
  const t = await createTask(db, seller, base({ linkedRecordId: "lead-mine" }), NOW);
  assert.deepEqual(t.task.link, { id: "lead-mine", kind: "leads", title: "Fictional lead-mine", status: "New" });
  assert.equal((await tasksForRecord(db, seller, "lead-mine")).length, 1);
  await rejects(tasksForRecord(db, seller2, "lead-mine"), 404);
  // Defence in depth: even a direct write cannot link across companies.
  assert.throws(() => sqlite.prepare("UPDATE Task SET company='Afrilube' WHERE id=?").run(t.task.id), /task_scope_invalid/);
  assert.throws(
    () => sqlite.prepare("INSERT INTO Task(id,company,branch,title,assigneeId,createdBy,dueDate,linkedRecordId,createdAt,updatedAt) VALUES('x','Petronik','Main','Bad link','s1','s1',?,'afri',1,1)").run(TODAY),
    /task_scope_invalid/,
  );
});

test("concurrent edits: the second writer with a stale version is refused and nothing partial remains", async () => {
  const { db, sqlite } = setup();
  const { task } = await createTask(db, seller, base(), NOW);
  const values = { title: "Call the buyer again", description: "", priority: "high", dueDate: "2026-10-09", dueTime: "14:30", linkedRecordId: null };
  const [a, b] = await Promise.allSettled([
    updateTask(db, seller, { action: "edit", id: task.id, expectedVersion: 1, values }, NOW),
    updateTask(db, salesManager, { action: "status", id: task.id, expectedVersion: 1, status: "completed" }, NOW),
  ]);
  assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  const lost = [a, b].find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.ok(lost.reason instanceof TaskError && lost.reason.status === 409, String(lost.reason));
  assert.equal(count(sqlite, "AuditEvent", "subject='task'"), 2);
  const { task: now, history } = await taskDetail(db, seller, task.id);
  assert.equal(now.version, 2);
  assert.equal(history.length, 2);
});

test("status workflow: start, complete, reopen, cancel — with permissions and audit history", async () => {
  const { db } = setup();
  const { task } = await createTask(db, salesManager, base({ assigneeId: "s1" }), NOW);
  let v = (await updateTask(db, seller, { action: "status", id: task.id, expectedVersion: 1, status: "in_progress" }, NOW)).task;
  assert.equal(v.status, "in_progress");
  // The assignee works on it but cannot cancel what a manager asked for.
  await rejects(updateTask(db, seller, { action: "status", id: task.id, expectedVersion: 2, status: "cancelled" }, NOW), 403);
  await rejects(updateTask(db, seller2, { action: "status", id: task.id, expectedVersion: 2, status: "completed" }, NOW), 404);
  v = (await updateTask(db, seller, { action: "status", id: task.id, expectedVersion: 2, status: "completed" }, NOW)).task;
  assert.ok(v.completedAt);
  assert.equal(v.bucket, "completed");
  await rejects(updateTask(db, seller, { action: "edit", id: task.id, expectedVersion: 3, values: { title: "Changed", description: "", priority: "normal", dueDate: TODAY, dueTime: null, linkedRecordId: null } }, NOW), 409, /Reopen/);
  await rejects(updateTask(db, seller, { action: "status", id: task.id, expectedVersion: 3, status: "cancelled" }, NOW), 409);
  v = (await updateTask(db, seller, { action: "status", id: task.id, expectedVersion: 3, status: "open" }, NOW)).task;
  assert.equal(v.completedAt, null);
  v = (await updateTask(db, salesManager, { action: "status", id: task.id, expectedVersion: 4, status: "cancelled" }, NOW)).task;
  assert.equal(v.status, "cancelled");
  const { history } = await taskDetail(db, salesManager, task.id);
  assert.deepEqual(history.map((h) => h.action), ["Cancelled task", "Reopened task", "Completed task", "Started task", "Created task"]);
  assert.deepEqual(history[0].changes, ["Status: Open → Cancelled"]);
});

/* ------------------------------------------------------------ automation */

async function rule(db: Database, actor: Actor, values: Record<string, unknown>) {
  return saveRule(db, actor, { company: "Petronik", name: "Rule", enabled: false, assigneeId: null, dueDays: 0, dueTime: null, priority: "normal", conditions: {}, ...values }, NOW);
}

test("rule permissions: department managers edit their own preset; executives and branch staff never", async () => {
  const { db } = setup();
  assert.equal(canEditRule(salesManager, "Petronik", "lead_follow_up"), true);
  assert.equal(canEditRule(salesManager, "Petronik", "it_ticket_triage"), false);
  assert.equal(canEditRule(itAdmin, "Petronik", "it_ticket_triage"), true);
  assert.equal(canEditRule(logistics, "Petronik", "quotation_handoff"), true);
  assert.equal(canEditRule(dubaiManager, "Petronik", "lead_follow_up"), false);
  assert.equal(canEditRule(otherCompany, "Petronik", "lead_follow_up"), false);
  await rejects(rule(db, seller, { preset: "lead_follow_up" }), 403);
  await rejects(rule(db, salesManager, { preset: "it_ticket_triage", assigneeId: "it" }), 403);
  // Rules start disabled; enabling a person-assigned rule needs a person.
  const created = await rule(db, md, { preset: "it_ticket_triage" });
  assert.equal(created.version, 1);
  await rejects(rule(db, md, { preset: "it_ticket_triage", enabled: true, expectedVersion: 1 }), 400, /Choose who/);
  await rejects(rule(db, md, { preset: "it_ticket_triage", enabled: true, assigneeId: "gone", expectedVersion: 1 }), 400, /inactive/);
  await rejects(rule(db, md, { preset: "it_ticket_triage", enabled: true, assigneeId: "s1", expectedVersion: 1 }), 400, /cannot open IT tickets/);
  await rule(db, md, { preset: "it_ticket_triage", enabled: true, assigneeId: "it", expectedVersion: 1 });
  // A stale editor cannot overwrite the newer rule.
  await rejects(rule(db, itAdmin, { preset: "it_ticket_triage", enabled: false, assigneeId: "it", expectedVersion: 1 }), 409);
});

test("lead follow-up: disabled does nothing; enabled creates one task per due lead, once", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, record("due-today"));
  insert(sqlite, record("due-yesterday", { due: "2026-10-07" }));
  insert(sqlite, record("due-later", { due: "2026-10-12" }));
  insert(sqlite, record("won", { status: "Won" }));
  insert(sqlite, record("other-co", { company: "Afrilube", ownerId: "oc" }));
  const { id } = await rule(db, salesManager, { preset: "lead_follow_up", dueTime: "10:00" });
  await automationSweep(db, NOW);
  assert.equal(count(sqlite, "Task"), 0, "a disabled rule creates nothing");
  // Read-only preview: shows what would happen and writes nothing.
  await rule(db, salesManager, { preset: "lead_follow_up", enabled: true, dueTime: "10:00", expectedVersion: 1 });
  const before = count(sqlite, "AuditEvent");
  const preview = await previewRule(db, salesManager, id, NOW);
  assert.deepEqual(preview.items.map((i) => [i.record.id, i.outcome]), [["due-today", "create"]]);
  assert.equal(count(sqlite, "Task") + count(sqlite, "AutomationRun"), 0);
  assert.equal(count(sqlite, "AuditEvent"), before);
  const first = await runLeadFollowUps(db, NOW);
  assert.equal(first.outcomes.length, 1);
  const [task] = (await listTasks(db, seller, { view: "today", scope: "mine" }, NOW)).items;
  assert.equal(task.title, "Follow up: Fictional due-today");
  assert.equal(task.dueTime, "10:00");
  assert.equal(task.automation?.ruleId, id);
  assert.equal(first.drafts[0].recipientId, "s1");
  // Repeated scheduled runs, including concurrent ones, add nothing.
  await Promise.all([runLeadFollowUps(db, NOW), runLeadFollowUps(db, NOW), automationSweep(db, NOW)]);
  assert.equal(count(sqlite, "Task"), 1);
  assert.equal(count(sqlite, "AutomationRun"), 1);
  // Catch-up for overdue follow-ups is an explicit condition.
  await rule(db, salesManager, { preset: "lead_follow_up", enabled: true, dueTime: "10:00", conditions: { lookbackDays: 2 }, expectedVersion: 2 });
  await runLeadFollowUps(db, NOW);
  assert.equal(count(sqlite, "Task"), 2);
  // A new follow-up date while the earlier task is open: skipped, explained.
  sqlite.prepare("UPDATE BusinessRecord SET payload=json_set(payload,'$.due','2026-10-08') WHERE id='due-yesterday'").run();
  await runLeadFollowUps(db, NOW);
  const history = await ruleHistory(db, salesManager, id);
  assert.equal(history.length, 3);
  assert.equal(history.filter((h) => h.status === "skipped")[0].message, "An earlier follow-up task for this lead is still open.");
  assert.equal(count(sqlite, "Task"), 2);
});

test("lead follow-up: an inactive owner is skipped with an understandable reason", async () => {
  const { db, sqlite } = setup();
  insert(sqlite, record("orphan", { ownerId: "gone", owner: "Gary Former" }));
  const { id } = await rule(db, md, { preset: "lead_follow_up", enabled: true });
  await runLeadFollowUps(db, NOW);
  assert.equal(count(sqlite, "Task"), 0);
  const [run] = await ruleHistory(db, md, id);
  assert.equal(run.status, "skipped");
  assert.match(run.message, /Gary Former is inactive\. No task was created\./);
  // Run history never names a record the reader cannot open.
  await rejects(ruleHistory(db, seller, id), 404);
});

test("IT ticket created: the outbox commits with the ticket; replays create one task", async () => {
  const { db, sqlite } = setup();
  await rule(db, itAdmin, { preset: "it_ticket_triage", enabled: true, assigneeId: "it", priority: "high", conditions: { priorities: ["High", "Urgent"] } });
  const ticket = record("ticket-1", { kind: "it", status: "Open", ownerId: "emp", owner: "Eli Employee", attributes: { priority: "Urgent", category: "Email" } });
  const outbox = await automationOutbox(db, { after: ticket });
  assert.equal(outbox.ids.length, 1);
  await createRecordWithAudit(db, { id: ticket.id, kind: ticket.kind, company: ticket.company, branch: ticket.branch, ownerId: ticket.ownerId, status: ticket.status, payload: ticket }, { id: "a1", actor: "Eli", actorId: "emp", company: "Petronik", action: "Created it", recordId: ticket.id }, outbox.statements);
  assert.equal(count(sqlite, "AutomationEvent"), 1);
  await Promise.all([processEvents(db, { ids: outbox.ids }, NOW), processEvents(db, {}, NOW), automationSweep(db, NOW)]);
  assert.equal(count(sqlite, "Task"), 1);
  const [task] = (await listTasks(db, itAdmin, { view: "today", scope: "mine" }, NOW)).items;
  assert.equal(task.title, "Triage ticket: Fictional ticket-1");
  assert.equal(task.priority, "high");
  // A low-priority ticket does not meet the rule's condition.
  const low = record("ticket-2", { kind: "it", status: "Open", ownerId: "emp", attributes: { priority: "Low" } });
  const lowOutbox = await automationOutbox(db, { after: low });
  await createRecordWithAudit(db, { id: low.id, kind: "it", company: "Petronik", branch: "Main", ownerId: "emp", status: "Open", payload: low }, { id: "a2", actor: "Eli", actorId: "emp", company: "Petronik", action: "Created it", recordId: low.id }, lowOutbox.statements);
  await processEvents(db, {}, NOW);
  assert.equal(count(sqlite, "Task"), 1);
  assert.equal(count(sqlite, "AutomationEvent", "processedAt IS NULL"), 0);
  // No recursion: creating tasks raised no further events.
  assert.equal(count(sqlite, "AutomationEvent"), 2);
});

test("a ticket rule whose person became inactive is skipped, not silently dropped", async () => {
  const { db, sqlite } = setup();
  const { id } = await rule(db, md, { preset: "it_ticket_triage", enabled: true, assigneeId: "it" });
  sqlite.prepare("UPDATE User SET active=0 WHERE id='it'").run();
  const ticket = record("ticket-3", { kind: "it", status: "Open", ownerId: "emp" });
  const outbox = await automationOutbox(db, { after: ticket });
  await createRecordWithAudit(db, { id: ticket.id, kind: "it", company: "Petronik", branch: "Main", ownerId: "emp", status: "Open", payload: ticket }, { id: "a3", actor: "Eli", actorId: "emp", company: "Petronik", action: "Created it", recordId: ticket.id }, outbox.statements);
  await processEvents(db, {}, NOW);
  const [run] = await ruleHistory(db, md, id);
  assert.equal(run.status, "skipped");
  assert.match(run.message, /Ivan Support is inactive/);
  assert.equal(count(sqlite, "Task"), 0);
});

test("an unexpected failure is retried, then recorded as failed with an actionable message", async () => {
  const { db, sqlite } = setup();
  const { id } = await rule(db, md, { preset: "it_ticket_triage", enabled: true, assigneeId: "it" });
  sqlite.exec("CREATE TRIGGER fail_task BEFORE INSERT ON Task BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
  const ticket = record("ticket-4", { kind: "it", status: "Open", ownerId: "emp" });
  const outbox = await automationOutbox(db, { after: ticket });
  await createRecordWithAudit(db, { id: ticket.id, kind: "it", company: "Petronik", branch: "Main", ownerId: "emp", status: "Open", payload: ticket }, { id: "a4", actor: "Eli", actorId: "emp", company: "Petronik", action: "Created it", recordId: ticket.id }, outbox.statements);
  for (let i = 0; i < 5; i++) await processEvents(db, {}, NOW);
  const event = sqlite.prepare("SELECT attempts, processedAt, lastError FROM AutomationEvent").get() as { attempts: number; processedAt: number | null; lastError: string };
  assert.equal(event.attempts, 3);
  assert.ok(event.processedAt);
  assert.match(event.lastError, /test_failure/);
  const [run] = await ruleHistory(db, md, id);
  assert.equal(run.status, "failed");
  assert.match(run.message, /could not be created after 3 attempts/);
  assert.equal(count(sqlite, "Task"), 0);
});

test("quotation accepted: one handoff task linked to the order the workflow created — never more downstream records", async () => {
  const { db, sqlite } = setup();
  await rule(db, logistics, { preset: "quotation_handoff", enabled: true, assigneeId: "lm", dueDays: 1, dueTime: "09:00" });
  const quote = insert(sqlite, record("Q-1", { kind: "quotations", status: "Sent", ownerId: "sm", owner: "Sami Manager", title: "Gulf Lubes · SN500" }));
  // Exactly the records PATCH for status "Accepted".
  const result = transition({ records: [quote], audit: [] }, salesManager, quote.id, "Accepted");
  const changed = result.records.find((r) => r.id === quote.id)!;
  const created = result.records.filter((r) => r.id !== quote.id);
  const outbox = await automationOutbox(db, { before: quote, after: changed, created });
  const ok = await updateRecordWithAudit(
    db, quote.id, 1, { status: changed.status, payload: changed },
    { id: "acc", company: "Petronik", actor: "Sami", actorId: "sm", action: "quotations: Sent → Accepted", recordId: quote.id },
    created.map((r) => ({ id: r.id, kind: r.kind, company: r.company, branch: r.branch, ownerId: r.ownerId, status: r.status, payload: r })),
    outbox.statements,
  );
  assert.equal(ok, true);
  await processEvents(db, { ids: outbox.ids }, NOW);
  await processEvents(db, {}, NOW);
  await automationSweep(db, NOW);
  assert.equal(count(sqlite, "BusinessRecord", "kind IN ('orders','logistics','accounts')"), 3);
  assert.equal(count(sqlite, "Task"), 1);
  const [task] = (await listTasks(db, logistics, { view: "upcoming", scope: "mine" }, NOW)).items;
  assert.equal(task.link && "id" in task.link ? task.link.id : "", "Q-1-SO");
  assert.equal(task.dueDate, "2026-10-09");
  assert.equal(task.title, "Operations handoff: Gulf Lubes · SN500");
  // A stale acceptance (another writer won) rolls back the event with the records.
  const stale = await updateRecordWithAudit(db, quote.id, 1, { status: "Accepted", payload: changed }, { id: "acc2", company: "Petronik", actor: "Sami", actorId: "sm", action: "x", recordId: quote.id }, [], outbox.statements);
  assert.equal(stale, false);
  assert.equal(count(sqlite, "AutomationEvent"), 1);
});

test("no rule enabled: business changes enqueue nothing", async () => {
  const { db } = setup();
  const outbox = await automationOutbox(db, { after: record("ticket-x", { kind: "it", status: "Open" }) });
  assert.deepEqual(outbox, { statements: [], ids: [] });
});

/* --------------------------------------------------------- Action Center */
import { signalsFor } from "../src/lib/proactive/service";

test("Action Center: due tasks appear once; a task about a flagged record is folded into its signal", async () => {
  const { db, sqlite } = setup();
  const today = new Date().toISOString(); // signalsFor uses the real business day
  const { businessToday } = await import("../src/lib/gst");
  const day = businessToday();
  insert(sqlite, record("lead-due", { due: day, updatedAt: today }));
  const linked = await createTask(db, seller, base({ title: "Call about samples", dueDate: day, linkedRecordId: "lead-due" }));
  const alone = await createTask(db, seller, base({ title: "Prepare price list", dueDate: day }));
  await createTask(db, seller, base({ title: "Later", dueDate: "2099-01-01" }));
  const { signals } = await signalsFor(db, seller, "mine");
  const follow = signals.find((s) => s.entity.id === "lead-due");
  assert.equal(follow?.task?.id, linked.task.id, "the follow-up names its task");
  assert.equal(signals.filter((s) => s.entity.type === "task").map((s) => s.entity.id).join(), alone.task.id, "only the unlinked task is its own item");
  assert.equal(signals.find((s) => s.entity.type === "task")?.type, "TASK_DUE_TODAY");
  // Someone else's tasks never appear in another person's Action Center.
  assert.equal((await signalsFor(db, seller2, "mine")).signals.filter((s) => s.entity.type === "task").length, 0);
  const done = await updateTask(db, seller, { action: "status", id: alone.task.id, expectedVersion: 1, status: "completed" });
  assert.equal(done.task.status, "completed");
  assert.equal((await signalsFor(db, seller, "mine")).signals.filter((s) => s.entity.type === "task").length, 0);
});
