import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { formatMoneyCompact } from "../../src/lib/money-format";

test("studio navigation, dashboard and status views preserve the working routes", async ({
  browser,
}) => {
  const actor = await Client.login("cmmd");
  const result = await actor.request("POST", "/api/records", {
    kind: "leads",
    company: "Petronik",
    branch: "Main",
    title: "Studio redesign · sample enquiry",
    contact: "Sample buyer",
    product: "Base Oil SN 500",
    quantity: 80,
    unit: "MT",
    amount: 64000,
    currency: "USD",
    due: "2026-10-01",
    detail: "Fictional local design verification.",
    source: "Design test",
    requestId: crypto.randomUUID(),
  });
  expect(result.status).toBe(201);
  const permitted = (await actor.request("GET", "/api/records")).body.records;
  const pipeline = permitted.filter((r: { kind: string; status: string; currency: string }) => r.kind === "leads" && !["Won", "Lost"].includes(r.status) && r.currency === "USD").reduce((total: number, r: { amount: number }) => total + r.amount, 0);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  try {
    await page.goto("/workspace/all-companies/overview");
    const dashboard = page.locator('[data-ui="studio-dashboard"]');
    await expect(dashboard).toBeVisible();
    await expect(
      dashboard.getByRole("button", { name: /Open pipeline/ }).first(),
    ).toContainText(formatMoneyCompact(pipeline, "USD"));
    await expect(
      dashboard.getByRole("button", { name: /View leads/ }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/studio-dashboard-desktop.png",
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.screenshot({
      path: "test-results/studio-dashboard-dark.png",
      animations: "disabled",
    });
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await dashboard.getByRole("button", { name: /View leads/ }).click();
    await expect(page).toHaveURL(/sales-pipeline/);
    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Sales pipeline", exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Expand sidebar", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Access control", exact: true }),
    ).toBeVisible();
    await page.goto("/workspace/all-companies/sales-pipeline");
    await page.getByRole("button", { name: "List view", exact: true }).click();
    const views = page.locator('[aria-label="Record views"]');
    await expect(views).toBeVisible();
    await views.getByRole("button", { name: /New/ }).click();
    await expect(views.getByRole("button", { name: /New/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await views.getByRole("button", { name: /All records/ }).click();
    await page
      .locator(".record-link")
      .filter({ hasText: "Studio redesign · sample enquiry" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Studio redesign · sample enquiry",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/studio-record-desktop.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/studio-record-phone.png",
      animations: "disabled",
    });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      offenders: [...document.querySelectorAll("main *")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > innerWidth + 1;
        })
        .map((e) => ({
          element: e.className,
          width: e.getBoundingClientRect().width,
        }))
        .slice(0, 12),
    }));
    expect(geometry.width, JSON.stringify(geometry)).toBeLessThanOrEqual(
      geometry.viewport,
    );
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Email", exact: true }).click();
    await expect(page).toHaveURL(/email/);
    await expect(drawer).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/studio-email-phone.png",
      animations: "disabled",
    });
  } finally {
    await actor.request("PATCH", "/api/records", {
      action: "delete",
      id: result.body.record.id,
      expectedUpdatedAt: result.body.record.updatedAt,
    });
    await context.close();
  }
});

test("requests are history first and the compact form keeps actions visible", async ({
  browser,
}) => {
  const actor = await Client.login("cmsales2");
  const context = await browser.newContext();
  await actor.signInBrowser(context);
  const page = await context.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/workspace/all-companies/my-requests");
    await expect(
      page.getByRole("heading", { name: "Your request history", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Leave type", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "New request",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Request leave", exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole("button", { name: "IT support", exact: true })
      .click();
    await expect(
      dialog.getByRole("textbox", { name: "Issue summary", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Send to IT", exact: true }),
    ).toBeInViewport();
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/studio-request-${width}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await context.close();
});
