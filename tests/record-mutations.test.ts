import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { mutateRecord } from "../src/lib/record-mutations";
import { scopedWorkspace } from "../src/lib/domain";
test("edit preserves ownership, history and unrelated attributes", () => {
  const data = makePreview(); const r = data.records.find(r => r.kind === "customers")!;
  r.attributes = { website: "example.test", custom: "retain" };
  const result = mutateRecord(data, previewActor, r.id, r.updatedAt, { title: "Updated customer", ownerId: "attacker", status: "Deleted", attributes: { website: "changed.test" } });
  const updated = result.records.find(v => v.id === r.id)!;
  assert.equal(updated.title, "Updated customer"); assert.equal(updated.ownerId, r.ownerId); assert.equal(updated.status, r.status); assert.equal(updated.attributes?.custom, "retain");
  assert.equal(result.audit.length, data.audit.length + 1);
  assert.throws(() => mutateRecord(data, previewActor, r.id, "stale", {}), /changed/);
  assert.throws(() => mutateRecord(data, previewActor, r.id, r.updatedAt, { company: "Afrilube" }), /cannot/);
});
test("deletion retains audit payload, hides record and checks scope and linked records", () => {
  const data = makePreview(); const r = data.records.find(r => r.kind === "customers")!;
  const deleted = mutateRecord(data, previewActor, r.id, r.updatedAt);
  assert.ok(deleted.records.find(v => v.id === r.id)?.deletedAt);
  assert.ok(!scopedWorkspace(previewActor, deleted).records.some(v => v.id === r.id));
  assert.throws(() => mutateRecord(data, { ...previewActor, role: "MD Assistant" }, r.id, r.updatedAt), /permission/);
  assert.throws(() => mutateRecord(data, { ...previewActor, companies: ["Afrilube"] }, r.id, r.updatedAt), /permission/);
  data.records.push({ ...r, id: "child", parentId: r.id });
  assert.throws(() => mutateRecord(data, previewActor, r.id, r.updatedAt), /linked/);
});
test("commercial records allow corrections but protect financial fields and payments", () => {
  const data = makePreview(); const r = data.records.find(r => r.kind === "accounts")!;
  const result = mutateRecord(data, previewActor, r.id, r.updatedAt, { amount: 1, contact: "Correct contact", payments: [] });
  const updated = result.records.find(v => v.id === r.id)!;
  assert.equal(updated.amount, r.amount); assert.equal(updated.contact, "Correct contact"); assert.deepEqual(updated.payments, r.payments);
  assert.throws(() => mutateRecord(data, previewActor, r.id, r.updatedAt), /workflow/);
});
