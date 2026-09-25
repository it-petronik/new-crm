import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordItem } from "../src/lib/domain";
import { authorised, recordChangeDrafts, reminderDrafts, mayOwn, type Person } from "../src/lib/notification-rules";
import { targetFor, titleWithCount } from "../src/lib/notification-types";
import { assign, canAssign } from "../src/lib/workflow";

const person = (id: string, role: Person["role"], extra: Partial<Person> = {}): Person => ({
  id,
  name: id,
  role,
  companies: ["Petronik"],
  branches: [],
  active: true,
  ...extra,
});
const manager = person("manager", "Sales Manager");
const edwin = person("edwin", "Sales Executive");
const eric = person("eric", "Sales Executive");
const outsider = person("outsider", "Sales Executive", { companies: ["Afrilube"] });
const people = [manager, edwin, eric, outsider];

const lead: RecordItem = {
  id: "LEAD-A", kind: "leads", company: "Petronik", branch: "Main", title: "ABC Trading",
  contact: "", product: "Base Oil SN500", quantity: 1, unit: "MT", amount: 1000, currency: "USD",
  status: "New", ownerId: "edwin", owner: "edwin", due: "2026-09-25", detail: "", source: "",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

test("assigning a lead notifies the new owner; a previous owner who lost sight of it is not told", () => {
  const workspace = assign({ records: [lead], audit: [] }, manager, lead.id, { id: "eric", name: "eric" });
  const after = workspace.records[0];
  const drafts = recordChangeDrafts({ before: lead, after, actor: manager, version: 2, people });
  const kept = authorised(drafts, people, new Map([[after.id, after]]));
  const toEric = kept.find((d) => d.recipientId === "eric");
  assert.equal(toEric?.type, "record.assigned");
  assert.equal(toEric?.title, "New lead assigned to you");
  assert.match(toEric!.body, /ABC Trading · Base Oil SN500/);
  assert.equal(toEric?.dedupeKey, "assigned:LEAD-A:eric:2");
  // Edwin can no longer read Eric's lead (executives see their own), so the
  // reassignment note is withheld from him rather than leaking the record.
  assert.ok(!kept.some((d) => d.recipientId === "edwin"));
  assert.ok(!kept.some((d) => d.recipientId === "manager" || d.recipientId === "outsider"));
});

test("only managers assign, and only to people who could own the record", () => {
  assert.equal(canAssign(manager, lead), true);
  assert.equal(canAssign(edwin, lead), false);
  assert.equal(mayOwn(eric, lead), true);
  assert.equal(mayOwn(outsider, lead), false);
  assert.equal(mayOwn({ ...eric, active: false }, lead), false);
});

test("nobody is notified of their own action", () => {
  const after = { ...lead, status: "Won" };
  const drafts = recordChangeDrafts({ before: lead, after, actor: edwin, version: 2, people });
  assert.equal(authorised(drafts, people, new Map([[after.id, after]])).length, 0);
});

test("a quotation sent for approval reaches approvers; the decision reaches the owner", () => {
  const quote: RecordItem = { ...lead, id: "Q-1", kind: "quotations", status: "Draft" };
  const pending = { ...quote, status: "Pending Approval" };
  const asked = authorised(
    recordChangeDrafts({ before: quote, after: pending, actor: edwin, version: 2, people }),
    people,
    new Map([[pending.id, pending]]),
  );
  assert.deepEqual(asked.map((d) => [d.recipientId, d.type]), [["manager", "approval.requested"]]);
  const approved = { ...pending, status: "Approved" };
  const decided = authorised(
    recordChangeDrafts({ before: pending, after: approved, actor: manager, version: 3, people }),
    people,
    new Map([[approved.id, approved]]),
  );
  assert.deepEqual(decided.map((d) => [d.recipientId, d.title]), [["edwin", "Your quotation was approved"]]);
});

test("reminders carry the date they concern, so reruns add nothing new", () => {
  const due = reminderDrafts([{ ...lead, due: "2026-09-25" }], people, "2026-09-25", "2026-09-28");
  assert.equal(due[0].dedupeKey, "followup-due:LEAD-A:2026-09-25:edwin");
  const overdue = reminderDrafts([{ ...lead, due: "2026-09-20" }], people, "2026-09-25", "2026-09-28");
  assert.equal(overdue[0].type, "followup.overdue");
  assert.deepEqual(
    reminderDrafts([{ ...lead, due: "2026-09-20" }], people, "2026-09-25", "2026-09-28").map((d) => d.dedupeKey),
    overdue.map((d) => d.dedupeKey),
  );
  assert.equal(reminderDrafts([{ ...lead, status: "Won" }], people, "2026-09-25", "2026-09-28").length, 0);
});

test("destinations come from trusted fields, and the tab title caps at 99+", () => {
  assert.deepEqual(targetFor({ entityType: "leave", entityId: "L1", conversationId: null, messageId: null }), {
    kind: "record", recordKind: "leave", recordId: "L1",
  });
  assert.equal(targetFor({ entityType: "https://evil.example", entityId: "x", conversationId: null, messageId: null }), null);
  assert.equal(titleWithCount("Enercore", 0), "Enercore");
  assert.equal(titleWithCount("Enercore", 4), "(4) Enercore");
  assert.equal(titleWithCount("Enercore", 150), "(99+) Enercore");
});

const rules = (before: RecordItem | undefined, after: RecordItem, actor: Person, everyone: Person[], created: RecordItem[] = []) =>
  authorised(
    recordChangeDrafts({ before, after, actor, version: 2, people: everyone, created }),
    everyone,
    new Map([after, ...created].map((r) => [r.id, r])),
  ).map((d) => [d.recipientId, d.type, d.title]);

test("a previous owner who can still see the record is told it moved; self-assignment is silent", () => {
  const md = person("md", "MD");
  const gm = person("gm", "Group Manager");
  const everyone = [md, gm, ...people];
  const mine = { ...lead, ownerId: "gm", owner: "gm" };
  const moved = assign({ records: [mine], audit: [] }, md, mine.id, { id: "eric", name: "eric" }).records[0];
  assert.deepEqual(rules(mine, moved, md, everyone).sort(), [
    ["eric", "record.assigned", "New lead assigned to you"],
    ["gm", "record.reassigned", "Lead reassigned"],
  ]);
  const toSelf = assign({ records: [lead], audit: [] }, manager, lead.id, { id: "manager", name: "manager" }).records[0];
  assert.deepEqual(rules(lead, toSelf, manager, people), []);
  // Assigning to the current owner changes nothing.
  assert.equal(assign({ records: [lead], audit: [] }, manager, lead.id, { id: "edwin", name: "edwin" }).records[0], lead);
  assert.throws(() => assign({ records: [lead], audit: [] }, edwin, lead.id, { id: "eric", name: "eric" }));
});

test("branch scope limits who may own a record", () => {
  const dubai = person("dubai", "Sales Executive", { branches: ["Dubai"] });
  assert.equal(mayOwn(dubai, { ...lead, branch: "Main" }), false);
  assert.equal(mayOwn(dubai, { ...lead, branch: "Dubai" }), true);
});

test("an accepted quotation hands work to logistics and accounts", () => {
  const logistics = person("logi", "Logistics Manager");
  const accounts = person("acct", "Accounts Manager");
  const everyone = [...people, logistics, accounts];
  const quote: RecordItem = { ...lead, id: "Q-2", kind: "quotations", status: "Approved" };
  const accepted = { ...quote, status: "Accepted" };
  const made: RecordItem[] = [
    { ...quote, id: "Q-2-SO", kind: "orders", status: "Confirmed", parentId: "Q-2" },
    { ...quote, id: "Q-2-SHP", kind: "logistics", status: "Pending Planning", parentId: "Q-2-SO" },
    { ...quote, id: "Q-2-INV", kind: "accounts", status: "Draft", parentId: "Q-2-SO" },
  ];
  const out = rules(quote, accepted, manager, everyone, made);
  assert.ok(out.some(([to, type]) => to === "logi" && type === "shipment.to_plan"));
  assert.ok(out.some(([to, type]) => to === "acct" && type === "invoice.to_issue"));
  assert.ok(out.some(([to, type]) => to === "edwin" && type === "order.created"));
  // Sales executives never learn of the invoice they may not read.
  assert.ok(!out.some(([to, type]) => to === "edwin" && type === "invoice.to_issue"));
});

test("a delayed shipment and an overdue invoice reach the owner and the team", () => {
  const logistics = person("logi", "Logistics Manager");
  const accounts = person("acct", "Accounts Manager");
  const md = person("md", "MD");
  const everyone = [...people, logistics, accounts, md];
  const shipment: RecordItem = { ...lead, id: "S-1", kind: "logistics", status: "In Transit" };
  const delayed = rules(shipment, { ...shipment, status: "Delayed" }, md, everyone);
  assert.deepEqual(delayed.map(([to]) => to).sort(), ["edwin", "logi"]);
  assert.ok(delayed.every(([, type]) => type === "shipment.delayed"));
  const invoice: RecordItem = { ...lead, id: "I-1", kind: "accounts", status: "Sent", ownerId: "md", owner: "md" };
  const overdue = rules(invoice, { ...invoice, status: "Overdue" }, accounts, everyone);
  assert.deepEqual(overdue, [["md", "payment.overdue", "Payment overdue"]]);
});

test("leave requests go to HR approvers, and the decision comes back", () => {
  const hr = person("hr", "HR Manager");
  const employee = person("emp", "Employee");
  const everyone = [hr, employee];
  const leave: RecordItem = { ...lead, id: "LV-1", kind: "leave", status: "Pending Approval", ownerId: "emp", owner: "emp" };
  assert.deepEqual(rules(undefined, leave, employee, everyone), [["hr", "approval.requested", "Leave approval required"]]);
  assert.deepEqual(rules(leave, { ...leave, status: "Approved" }, hr, everyone), [["emp", "approval.approved", "Your leave request was approved"]]);
  assert.deepEqual(rules(leave, { ...leave, status: "Rejected" }, hr, everyone), [["emp", "approval.rejected", "Your leave request was rejected"]]);
});

test("a new ticket reaches IT, urgent when marked so; the requester follows its status", () => {
  const it = person("it", "IT Administrator");
  const employee = person("emp", "Employee");
  const everyone = [it, employee];
  const ticket: RecordItem = { ...lead, id: "T-1", kind: "it", status: "Open", ownerId: "emp", owner: "emp", attributes: { priority: "Urgent" } };
  const created = authorised(recordChangeDrafts({ after: ticket, actor: employee, version: 1, people: everyone }), everyone, new Map([[ticket.id, ticket]]));
  assert.deepEqual(created.map((d) => [d.recipientId, d.type, d.priority]), [["it", "ticket.created", "urgent"]]);
  assert.deepEqual(rules(ticket, { ...ticket, status: "Resolved" }, it, everyone), [["emp", "ticket.status", "Your ticket is resolved"]]);
});

test("ordinary edits notify nobody", () => {
  const md = person("md", "MD");
  assert.deepEqual(rules(lead, { ...lead, detail: "new notes", contact: "Ali" }, md, [md, ...people]), []);
});
