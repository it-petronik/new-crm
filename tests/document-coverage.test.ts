import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { roles } from "../src/lib/domain";
import { documentValidity, expiryFromValidity, validityInDays } from "../src/lib/pdf/document-validity";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { proformaData } from "../src/lib/pdf/proforma-data";
import { TermsBody } from "../src/components/pdf/TermsBody";
import { SkeletonRoleHome } from "../src/components/ui/skeleton";
import { DocumentTemplate } from "../src/components/pdf/DocumentTemplate";
import { documentConfig } from "../src/config/document-templates";
import { AmountInWords } from "../src/components/pdf/AmountInWords";
import { DocumentInfo } from "../src/components/pdf/DocumentInfo";

test("proforma dates are explicitly labeled Invoice Date without changing the date", () => {
  const record = makePreview().records.find(r => r.kind === "quotations")!;
  const data = proformaData({ ...record, kind: "accounts", attributes: { documentType: "proforma", issuedDate: "2026-10-19" } });
  const html = renderToStaticMarkup(createElement(DocumentInfo, { doc: data, config: documentConfig.proforma }));
  assert.match(html, />Invoice Date</);
  assert.match(html, />19 October 2026</);
  assert.ok(!html.includes(">Date<"));
  assert.equal(documentConfig.quotation.dateFields[0].label, "Issued");
});

test("printed amount words use title case, including hyphens, and retain currency abbreviations", () => {
  const record = makePreview().records.find(r => r.kind === "quotations")!;
  const data = quotationData(record);
  for (const [value, expected] of [
    [undefined, "One Hundred Twenty-Eight Thousand Eight Hundred US Dollars Only"],
    ["one hundred AED only", "One Hundred AED Only"],
    ["zero euros only", "Zero Euros Only"],
    ["one US dollar and twenty-five cents only", "One US Dollar And Twenty-Five Cents Only"],
  ] as const) {
    const doc = { ...data, totals: { ...data.totals, currency: "USD", total: 128800, amountInWords: value } };
    const html = renderToStaticMarkup(createElement(AmountInWords, { doc, referenceFieldsOnly: true }));
    assert.ok(html.includes(`<p>${expected}</p>`), html);
    assert.equal(doc.totals.total, 128800);
  }
});
test("thank-you is part of the footer group directly before its colored contact band", () => {
  const record = makePreview().records.find(r => r.kind === "quotations")!;
  const html = renderToStaticMarkup(createElement(DocumentTemplate, { type: "quotation", data: quotationData(record) }));
  const group = html.indexOf('<footer class="pdf-footer-group">');
  const thanks = html.indexOf('class="pdf-thank-you"');
  const band = html.indexOf('class="pdf-footer-band');
  assert.ok(group >= 0 && group < thanks && thanks < band);
  assert.equal((html.match(/class="pdf-thank-you"/g) || []).length, 1);
  assert.match(html.slice(band), /background-color:color-mix/);
});
test("reference sales documents have an unnamed signing area without extra client fields", () => {
  const record = makePreview().records.find(r => r.kind === "quotations")!;
  const data = quotationData({ ...record, attributes: { ...record.attributes, signatoryName: "Legacy Signatory Must Not Print", signatoryTitle: "Legacy Title", customerTaxNumber: "PRIVATE-CUSTOMER-TAX", senderTaxNumber: "PRIVATE-ISSUER-TAX" } });
  for (const type of ["quotation", "proforma"] as const) {
    const html = renderToStaticMarkup(createElement(DocumentTemplate, { type, data }));
    assert.match(html, /Authorized Signatory/);
    for (const text of ["Client Representative", "Legacy Signatory Must Not Print", "Legacy Title", "PRIVATE-CUSTOMER-TAX", "PRIVATE-ISSUER-TAX", "Generated electronically"]) assert.ok(!html.includes(text), text);
    assert.match(html, /Item #/);
    assert.match(html, /Amount in words/);
  }
});
test("validity day entry derives one expiry date without date rollover errors", () => {
  assert.equal(expiryFromValidity("2026-10-19", "2"), "2026-10-21");
  assert.equal(expiryFromValidity("2028-02-28", "2"), "2028-03-01");
  assert.equal(expiryFromValidity("2026-10-19", "0"), "2026-10-19");
  assert.equal(validityInDays("2026-10-19", "2026-10-21"), "2");
  for (const days of ["", "-1", "1.5", "NaN"]) assert.equal(expiryFromValidity("2026-10-19", days), "");
  assert.equal(expiryFromValidity("2026-02-30", "2"), "");
});
test("signatory comes only from the document field and can be deliberately blank", () => {
  const quote = makePreview().records.find(r => r.kind === "quotations")!;
  assert.equal(quotationData({ ...quote, attributes: { ...quote.attributes, signatoryName: "Fictional Signatory" } }).signatory.signedBy, "Fictional Signatory");
  assert.equal(quotationData({ ...quote, attributes: { ...quote.attributes, signatoryName: "" } }).signatory.signedBy, "");
  assert.equal(quotationData({ ...quote, attributes: {} }).signatory.signedBy, "");
});
test("validity in days derives from the actual dates, including leap years", () => {
  assert.equal(documentValidity("2026-10-19", "2026-10-21"), "2 days");
  assert.equal(documentValidity("2028-02-28", "2028-03-01"), "2 days");
  assert.equal(documentValidity("2026-10-19", "2026-10-20"), "1 day");
  assert.equal(
    documentValidity("2026-10-19", "2026-10-19"),
    "Valid through the document date",
  );
  assert.equal(documentValidity("2026-10-19", "2026-10-18"), "");
});
test("document preserves category, grade, attention, issuer email, footer and every bank field", () => {
  const r = {
    ...makePreview().records[0],
    kind: "accounts" as const,
    contact: "Purchasing Contact",
    attributes: {
      documentType: "proforma",
      issuedDate: "2026-10-19",
      senderEmail: "accounts@example.invalid",
      footerMessage: "Custom footer thanks",
      bankName: "Test bank",
      bankBranch: "Test branch",
      bankAccountName: "Test holder",
      bankAccountNumber: "TEST-123",
      bankIban: "TEST-IBAN",
      bankSwift: "TEST-SWIFT",
    },
    lines: [
      {
        itemName: "Base Oil Virgin (Group I)",
        description: "SN500",
        packaging: "Flexi Bags",
        quantity: 80,
        unitPriceCents: 161000,
      },
    ],
  };
  const data = proformaData(r);
  assert.equal(data.items[0].name, "Base Oil Virgin (Group I)");
  assert.equal(data.items[0].description, "SN500");
  assert.equal(data.to.attention, "Purchasing Contact");
  assert.equal(data.from.email, "accounts@example.invalid");
  assert.equal(data.footerMessage, "Thank you for your business.");
  assert.deepEqual(data.bankAccount, {
    bankName: "Test bank",
    branch: "Test branch",
    accountName: "Test holder",
    accountNumber: "TEST-123",
    iban: "TEST-IBAN",
    swift: "TEST-SWIFT",
    currency: r.currency,
  });
  assert.equal(data.totals.total, 128800);
  assert.equal(
    quotationData({ ...r, kind: "quotations" }).items[0].description,
    "SN500",
  );
});
test("all 15 numbered clauses and their final text remain present and escaped", () => {
  const clauses = Array.from(
    { length: 15 },
    (_, i) =>
      `${i + 1}. Clause ${i + 1}: Text with <script>unsafe()</script> & symbols. LAST-${i + 1}`,
  );
  const html = renderToStaticMarkup(
    createElement(TermsBody, { text: clauses.join("\n") }),
  );
  for (let i = 1; i <= 15; i++) assert.ok(html.includes(`LAST-${i}`));
  assert.equal((html.match(/class="pdf-term/g) || []).length, 15);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("every role's loading placeholder names that role, never the MD dashboard", () => {
  for (const role of roles) {
    const html = renderToStaticMarkup(
      createElement(SkeletonRoleHome, { actor: { ...previewActor, role } }),
    );
    assert.ok(html.includes(`data-loading-role="${role}"`));
    assert.ok(!html.includes("Group dashboard"));
    assert.ok(!html.includes('class="dash-grid"'));
  }
});
