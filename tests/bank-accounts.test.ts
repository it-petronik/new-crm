import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bankMutationSchema,
  bankSnapshot,
  canUseBankAccounts,
} from "../src/lib/bank-accounts";
import { previewActor } from "../src/lib/fixtures";
import { roles, scopedWorkspace, type RecordItem } from "../src/lib/domain";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { proformaData } from "../src/lib/pdf/proforma-data";
import { ItemsTable } from "../src/components/pdf/ItemsTable";
import { companyFooter } from "../src/lib/pdf/company-footer";

test("saved banks enforce finance access, company boundaries and explicit read-only grants", () => {
  for (const role of roles) {
    const actor = { ...previewActor, role, companies: ["Petronik"] };
    assert.equal(
      canUseBankAccounts(actor, "Petronik", true),
      ["MD", "MD Assistant", "IT Administrator", "Group Manager", "Accounts Manager", "Accountant"].includes(role),
      role,
    );
    assert.equal(canUseBankAccounts(actor, "Afrilube", true), false);
    assert.equal(
      canUseBankAccounts(
        { ...actor, moduleAccess: { accounts: "none" } },
        "Petronik",
      ),
      false,
    );
    assert.equal(
      canUseBankAccounts(
        { ...actor, moduleAccess: { accounts: "read" } },
        "Petronik",
        true,
      ),
      false,
    );
  }
});
test("saved bank input is bounded, strict and rejects blank required fields", () => {
  const valid = {
    id: crypto.randomUUID(),
    company: "Petronik",
    label: "Test USD",
    currency: "USD",
    details: bankSnapshot({
      bankName: "Fictional Bank",
      bankAccountName: "Test Holder",
      bankAccountNumber: "TEST-123",
    }),
  };
  assert.ok(bankMutationSchema.safeParse(valid).success);
  assert.ok(
    !bankMutationSchema.safeParse({
      ...valid,
      details: { ...valid.details, bankName: "" },
    }).success,
  );
  assert.ok(
    !bankMutationSchema.safeParse({
      ...valid,
      details: { ...valid.details, bankSwift: "two\nlines" },
    }).success,
  );
  assert.ok(
    !bankMutationSchema.safeParse({ ...valid, label: "x".repeat(81) }).success,
  );
  assert.ok(
    !bankMutationSchema.safeParse({ ...valid, createdBy: "someone-else" })
      .success,
  );
  const snapshot = bankSnapshot(valid.details);
  valid.details.bankName = "Changed Saved Bank";
  assert.equal(snapshot.bankName, "Fictional Bank");
});
test("company footer stays identical across document overrides without crossing companies", () => {
  const record = {
    company: "Petronik",
    unit: "MT",
    lines: [],
    attributes: {
      senderPhone: "WRONG",
      senderEmail: "wrong@example.invalid",
      senderWebsite: "wrong.invalid",
      footerMessage: "Different Footer",
    },
    amount: 1,
    quantity: 1,
    createdAt: "2026-10-19",
    product: "Test",
  } as unknown as RecordItem;
  const quote = quotationData(record),
    proforma = proformaData(record);
  assert.deepEqual(quote.footerContacts, proforma.footerContacts);
  assert.equal(quote.footerContacts?.phone, "+971 (4) 2669953");
  assert.equal(quote.footerContacts?.email, "info@petronik.ae");
  assert.equal(quote.footerWebsite, "www.petronik.ae");
  assert.equal(quote.footerMessage, "Thank you for your business.");
  assert.equal(companyFooter("Afrilube").phone, undefined);
  assert.equal(companyFooter("Unrecognized").website, undefined);
});

test("saved-bank audit entries never enter the general workspace activity feed", () => {
  const record = {
    id: "bank-id",
    company: "Petronik",
    branch: "Main",
    ownerId: previewActor.id,
    kind: "accounts",
  } as RecordItem;
  const scoped = scopedWorkspace(previewActor, {
    records: [record],
    audit: [
      {
        id: "bank-audit",
        company: "Petronik",
        actor: "Finance",
        action: "Updated saved bank account",
        recordId: record.id,
        at: "2026-10-20",
        subject: "bank-account",
      },
    ],
  });
  assert.equal(scoped.audit.length, 0);
});
test("quantity unit changes header and every row without silently converting quantities", () => {
  for (const [unit, display] of [
    ["kg", "kg"],
    ["Kg", "kg"],
    ["MT", "MT"],
    ["mt", "MT"],
  ]) {
    const record = {
      company: "Petronik",
      unit,
      lines: [{ description: "Test", quantity: 80, unitPriceCents: 200 }],
      attributes: {},
      createdAt: "2026-10-19",
    } as unknown as RecordItem;
    const data = quotationData(record);
    const html = renderToStaticMarkup(
      ItemsTable({ doc: data, referenceFieldsOnly: true }),
    );
    assert.ok(html.includes(`QTY ${display}`));
    assert.ok(html.includes(`80.00 ${display}`));
    assert.equal(data.items[0].quantity, 80);
    assert.equal(data.totals.total, 160);
  }
});
