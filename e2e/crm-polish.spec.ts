import { test, expect } from "@playwright/test";
import { makePreview, previewActor } from "../src/lib/fixtures";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ actor, data }) => {
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    },
    { actor: previewActor, data: makePreview() },
  );
});
test("no duplicate dashboard tabs; one spacing gap and compact summaries", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/overview");
  await expect(
    page.getByRole("heading", { name: "Departments & team" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Performance", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^My priorities/ }),
  ).toHaveCount(0);
  const spacing = await page.locator(".page-under-record").evaluate((el) => {
    const children = [...el.children].filter((e) => e.getClientRects().length);
    return children
      .slice(1)
      .map((e) => parseFloat(getComputedStyle(e).marginTop));
  });
  expect(
    spacing.every((m) => m === 0),
    JSON.stringify(spacing),
  ).toBe(true);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`dashboard-${theme}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Employee performance", exact: true })
    .click();
  const table = page.getByRole("table");
  await table.getByRole("button", { name: /Overdue/ }).click();
  await expect(
    table.getByRole("columnheader", { name: /Overdue/ }),
  ).toHaveAttribute("aria-sort", "ascending");
});
test("month picker and payroll validation are custom and accessible", async ({
  page,
}, info) => {
  await page.goto("/workspace/all-companies/people-hr");
  const select = async (name: string) => {
    await page.getByRole("combobox", { name: "HR workspace section" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await select("Attendance");
  await page
    .getByRole("button", { name: "Register month", exact: true })
    .click();
  const month = page.getByRole("dialog", { name: "Choose month" });
  await expect(month).toBeVisible();
  await month
    .getByRole("button", { name: "November 2026", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Register month", exact: true }),
  ).toContainText("November 2026");
  await expect(page.locator('input[type="month"]')).toHaveCount(0);
  await select("Payroll Register");
  await page.getByRole("button", { name: "New payroll", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New payroll", exact: true });
  expect(
    await dialog
      .locator("form")
      .evaluate((f) => (f as HTMLFormElement).noValidate),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog.locator(".has-error")).not.toHaveCount(0);
  await expect(dialog.locator(".ui-field-message").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("custom-payroll-feedback.png"),
  });
});
test("lead sorting preserves rows, uses flame symbols and procurement navigation", async ({
  page,
}) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.getByRole("columnheader", { name: "Lead / company", exact: true }).getByRole("button").click();
  const names = await page
    .locator("[data-lead-row] h3,[data-lead-row] [class*=identity] button")
    .allTextContents();
  expect(names.length).toBeGreaterThan(1);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  const marks = await page.locator("[data-lead-row] .brand-logo").all();
  for (const mark of marks) {
    await expect(mark.locator("span")).toHaveCSS("overflow", "hidden");
    expect((await mark.boundingBox())!.width).toBeLessThanOrEqual(36);
  }
  const group = page
    .locator("nav details")
    .filter({ has: page.getByText("Procurement", { exact: true }) });
  if (await group.count()) {
    await group.locator("summary").click();
    await expect(
      group.getByRole("button", { name: "Suppliers", exact: true }),
    ).toBeVisible();
  }
});
