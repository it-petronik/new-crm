import { test, expect } from "@playwright/test";

test("row and card overflow menus open the correct edit and delete dialogs", async ({ page }) => {
  await page.goto("/?module=customers");
  // Edit and delete live in each row's overflow menu, not as permanent buttons.
  await expect(page.getByRole("button", { name: "Edit Gulf Industrial Trading", exact: true })).toHaveCount(0);
  const more = page.getByRole("button", { name: "More actions for Gulf Industrial Trading", exact: true }).first();
  await more.click();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Customer / Business name", exact: true })).toHaveValue("Gulf Industrial Trading");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await more.click();
  await page.getByRole("button", { name: "Delete record", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete record?", exact: true })).toBeVisible();
  await page.goto("/?module=leads");
  const card = page.locator(".pipeline-card-shell").first();
  await card.getByRole("button", { name: /^More actions for / }).click();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
});

test("palette survives reload and works with dark mode", async ({ page }, info) => {
  await page.goto("/?view=appearance&company=Petronik");
  await page.getByRole("button", { name: /Violet/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "violet");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--brand-action").trim())).toBe("#6d28d9");
  await page.getByRole("button", { name: /Dark mode/ }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /Violet/ })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("appearance-dark.png"), animations:"disabled" });
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({ path: info.outputPath("appearance-mobile.png"), animations:"disabled" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Company colours/ }).click();
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--brand-action").trim())).toBe("#087b89");
});
