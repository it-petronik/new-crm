import { test, expect } from "@playwright/test";
import { Client } from "./client";

test("charts keep their geometry and readable labels at zoom, narrow widths and both themes", async ({ browser }) => {
  const actor = await Client.login("studio");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".dash-analysis summary").click();

  // CSS zoom stresses actual card sizing; reduced CSS viewports separately
  // exercise the responsive breakpoints used by desktop browser zoom.
  for (const { width, zoom } of [
    { width: 1440, zoom: 1 }, { width: 1440, zoom: 1.25 },
    { width: 1440, zoom: 1.5 }, { width: 1440, zoom: 2 },
    { width: 960, zoom: 1 }, { width: 720, zoom: 1 }, { width: 390, zoom: 1 },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      const chart = page.locator(".chart-donut").last();
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toHaveAttribute("data-chart-entered", "true");
      await page.mouse.move(0, 0);
      const segment = chart.locator(".chart-segment").first();
      await segment.focus();
      await page.keyboard.press("Enter");
      await expect(chart.locator(".chart-segment").first()).toHaveCSS("stroke-width", "23px");
      await expect(chart.locator(".chart-segment").last()).toHaveCSS("stroke-width", "23px");
      await expect(chart.locator(".chart-selection")).not.toContainText("Explore the breakdown");
      expect(await chart.evaluate(el => {
        const svg = el.querySelector("svg")!.getBoundingClientRect();
        const legend = el.querySelector(".donut-breakdown")!.getBoundingClientRect();
        return {
          fits: el.scrollWidth <= el.clientWidth + 1,
          square: Math.abs(svg.width - svg.height) < 1,
          readable: legend.width / Number(document.documentElement.style.zoom || 1) >= 180,
        };
      })).toEqual({ fits: true, square: true, readable: true });
      await chart.locator("svg").evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" }));
      await expect(chart.locator("svg")).toBeInViewport({ ratio: 1 });
      await chart.locator("svg").screenshot({ path: `test-results/chart-ring-${width}-${zoom}-${theme}.png`, animations: "disabled" });
      if (zoom === 1) await chart.screenshot({ path: `test-results/chart-${width}-${zoom}-${theme}.png`, animations: "disabled" });
      await chart.getByRole("button", { name: "Clear chart selection" }).click();
      const bars = page.locator(".chart-horizontal").first();
      await bars.scrollIntoViewIfNeeded();
      expect(await bars.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
  }
  // A tall chart must reveal as soon as its first pixels enter the viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  // Collapse first to mount a fresh chart, without a reload restoring the
  // persisted open preference while a second click tries to close it.
  await page.locator(".dash-analysis summary").click();
  await expect(page.locator(".chart-donut")).toHaveCount(0);
  await page.addStyleTag({ content: ".chart-donut { min-height: 10000px !important; }" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.locator(".dash-analysis summary").click();
  const chart = page.locator(".chart-donut").last();
  await chart.evaluate(e => e.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(chart).toHaveAttribute("data-chart-entered", "true");
  expect(errors).toEqual([]);
  await context.close();
});
