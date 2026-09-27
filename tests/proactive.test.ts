import { test } from "node:test";
import assert from "node:assert/strict";
import type { Actor, RecordItem } from "../src/lib/domain";
import { previewActor } from "../src/lib/fixtures";
import { duplicateCandidates, missingFields, normalizeName, proactiveSignals, type ProactiveMeeting } from "../src/lib/proactive/signals";
import { DEFAULT_RULES, plan, validRule } from "../src/lib/proactive/automation";

const TODAY = "2026-09-27";
const at = (d: string) => `${d}T06:00:00.000Z`;
const md: Actor = { ...previewActor, id: "md1", role: "MD", companies: ["Istanegry"], branches: [] };
const rec = (id: string, kind: RecordItem["kind"], extra: Partial<RecordItem> = {}): RecordItem => ({
  id, kind, company: "Istanegry", branch: "Main", title: `T ${id}`, contact: "C", product: "SN500", quantity: 10, unit: "MT", amount: 1000, currency: "USD",
  status: "New", ownerId: "u1", owner: "Sam", due: "2026-10-10", detail: "", source: "", destination: "Mombasa", createdAt: at("2026-09-20"), updatedAt: at("2026-09-26"), ...extra,
});
const run = (records: RecordItem[], meetings: ProactiveMeeting[] = [], actor = md, now = new Date(at(TODAY))) => proactiveSignals({ actor, records, meetings, today: TODAY, now });
const types = (records: RecordItem[], meetings: ProactiveMeeting[] = []) => run(records, meetings).map((s) => s.type).sort();

test("sales and quotation signals come from the Phase 2 rules (one source of truth)", () => {
  assert.deepEqual(types([rec("l1", "leads", { status: "Qualified", due: "2026-09-24" })]), ["FOLLOW_UP_OVERDUE"]);
  assert.deepEqual(types([rec("l2", "leads", { status: "Qualified", due: TODAY })]), ["FOLLOW_UP_DUE_TODAY"]);
  const q = rec("q1", "quotations", { status: "Sent", due: "2026-10-30", updatedAt: at("2026-09-21") });
  const s = run([q])[0];
  assert.deepEqual([s.type, s.section, s.actions], ["QUOTATION_WAITING_RESPONSE", "waiting", ["open", "draft_follow_up", "set_follow_up"]]);
  // An expired quotation is never called "rejected".
  const expired = run([rec("q2", "quotations", { status: "Sent", due: "2026-09-20", updatedAt: at("2026-09-26") })]);
  assert.deepEqual(expired.map((x) => [x.type, x.label]), [["QUOTATION_EXPIRED", "Quotation validity ended 7 days ago"]]);
});

test("approvals block work: urgent, for approvers only, overdue after the central threshold", () => {
  const pending = rec("q3", "quotations", { status: "Pending Approval", updatedAt: at("2026-09-24"), due: "2026-10-30" });
  const s = run([pending]).find((x) => x.category === "approval")!;
  assert.deepEqual([s.type, s.severity, s.snoozable], ["QUOTATION_APPROVAL_OVERDUE", "urgent", false]);
  const seller: Actor = { ...previewActor, id: "u1", role: "Sales Executive", companies: ["Istanegry"], branches: [] };
  assert.equal(run([pending], [], seller).some((x) => x.category === "approval"), false, "the owner can't approve their own");
});

test("orders, logistics and accounts: exact workflow state only", () => {
  const order = rec("o1", "orders", { status: "Confirmed", due: "2026-10-30" });
  const ship = rec("s1", "logistics", { status: "Delayed", parentId: "o1", due: "2026-10-30" });
  assert.deepEqual(types([order, ship]), ["ORDER_DELAYED", "SHIPMENT_DELAYED"]);
  assert.deepEqual(types([rec("s2", "logistics", { status: "In Transit", due: "2026-09-12" })]), ["DELIVERY_OVERDUE"]);
  assert.equal(run([rec("s2", "logistics", { status: "In Transit", due: "2026-09-12" })])[0].severity, "urgent", "over 7 days: severe");
  assert.deepEqual(types([rec("s3", "logistics", { status: "In Transit", due: "2026-09-29" })]), ["ETA_APPROACHING"]);
  assert.deepEqual(types([rec("s4", "logistics", { status: "Documents Pending", due: "2026-10-30", updatedAt: at("2026-09-20") })]), ["DOCUMENTS_PENDING"]);
  const invoice = rec("i1", "accounts", { status: "Sent", amount: 5000, due: "2026-09-20", payments: [{ id: "p", amountCents: 100000, reference: "x", at: at("2026-09-21"), actor: "a" }] });
  const pay = run([invoice])[0];
  assert.deepEqual([pay.type, pay.severity, pay.label, pay.snoozable, pay.dismissible], ["PAYMENT_OVERDUE", "urgent", "$4,000 overdue by 7 days", false, false]);
  assert.deepEqual(types([rec("i2", "accounts", { status: "Draft", due: "2026-10-30", updatedAt: at("2026-09-20") })]), ["INVOICE_WAITING"]);
  assert.deepEqual(types([rec("i3", "accounts", { status: "Paid", due: "2026-09-01" })]), []);
});

test("completeness depends on the stage — a new enquiry isn't asked for quotation details", () => {
  const bare = { product: "", quantity: 0, destination: "", due: "" };
  assert.deepEqual(missingFields(rec("a", "leads", { status: "New", ...bare })), []);
  assert.deepEqual(missingFields(rec("b", "leads", { status: "New", ...bare, contact: "" })), ["contact"]);
  assert.deepEqual(missingFields(rec("c", "leads", { status: "Qualified", ...bare })), ["product", "quantity", "destination", "due"]);
  assert.deepEqual(missingFields(rec("d", "leads", { status: "Quote Sent", ...bare }), { hasQuotation: false, canSeeQuotations: true }), ["product", "quantity", "destination", "due", "quotation"]);
  assert.deepEqual(missingFields(rec("e", "customers", { status: "Active", contact: "", email: "", phone: "", destination: "" })), ["contact", "country"]);
  const s = run([rec("f", "leads", { status: "Negotiation", quantity: 0, destination: "", due: "2026-10-10" })]).find((x) => x.section === "data")!;
  assert.deepEqual([s.type, s.label, s.missing, s.severity, s.dismissible], ["LEAD_INCOMPLETE", "2 details missing", ["quantity", "destination"], "important", false]);
  const advisory = run([rec("g", "leads", { status: "Qualified", quantity: 0 })]).find((x) => x.section === "data")!;
  assert.deepEqual([advisory.severity, advisory.dismissible], ["normal", true]);
});

test("duplicates only on deterministic evidence — never merged", () => {
  assert.equal(normalizeName("ABC Trading LLC"), normalizeName("abc trading"));
  assert.equal(normalizeName("Gulf Oils FZCO."), "gulf oils");
  const a = rec("c1", "customers", { title: "ABC Trading", status: "Active" });
  const b = rec("c2", "customers", { title: "ABC Trading LLC", status: "Active" });
  const c = rec("c3", "customers", { title: "Zenith Lubes", status: "Active", email: "buy@zenith.test" });
  const d = rec("c4", "customers", { title: "Zenith Lubricants Est", status: "Active", email: "BUY@zenith.test" });
  const e = rec("c5", "customers", { title: "ABC Trading", status: "Active", company: "Afrilube" });
  const f = rec("c6", "customers", { title: "ABC Tradings", status: "Active" });
  const found = duplicateCandidates([a, b, c, d, e, f]).map((x) => [x.a.id, x.b.id, x.evidence]);
  assert.deepEqual(found, [
    ["c1", "c2", ["same name (ignoring legal suffixes)"]],
    ["c3", "c4", ["same email"]],
  ]);
  const s = run([a, b]).find((x) => x.type === "DUPLICATE_CANDIDATE")!;
  assert.deepEqual([s.key, s.actions, s.dismissible], ["DUPLICATE:c1:c2", ["review_duplicates"], true]);
});

test("meetings: starting soon, today, report not generated — no AI report is created", () => {
  const now = new Date("2026-09-27T09:40:00.000Z");
  const m = (extra: Partial<ProactiveMeeting>): ProactiveMeeting => ({ id: "m", title: "Call", status: "scheduled", scheduledAt: "2026-09-27T10:00:00.000Z", endedAt: null, relatedRecordId: null, createdBy: "md1", ...extra });
  assert.deepEqual(run([], [m({})], md, now).map((s) => [s.type, s.label]), [["MEETING_STARTING_SOON", "Starts in 20 minutes"]]);
  assert.deepEqual(run([], [m({ scheduledAt: "2026-09-27T14:00:00.000Z" })], md, now).map((s) => s.type), ["MEETING_TODAY"]);
  const ended = m({ id: "e", status: "ended", scheduledAt: null, endedAt: "2026-09-26T09:00:00.000Z", hasContent: true, hasReport: false });
  assert.deepEqual(run([], [ended], md, now).map((s) => [s.type, s.actions]), [["MEETING_REPORT_NOT_GENERATED", ["review_meeting", "generate_meeting_report"]]]);
  assert.deepEqual(run([], [{ ...ended, hasReport: true }], md, now), []);
  assert.deepEqual(run([], [{ ...ended, hasContent: false }], md, now), [], "nothing written: nothing to report on");
  assert.deepEqual(run([], [{ ...ended, createdBy: "someone-else" }], md, now), [], "the organiser's decision");
});

test("one condition, one signal; resolution is simply re-derivation; ranking is deterministic", () => {
  const lead = rec("l9", "leads", { status: "Qualified", due: "2026-09-24", amount: 90000 });
  const first = run([lead]);
  assert.equal(new Set(first.map((s) => s.key)).size, first.length);
  // Set a future follow-up: the overdue signal is gone.
  assert.deepEqual(run([{ ...lead, due: "2026-10-01" }]).filter((s) => s.type === "FOLLOW_UP_OVERDUE"), []);
  // Urgent before important before normal, regardless of input order.
  const mix = [rec("i", "accounts", { status: "Overdue", due: "2026-09-20" }), lead, rec("q", "quotations", { status: "Sent", due: "2026-09-10", updatedAt: at("2026-09-26") })];
  assert.deepEqual(run(mix).map((s) => s.severity), ["urgent", "important", "normal"]);
  assert.deepEqual(run([...mix].reverse()).map((s) => s.key), run(mix).map((s) => s.key));
});

test("automation rules are typed, closed and never write business data", () => {
  const accepted = DEFAULT_RULES.map((r) => ({ ...r, enabled: true }));
  assert.deepEqual(plan(accepted, { trigger: "STATUS_CHANGED", kind: "quotations", from: "Sent", to: "Accepted" }).map((p) => p.action.type), ["REQUEST_REVIEW"]);
  assert.deepEqual(plan(accepted, { trigger: "STATUS_CHANGED", kind: "leads", to: "Accepted" }), []);
  assert.deepEqual(plan(DEFAULT_RULES, { trigger: "PAYMENT_OVERDUE" }), [], "disabled by default");
  assert.equal(validRule({ id: "x", trigger: "STATUS_CHANGED", conditions: [{ type: "eval", code: "process.exit()" }], actions: [], enabled: true }), false);
  assert.equal(validRule({ id: "x", trigger: "STATUS_CHANGED", conditions: [], actions: [{ type: "DELETE_RECORD" }], enabled: true }), false);
  assert.equal(validRule({ id: "x", trigger: "RUN_SQL", conditions: [], actions: [], enabled: true }), false);
  assert.ok(DEFAULT_RULES.every(validRule));
  const allowed = new Set(["CREATE_NOTIFICATION", "CREATE_SIGNAL", "REQUEST_REVIEW"]);
  assert.ok(DEFAULT_RULES.flatMap((r) => r.actions).every((a) => allowed.has(a.type)));
});

test("a fingerprint identifies the condition, not the day — and holds no CRM values", () => {
  const lead = rec("fp1", "leads", { status: "Qualified", quantity: 0, title: "Secret Customer Name", amount: 123456 });
  const fp = (r: RecordItem, now = at(TODAY)) => proactiveSignals({ actor: md, records: [r], meetings: [], today: now.slice(0, 10), now: new Date(now) }).find((s) => s.section === "data")!.fingerprint;
  const base = fp(lead);
  expect8(base);
  assert.equal(fp(lead, at("2026-09-29")), base, "the same condition two days later is the same condition");
  assert.notEqual(fp({ ...lead, destination: "" }), base, "something else missing: a different condition");
  assert.notEqual(fp({ ...lead, status: "Negotiation" }), base, "a new stage: a different condition");
  // Gone quiet: new activity then quiet again is a new condition.
  const quiet = rec("fp2", "leads", { status: "Contacted", due: "", updatedAt: at("2026-09-01") });
  const q = (r: RecordItem) => run([r]).find((s) => s.type === "LEAD_GONE_QUIET")!.fingerprint;
  assert.notEqual(q(quiet), q({ ...quiet, updatedAt: at("2026-09-05") }));
});
function expect8(h: string) {
  assert.match(h, /^[0-9a-f]{8}$/);
}
