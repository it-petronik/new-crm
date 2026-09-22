import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordProfiles,
  detailFields,
  recordFieldValue,
} from "../src/lib/record-profiles";
import { makePreview } from "../src/lib/fixtures";
test("leave and marketing details do not inherit commercial units", () => {
  const records = makePreview().records;
  const leave = records.find((r) => r.kind === "leave")!;
  const campaign = records.find((r) => r.kind === "marketing")!;
  assert.equal(
    detailFields({ ...leave, unit: "MT" }).find(
      ([label]) => label === "Working days",
    )?.[1],
    `${leave.quantity} days`,
  );
  assert.equal(
    detailFields({ ...campaign, unit: "MT" }).find(
      ([label]) => label === "Lead target",
    )?.[1],
    `${campaign.quantity} leads`,
  );
  assert.ok(
    recordProfiles.accounts.fields.some((f) => f.label === "Invoice amount"),
  );
});
test("employee, customer and IT profiles do not show sales-only quantities or values", () => {
  for (const kind of ["hr", "customers", "it"] as const) {
    const names = recordProfiles[kind].fields.map((f) => f.name);
    assert.ok(!names.includes("amount"));
    assert.ok(!names.includes("quantity"));
  }
  assert.ok(
    recordProfiles.hr.fields.some((f) => f.name === "attributes.department"),
  );
  assert.ok(
    recordProfiles.it.fields.some((f) => f.name === "attributes.priority"),
  );
});
test("employee details preserve job title and omit financial fields", () => {
  const employee = makePreview().records.find((r) => r.kind === "hr")!;
  const fields = detailFields(employee);
  assert.ok(
    fields.some(
      ([label, value]) =>
        label === "Job title" && value === "Managing Director",
    ),
  );
  assert.ok(
    !fields.some(([label]) =>
      ["Value", "Quantity", "Order value"].includes(label),
    ),
  );
});
test("new attributes are shown while older records remain readable", () => {
  const ticket = makePreview().records.find((r) => r.kind === "it")!;
  assert.equal(recordFieldValue(ticket, "attributes.priority"), "");
  assert.equal(
    recordFieldValue(
      { ...ticket, attributes: { priority: "High" } },
      "attributes.priority",
    ),
    "High",
  );
});
test("all module profiles have distinct identity and no duplicate field names", () => {
  for (const profile of Object.values(recordProfiles)) {
    assert.ok(profile.title && profile.nameLabel && profile.description);
    assert.equal(
      new Set(profile.fields.map((f) => f.name)).size,
      profile.fields.length,
    );
  }
});
test("record details omit legacy branch fields without modifying stored records", () => {
  for (const record of makePreview().records) {
    const originalBranch = record.branch;
    assert.ok(!detailFields(record).some(([label]) => /branch/i.test(label)));
    assert.equal(record.branch, originalBranch);
  }
});
