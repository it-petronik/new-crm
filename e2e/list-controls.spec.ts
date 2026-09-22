import { test, expect, type Page } from "@playwright/test";

/** Document order of the filter row, the list and the pagination nav. */
async function regionOrder(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".records-panel") as HTMLElement;
    const nodes = [...panel.querySelectorAll(".list-query-controls, .table-scroll, .record-grid, .pagination")];
    return nodes.map((n) => n.className.split(" ")[0]);
  });
}

test("filters, list and pagination share one visual and keyboard order", async ({ page }, info) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  // Markup order, which is also tab order.
  expect(await regionOrder(page)).toEqual(["list-query-controls", "table-scroll", "pagination"]);

  // Visual order must agree: filters above the table, pagination below it.
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const filters = await box(".list-query-controls");
  const table = await box(".table-scroll");
  const pager = await box(".pagination");
  expect(filters.y).toBeLessThan(table.y);
  expect(table.y).toBeLessThan(pager.y);

  // Tabbing forward from the search box reaches the filter toggle before the table.
  await page.getByRole("textbox", { name: "Search records", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Filters/ })).toBeFocused();
  await page.screenshot({ path: info.outputPath("list-controls.png"), animations: "disabled" });
});

test("a filtered-out list explains itself and resets", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  await page.getByRole("textbox", { name: "Search records", exact: true }).fill("zzzzz-no-such-record");
  await expect(page.locator(".list-empty")).toContainText("No records match the current filters");
  // The blank table is removed rather than left as an empty shell.
  await expect(page.locator(".records-panel .table-scroll")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "records pagination" })).toBeHidden();
  await page.locator(".list-empty").getByRole("button", { name: "Reset filters" }).click();
  await expect(page.locator(".records-panel .table-scroll")).toBeVisible();
  await expect(page.locator(".list-empty")).toBeHidden();
});

test("business lists offer no date range and sort from column headings", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  // Date range inputs were removed from business lists.
  await expect(page.getByRole("button", { name: /record date/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Sort records", exact: true })).toHaveCount(0);
  await expect(page.locator(".list-query-panel")).toContainText("Select a column heading to sort");

  const header = page.getByRole("columnheader", { name: /Value/ });
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  const asc = await page.locator(".records-panel td.amount").allInnerTexts();
  const ascNumbers = asc.map((a) => Number(a.replace(/[^0-9.]/g, "")));
  expect(ascNumbers).toEqual([...ascNumbers].sort((a, b) => a - b));

  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  const desc = await page.locator(".records-panel td.amount").allInnerTexts();
  const descNumbers = desc.map((a) => Number(a.replace(/[^0-9.]/g, "")));
  expect(descNumbers).toEqual([...descNumbers].sort((a, b) => b - a));

  // A third click returns the table to its default order.
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "none");
});

test("only one column reports itself as sorted", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  await page.getByRole("columnheader", { name: /Value/ }).getByRole("button").click();
  await page.getByRole("columnheader", { name: /Company/ }).getByRole("button").click();
  await expect(page.getByRole("columnheader", { name: /Value/ })).toHaveAttribute("aria-sort", "none");
  await expect(page.getByRole("columnheader", { name: /Company/ })).toHaveAttribute("aria-sort", "ascending");
  expect(await page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]').count()).toBe(1);
});

test("single-currency data is sorted without a misleading currency note", async ({ page }) => {
  // Preview records are all USD, so the cross-currency caveat must stay hidden.
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  await page.getByRole("columnheader", { name: /Value/ }).getByRole("button").click();
  await page.getByRole("columnheader", { name: /Value/ }).getByRole("button").click();
  await expect(page.locator(".list-query-message[role='status']")).toHaveCount(0);
  const amounts = await page.locator(".records-panel td.amount").allInnerTexts();
  const numeric = amounts.map((a) => Number(a.replace(/[^0-9.]/g, ""))).filter((n) => n > 0);
  expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
});

test("the cashbook filters on the transaction date it displays", async ({ page }) => {
  await page.goto("/?module=accounts&company=Petronik");
  // Preview fixtures carry no cash entries, so one is created for this check.
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Transaction date check");
  await page.getByRole("spinbutton", { name: "Amount", exact: true }).fill("42");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".cashbook-panel thead")).toContainText("Transaction date");
  await expect(page.locator(".cashbook-panel").getByRole("columnheader", { name: /Transaction date/ })).toHaveAttribute("aria-sort", "none");
  // The cashbook must not offer a second search box beside the shared one.
  await expect(page.locator(".cashbook-panel").getByRole("textbox", { name: /Search/ })).toHaveCount(1);
});

test("user administration has a single search control", async ({ page }) => {
  await page.goto("/workspace/all-companies/access-control");
  await expect(page.getByRole("textbox", { name: /Search users/ })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Search users", exact: true })).toBeVisible();
});

test("selecting a donut segment does not move the page", async ({ page }) => {
  await page.goto("/workspace/all-companies/overview");
  const selection = page.locator(".chart-selection").first();
  await expect(selection).toBeVisible();
  // Focusing a segment scrolls the page, so sizes are compared, not viewport coordinates.
  const measure = () => page.evaluate(() => {
    const sel = document.querySelector(".chart-selection") as HTMLElement;
    return { h: sel.getBoundingClientRect().height, panel: (sel.parentElement as HTMLElement).getBoundingClientRect().height, doc: document.documentElement.scrollHeight };
  });
  const before = await measure();
  const segment = page.locator(".chart-segment").first();
  await segment.focus();
  await page.keyboard.press("Enter");
  await expect(selection).toContainText("% of displayed total");
  const after = await measure();
  expect(after.h).toBe(before.h);
  expect(after.panel).toBe(before.panel);
  expect(after.doc).toBe(before.doc);
  // A single order is not described as "1 orders".
  await expect(selection).not.toContainText("1 orders");
  // Focus stays visible without drawing a box around the whole donut.
  await expect(segment).toHaveCSS("outline-style", "none");
  await expect(segment).toHaveCSS("stroke-width", "29px");
});

test("no console errors and no failed asset requests on the dashboard", async ({ page }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto("/workspace/all-companies/overview");
  await page.waitForLoadState("networkidle");
  // An explicit icon stops the browser probing /favicon.ico.
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/icon.svg");
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test("a list offers exactly one status filter", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  await page.locator(".records-panel .table-scroll").waitFor();
  // The toolbar control used to sit alongside the shared filter row.
  await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "records status", exact: true })).toHaveCount(1);
  await expect(page.locator(".records-panel").getByRole("textbox", { name: /Search records/ })).toHaveCount(1);
});

test("the kanban board keeps its own status control", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.locator(".kanban").waitFor();
  await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveCount(1);
});

test("page size control shows its full label", async ({ page }) => {
  await page.goto("/workspace/all-companies/sales-orders");
  const trigger = page.getByRole("combobox", { name: "records per page" });
  await expect(trigger).toContainText("10 per page");
  const clipped = await trigger.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
});
