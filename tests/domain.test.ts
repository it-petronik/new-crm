import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRead,
  canWrite,
  canApprove,
  scopedWorkspace,
  totalCents,
  type Actor,
} from "../src/lib/domain";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { transition } from "../src/lib/workflow";
const sales: Actor = {
  id: "preview-sales",
  name: "Leila Ahmed",
  role: "Sales Executive",
  companies: ["Petronik"],
  branches: ["Main"],
};
test("company and branch boundaries prevent access", () => {
  const data = makePreview();
  const r = data.records[0];
  assert.equal(canRead(sales, r), true);
  assert.equal(canRead(sales, { ...r, company: "Afrilube" }), false);
  assert.equal(canWrite(sales, { ...r, branch: "Other" }), false);
});
test("sales representatives cannot access finance or another owner’s leads", () => {
  const r = makePreview().records[0];
  assert.equal(canRead(sales, { ...r, kind: "accounts" }), false);
  assert.equal(canRead(sales, { ...r, ownerId: "someone-else" }), false);
});
test("MD assistant has read access but no mutation permission", () => {
  const r = makePreview().records[0];
  const actor = { ...previewActor, role: "MD Assistant" as const };
  assert.equal(canRead(actor, r), true);
  assert.equal(canWrite(actor, r), false);
});
test("IT role does not expose HR or finance records", () => {
  const actor = { ...previewActor, role: "IT Administrator" as const };
  const data = scopedWorkspace(actor, makePreview());
  assert.equal(
    data.records.some((r) => ["hr", "accounts"].includes(r.kind)),
    false,
  );
});
test("approvers cannot approve their own request", () => {
  const r = makePreview().records.find((r) => r.kind === "quotations")!;
  assert.equal(canApprove({ ...previewActor, id: r.ownerId }, r), false);
});
test("quote acceptance atomically produces one linked order, shipment and draft invoice", () => {
  const data = makePreview();
  const quote = data.records.find(
    (r) => r.kind === "quotations" && r.status === "Approved",
  )!;
  const result = transition(data, previewActor, quote.id, "Accepted");
  assert.equal(result.records.length, data.records.length + 3);
  const linked = result.records.filter((r) => r.id.startsWith(quote.id + "-"));
  assert.deepEqual(
    linked.map((r) => r.kind),
    ["orders", "logistics", "accounts"],
  );
  assert.equal(linked[2].status, "Draft");
  assert.equal(linked[1].parentId, linked[0].id);
  assert.equal(result.audit.length, data.audit.length + 1);
  const repeated = transition(result, previewActor, quote.id, "Accepted");
  assert.equal(repeated.records.length, result.records.length);
});
test("pending quotation cannot skip approval", () => {
  const data = makePreview();
  const quote = data.records.find(
    (r) => r.kind === "quotations" && r.status === "Pending Approval",
  )!;
  assert.throws(
    () => transition(data, previewActor, quote.id, "Accepted"),
    /Approve/,
  );
  assert.throws(
    () => transition(data, sales, quote.id, "Approved"),
    /authorised/,
  );
});
test("foreign company mutation is rejected", () => {
  const data = makePreview();
  const r = data.records.find((r) => r.company === "Afrilube")!;
  assert.throws(() => transition(data, sales, r.id, "Contacted"), /permission/);
});
test("money helper rounds line items to whole minor units", () =>
  assert.equal(
    totalCents([
      { quantity: 1.5, unitPriceCents: 101 },
      { quantity: 2, unitPriceCents: 250 },
    ]),
    652,
  ));
