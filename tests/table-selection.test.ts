import test from "node:test";
import assert from "node:assert/strict";
import { makePreview, previewActor, demoAccounts } from "../src/lib/fixtures";
import {
  deletePreviewSelection,
  recordDeleteProblem,
  togglePageSelection,
} from "../src/lib/table-selection";

test("select page only adds visible IDs, preserves other pages and deduplicates", () => {
  assert.deepEqual(togglePageSelection(["a"], ["a", "b"], true), ["a", "b"]);
  assert.deepEqual(togglePageSelection(["a", "b", "c"], ["a", "b"], false), [
    "c",
  ]);
  assert.deepEqual(togglePageSelection(["a"], ["b", "c"], true), [
    "a",
    "b",
    "c",
  ]);
});
test("bulk preview deletion uses soft deletion and one audit event per selected row", () => {
  const data = makePreview();
  const rows = data.records.filter((r) => r.kind === "customers").slice(0, 2);
  const originalIds = data.records.map((r) => r.id);
  const { workspace, result } = deletePreviewSelection(
    data,
    previewActor,
    rows,
  );
  assert.deepEqual(
    result.deleted,
    rows.map((r) => r.id),
  );
  assert.deepEqual(result.failed, []);
  assert.equal(workspace.audit.length, data.audit.length + rows.length);
  assert.deepEqual(
    workspace.records.map((r) => r.id),
    originalIds,
  );
  for (const r of workspace.records)
    assert.equal(
      Boolean(r.deletedAt),
      rows.some((row) => row.id === r.id),
    );
  assert.ok(
    data.records.every((r) => !r.deletedAt),
    "original fixture is not mutated",
  );
});
test("bulk deletion preserves protected, linked and stale records and reports partial failures", () => {
  const data = makePreview(),
    customer = data.records.find((r) => r.kind === "customers")!,
    invoice = data.records.find((r) => r.kind === "accounts")!;
  const stale = {
    ...data.records.find((r) => r.kind === "suppliers")!,
    updatedAt: "stale",
  };
  data.records.push({ ...customer, id: "linked-child", parentId: customer.id });
  assert.match(
    recordDeleteProblem(previewActor, customer, data.records),
    /linked/,
  );
  assert.match(
    recordDeleteProblem(previewActor, invoice, data.records),
    /workflow|audit/,
  );
  const { workspace, result } = deletePreviewSelection(data, previewActor, [
    customer,
    invoice,
    stale,
  ]);
  assert.equal(result.deleted.length, 0);
  assert.equal(result.failed.length, 3);
  assert.ok(workspace.records.every((r) => !r.deletedAt));
});
test("bulk deletion never bypasses company or sales ownership boundaries", () => {
  const data = makePreview(),
    other = {
      ...data.records.find((r) => r.kind === "leads")!,
      id: "other-lead",
      ownerId: "another-person",
      attributes: {},
    };
  data.records.push(other);
  const sales = demoAccounts.find((a) =>
    a.actor.role.startsWith("Sales"),
  )!.actor;
  assert.match(recordDeleteProblem(sales, other, data.records), /permission/);
  assert.equal(
    deletePreviewSelection(data, sales, [other]).result.deleted.length,
    0,
  );
  const restricted = { ...previewActor, companies: ["Afrilube"] };
  const row = data.records.find((r) => r.company !== "Afrilube")!;
  assert.match(
    recordDeleteProblem(restricted, row, data.records),
    /permission/,
  );
});
