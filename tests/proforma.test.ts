import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWrite,
  canRead,
  isProforma,
  outstanding,
  recordStages,
  roles,
  type Actor,
  type RecordItem,
} from "../src/lib/domain";
import { makePreview, previewActor } from "../src/lib/fixtures";
import {
  proformaError,
  proformaReference,
  canCreateProforma,
} from "../src/lib/proforma";
import { transition, recordPayment, addNote } from "../src/lib/workflow";
import { mutateRecord } from "../src/lib/record-mutations";
import { proformaData } from "../src/lib/pdf/proforma-data";
import { attentionItems } from "../src/lib/attention";
import { roleHome } from "../src/lib/role-home";
const accountant: Actor = {
  ...previewActor,
  id: "test-accountant",
  role: "Accountant",
  name: "Test Accountant",
  companies: ["Petronik"],
  branches: ["Main"],
};
const draft = (): RecordItem => ({
  ...makePreview().records[0],
  id: "PROFORMA-TEST-01",
  kind: "accounts",
  company: "Petronik",
  branch: "Main",
  status: "Draft",
  title: "Fictional Customer",
  customerId: "customer-1",
  ownerId: accountant.id,
  owner: accountant.name,
  amount: 128800,
  unit: "MT",
  lines: [
    {
      description: "Base Oil SN500",
      packaging: "Flexi bags",
      quantity: 80,
      unitPriceCents: 161000,
    },
  ],
  due: "2026-10-22",
  attributes: {
    documentType: "proforma",
    issuedDate: "2026-10-19",
    quoteReference: "PI-TEST-01",
    originCountry: "India",
    loadingPort: "India",
    partialShipment: "No",
  },
});
test("only finance roles can create or write proformas, with company, branch and read-only boundaries", () => {
  for (const role of roles) {
    const actor = { ...accountant, role };
    assert.equal(
      canCreateProforma(actor, "Petronik", "Main"),
      ["Accountant", "Accounts Manager"].includes(role),
      role,
    );
    assert.equal(
      canWrite(actor, draft()),
      ["Accountant", "Accounts Manager"].includes(role),
      role,
    );
  }
  assert.equal(canRead(previewActor, draft()), true);
  assert.equal(canCreateProforma(accountant, "Afrilube", "Main"), false);
  assert.equal(canCreateProforma(accountant, "Petronik", "Other"), false);
  assert.equal(
    canCreateProforma(
      { ...accountant, moduleAccess: { accounts: "read" } },
      "Petronik",
      "Main",
    ),
    false,
  );
});
test("proformas are never receivables and have no paid states", () => {
  for (const status of ["Draft", "Issued", "Cancelled"])
    assert.equal(outstanding({ ...draft(), status }), 0);
  assert.deepEqual(recordStages(draft()), ["Draft", "Issued", "Cancelled"]);
  assert.equal(outstanding({ ...draft(), attributes: {} }), 128800);
});
test("issuing records the responsible accountant, creates no order, payment or supplier document", () => {
  const result = transition(
    { records: [draft()], audit: [] },
    accountant,
    draft().id,
    "Issued",
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].attributes?.issuedById, accountant.id);
  assert.equal(result.records[0].payments?.length || 0, 0);
  assert.equal(result.records[0].status, "Issued");
  assert.equal(result.audit.length, 1);
  assert.equal(transition(result, accountant, draft().id, "Issued"), result);
  assert.throws(
    () => transition(result, accountant, draft().id, "Draft"),
    /cannot be reopened/,
  );
  assert.throws(
    () => transition(result, accountant, draft().id, "Paid"),
    /available status/,
  );
  assert.throws(
    () => recordPayment(result, accountant, draft().id, 100, "TEST"),
    /not a payment invoice/,
  );
  const cancelled = transition(result, accountant, draft().id, "Cancelled");
  assert.throws(
    () => transition(cancelled, accountant, draft().id, "Issued"),
    /cannot be reopened/,
  );
});
test("draft changes recalculate totals; issued documents, references, types and audit fields are protected", () => {
  const r = draft(),
    workspace = { records: [r], audit: [] };
  const result = mutateRecord(workspace, accountant, r.id, r.updatedAt, {
    amount: 2,
    lines: [
      { description: "Edited product", quantity: 2, unitPriceCents: 1250 },
    ],
  });
  assert.equal(result.records[0].amount, 25);
  assert.throws(
    () =>
      mutateRecord(workspace, accountant, r.id, "old", { detail: "Changed" }),
    /changed/,
  );
  assert.throws(
    () =>
      mutateRecord(workspace, accountant, r.id, r.updatedAt, {
        attributes: { documentType: "taxInvoice" },
      }),
    /type cannot/,
  );
  assert.throws(
    () =>
      mutateRecord(workspace, accountant, r.id, r.updatedAt, {
        attributes: { issuedBy: "Another" },
      }),
    /system/,
  );
  const issued = transition(workspace, accountant, r.id, "Issued");
  assert.throws(
    () =>
      mutateRecord(issued, accountant, r.id, issued.records[0].updatedAt, {
        detail: "Changed",
      }),
    /cannot be edited/,
  );
  assert.throws(
    () => mutateRecord(workspace, accountant, r.id, r.updatedAt),
    /cancelled/,
  );
  assert.throws(
    () => addNote(issued, accountant, r.id, "Note", "2026-11-01"),
    /validity date/,
  );
});
test("proforma validation rejects missing customer, invalid date, blank lines and mixed cash entries", () => {
  assert.equal(proformaError(draft()), "");
  assert.match(proformaError({ ...draft(), customerId: null }), /customer/);
  assert.match(proformaError({ ...draft(), due: "2026-10-01" }), /Validity/);
  assert.match(
    proformaError({
      ...draft(),
      lines: [{ description: " ", quantity: 1, unitPriceCents: 0 }],
    }),
    /description/,
  );
  assert.match(
    proformaError({
      ...draft(),
      attributes: { ...draft().attributes, entryType: "Income" },
    }),
    /cashbook/,
  );
  assert.match(
    proformaError({
      ...draft(),
      attributes: { ...draft().attributes, bankName: "Test Bank" },
    }),
    /Complete the bank/,
  );
});
test("PDF uses dynamic trade fields and no copied bank account or signatory", () => {
  const data = proformaData(draft());
  assert.equal(data.totals.total, 128800);
  assert.equal(data.refNo, "PI-TEST-01");
  assert.equal(data.bankAccount, null);
  assert.equal(data.signatory.signedBy, null);
  assert.equal(data.dates.invoiceDate, "2026-10-19");
  assert.match(data.notes, /DRAFT/);
  assert.deepEqual(
    data.extraInfo.map((x) => x.label),
    ["Invoice validity", "Origin", "Port of loading", "Partial Shipment Allowed"],
  );
  assert.equal(isProforma(draft()), true);
});
test("proforma references are deterministic for retries and distinct for distinct identifiers", () => {
  assert.equal(
    proformaReference("request-1111222233334444", "2026-10-19"),
    "PI-2026-10-1111222233334444",
  );
  assert.notEqual(
    proformaReference("req-1111222233334444", "2026-10-19"),
    proformaReference("req-1111222233334445", "2026-10-19"),
  );
});
test("proforma expiry is not reported as an overdue payment or follow-up", () => {
  const result = attentionItems(accountant, [draft()], "2026-11-01");
  assert.deepEqual(
    result.map((x) => x.category),
    ["Proforma"],
  );
  assert.equal(
    attentionItems(accountant, [{ ...draft(), status: "Issued" }], "2026-11-01")
      .length,
    0,
  );
});
test("every role home contains only permitted shortcuts and finance prioritises accounts", () => {
  for (const role of roles) {
    const home = roleHome({ ...accountant, role });
    assert.ok(home.title);
    assert.ok(home.modules.length > 0, role);
  }
  assert.equal(roleHome(accountant).modules[0], "accounts");
  assert.deepEqual(
    roleHome({ ...accountant, role: "IT Administrator" }).modules,
    ["it", "settings", "activity"],
  );
  assert.equal(
    roleHome({
      ...accountant,
      moduleAccess: { accounts: "none" },
    }).modules.includes("accounts"),
    false,
  );
});
