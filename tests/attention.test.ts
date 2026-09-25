import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attentionItems, myDay, followUpPresets, isOpen, idleDays,
  nextAction, staleRecords, morningBrief, operationalViews,
} from "../src/lib/attention";
import { previewActor } from "../src/lib/fixtures";
import type { Actor, RecordItem } from "../src/lib/domain";

const TODAY = "2026-09-25";
const rec = (over: Partial<RecordItem> = {}): RecordItem =>
  ({
    id: over.id || Math.random().toString(36).slice(2),
    kind: "leads", company: "Petronik", branch: "Main",
    title: "Acme", contact: "", product: "", quantity: 0, unit: "MT",
    amount: 0, currency: "USD", status: "New", ownerId: previewActor.id,
    owner: previewActor.name, due: TODAY, detail: "", source: "Manual",
    createdAt: `${TODAY}T00:00:00.000Z`, updatedAt: `${TODAY}T00:00:00.000Z`,
    ...over,
  }) as RecordItem;

test("closed records never ask for attention", () => {
  for (const status of ["Won", "Lost", "Completed", "Paid", "Cancelled", "Resolved"])
    assert.equal(isOpen(rec({ status })), false, status);
  assert.equal(isOpen(rec({ deletedAt: `${TODAY}T00:00:00.000Z` } as Partial<RecordItem>)), false);
  const items = attentionItems(previewActor, [rec({ status: "Won", due: "2026-01-01" })], TODAY);
  assert.equal(items.length, 0, "a won deal is not an overdue follow-up");
});

test("problems are ranked by urgency, not by order or value alone", () => {
  const items = attentionItems(previewActor, [
    rec({ id: "cold", due: "", updatedAt: "2026-08-01T00:00:00.000Z", amount: 5_000_000 }),
    rec({ id: "late", due: "2026-09-18", amount: 10 }),
    rec({ id: "overdue-payment", kind: "accounts", status: "Overdue", due: "", amount: 100 }),
  ], TODAY);

  const ids = items.map((i) => i.record.id);
  assert.equal(ids[0], "overdue-payment", "money already late outranks everything");
  assert.equal(ids[1], "late", "an overdue commitment outranks a merely stale one");
  assert.ok(
    ids.indexOf("cold") > ids.indexOf("late"),
    "a large but not-yet-late opportunity must not outrank an overdue one",
  );
});

test("each problem states what it is and how to resolve it", () => {
  const [item] = attentionItems(previewActor, [rec({ due: "2026-09-19" })], TODAY);
  assert.equal(item.severity, "urgent");
  assert.equal(item.category, "Follow-up");
  assert.equal(item.action, "follow-up");
  assert.match(item.reason, /6 days overdue/);

  const [today] = attentionItems(previewActor, [rec({ due: TODAY })], TODAY);
  assert.equal(today.severity, "warning");
  assert.match(today.reason, /due today/);

  const [quote] = attentionItems(previewActor, [
    rec({ kind: "quotations", status: "Sent", due: "", updatedAt: "2026-09-10T00:00:00.000Z" }),
  ], TODAY);
  assert.equal(quote.category, "Quotation");
  assert.match(quote.reason, /no response/);
});

test("a person's day is their own work, but approvals are a duty", () => {
  const other: Actor = { ...previewActor, id: "someone-else" };
  const records = [
    rec({ id: "mine", due: "2026-09-20" }),
    rec({ id: "theirs", ownerId: other.id, owner: "Other", due: "2026-09-20" }),
  ];
  const day = myDay(previewActor, records, TODAY);
  assert.deepEqual(day.overdue.map((i) => i.record.id), ["mine"], "only my own follow-ups");
  assert.equal(day.clear, false);
});

test("an empty day is reported as caught up, not as no data", () => {
  const day = myDay(previewActor, [], TODAY);
  assert.equal(day.clear, true);
  assert.equal(day.overdue.length + day.today.length + day.approvals.length, 0);

  // Something merely upcoming does not make the day un-clear.
  const upcoming = myDay(previewActor, [rec({ due: "2026-09-29" })], TODAY);
  assert.equal(upcoming.clear, true);
  assert.equal(upcoming.soon.length, 1, "but it is shown as coming up");
});

test("follow-up presets are all in the future and ordered", () => {
  const presets = followUpPresets(new Date(`${TODAY}T00:00:00.000Z`));
  assert.deepEqual(presets.map((p) => p.label), ["Tomorrow", "In 3 days", "Next week", "In 2 weeks"]);
  assert.equal(presets[0].date, "2026-09-26");
  for (const preset of presets) assert.ok(preset.date > TODAY, preset.label);
});

test("idle time is measured from the last change", () => {
  assert.equal(idleDays(rec({ updatedAt: "2026-09-20T00:00:00.000Z" }), TODAY), 5);
});

test("every open record says what to do next, without anyone maintaining a field", () => {
  const cases: [Partial<RecordItem>, RegExp, string][] = [
    [{ due: "2026-09-19" }, /Follow up — 6 days late/, "urgent"],
    [{ due: TODAY }, /Follow up today/, "warning"],
    [{ due: "2026-09-26" }, /Follow up tomorrow/, "info"],
    [{ kind: "leads", status: "New", due: "" }, /Make first contact/, "info"],
    [{ kind: "leads", status: "Qualified", due: "" }, /Prepare quotation/, "info"],
    [{ kind: "quotations", status: "Draft", due: "" }, /Send quotation/, "info"],
    [{ kind: "quotations", status: "Sent", due: "" }, /Awaiting customer response/, "info"],
    [{ kind: "quotations", status: "Sent", due: "", updatedAt: "2026-09-10T00:00:00.000Z" }, /No response for 15 days/, "warning"],
    [{ status: "Overdue", due: "" }, /Payment overdue/, "urgent"],
    [{ kind: "logistics", status: "Delayed", due: "" }, /Shipment delayed/, "urgent"],
    [{ status: "Pending Approval", due: "" }, /Awaiting approval/, "warning"],
  ];
  for (const [over, pattern, tone] of cases) {
    const action = nextAction(rec(over), TODAY);
    assert.match(action.label, pattern, JSON.stringify(over));
    assert.equal(action.tone, tone, action.label);
  }
  // A finished record asks for nothing.
  assert.equal(nextAction(rec({ status: "Won" }), TODAY).tone, "done");
});

test("staleness uses a threshold suited to the kind of record", () => {
  const quiet = (kind: RecordItem["kind"], days: number) =>
    rec({ kind, due: "", updatedAt: `2026-09-${String(25 - days).padStart(2, "0")}T00:00:00.000Z` });
  // A quotation going quiet for 10 days is a problem; a supplier record is not.
  assert.equal(staleRecords([quiet("quotations", 10)], TODAY).length, 1);
  assert.equal(staleRecords([quiet("suppliers", 10)], TODAY).length, 0);
  assert.equal(staleRecords([quiet("leads", 10)], TODAY).length, 0, "under the 14-day lead threshold");
  assert.equal(staleRecords([quiet("leads", 20)], TODAY).length, 1);
  // A closed record is never stale.
  assert.equal(staleRecords([{ ...quiet("leads", 40), status: "Won" }], TODAY).length, 0);
});

test("the morning brief counts facts and stays silent when there is nothing to say", () => {
  assert.deepEqual(morningBrief(previewActor, [], TODAY), [], "a quiet company gets no bullets");

  const lines = morningBrief(previewActor, [
    rec({ kind: "accounts", status: "Overdue", due: "", amount: 184000, currency: "AED" }),
    rec({ kind: "quotations", status: "Sent", due: "", updatedAt: "2026-09-10T00:00:00.000Z" }),
    rec({ kind: "logistics", status: "Delayed", due: "" }),
    rec({ status: "Won", due: "", updatedAt: `${TODAY}T09:00:00.000Z`, amount: 50000 }),
  ], TODAY);

  const text = lines.map((l) => l.text).join(" | ");
  assert.match(text, /AED 184k overdue across 1 invoice/);
  assert.match(text, /1 quotation has had no response for 7\+ days/);
  assert.match(text, /1 shipment is delayed/);
  assert.match(text, /1 deal won since yesterday/);
  // Nothing is padded with zeroes.
  assert.ok(!/\b0 /.test(text), text);
  // Urgent facts are marked as such, and money links to its module.
  assert.equal(lines.find((l) => /overdue across/.test(l.text))?.tone, "urgent");
  assert.equal(lines.find((l) => /overdue across/.test(l.text))?.to, "accounts");
});

test("operational views answer real questions and hide the empty ones", () => {
  const views = operationalViews(previewActor, [
    rec({ id: "late", due: "2026-09-19" }),
    rec({ id: "now", due: TODAY }),
    rec({ id: "quiet-quote", kind: "quotations", status: "Sent", due: "", updatedAt: "2026-09-10T00:00:00.000Z" }),
    rec({ id: "stuck", kind: "logistics", status: "Delayed", due: "" }),
    rec({ id: "unpaid", kind: "accounts", status: "Overdue", due: "", amount: 5000 }),
    rec({ id: "won", status: "Won", due: "2026-09-01" }),
  ], TODAY);

  const byId = new Map(views.map((v) => [v.id, v]));
  assert.deepEqual(byId.get("overdue")?.records.map((r) => r.id), ["late"]);
  assert.deepEqual(byId.get("today")?.records.map((r) => r.id), ["now"]);
  assert.deepEqual(byId.get("silent-quotes")?.records.map((r) => r.id), ["quiet-quote"]);
  assert.deepEqual(byId.get("delayed")?.records.map((r) => r.id), ["stuck"]);
  assert.deepEqual(byId.get("unpaid")?.records.map((r) => r.id), ["unpaid"]);

  // A closed record belongs to no operational slice.
  for (const view of views)
    assert.ok(!view.records.some((r) => r.id === "won"), `${view.id} must exclude won deals`);

  // Slices with nothing in them are not offered at all.
  assert.equal(operationalViews(previewActor, [], TODAY).length, 0);
  for (const view of views) assert.ok(view.records.length > 0, view.id);
});

test("operational views only ever contain records handed to them", () => {
  // The caller scopes by permission; the view must not widen that.
  const mine = rec({ id: "mine", ownerId: previewActor.id, due: "2026-09-19" });
  const views = operationalViews(previewActor, [mine], TODAY);
  const ids = new Set(views.flatMap((v) => v.records.map((r) => r.id)));
  assert.deepEqual([...ids], ["mine"]);
  assert.deepEqual(
    views.find((v) => v.id === "mine")?.records.map((r) => r.id),
    ["mine"],
  );
});
