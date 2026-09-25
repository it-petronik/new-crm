import { test, expect, type Page } from "@playwright/test";

/**
 * The shared table layout, across every business module and the tables that
 * are not record lists (cashbook, activity log, user administration).
 *
 * Guards the root cause of the cashbook bug: record-list column widths were
 * applied by position to every table, so a table with a different column set
 * painted one cell over the next and the record link could not be clicked.
 * Checked geometrically (cells never overlap, content stays inside its cell)
 * and behaviourally (the element under the pointer is the control itself).
 */

const PAGES: { path: string; label: string }[] = [
  { path: "/workspace/all-companies/sales-orders", label: "Orders" },
  { path: "/workspace/all-companies/logistics", label: "Logistics" },
  { path: "/?module=accounts&company=Petronik", label: "Accounts & cashbook" },
  { path: "/workspace/all-companies/sales-pipeline", label: "Leads" },
  { path: "/workspace/all-companies/customers", label: "Customers" },
  { path: "/workspace/all-companies/suppliers", label: "Suppliers" },
  { path: "/workspace/all-companies/products", label: "Products" },
  { path: "/workspace/all-companies/quotations", label: "Quotations" },
  { path: "/workspace/all-companies/activity", label: "Activity log" },
  { path: "/workspace/all-companies/access-control", label: "User administration" },
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

/** Whether the centre of `selector`'s first match is really that element. */
const hitsItself = (page: Page, locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });

async function layoutProblems(page: Page, mobile: boolean) {
  return page.evaluate((mobile) => {
    const problems: string[] = [];
    const tables = [...document.querySelectorAll<HTMLTableElement>(".table-scroll table")].filter(
      (t) => t.getBoundingClientRect().width > 0,
    );
    for (const [ti, table] of tables.entries()) {
      const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].slice(0, 6);
      for (const [ri, row] of rows.entries()) {
        const cells = [...row.cells].filter((c) => getComputedStyle(c).display !== "none");
        if (!mobile) {
          for (let i = 0; i + 1 < cells.length; i++) {
            const a = cells[i].getBoundingClientRect();
            const b = cells[i + 1].getBoundingClientRect();
            if (a.right > b.left + 1) problems.push(`table ${ti} row ${ri}: cell ${i} overlaps cell ${i + 1}`);
          }
        }
        // Nothing inside a cell may be drawn outside it.
        for (const [ci, cell] of cells.entries()) {
          const c = cell.getBoundingClientRect();
          for (const child of cell.querySelectorAll<HTMLElement>(".record-link, .avatar-name, .table-record-actions, .e-badge")) {
            const k = child.getBoundingClientRect();
            if (k.width && (k.right > c.right + 1 || k.left < c.left - 1))
              problems.push(`table ${ti} row ${ri} cell ${ci}: ${child.className} spills out of its cell`);
          }
        }
        if (mobile && getComputedStyle(row).display !== "block") problems.push(`table ${ti} row ${ri}: not a card on mobile`);
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push(`page overflows horizontally by ${document.documentElement.scrollWidth - window.innerWidth}px`);
    return { tables: tables.length, problems };
  }, mobile);
}

/**
 * Some modules open on cards (Logistics, the Leads board); check those as
 * they first appear, then switch to the list with the real toggle.
 */
async function checkDefaultCards(page: Page, label: string) {
  const card = page.locator(".record-card-shell").first();
  if (!(await card.count())) return;
  expect(await hitsItself(page, card.locator("> button").first()), `${label}: card is covered`).toBe(true);
  const more = card.getByRole("button", { name: /^More actions for / });
  if (await more.count()) expect(await hitsItself(page, more.first()), `${label}: card actions are covered`).toBe(true);
}

async function showList(page: Page) {
  const list = page.getByRole("button", { name: "List view", exact: true });
  if (await list.count()) await list.click();
  await page.locator(".table-scroll table").first().waitFor({ timeout: 20_000 });
}

async function openModule(page: Page, path: string) {
  await page.goto(path);
  const list = page.locator(".record-card-shell, .table-scroll table").first();
  const empty = page.getByText("Nothing here yet");
  await list.or(empty).first().waitFor({ timeout: 20_000 });
  // The preview's fictional data has no suppliers; add one through the real
  // form so the Suppliers list has a row to lay out.
  if (path.endsWith("/suppliers") && (await empty.isVisible())) {
    await page.getByRole("button", { name: "Add supplier", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Supplier legal name", exact: true }).fill("Harbour Additives Trading LLC");
    await page.getByRole("button", { name: "Create supplier", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await list.waitFor({ timeout: 20_000 });
}

for (const viewport of VIEWPORTS) {
  test(`tables lay out cleanly at ${viewport.width}px`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(viewport);
    const mobile = viewport.width <= 720;
    for (const { path, label } of PAGES) {
      await openModule(page, path);
      const cardView = await layoutProblems(page, mobile);
      expect(cardView.problems, `${label} (first view) at ${viewport.width}px`).toEqual([]);
      await checkDefaultCards(page, label);

      await showList(page);
      const { tables, problems } = await layoutProblems(page, mobile);
      expect(problems, `${label} at ${viewport.width}px`).toEqual([]);
      expect(tables, label).toBeGreaterThan(0);

      // The record link and the row's actions are the topmost element under
      // the pointer: no neighbouring cell covers them.
      const row = page.locator(".table-scroll tbody tr").first();
      expect(await hitsItself(page, row.locator(".record-link").first()), `${label}: record link is covered`).toBe(true);
      const more = row.getByRole("button", { name: /^More actions for / });
      if (await more.count()) expect(await hitsItself(page, more.first()), `${label}: actions are covered`).toBe(true);
    }
  });
}

test("record links and row actions respond to real clicks in every module", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const { path, label } of PAGES.filter((p) => !["Activity log", "User administration"].includes(p.label))) {
    await openModule(page, path);
    await showList(page);
    const row = page.locator(".table-scroll tbody tr").first();
    await row.locator(".record-link").first().click();
    await expect(page.getByRole("dialog"), `${label}: opening the record`).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const more = row.getByRole("button", { name: /^More actions for / });
    if (await more.count()) {
      await more.first().click();
      await expect(page.getByRole("button", { name: "Edit details", exact: true }), `${label}: row menu`).toBeVisible();
      await page.keyboard.press("Escape");
    }
  }
});
