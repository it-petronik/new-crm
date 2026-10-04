import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Never allow this preview-only suite to write to a server.
  await page.route("**/api/**", (route) => route.request().method() === "GET" ? route.continue() : route.abort());
});

test("minimal lead saves with optional details collapsed and survives reload", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Contact person", { exact: true })).not.toBeVisible();
  await dialog.getByRole("textbox", { name: "Customer / company" }).fill("Simple entry customer");
  await dialog.getByRole("textbox", { name: "Product needed", exact: true }).fill("Base oil");
  await dialog.getByRole("button", { name: "Create lead", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Simple entry customer", exact: true })).toBeVisible();
});

test("quotation has no wizard; required fields, items and optional detail persist together", async ({ page }) => {
  await page.goto("/workspace/all-companies/quotations");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "New quotation", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("navigation", { name: "Quotation sections" })).toHaveCount(0);
  await expect(dialog.getByLabel("Item 1 product")).toBeVisible();
  await dialog.locator('[name="title"]').fill("Simple quotation customer");
  await dialog.getByRole("button", { name: "Create quotation", exact: true }).click();
  await expect(dialog.getByText("Sender address is required.", { exact: true })).toBeVisible();
  await dialog.locator('[name="attributes.senderAddress"]').fill("Test sender address");
  await dialog.locator('[name="attributes.customerAddress"]').fill("Test customer address");
  await dialog.getByLabel("Item 1 product").fill("Test base oil");
  await dialog.getByRole("spinbutton", { name: "Unit price" }).fill("100");
  await dialog.locator("summary").click();
  await page.screenshot({ path: "test-results/simple-entry-quotation.png", fullPage: true });
  await dialog.getByLabel("Payment terms", { exact: true }).fill("Advance payment");
  await dialog.locator("summary").click();
  await dialog.getByRole("button", { name: "Create quotation", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  expect(saved).toContain("Advance payment");
});

test("mobile essentials stay within the dialog and optional details can be opened", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.locator("summary").click();
  await expect(dialog.getByLabel("Contact person", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/simple-entry-mobile.png", fullPage: true });
});
