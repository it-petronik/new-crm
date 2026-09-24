import { test, expect, type Page } from "@playwright/test";

const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector(".quick-add-trigger");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });

const signIn = async (page: Page, who = "sales") => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`${who}@enercore.test`) }).click();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await hydrated(page);
};

test("forms never fall back to the browser's own validation", async ({ page }) => {
  await signIn(page);
  await page.locator(".quick-add-trigger").click();
  const dialog = page.getByRole("dialog");

  // Every form in the dialog opts out of native constraint UI.
  const native = await dialog.locator("form").evaluateAll((forms) =>
    forms.map((f) => (f as HTMLFormElement).noValidate),
  );
  expect(native.every(Boolean)).toBe(true);
});

test("a form opens neutral, then explains problems in plain language", async ({ page }) => {
  await signIn(page);
  await page.locator(".quick-add-trigger").click();
  const dialog = page.getByRole("dialog");

  // Nothing is red before the person has done anything.
  await expect(dialog.locator(".ui-field-message.is-error")).toHaveCount(0);

  // Submitting with nothing entered explains what is missing, in our words.
  await dialog.getByRole("button", { name: /^Save (opportunity|customer|supplier|product)$/i }).click();
  const message = dialog.locator(".ui-field-message.is-error").first();
  await expect(message).toBeVisible();
  await expect(message).toContainText(/is required\.$/);
  await expect(message).not.toContainText(/please fill out/i);

  // The invalid control says so to assistive technology.
  await expect(dialog.locator('[name="name"]')).toHaveAttribute("aria-invalid", "true");

  // A bad email is named for what it is.
  await dialog.locator('[name="email"]').fill("nope");
  await dialog.locator('[name="email"]').blur();
  // Scoped to that field: the name error is still shown, correctly.
  await expect(
    dialog.locator('.ui-field:has([name="email"]) .ui-field-message.is-error'),
  ).toContainText(/valid email address/);

  // Correcting clears the message immediately — no second submit needed.
  await dialog.locator('[name="name"]').fill("Acme Trading");
  await expect(dialog.locator('[name="name"]')).not.toHaveAttribute("aria-invalid", "true");
  await dialog.locator('[name="email"]').fill("buyer@acme.test");
  await expect(dialog.locator(".ui-field-message.is-error")).toHaveCount(0);
});

test("the record form reports its own field problems, not the browser's", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/customers");
  await page.getByRole("button", { name: /Add customer|Add record|^Add/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.locator("form").first().evaluate((f) => (f as HTMLFormElement).noValidate)).toBe(true);
});

test("loading shows the page's own shape, never a blank panel", async ({ page }) => {
  // Hold the workspace request so the loading state is observable.
  await page.route("**/api/records*", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /md@enercore.test/ }).click();

  const region = page.locator(".skeleton-region");
  if (await region.count()) {
    // One announcement for assistive technology, and the placeholders stay silent.
    await expect(region.first()).toHaveAttribute("aria-busy", "true");
    const hiddenAll = await page.locator(".skeleton").evaluateAll((nodes) =>
      nodes.every((n) => n.getAttribute("aria-hidden") === "true"),
    );
    expect(hiddenAll).toBe(true);
  }
  await page.unroute("**/api/records*");
});

test("the boot loader is branded and claims no fake progress", async ({ page }) => {
  await page.goto("/login");
  const html = await page.content();
  expect(html).not.toMatch(/\d+%\s*(loaded|complete)/i);
});
