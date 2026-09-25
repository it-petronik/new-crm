import { test, expect, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow, expectInsideViewport, expectNotOverlapping,
  expectAlignedTop, expectReasonableGap, expectEqualGutters, expectBelowHeader,
  VIEWPORTS,
} from "./layout-helpers";

const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector(".quick-add-trigger");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });

const signIn = async (page: Page, who = "md") => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`${who}@enercore.test`) }).click();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await hydrated(page);
};

/** The pages that must all obey the same container. */
const PAGES = [
  "/workspace/all-companies/overview",
  "/workspace/all-companies/sales-orders",
  "/workspace/all-companies/customers",
  "/workspace/all-companies/quotations",
  "/workspace/all-companies/sales-pipeline",
];

test("the executive dashboard is laid out by the shared system", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await expect(page.locator(".e-kpi-strip")).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);

  const kpis = page.locator(".e-kpi-strip");
  const attention = page.locator(".command-attention");
  const pipeline = page.locator(".e-pipeline");
  const operations = page.locator(".e-operations");

  // Nothing hides under the sticky header, and nothing is clipped.
  await expectBelowHeader(kpis, page, "KPI strip");
  await expectInsideViewport(kpis, page, "KPI strip");
  await expectNotOverlapping(page.locator(".topbar"), kpis, "header and KPI strip");

  // The two executive panels start on the same line and do not collide.
  await expectAlignedTop(attention, pipeline, 2, "attention and pipeline");
  await expectNotOverlapping(attention, pipeline, "attention and pipeline");

  // Sections are separated by the page rhythm, not by ad-hoc margins.
  await expectReasonableGap(kpis, attention, 8, 40, "KPI strip to attention");
  await expectReasonableGap(attention, operations, 8, 40, "attention to operations");

  // Equal gutters, and nothing wider than the container.
  await expectEqualGutters(page.locator(".main-content"), page);
  await expectNoHorizontalOverflow(page, "dashboard at 1440");

  const container = (await page.locator(".main-content").boundingBox())!;
  for (const sel of [".e-kpi-strip", ".command-attention", ".e-pipeline", ".e-operations"]) {
    const box = (await page.locator(sel).boundingBox())!;
    expect(box.x, `${sel} starts left of the container`).toBeGreaterThanOrEqual(container.x - 1);
    expect(box.x + box.width, `${sel} extends past the container`)
      .toBeLessThanOrEqual(container.x + container.width + 1);
  }
});

test("every KPI tile is the same size and none is clipped", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await expect(page.locator(".e-kpi-strip")).toBeVisible();

  const boxes = await page.locator(".e-kpi").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, scrollH: el.scrollHeight, clientH: el.clientHeight };
    }),
  );
  expect(boxes.length).toBe(4);
  const widths = boxes.map((b) => Math.round(b.w));
  expect(Math.max(...widths) - Math.min(...widths), "tiles share a width").toBeLessThanOrEqual(2);
  for (const box of boxes)
    expect(box.scrollH, "a tile must not clip its own content").toBeLessThanOrEqual(box.clientH + 1);
});

test("a list toolbar and its rows share one alignment line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/workspace/all-companies/sales-orders");
  const toolbar = page.locator(".list-query-controls").first();
  const table = page.locator(".table-scroll").first();
  await expect(toolbar).toBeVisible();
  await expect(table).toBeVisible();
  const [a, b] = [(await toolbar.boundingBox())!, (await table.boundingBox())!];
  expect(Math.abs(a.x - b.x), "toolbar and table left edges").toBeLessThanOrEqual(2);
});

for (const viewport of VIEWPORTS) {
  test(`no page overflows or hides content at ${viewport.name}`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page);

    for (const path of PAGES) {
      await page.goto(path);
      await page.locator(".main-content").waitFor();
      await expectNoHorizontalOverflow(page, `${path} at ${viewport.name}`);
      await expectEqualGutters(page.locator(".main-content"), page, 3);

      // Whatever the page renders, it stays inside the viewport.
      const first = page.locator(".main-content > *").first();
      if (await first.count()) {
        await expectInsideViewport(first, page, `${path} first section`);
        await expectBelowHeader(first, page, `${path} first section`);
      }
    }
  });
}

test("the mobile dashboard fits and its fixed action clears the content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.locator(".e-kpi-strip")).toBeVisible();

  await expectNoHorizontalOverflow(page, "mobile dashboard");
  for (const sel of [".e-kpi-strip", ".command-attention", ".e-pipeline", ".e-operations"])
    await expectInsideViewport(page.locator(sel), page, sel);

  // Two KPI columns on a phone, not four squeezed ones.
  const columns = await page.locator(".e-kpi-strip").evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(columns).toBeLessThanOrEqual(2);

  // The floating Quick Add must not sit on top of the last row of content.
  const trigger = page.locator(".quick-add-trigger");
  await expectInsideViewport(trigger, page, "quick add");
});
