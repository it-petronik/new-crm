import { test, expect, type Page } from "@playwright/test";
import { demoAccounts, makePreview } from "../src/lib/fixtures";

async function signIn(page: Page, who: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`${who}@enercore.test`) }).click();
  await expect(page.getByRole("heading", { name: who === "accounts" ? "Accounts desk" : "Sales desk", exact: true })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("enercore-preview-v1"))).not.toBeNull();
}
test("catalog choices add, capitalize, rename and delete immediately without rewriting records", async ({ page }, info) => {
  await signIn(page, "sales");
  const before = await page.evaluate(() => localStorage.getItem("enercore-preview-v1"));
  await page.goto("/workspace/petronik/option-catalogs");
  await expect(page.getByRole("heading", { name: "Option Catalogs", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Catalog", exact: true }).click();
  await page.getByRole("option", { name: /Lead Sources/ }).click();
  await page.getByRole("textbox", { name: "New choice" }).fill("trade partner referral");
  await page.getByRole("button", { name: "Add choice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Trade Partner Referral", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Trade Partner Referral", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename choice" }).fill("partner introduction");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Trade Partner Referral", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Partner Introduction", exact: true }).click();
  await page.getByRole("button", { name: "Delete choice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Partner Introduction", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("enercore-preview-v1"))).toBe(before);
  await page.screenshot({ path: info.outputPath("catalog.png"), fullPage: true });
});

test("proforma wizard creates a customer in place and retains values between steps at all sizes", async ({ page }, info) => {
  await signIn(page, "accounts");
  await page.goto("/workspace/petronik/accounts");
  await page.getByRole("button", { name: "New proforma", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New customer proforma" });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Customer email", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Customer tax number", exact: true })).toHaveCount(0);
  await dialog.getByRole("spinbutton", { name: "Invoice validity (days)", exact: true }).fill("2");
  await expect(dialog.getByRole("combobox", { name: "Branch", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create customer", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Company name", exact: true }).fill("Wizard Fictional Buyer");
  await dialog.getByRole("button", { name: "Save customer", exact: true }).click();
  await expect(dialog.getByText("Selected customer:", { exact: false })).toContainText("Wizard Fictional Buyer");
  await dialog.getByRole("combobox", { name: "Item 1 product", exact: true }).fill("Wizard Test Product");
  await dialog.getByRole("spinbutton", { name: "Unit price", exact: true }).fill("50");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.waitForTimeout(450);
      if (width === 1440) expect((await dialog.boundingBox())!.width).toBeGreaterThan(1100);
      await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`wizard-${theme}-${width}.png`), animations: "disabled" });
    }
  }
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Terms & conditions" }).fill("Wizard terms must survive going back.");
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Item 1 product", exact: true })).toHaveValue("Wizard Test Product");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Terms & conditions" })).toHaveValue("Wizard terms must survive going back.");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Authorized signatory name", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Signatory title", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create Draft Proforma", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.filter((r: { title: string }) => r.title === "Wizard Fictional Buyer"));
  expect(saved.map((r: { kind: string }) => r.kind).sort()).toEqual(["accounts", "customers"]);
  expect(saved.find((r: { kind: string }) => r.kind === "accounts").detail).toBe("Wizard terms must survive going back.");
  const proforma = saved.find((r: { kind: string }) => r.kind === "accounts");
  expect((Date.parse(proforma.due) - Date.parse(proforma.attributes.issuedDate)) / 86400000).toBe(2);
});
test("saved bank accounts reload, select and edit without rewriting existing documents", async ({ page }, info) => {
  await signIn(page, "accounts");
  const customer = makePreview().records.find(r => r.kind === "customers" && r.company === "Petronik")!;
  async function openBankStep() {
    await page.goto("/workspace/petronik/accounts");
    await page.getByRole("button", { name: "New proforma", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New customer proforma" });
    await dialog.getByRole("combobox", { name: "Customer", exact: true }).click();
    await page.getByRole("option", { name: customer.title, exact: true }).click();
    await dialog.getByRole("combobox", { name: "Item 1 product", exact: true }).fill("Fictional Bank Review Item");
    await dialog.getByRole("combobox", { name: "Quantity unit", exact: true }).click();
    await page.getByRole("option", { name: "Kg", exact: true }).click();
    await dialog.getByRole("spinbutton", { name: "Unit price", exact: true }).fill("5");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    return dialog;
  }
  let dialog = await openBankStep();
  await dialog.getByRole("textbox", { name: "Bank Name", exact: true }).fill("Fictional Review Bank");
  await dialog.getByRole("textbox", { name: "Account Holder", exact: true }).fill("Fictional Holder");
  await dialog.getByRole("textbox", { name: "Account Number", exact: true }).fill("TEST-1234");
  await dialog.getByRole("textbox", { name: "Saved Account Label", exact: true }).fill("Main Test USD");
  await dialog.getByRole("button", { name: "Save As New Account", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Bank account saved");
  for (const width of [390, 768, 1440]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`saved-bank-${theme}-${width}.png`), animations: "disabled" });
  }
  await dialog.getByRole("button", { name: "Create Draft Proforma", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.filter((r: { product: string }) => r.product === "Fictional Bank Review Item"));
  expect(savedBefore).toHaveLength(1);
  expect(savedBefore[0].attributes.bankAccountNumber).toBe("TEST-1234");
  expect(savedBefore[0].unit).toBe("kg");
  await page.reload();
  dialog = await openBankStep();
  await dialog.getByRole("combobox", { name: "Saved Bank Account", exact: true }).click();
  await page.getByRole("option", { name: /Main Test USD/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Account Number", exact: true })).toHaveValue("TEST-1234");
  await dialog.getByRole("textbox", { name: "Account Number", exact: true }).fill("TEST-5678");
  await dialog.getByRole("button", { name: "Update Selected Account", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Existing documents have not changed");
  const savedAfter = await page.evaluate(id => JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find((r: { id: string }) => r.id === id), savedBefore[0].id);
  expect(savedAfter).toEqual(savedBefore[0]);
  await dialog.getByRole("button", { name: "Reload Saved Accounts", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Saved Bank Account", exact: true }).click();
  await page.getByRole("option", { name: /Main Test USD.*5678/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Account Number", exact: true })).toHaveValue("TEST-5678");
});
test("depth-styled mini trends stay inside existing KPI cards without removing content", async ({ page }, info) => {
  await signIn(page, "accounts");
  await expect(page.getByRole("region", { name: "Workspace activity trend" })).toHaveCount(0);
  await expect(page.locator(".stats-grid .stat-card")).toHaveCount(4);
  await expect(page.locator(".stats-grid")).toContainText("Proformas to review");
  await expect(page.locator(".stats-grid")).toContainText("Confirmed orders");
  expect(await page.locator('.stat-card svg[aria-label="Six-month record creation trend"]').count()).toBeGreaterThan(0);
  for (const width of [390, 768, 1440]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const card of await page.locator(".stats-grid .stat-card").all()) {
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await card.boundingBox())!.width).toBeGreaterThan(150);
    }
    await page.screenshot({ path: info.outputPath(`dashboard-${theme}-${width}.png`), animations: "disabled" });
  }
});
test("reference document fields omit named and client signatures and preserve legacy data", async ({ page }, info) => {
  const data = makePreview();
  const quote = data.records.find(r => r.kind === "quotations" && r.company === "Petronik")!;
  quote.status = "Draft"; quote.due = "2026-11-01";
  quote.attributes = { ...quote.attributes, issuedDate: "2026-10-19", senderAddress: "Fictional Issuer Address", customerAddress: "Fictional Buyer Address", senderEmail: "accounts@example.invalid", senderPhone: "+971 00 000 0000", senderWebsite: "example.invalid" };
  quote.attributes.signatoryName = "Legacy Name Must Stay Stored";
  quote.attributes.signatoryTitle = "Legacy Title";
  const actor = demoAccounts.find(a => a.email.startsWith("md@"))!.actor;
  await page.addInitScript(({ data, actor }) => { localStorage.setItem("enercore-preview-v1", JSON.stringify(data)); localStorage.setItem("enercore-preview-actor", JSON.stringify(actor)); }, { data, actor });
  await page.goto(`/workspace/petronik/quotations?record=${quote.id}`);
  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("textbox", { name: "Authorized signatory name", exact: true })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: "Authorized signatory title", exact: true })).toHaveCount(0);
  await form.getByRole("textbox", { name: "Customer address", exact: true }).fill("Fictional Updated Buyer Address");
  await form.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem("enercore-preview-v1")!).records.find((r: { id: string }) => r.id === id).attributes.signatoryName, quote.id)).toBe("Legacy Name Must Stay Stored");
  await page.getByRole("button", { name: "View document", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Quotation document" });
  await expect(preview.locator(".reference-document")).toContainText("Fictional Updated Buyer Address");
  await expect(preview.locator(".reference-document")).not.toContainText("Legacy Name Must Stay Stored");
  await expect(preview.locator(".reference-document")).not.toContainText("Client Representative");
  await expect(preview.locator(".reference-document")).not.toContainText("Generated electronically");
  for (const width of [390, 768, 1440]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(450);
    expect(await preview.locator(".document-preview-stage").evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    expect(await preview.locator("[data-print-document]").evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThan(30);
    const paper = (await preview.locator(".reference-document").boundingBox())!;
    const footer = (await preview.locator(".pdf-footer-band").boundingBox())!;
    const thanks = (await preview.locator(".pdf-thank-you").boundingBox())!;
    expect(Math.abs(paper.y + paper.height - footer.y - footer.height - paper.width * 4 / 210)).toBeLessThan(3);
    expect(Math.abs(footer.x - paper.x - paper.width * 9 / 210)).toBeLessThan(3);
    expect(Math.abs(thanks.y + thanks.height - footer.y)).toBeLessThan(2);
    await expect(preview.locator('.pdf-footer-band a[href="https://www.petronik.ae/"]')).toHaveText("www.petronik.ae");
    await expect(preview.locator('.pdf-footer-band a[href="mailto:info@petronik.ae"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`preview-${theme}-${width}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ media: "print" });
  await expect(preview.locator(".reference-document")).toBeVisible();
  await expect(preview.locator(".document-preview-toolbar")).toBeHidden();
  await page.pdf({ path: info.outputPath("preview-clean-print.pdf"), preferCSSPageSize: true, printBackground: true });
});
