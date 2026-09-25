import { test, expect, type Page } from "@playwright/test";

const signIn = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(email) }).click();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
};

test("demo accounts sign in and scope the workspace to that role", async ({ page }) => {
  await signIn(page, "sales@enercore.test");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toContainText("Sales pipeline");
  // A sales sign-in must not get the MD's finance, people or admin modules.
  for (const hidden of ["Accounts", "People & HR", "Marketing", "IT & support", "Access control"])
    await expect(sidebar).not.toContainText(hidden);
  await expect(page.locator(".sidebar")).toContainText("Sales Manager");

  await signIn(page, "hr@enercore.test");
  await expect(page.locator(".sidebar")).toContainText("People & HR");
  // HR has no commercial data, so order value and demand rankings are hidden.
  await expect(page.locator(".business-insights")).toHaveCount(0);
  await expect(page.locator(".panel.performance")).toHaveCount(0);

  await signIn(page, "md@enercore.test");
  await expect(page.locator(".business-insights")).toHaveCount(1);
  await expect(page.locator(".sidebar")).toContainText("Access control");
});

test("signing out returns to the login page so another role can be chosen", async ({ page }) => {
  await signIn(page, "accounts@enercore.test");
  // Sign out lives on the profile, which every role can open.
  await page.goto("/workspace/all-companies/profile");
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".demo-accounts")).toBeVisible();
});

test("sorting is not counted as an active filter", async ({ page }) => {
  await signIn(page, "md@enercore.test");
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  const toggle = page.getByRole("button", { name: /^Filters/ });
  await expect(page.locator(".list-query-count")).toHaveCount(0);

  await page.getByRole("columnheader", { name: /Value/ }).getByRole("button").click();
  // Ordering a column must not make the Filters badge claim a filter is set.
  await expect(page.locator(".list-query-count")).toHaveCount(0);

  await toggle.click();
  await page.getByRole("combobox", { name: "records status", exact: true }).click();
  await page.getByRole("option", { name: "Confirmed", exact: true }).click();
  await expect(page.locator(".list-query-count")).toHaveText("1");
});

test("tables carry a Created by column", async ({ page }) => {
  await signIn(page, "md@enercore.test");
  // Wide screens: a sortable column of its own.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace/all-companies/sales-orders");
  await expect(page.getByRole("columnheader", { name: /Created by/ })).toBeVisible();
  await page.getByRole("columnheader", { name: /Created by/ }).getByRole("button").click();
  await expect(page.getByRole("columnheader", { name: /Created by/ })).toHaveAttribute("aria-sort", "ascending");

  // Narrower screens drop the column for space; the creator is not lost but
  // moves into each record's summary line.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("columnheader", { name: /Created by/ })).toBeHidden();
  const rows = page.locator(".e-record-table tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++)
    await expect(rows.nth(i).locator(".e-row-owner")).toBeVisible();
  await expect(rows.first().locator(".e-row-owner")).toHaveText(/ · by \S/);
});

test("the activity log is a table whose entries open a detail dialog", async ({ page }) => {
  await signIn(page, "md@enercore.test");
  await page.goto("/workspace/all-companies/activity");
  await page.locator(".table-scroll").waitFor();
  for (const column of ["Person", "What changed", "Company", "When"])
    await expect(page.getByRole("columnheader", { name: new RegExp(column) })).toBeVisible();
  // The generic name sort made no sense for an audit trail.
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Sort events", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /^Open activity by/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Activity detail");
  await expect(dialog).toContainText("Person");
  await expect(dialog).toContainText("When");
  await expect(dialog).toContainText("cannot be edited");
});

test("the company filter is hidden where it changes nothing", async ({ page }) => {
  await signIn(page, "md@enercore.test");
  await expect(page.getByRole("combobox", { name: "Company", exact: true })).toBeVisible();
  for (const view of ["profile", "appearance", "shortcuts"]) {
    await page.goto(`/workspace/all-companies/${view}`);
    await page.locator(".page-heading, h1").first().waitFor();
    await expect(page.getByRole("combobox", { name: "Company", exact: true })).toHaveCount(0);
  }
});
