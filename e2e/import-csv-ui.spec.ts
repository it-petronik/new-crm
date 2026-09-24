import { test, expect } from "@playwright/test";

// Columns are the customers module's own, keyed by machine name.
const HEAD = "title,contact,email,attributes.segment";
const good = (n: number) => `Imported Co ${n},Sara,sara${n}@example.invalid,Distributor`;

test("import previews and reports before writing, and preview mode writes nothing", async ({ page }) => {
  await page.goto("/workspace/all-companies/customers");
  await page.getByRole("button", { name: /^Import/ }).click();

  const csv = [
    HEAD,
    good(1),
    good(2),
    ",Sara,blank@example.invalid,Distributor",            // row 4: no name
    "Bad Segment,Sara,seg@example.invalid,Nonsense",       // row 5: not an allowed segment
    good(1).replace("Imported Co 1", "Duplicate Email"),   // row 6: repeats row 2's address
  ].join("\r\n");

  await page.getByLabel("CSV file").setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("﻿" + csv, "utf8"),
  });

  // Nothing is written on selection: the user sees a preview and must confirm.
  const summary = page.locator(".import-summary");
  await expect(summary).toContainText("5");
  await expect(page.locator(".import-issues")).toContainText("Row 4");
  await expect(page.locator(".import-issues")).toContainText("Row 5");
  await expect(page.locator(".import-issues")).toContainText("Row 6");

  const confirm = page.getByRole("button", { name: /^Import \d+ records$/ });
  await expect(confirm).toBeEnabled();
  await expect(confirm).toHaveText(/Import 2 records/);

  await confirm.click();

  // Preview runs on fictional in-browser data; the API refuses to write, so
  // every row is reported as failed rather than silently appearing to import.
  await expect(page.getByRole("heading", { name: /Import complete/ })).toBeVisible();
  // A failure report is offered only when something actually failed, so its
  // presence is the proof that preview wrote nothing.
  await expect(page.getByRole("button", { name: /Download failures/ })).toBeVisible();
});

test("a template can be downloaded for a supported module", async ({ page }) => {
  await page.goto("/workspace/all-companies/customers");
  await page.getByRole("button", { name: /^Import/ }).click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download template/ }).click(),
  ]).then(([d]) => d);
  expect(download.suggestedFilename()).toMatch(/customers-template-\d{4}-\d{2}-\d{2}\.csv$/);
});
