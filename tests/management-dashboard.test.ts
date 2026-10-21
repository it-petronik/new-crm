import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePreview, previewActor, demoAccounts } from "../src/lib/fixtures";
import {
  canViewManagement,
  completedWork,
  managementCsv,
  managementSnapshot,
  openWork,
  overdueWork,
  type TeamPerson,
} from "../src/lib/management-dashboard";
import type { RecordItem } from "../src/lib/domain";

const people: TeamPerson[] = demoAccounts.map((a) => ({
  ...a.actor,
  active: true,
}));
const base = makePreview().records[0];
const record = (id: string, values: Partial<RecordItem> = {}): RecordItem => ({
  ...base,
  id,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  due: "2026-10-23",
  kind: "leads",
  status: "New",
  ownerId: "preview-sales",
  owner: "Leila Ahmed",
  company: "Petronik",
  attributes: {},
  ...values,
});

test("management is restricted to MD, assistant and IT, retaining module access", () => {
  for (const role of ["MD", "MD Assistant", "IT Administrator"] as const)
    assert.equal(canViewManagement({ ...previewActor, role }), true);
  for (const { actor } of demoAccounts.filter(
    (a) => !["MD", "IT Administrator"].includes(a.actor.role),
  ))
    assert.equal(canViewManagement(actor), false);
  assert.equal(
    canViewManagement({ ...previewActor, moduleAccess: { overview: "none" } }),
    false,
  );
  assert.throws(
    () => managementSnapshot(demoAccounts[1].actor, [], people),
    /not available/,
  );
});
test("all six departments appear, including zero-data departments", () => {
  const report = managementSnapshot(previewActor, [], people);
  assert.equal(report.departments.length, 6);
  assert.equal(report.employees.length, people.length);
  assert.equal(report.employees.find((p) => p.id === "preview-sales")?.open, 0);
  assert.ok(
    report.departments.every(
      (d) => d.open === 0 && d.completed === 0 && d.overdue === 0,
    ),
  );
});
test("open work excludes master data, cash entries, cancellations and issued proformas", () => {
  assert.equal(
    openWork(record("customer", { kind: "customers", status: "Active" })),
    false,
  );
  assert.equal(
    openWork(record("employee", { kind: "hr", status: "Active" })),
    false,
  );
  assert.equal(
    openWork(record("cancelled", { kind: "orders", status: "Cancelled" })),
    false,
  );
  assert.equal(
    openWork(
      record("cash", {
        kind: "accounts",
        attributes: { entryType: "Expense" },
        status: "Recorded",
      }),
    ),
    false,
  );
  assert.equal(
    openWork(
      record("issued", {
        kind: "accounts",
        attributes: { documentType: "proforma" },
        status: "Issued",
      }),
    ),
    false,
  );
  assert.equal(
    completedWork(
      record("delivered", { kind: "logistics", status: "Delivered" }),
    ),
    true,
  );
  assert.equal(completedWork(record("lost", { status: "Lost" })), false);
  assert.equal(
    completedWork(
      record("rejected leave", { kind: "leave", status: "Rejected" }),
    ),
    true,
  );
  assert.equal(
    overdueWork(record("open", { due: "2026-10-20" }), "2026-10-21"),
    true,
  );
  assert.equal(
    overdueWork(
      record("delivered", {
        kind: "logistics",
        status: "Delivered",
        due: "2026-10-20",
      }),
      "2026-10-21",
    ),
    false,
  );
});
test("company, branch, module, soft-delete and creation-period boundaries apply again", () => {
  const actor = {
    ...previewActor,
    companies: ["Petronik"],
    branches: ["Main"],
    moduleAccess: { it: "none" as const },
  };
  const rows = [
    record("yes", { branch: "Main" }),
    record("brand", { company: "Afrilube" }),
    record("branch", { branch: "Other" }),
    record("old", { createdAt: "2026-09-01T10:00:00.000Z" }),
    record("deleted", { deletedAt: "2026-10-04" }),
    record("disabled", { kind: "it", branch: "Main" }),
  ];
  const report = managementSnapshot(actor, rows, [], {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(
    report.records.map((r) => r.id),
    ["yes"],
  );
  assert.ok(!report.departments.some((d) => d.id === "it"));
  assert.equal(
    managementSnapshot(previewActor, rows, [], { company: "Afrilube" }).records
      .length,
    1,
  );
});
test("owner IDs keep identical names separate, inactive and unlinked owners remain visible", () => {
  const roster = [
    { ...people[1], name: "Same Name" },
    { ...people[1], id: "another-person", name: "Same Name", active: false },
  ];
  const report = managementSnapshot(
    previewActor,
    [
      record("one"),
      record("two", { ownerId: "another-person" }),
      record("three", { ownerId: "former-person", owner: "Former Person" }),
    ],
    roster,
  );
  assert.equal(report.employees.length, 3);
  assert.equal(
    report.employees.filter((p) => p.name === "Same Name").length,
    2,
  );
  assert.equal(
    report.employees.find((p) => p.id === "another-person")?.active,
    false,
  );
  assert.equal(
    report.employees.find((p) => p.id === "former-person")?.linked,
    false,
  );
  assert.ok(report.employees.every((p) => p.open === 1));
});
test("reports include records beyond the ordinary 1000-row workspace window", () => {
  const rows = Array.from({ length: 1205 }, (_, i) => record(String(i)));
  const report = managementSnapshot(previewActor, rows, people);
  assert.equal(report.departments[0].open, 1205);
  assert.equal(
    report.employees.find((p) => p.id === "preview-sales")?.open,
    1205,
  );
});
test("unknown first response is not zero, and record updates are not staff activity", () => {
  const report = managementSnapshot(previewActor, [record("one")], people);
  const employee = report.employees.find((p) => p.id === "preview-sales")!;
  assert.equal(employee.responseMinutes, null);
  assert.equal(employee.responseSamples, 0);
  const csv = managementCsv(report, {
    scope: "All companies",
    from: "",
    to: "",
    asOf: "Fictional preview",
  });
  assert.match(csv, /Not attendance/);
  assert.match(csv, /Latest record update/);
  assert.match(csv, /Unknown/);
});
test("management API pages full authorized scope and never exposes security fields in roster", () => {
  const route = readFileSync(
    "src/app/api/management/overview/route.ts",
    "utf8",
  );
  assert.match(route, /canViewManagement\(actor\)/);
  assert.match(route, /!r.deletedAt && canRead\(actor, r\)/);
  assert.match(route, /listManagementPage/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /passwordHash:|email: p.email|\.\.\.p\b/);
});
test("tab icon uses the approved flame paths without rendered lettering", () => {
  const svg = readFileSync("public/brands/enercore-flame.svg", "utf8");
  const master = readFileSync("public/brands/enercore.svg", "utf8");
  assert.deepEqual(
    [...svg.matchAll(/<path[^>]*d="([^"]+)"/g)].map((m) => m[1]),
    [...master.matchAll(/<path[^>]*d="([^"]+)"/g)].map((m) => m[1]),
  );
  assert.doesNotMatch(svg, /<text\b|<image\b/);
  assert.match(
    readFileSync("src/app/layout.tsx", "utf8"),
    /enercore-flame.svg/,
  );
});
