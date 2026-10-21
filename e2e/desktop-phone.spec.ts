import { test, expect } from "@playwright/test";
import { demoAccounts, makePreview, previewActor } from "../src/lib/fixtures";

for (const width of [360, 390, 430])
  test(`phone ${width} retains desktop navigation, tables and dashboard after refresh`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      await context.addInitScript(
        ({ actor, data }) => {
          localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
          if (!localStorage.getItem("enercore-preview-v1"))
            localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
        },
        { actor: previewActor, data: makePreview() },
      );
      const page = await context.newPage();
      for (const theme of ["light", "dark"]) {
        await page.goto("/workspace/all-companies/overview");
        await page
          .getByRole("combobox", { name: "Dashboard currency", exact: true })
          .waitFor();
        await page.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        expect(await page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(
          1280,
        );
        await expect(
          page.locator('nav[aria-label="Main navigation"]'),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Open navigation", exact: true }),
        ).toBeHidden();
        const metrics = page.locator('[class*="metrics_"]');
        await expect(metrics.first()).toBeVisible();
        expect(
          await metrics
            .first()
            .evaluate(
              (el) =>
                getComputedStyle(el).gridTemplateColumns.split(" ").length,
            ),
        ).toBe(4);
        const metadata = await page
          .locator('meta[name="viewport"]')
          .getAttribute("content");
        expect(metadata).toContain("width=1280");
        expect(metadata).not.toContain("user-scalable=no");
        expect(metadata).not.toContain("maximum-scale=1");
        expect(metadata).not.toContain("initial-scale=1");
        const visible = await page.evaluate(() => ({
          width: visualViewport!.width,
          scale: visualViewport!.scale,
        }));
        expect(visible.width).toBeGreaterThanOrEqual(1279);
        expect(visible.scale).toBeLessThan(1);
        await page.screenshot({
          path: info.outputPath(`desktop-phone-dashboard-${theme}.png`),
          fullPage: true,
        });
        await page.goto("/workspace/all-companies/customers");
        await expect(page.locator(".record-list-surface table")).toBeVisible();
        expect(
          await page
            .locator(".record-list-surface table")
            .evaluate((el) => getComputedStyle(el).display),
        ).toBe("table");
        const headings = page.locator(".record-list-surface table thead");
        await expect(headings).toBeVisible();
        await page.reload();
        await expect(
          page.locator('nav[aria-label="Main navigation"]'),
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(
          1280,
        );
        await page
          .getByRole("button", { name: "Quick add", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Quick add",
          exact: true,
        });
        await expect(dialog.locator('input[name="name"]')).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.width).toBeGreaterThan(500);
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await page
          .locator('nav[aria-label="Main navigation"]')
          .getByRole("button", { name: "Lead Desk", exact: true })
          .click();
        await expect(page).toHaveURL(/\/lead-desk$/);
        await expect(
          page.getByRole("searchbox", {
            name: "Search leads or product grade",
            exact: true,
          }),
        ).toBeVisible();
        expect(await page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(
          1280,
        );
        await page
          .getByRole("link", { name: "My requests", exact: true })
          .click();
        await expect(page).toHaveURL(/\/my-requests$/);
        await expect(page.locator("#main h1").first()).toBeVisible();
        expect(
          await page.locator('meta[name="viewport"]').getAttribute("content"),
        ).toContain("width=1280");
        await page.reload();
        await expect(
          page.locator('nav[aria-label="Main navigation"]'),
        ).toBeVisible();
      }
      await page.goto("/login");
      expect(
        await page.locator('meta[name="viewport"]').getAttribute("content"),
      ).toContain("width=device-width");
      expect(await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(
        width + 1,
      );
    } finally {
      await context.close();
    }
  });

test("desktop phone mode retains each role's own workspace", async ({
  browser,
}) => {
  for (const { actor } of demoAccounts) {
    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      await context.addInitScript(
        ({ actor, data }) => {
          localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
          localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
        },
        { actor, data: makePreview() },
      );
      const page = await context.newPage();
      await page.goto("/workspace/all-companies/overview");
      await expect(page.locator(".skeleton-region")).toHaveCount(0);
      await expect(page.locator("#main h1").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Open my profile", exact: true }),
      ).toContainText(actor.name);
      expect(await page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(
        1280,
      );
      await expect(
        page.locator('nav[aria-label="Main navigation"]'),
      ).toBeVisible();
      if (!["MD", "IT Administrator"].includes(actor.role))
        await expect(page.locator("#main h1").first()).not.toHaveText(
          "Group dashboard",
        );
    } finally {
      await context.close();
    }
  }
});
