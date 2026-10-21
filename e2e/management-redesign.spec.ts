import { test, expect, type Page } from "@playwright/test";
import { demoAccounts, makePreview, previewActor } from "../src/lib/fixtures";
import type { Actor } from "../src/lib/domain";
import { workspaceUrl } from "../src/lib/workspace-url";

async function seed(page: Page, actor: Actor = previewActor) {
  await page.addInitScript(
    ({ actor, data }) => {
      localStorage.setItem("enercore-preview-actor", JSON.stringify(actor));
      localStorage.setItem("enercore-preview-v1", JSON.stringify(data));
    },
    { actor, data: makePreview() },
  );
}
test("MD sees every department and can analyze employees, filter and inspect assigned work", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await seed(page);
  await page.goto("/workspace/all-companies/overview");
  const overview = page.getByRole("region", {
    name: "Department and employee overview",
    exact: true,
  });
  await expect(overview.locator("[data-department]")).toHaveCount(6);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const cards = overview.locator("[data-department]");
    const boxes = await Promise.all(
      (await cards.all()).map((c) => c.boundingBox()),
    );
    expect(boxes[1]!.x - boxes[0]!.x - boxes[0]!.width).toBeGreaterThanOrEqual(
      15,
    );
    expect(boxes[3]!.y - boxes[0]!.y - boxes[0]!.height).toBeGreaterThanOrEqual(
      15,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`md-departments-${theme}.png`),
      fullPage: true,
    });
  }
  await overview
    .getByRole("button", { name: "Employee performance", exact: true })
    .click();
  await expect(overview.getByRole("table")).toBeVisible();
  await overview
    .getByRole("searchbox", { name: "Find an employee", exact: true })
    .fill("Leila");
  await expect(
    overview.getByRole("button", { name: /Leila Ahmed/ }),
  ).toHaveCount(1);
  await overview.getByRole("button", { name: /Leila Ahmed/ }).click();
  await expect(
    overview.getByText("Assigned CRM work", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("md-employee-work.png"),
    fullPage: true,
  });
  await overview
    .getByRole("searchbox", { name: "Find an employee", exact: true })
    .fill("Nobody matches");
  await expect(
    overview.getByText("No employees match these filters."),
  ).toBeVisible();
  await overview
    .getByRole("searchbox", { name: "Find an employee", exact: true })
    .fill("");
  const download = page.waitForEvent("download");
  await overview
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/^Enercore_Employee-performance_\d{4}-\d\d-\d\d_Alex-Morgan\.xlsx$/);
  const icon = page.locator('link[rel="icon"]').first();
  expect(await icon.getAttribute("href")).toContain("enercore-flame.svg");
});

test("shared page spacing and standard forms remain compact and separated across all modules", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page);
  const routes = [
    "overview",
    "leads",
    "quotations",
    "orders",
    "logistics",
    "accounts",
    "customers",
    "suppliers",
    "products",
    "hr",
    "marketing",
    "it",
    "approvals",
    "activity",
    "settings",
  ] as const;
  const forms: Record<string, string> = {
    leads: "New lead",
    quotations: "New quotation",
    customers: "Add customer",
    suppliers: "Add supplier",
    products: "Add product",
    hr: "Add employee",
    it: "New ticket",
  };
  for (const route of routes) {
    await page.goto(workspaceUrl(route, "Petronik"));
    await expect(page.locator("#main h1").first()).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        route,
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`${route}-${theme}.png`) });
    }
    if (forms[route]) {
      if (route === "hr") {
        await page.getByRole("combobox",{name:"HR workspace section"}).click();
        await page.getByRole("option",{name:"Employee Directory",exact:true}).click();
      }
      await page
        .getByRole("button", { name: forms[route], exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
      const measurements = await dialog.evaluate((el) => {
        const controls = [
          ...el.querySelectorAll<HTMLElement>(
            ".ui-input,.ui-select-trigger,.ui-date-trigger",
          ),
        ].filter((e) => e.getClientRects().length);
        return controls.map((e) => ({
          h: e.getBoundingClientRect().height,
          font: parseFloat(getComputedStyle(e).fontSize),
        }));
      });
      expect(measurements.length).toBeGreaterThan(0);
      expect(
        measurements.every((m) => m.h === 32 && m.font === 13),
        route,
      ).toBe(true);
      const spacing = await dialog.evaluate((el) => {
        const form = el.querySelector<HTMLElement>(".quick-add-form");
        const grids = [
          ...el.querySelectorAll<HTMLElement>(".form-grid"),
        ].filter((e) => e.getClientRects().length);
        return {
          quickGap: form ? getComputedStyle(form).gap : null,
          quickTop: form ? getComputedStyle(form).marginTop : null,
          grids: grids.map((e) => ({
            row: getComputedStyle(e).rowGap,
            column: getComputedStyle(e).columnGap,
          })),
        };
      });
      if (route === "leads") {
        expect(spacing.quickGap).toBe("16px");
        expect(spacing.quickTop).toBe("16px");
      }
      for (const grid of spacing.grids) {
        expect(grid.row).toBe("16px");
        expect(grid.column).toBe("20px");
      }
      await page.screenshot({
        path: info.outputPath(`${route}-form-dark.png`),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  }
});

test("the management view is hidden from employee dashboards without changing role identity", async ({
  browser,
}) => {
  for (const { actor } of demoAccounts) {
    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const page = await context.newPage();
      await seed(page, actor);
      await page.goto("/workspace/all-companies/overview");
      await expect(
        page.getByRole("button", { name: "Open my profile", exact: true }),
      ).toContainText(actor.name);
      const view = page.getByRole("region", {
        name: "Department and employee overview",
        exact: true,
      });
      if (["MD", "IT Administrator"].includes(actor.role))
        await expect(view.locator("[data-department]")).toHaveCount(6);
      else await expect(view).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
