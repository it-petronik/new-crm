import { test } from "node:test";
import assert from "node:assert/strict";
import { activityProfile } from "../src/lib/activity-profile";
import { quoteSection } from "../src/lib/form-layout";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { makePreview } from "../src/lib/fixtures";
test("generic note entry is absent from master records and quotations", () => {
  for (const kind of [
    "customers",
    "suppliers",
    "products",
    "hr",
    "quotations",
    "accounts",
    "leave",
    "marketing",
  ] as const)
    assert.equal(activityProfile(kind), undefined);
  assert.equal(activityProfile("leads")?.action, "Log follow-up");
  assert.equal(activityProfile("it")?.title, "Support progress");
});
test("quotation fields map into compact sections", () => {
  assert.equal(quoteSection("title"), 0);
  assert.equal(quoteSection("due"), 0);
  assert.equal(quoteSection("currency"), 1);
  assert.equal(quoteSection("attributes.senderAddress"), 2);
  assert.equal(quoteSection("detail"), 2);
});
test("source PDF template receives safe commercial data, never activity notes or fabricated signatures", () => {
  const r = {
    ...makePreview().records.find((r) => r.kind === "quotations")!,
    lines: [
      {
        description: "Bitumen",
        quantity: 500,
        unitPriceCents: 57000,
        packaging: "Drums",
      },
    ],
    notes: [
      { id: "1", actor: "QA", at: "2026-09-22", text: "Private activity" },
    ],
    attributes: {
      country: "Vietnam",
      senderWebsite: "example.test",
      customerAddress: "Customer address",
    },
  };
  const doc = quotationData(r);
  assert.equal(doc.totals.total, 285000);
  assert.equal(doc.items[0].packaging, "Drums");
  assert.equal(doc.to.address, "Customer address");
  assert.equal(doc.signatory.signatureUrl, undefined);
  assert.ok(!JSON.stringify(doc).includes("Private activity"));
  assert.equal(doc.footerWebsite, "example.test");
});
