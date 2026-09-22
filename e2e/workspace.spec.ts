import { test, expect } from "@playwright/test";
test("self-service retains workspace state without document navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page.getByRole("combobox", { name: "Company", exact: true }).click();
  await page.getByRole("option", { name: "PETRONIK FZCO", exact: true }).click();
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests++;
  });
  await page.getByRole("link", { name: "My requests", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My requests", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveText("PETRONIK FZCO");
  expect(documentRequests).toBe(0);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "My requests", level: 1 }),
  ).toBeVisible();
});

test("IT and people have dedicated fields", async ({ page }) => {
  await page.goto("/?module=it");
  await page.getByRole("button", { name: "New ticket", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Priority", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Estimated value", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "People & HR", exact: true }).click();
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Job title", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Department", exact: true }),
  ).toBeVisible();
});

test("theme persists and self-service shares workspace navigation", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "My requests", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My requests", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "My requests", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Sales pipeline", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sales pipeline", level: 1 }),
  ).toBeVisible();
});

test("wide lead dialog fits and exits cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page
    .getByRole("button", { name: "Sales pipeline", exact: true })
    .click();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  const dialog = page.locator(".ui-dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.clientWidth)).toBeGreaterThan(900);
  expect(await dialog.evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(1000);
  expect(
    await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  await expect(dialog).toBeVisible();
});

test("sidebar preference and accessible custom controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page.reload();
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sales pipeline", exact: true })
    .click();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Business entity", exact: true })
    .click();
  await page.getByRole("option", { name: "Afrilube", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Business entity", exact: true }),
  ).toHaveText("Afrilube");
  await page
    .getByRole("button", { name: "Next action / Due date", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Choose a date", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Choose a date", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save record", exact: true }),
  ).toBeVisible();
});

test("company filter, lead creation and persistence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Interactive preview")).toBeVisible();
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page
    .getByRole("button", { name: "Sales pipeline", exact: true })
    .click();
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  await page.getByLabel("Company / Record name").fill("Test customer");
  await page.getByLabel("Contact person").fill("Test contact");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Test customer" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sales pipeline", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Test customer" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Company", exact: true }).click();
  await page.getByRole("option", { name: "Afrilube", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Test customer" }),
  ).toHaveCount(0);
});
test("accepting a quote creates connected operational records", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page.getByRole("button", { name: "Quotations", exact: true }).click();
  await page
    .getByRole("button", { name: /Mekong Infrastructure/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Accept & create order" }).click();
  await expect(page.getByRole("combobox", { name: "Update status" })).toHaveText("Accepted");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Order, shipment and draft invoice created",
  );
  await page.getByRole("button", { name: "Sales orders", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Mekong Infrastructure/ }).first(),
  ).toBeVisible();
});
test("mobile navigation and no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Your daily focus")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "People & HR", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "People & HR", exact: true, level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
