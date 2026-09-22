import { test } from "node:test";
import assert from "node:assert/strict";
import { canRead, canWrite, type RecordItem } from "../src/lib/domain";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { transition } from "../src/lib/workflow";
import { recordProfiles } from "../src/lib/record-profiles";
const supplier: RecordItem = {
  ...makePreview().records[0],
  id: "supplier-test",
  kind: "suppliers",
  company: "Petronik",
  status: "Active",
};
test("suppliers respect company boundaries, read-only restrictions and existing role access", () => {
  assert.equal(canWrite(previewActor, supplier), true);
  assert.equal(
    canRead({ ...previewActor, companies: ["Afrilube"] }, supplier),
    false,
  );
  assert.equal(
    canWrite(
      { ...previewActor, moduleAccess: { suppliers: "read" } },
      supplier,
    ),
    false,
  );
  assert.equal(
    canRead({ ...previewActor, role: "Sales Executive" }, supplier),
    false,
  );
  assert.equal(
    canWrite({ ...previewActor, role: "MD Assistant" }, supplier),
    false,
  );
});
test("supplier status changes remain audited and do not create financial records", () => {
  const result = transition(
    { records: [supplier], audit: [] },
    previewActor,
    supplier.id,
    "On Hold",
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].status, "On Hold");
  assert.equal(result.audit.length, 1);
  assert.ok(
    recordProfiles.suppliers.fields.some(
      (f) => f.name === "attributes.taxNumber",
    ),
  );
});
