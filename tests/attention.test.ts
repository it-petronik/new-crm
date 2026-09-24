import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionItems, myDay, followUpPresets, isOpen, idleDays } from "../src/lib/attention";
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
