import { test, expect, type Page } from "@playwright/test";

const signIn = async (page: Page, who: string) => {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`${who}@enercore.test`) }).click();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await hydrated(page);
};

/**
 * Waits until React has attached to the workspace.
 *
 * A server-rendered button is a real button: clicking it before hydration
 * succeeds and does nothing, which would make these tests fail intermittently
 * for a reason that has nothing to do with the behaviour under test. The dev
 * server is slow enough to hit this; a built bundle is not.
 */
const hydrated = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector(".quick-add-trigger");
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  });

test("an employee lands on their own day, not a company report", async ({ page }) => {
  await signIn(page, "sales");
  await expect(page.locator(".my-day")).toBeVisible();
  // The first heading answers "what do I do today", not "how is the company".
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/caught up|Good to see you/);
  // Their own module summary is still available underneath.
  await expect(page.locator(".stats-grid .stat-card").first()).toBeVisible();
});

test("an executive leads with what needs attention", async ({ page }) => {
  await signIn(page, "md");
  await expect(page.locator(".my-day")).toHaveCount(0);
  const attention = page.locator(".command-attention");
  if (await attention.count()) {
    // Exceptions come before the analysis panels.
    const attentionTop = (await attention.boundingBox())!.y;
    const insights = page.locator(".overview-grid");
    if (await insights.count())
      expect(attentionTop).toBeLessThan((await insights.boundingBox())!.y);
  }
});

test("quick add is reachable from anywhere and creates a record in seconds", async ({ page }) => {
  await signIn(page, "sales");
  await page.getByRole("button", { name: /Quick add/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Only what the system cannot know is asked for; scope and owner are stated,
  // not requested.
  await expect(dialog).toContainText(/Saved to .* as /);

  const name = `Quick Lead ${Date.now()}`;
  await dialog.getByLabel(/Company \/ Record name|Customer|Supplier|Product/i).first().fill(name);
  await dialog.getByRole("button", { name: /^Save (opportunity|customer|supplier|product)$/i }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The record exists in the workspace without navigating anywhere to make it.
  await page.goto("/workspace/all-companies/sales-pipeline");
  await expect(page.getByText(name).first()).toBeVisible();
});

test("the keyboard shortcut opens quick add but is never required", async ({ page }) => {
  await signIn(page, "sales");
  // Hydration attaches the key listener in an effect, which can land a moment
  // after React claims the DOM. Retry the keystroke rather than assume timing;
  // the assertion is unchanged — the shortcut must open quick add.
  await expect
    .poll(async () => {
      await page.keyboard.press("n");
      return page.getByRole("dialog").count();
    }, { timeout: 10000 })
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // It must not fire while typing into a field.
  await page.goto("/workspace/all-companies/customers");
  const search = page.getByLabel("Search records");
  await search.fill("n");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(search).toHaveValue("n");
});

test("a follow-up is two taps and is recorded on the lead", async ({ page }) => {
  await signIn(page, "sales");
  // The presets sit behind one control so a list row stays compact; opening it
  // and choosing is still the whole interaction.
  const trigger = page.locator(".follow-up-menu-trigger").first();
  test.skip(!(await trigger.count()), "this demo account has nothing needing follow-up");
  await trigger.click();
  await page.locator(".follow-up-menu").getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.locator(".toast, [role='status']").first()).toContainText(/Follow-up set/);
});

test("mobile keeps the create action in reach with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "sales");
  const trigger = page.getByRole("button", { name: /Quick add/ });
  await expect(trigger).toBeVisible();
  const box = (await trigger.boundingBox())!;
  // Reachable by thumb, and a comfortable tap target.
  expect(box.y).toBeGreaterThan(844 / 2);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
