import { test, expect } from "@playwright/test";

const shots = "/private/tmp/claude-501/-Users-pranavs-NavOasis-new-crm/9fd55b45-e578-4c96-9dc7-8f2515043bd0/scratchpad/shots";

async function pickPeriod(page: import("@playwright/test").Page, option: string) {
  await page.getByRole("combobox", { name: "Dashboard time range" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("every dashboard period applies to the metrics and charts it controls", async ({ page }) => {
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".stats-grid").waitFor();

  // All time is the widest scope; every narrower preset must be a subset of it.
  const ordersAll = await page.locator(".stats-grid .stat-card").filter({ hasText: "Confirmed orders" }).innerText();
  const allCount = Number(ordersAll.match(/(\d+) orders/)![1]);
  expect(allCount).toBeGreaterThan(0);

  for (const [option, label] of [
    ["Today", "Today"],
    ["Last 7 days", "7 days"],
    ["Last 30 days", "30 days"],
    ["Last 90 days", "90 days"],
    ["Last 12 months", "12 months"],
  ] as const) {
    await pickPeriod(page, option);
    const text = await page.locator(".stats-grid .stat-card").filter({ hasText: "Confirmed orders" }).innerText();
    const count = Number(text.match(/(\d+) orders/)![1]);
    expect(count, `${label} must not exceed all time`).toBeLessThanOrEqual(allCount);
    // The value shown is explicitly scoped to one currency.
    expect(text).toContain("USD value only");
  }

  await pickPeriod(page, "All time");
  const back = await page.locator(".stats-grid .stat-card").filter({ hasText: "Confirmed orders" }).innerText();
  expect(Number(back.match(/(\d+) orders/)![1])).toBe(allCount);
});

test("an incomplete or reversed custom range is explained, not silently ignored", async ({ page }) => {
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".stats-grid").waitFor();
  await pickPeriod(page, "Custom dates");
  // Choosing Custom without dates must not quietly behave like All time.
  await expect(page.locator(".dashboard-period-note")).toContainText("Choose both a start and an end date");

  await page.getByRole("button", { name: "Dashboard start date", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Dashboard end date", exact: true }).click();
  const popover = page.locator(".ui-calendar-popover").last();
  await popover.getByRole("button", { name: "Go to the Previous Month" }).click();
  const last = new Date();
  last.setDate(1);
  last.setMonth(last.getMonth() - 1);
  const day = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-15`;
  await popover.locator(`td[data-day="${day}"] button`).click();
  await expect(page.locator(".dashboard-period-note[role='alert']")).toContainText("end date is before the start date");
});

test("operational alerts stay current and are labelled as such", async ({ page }) => {
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".dashboard-period").waitFor();
  await expect(page.locator(".dashboard-period")).toContainText("Daily focus remains current");
  await expect(page.locator(".insight-banner")).toBeVisible();
});

test("delete controls read as destructive in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/workspace/all-companies/sales-orders");
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const del = page.locator(".delete-action").first();
    await del.waitFor();
    const color = await del.evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(r, `${theme} delete colour ${color}`).toBeGreaterThan(150);
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
  }
});

test("capture light and dark, desktop and mobile", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    for (const [w, h, name] of [[1440, 900, "desktop"], [390, 844, "mobile"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/workspace/all-companies/overview");
      await page.locator(".stats-grid").waitFor();
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/overview-${theme}-${name}.png`, animations: "disabled", fullPage: name === "desktop" });
      await page.goto("/workspace/all-companies/sales-orders");
      await page.locator(".records-panel .table-scroll").waitFor();
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${shots}/orders-${theme}-${name}.png`, animations: "disabled" });
      // Horizontal overflow is a layout failure at any width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
