import { test, expect } from "@playwright/test";
import { makePreview } from "../src/lib/fixtures";
import { expectContinuousFooter } from "./pdf-footer-check";

// Fresh browser contexts and synthetic preview records only; no database writes.
for (const [count, company] of [
  [1, "Petronik"],
  [45, "Petronik"],
  [1, "Afrilube"],
  [1, "Petronex"],
  [1, "Istanegry"],
] as const) {
  test(`${company} quotation print layout with ${count} items`, async ({
    page,
  }, testInfo) => {
    const workspace = makePreview();
    const quote = workspace.records.find(
      (record) => record.kind === "quotations" && record.company === "Petronik",
    )!;
    quote.company = company;
    quote.attributes = { ...quote.attributes, signatoryName: "Fictional Authorized Signatory" };
    quote.lines = Array.from({ length: count }, (_, index) => ({
      description: `Print test product ${index + 1}`,
      quantity: 240,
      unitPriceCents: 80000,
      packaging: "Bulk / MT",
    }));
    await page.addInitScript((data) => {
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    }, workspace);
    await page.goto(`/?module=quotations&company=${company}`);
    await page
      .getByRole("button", { name: /Gulf Industrial Trading/ })
      .first()
      .click();
    // The record screen has a summary; its A4 document is intentionally
    // print-only until View document is opened. Verify the real print path.
    await expect(page.locator(".quotation-print-only .reference-document")).toBeAttached();
    await page.emulateMedia({ media: "print" });
    // The quotation is a page inside the shell; printing drops the shell's
    // navigation and the record's own controls, leaving only the document.
    for (const chrome of [".sidebar", ".topbar", ".rw-header", ".page-under-record"])
      await expect(page.locator(chrome)).toBeHidden();
    await expect(page.locator(".reference-document")).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color","rgb(255, 255, 255)");
    await expect(page.locator(".pdf-footer-band")).toBeHidden();
    await expect(
      page.locator(".reference-document").getByText("Authorized Signatory", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".reference-document")).not.toContainText("Fictional Authorized Signatory");
    await expect(page.locator(".reference-document")).not.toContainText("Client Representative");
    await expect(page.locator(".pdf-sheet-row--commercial")).toHaveCSS(
      "break-after",
      "auto",
    );
    const bounds = await page.locator(".reference-document").boundingBox();
    expect(bounds?.y).toBe(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images, (image) => image.decode().catch(() => {})),
      );
    });
    const pdf = await page.pdf({
      path: testInfo.outputPath(`quotation-${count}.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    // Chromium emits page dictionaries uncompressed (not the /Pages tree).
    const pageCount = [...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)]
      .length;
    if (count === 1) expect(pageCount).toBe(1);
    else expect(pageCount).toBeGreaterThan(1);
    expectContinuousFooter(testInfo.outputPath(`quotation-${count}.pdf`), pageCount);
  });
}
