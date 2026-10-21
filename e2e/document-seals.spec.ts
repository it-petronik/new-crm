import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makePreview } from "../src/lib/fixtures";
import { documentSealSvg } from "../src/lib/pdf/document-seal";
import { expectContinuousFooter } from "./pdf-footer-check";
const master = "output/pdf/petronik-signature-master.png";
for (const type of ["quotation", "proforma"] as const)
  test(`${type} prints approved native signature/stamp with all terms on one page`, async ({
    page,
  }, info) => {
    test.skip(
      !existsSync(master),
      "Approved private masters must be installed locally for asset QA.",
    );
    const svg = await documentSealSvg(
      readFileSync(master).toString("base64"),
      readFileSync("output/pdf/petronik-stamp-master.png").toString("base64"),
    );
    const record = {
      ...makePreview().records.find(
        (r) => r.kind === "quotations" && r.company === "Petronik",
      )!,
      title: "Fictional Design Review Customer",
      kind:
        type === "proforma" ? ("accounts" as const) : ("quotations" as const),
      status: "Draft",
      unit: "kg",
      due: "2026-10-21",
      contact: "Fictional Purchasing Contact",
      lines: [
        {
          itemName: "Base Oil Virgin (Group I)",
          description: "SN500",
          packaging: "Flexi Bags",
          quantity: 80,
          unitPriceCents: 161000,
        },
      ],
      detail: [
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
      ]
        .map(
          (name, i) =>
            `${i + 1}. ${name}: Fictional review clause ${i + 1}. This text verifies document layout without substituting actual agreed trading terms.${i === 14 ? " LAST-CLAUSE-COMPLETE" : ""}`,
        )
        .join("\n"),
      attributes: {
        ...(type === "proforma" ? { documentType: "proforma" } : {}),
        quoteReference: `DESIGN-REVIEW-${type}`,
        issuedDate: "2026-10-19",
        senderAddress: "Fictional Issuer Address\nDubai, UAE",
        customerAddress: "Fictional Customer Address",
        customerReference: "REVIEW-CUSTOMER",
        originCountry: "Review Origin",
        loadingPort: "Review Port",
        deliveryPeriod: "Review Delivery Period",
        partialShipment: "Not Allowed",
        incoterm: "Review Delivery Term",
        paymentTerms: "Review Payment Term",
        bankName: "Fictional Test Bank",
        bankAccountName: "Fictional Holder",
        bankAccountNumber: "TEST-ONLY-1234",
        bankSwift: "TEST-SWIFT",
        bankIban: "TEST-IBAN",
      },
    };
    // Test-only interception: production still authenticates this private URL.
    await page.route("**/api/document-seals**", (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await page.route("http://localhost:3000/brands/**", route => route.fulfill({ contentType: "image/png", body: readFileSync(`public${new URL(route.request().url()).pathname}`) }));
    const html = execFileSync(process.execPath, ["--import", "tsx", "scripts/render-document-review.ts"], { input: JSON.stringify(record), encoding: "utf8" });
    await page.setContent(
      `<html><head><base href="http://localhost:3000/"><style>${readFileSync("src/app/reference-document.css", "utf8")}</style></head><body>${html}</body></html>`,
    );
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const seal = page.getByRole("img", {
      name: "Approved Petronik signature and company stamp",
    });
    await expect(seal).toBeVisible();
    await expect(page.locator(".pdf-brand-watermark")).toHaveCSS("opacity", "0.04");
    await expect(page.locator(".pdf-amount-words > p:last-child")).toHaveText("One Hundred Twenty-Eight Thousand Eight Hundred US Dollars Only");
    if (type === "proforma") await expect(page.locator(".pdf-info-grid")).toContainText("Invoice Date");
    expect(
      await seal.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
    await expect(page.locator(".pdf-terms")).toContainText(
      "LAST-CLAUSE-COMPLETE",
    );
    const pdf = await page.pdf({
      path: info.outputPath(`${type}-with-approved-seal.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect(
      (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length,
    ).toBe(1);
    expectContinuousFooter(info.outputPath(`${type}-with-approved-seal.pdf`));
    await seal.screenshot({ path: info.outputPath(`${type}-seal.png`) });
  });
