import { test, expect } from "@playwright/test";
import { makePreview, demoAccounts } from "../src/lib/fixtures";
import type { RecordItem } from "../src/lib/domain";
import { expectContinuousFooter } from "./pdf-footer-check";

const clauseNames = [
  "Payment",
  "Validity",
  "Acceptance",
  "Document Release",
  "Bank Charges",
  "Shipment",
  "Risk & Insurance",
  "Amendments",
  "Trade Rules",
  "Shipping Instructions",
  "Force Majeure",
  "Quantity",
  "Quality Inspection & Guarantee",
  "Loading & Delivery Schedule",
  "Law & Arbitration",
];
for (const type of ["quotation", "proforma"] as const) {
  test(`${type} includes every reference-document section and all 15 clauses`, async ({
    page,
  }, info) => {
    const workspace = makePreview();
    const original = workspace.records.find(
      (r) => r.kind === "quotations" && r.company === "Petronik",
    )!;
    const customer = workspace.records.find(
      (r) => r.kind === "customers" && r.company === "Petronik",
    )!;
    const record: RecordItem = {
      ...original,
      id: `COMPLETE-${type}`,
      kind: type === "proforma" ? "accounts" : "quotations",
      status: "Draft",
      title: "Fictional completeness customer",
      customerId: customer.id,
      contact: "Test Purchasing Contact",
      email: "buyer@example.invalid",
      destination: "Fictional receiving port",
      due: "2026-10-21",
      unit: type === "proforma" ? "kg" : "MT",
      amount: 128800,
      lines: [
        {
          itemName: "Base Oil Virgin (Group I)",
          description: "SN500",
          packaging: "Flexi Bags",
          quantity: 80,
          unitPriceCents: 161000,
        },
      ],
      detail: clauseNames
        .map(
          (name, i) =>
            `${i + 1}. ${name}: Fictional review clause ${i + 1}. ${"This text verifies long-form document pagination without substituting actual trading terms. ".repeat(i === 12 ? 4 : 1)}${i === 14 ? "LAST-CLAUSE-COMPLETE" : ""}`,
        )
        .join("\n"),
      attributes: {
        ...(type === "proforma" ? { documentType: "proforma" } : {}),
        issuedDate: "2026-10-19",
        quoteReference: `REVIEW-${type.toUpperCase()}-2026`,
        senderAddress: "Fictional issuer street\nDubai, UAE",
        senderPhone: "+971 00 000 0000",
        senderEmail: "accounts@example.invalid",
        senderWebsite: "example.invalid",
        customerAddress: "Fictional customer address\nTest destination",
        customerReference: "TEST-CUSTOMER-ID",
        paymentTerms: "Review-only deposit terms",
        incoterm: "Review-only delivery term",
        deliveryPeriod: "Agreed review period",
        originCountry: "Test origin",
        loadingPort: "Test loading port",
        partialShipment: "No",
        bankName: "Fictional Test Bank",
        bankBranch: "Fictional test branch",
        bankAccountName: "Fictional account holder",
        bankAccountNumber: "TEST-000001-USD",
        bankIban: "TEST-IBAN-NOT-REAL",
        bankSwift: "TEST-SWIFT",
        signatoryName: "Approved test signatory",
        footerMessage: "Thank you for your business.",
      },
    };
    workspace.records.unshift(record);
    const actor = demoAccounts.find((a) =>
      a.email.startsWith(type === "proforma" ? "accounts@" : "md@"),
    )!.actor;
    await page.addInitScript(
      ({ workspace, actor }) => {
        localStorage.setItem("enercore-preview-v1", JSON.stringify(workspace));
        localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      },
      { workspace, actor },
    );
    await page.goto(`/?module=${record.kind}`);
    await page
      .getByRole("button", { name: /Fictional completeness customer/ })
      .first()
      .click();
    await page.emulateMedia({ media: "print" });
    const document = page.locator(".quotation-print-only .reference-document");
    await expect(document).toBeVisible();
    for (const value of [
      "Fictional issuer street",
      "Fictional customer address",
      "Test Purchasing Contact",
      "Base Oil Virgin (Group I)",
      "SN500",
      "Flexi Bags",
      "128,800.00",
      "Review-only delivery term",
      "Review-only deposit terms",
      "LAST-CLAUSE-COMPLETE",
      "Thank you for your business.",
    ])
      await expect(document).toContainText(value);
    for (const name of clauseNames)
      await expect(document.locator(".pdf-terms")).toContainText(name);
    await expect(document.locator(".pdf-footer-contacts")).toContainText("+971 (4) 2669953");
    await expect(document.locator(".pdf-footer-contacts")).toContainText("info@petronik.ae");
    await expect(document.locator(".pdf-footer-contacts")).not.toContainText("accounts@example.invalid");
    await expect(document.locator(".pdf-items thead")).toContainText(type === "proforma" ? "QTY kg" : "QTY MT");
    await expect(document.locator(".pdf-items tbody")).toContainText(type === "proforma" ? "80.00 kg" : "80.00 MT");
    await expect(document).not.toContainText("Approved test signatory");
    await expect(document).not.toContainText("Client Representative");
    await expect(document).not.toContainText("Generated electronically");
    if (type === "proforma") {
      for (const value of [
        "TEST-CUSTOMER-ID",
        "2 days",
        "Agreed review period",
        "Test origin",
        "Test loading port",
        "Fictional Test Bank",
        "Fictional test branch",
        "TEST-000001-USD",
        "TEST-IBAN-NOT-REAL",
        "TEST-SWIFT",
      ])
        await expect(document).toContainText(value);
    }
    await expect(page.locator(".rw-header")).toBeHidden();
    const pdf = await page.pdf({
      path: info.outputPath(`${type}-complete.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
    expectContinuousFooter(info.outputPath(`${type}-complete.pdf`));
    await page.pdf({ path: info.outputPath(`${type}-browser-headers.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true });
    await page.screenshot({
      path: info.outputPath(`${type}-complete.png`),
      fullPage: true,
    });
  });
}
