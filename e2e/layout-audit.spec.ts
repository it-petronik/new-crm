import { test, expect } from "@playwright/test";

const forms = [
  ["leads", "New lead"],
  ["quotations", "New quotation"],
  ["customers", "Add customer"],
  ["suppliers", "Add supplier"],
  ["products", "Add product"],
  ["hr", "Add employee"],
  ["marketing", "New campaign"],
  ["it", "New ticket"],
] as const;
test("all module pages fit desktop and mobile viewports", async ({ page }) => {
  test.setTimeout(60000);
  for (const module of [
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
  ]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?module=${module}`);
      await expect(page.locator(".main-content")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
  }
});
for (const [module, action] of forms) {
  test(`${module} compact dialog desktop and mobile`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?module=${module}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".dialog-footer")).toBeVisible();
    await expect(page.locator(".dialog-body")).toHaveCSS("overflow-y", "auto");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${module}-desktop.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const bounds = await dialog.boundingBox();
        return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390;
      })
      .toBe(true);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${module}-mobile.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  });
}

test("quotation preview starts at the top and legal name is consistent", async ({
  page,
}, info) => {
  await page.goto("/?module=quotations&company=Petronik");
  await expect(
    page.getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveText("PETRONIK FZCO");
  await page
    .getByRole("button", { name: /Gulf Industrial Trading/ })
    .first()
    .click();
  await expect(page.locator(".reference-document")).toContainText(
    "PETRONIK FZCO",
  );
  expect(
    await page.locator(".dialog-body").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await page.screenshot({
    path: info.outputPath("quotation-preview.png"),
    animations: "disabled",
  });
});
