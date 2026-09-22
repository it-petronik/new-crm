import { test, expect } from "@playwright/test";

test("salary components persist, total is derived, and legacy records survive editing", async ({ page }) => {
  await page.goto("/workspace/all-companies/people-hr");
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  await page.getByRole("textbox", { name: "Employee full name", exact: true }).fill("Salary Check Person");
  await page.getByRole("textbox", { name: "Job title", exact: true }).fill("Operations assistant");
  await page.getByRole("spinbutton", { name: "Basic salary", exact: true }).fill("8000");
  await page.getByRole("spinbutton", { name: "Allowance", exact: true }).fill("1250.75");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // The stored total is derived from the two components, not typed separately.
  await page.getByRole("button", { name: /Salary Check Person/ }).first().click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Monthly total");
  await expect(detail).toContainText("9250.75");
  await expect(detail).toContainText("8000");
  await expect(detail).toContainText("1250.75");

  // Editing recalculates rather than leaving the old total behind.
  await detail.getByRole("button", { name: "Edit record", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Allowance", exact: true }).fill("0");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  // Saving returns to the record detail, which must already show the new total.
  await expect(page.getByRole("dialog")).toContainText("Monthly total");
  await expect(page.getByRole("dialog")).not.toContainText("9250.75");
  await page.reload();
  await page.getByRole("button", { name: /Salary Check Person/ }).first().click();
  const reopened = page.getByRole("dialog");
  await expect(reopened).toContainText("8000");
  // The old total must not linger once a component changes.
  await expect(reopened).not.toContainText("9250.75");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("enercore-preview-v1") || "{}").records.find((r: { title: string }) => r.title === "Salary Check Person"));
  expect(stored.attributes.monthlySalary).toBe("8000");
});

test("friendly URLs survive direct load, reload, history and company switching", async ({ page }) => {
  await page.goto("/workspace/petronik/sales-pipeline");
  await expect(page.getByRole("heading", { name: "Sales pipeline", level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sales pipeline", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/workspace/petronik/sales-pipeline");

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/petronik\/accounts$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/workspace\/petronik\/sales-pipeline$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/workspace\/petronik\/accounts$/);

  // Switching company keeps the page and rewrites only the company segment.
  await page.getByRole("combobox", { name: /compan/i }).first().click();
  await page.getByRole("option", { name: "Afrilube", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/afrilube\/accounts$/);
});

test("older query-string bookmarks still resolve", async ({ page }) => {
  await page.goto("/?module=accounts&company=Petronik");
  await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/petronik\/accounts$/);
});

test("my requests keeps the employee's own scope on a direct URL", async ({ page }) => {
  await page.goto("/workspace/petronik/my-requests");
  await expect(page.getByRole("heading", { name: "My requests", level: 1 })).toBeVisible();
  await expect(page.getByText("Only your own requests appear here.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My requests", level: 1 })).toBeVisible();
});
