import { test, expect, type Page } from "@playwright/test";

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

const openPalette = async (page: Page) => {
  await expect
    .poll(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      return page.locator(".command-dialog").count();
    }, { timeout: 10000 })
    .toBeGreaterThan(0);
};

test("the palette opens on the shortcut and navigates by keyboard alone", async ({ page }) => {
  await signIn(page);
  await openPalette(page);

  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();

  // Arrow keys move the highlight; exactly one row is selected at a time.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  const second = await page.locator('[role="option"][aria-selected="true"]').innerText();
  await page.keyboard.press("ArrowUp");
  const first = await page.locator('[role="option"][aria-selected="true"]').innerText();
  expect(first).not.toBe(second);

  // Escape closes it without acting.
  await page.keyboard.press("Escape");
  await expect(page.locator(".command-dialog")).toHaveCount(0);
});

test("Enter runs the highlighted entry", async ({ page }) => {
  await signIn(page);
  await openPalette(page);
  await page.getByLabel("Search commands and records").fill("Quotations");
  const selected = page.locator('[role="option"][aria-selected="true"]');
  await expect(selected).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".command-dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/quotation/i);
});

test("operational slices answer a question inside the palette", async ({ page }) => {
  await signIn(page);
  await openPalette(page);

  // The slices are offered by name rather than built by hand.
  const overdue = page.getByRole("option", { name: /Overdue follow-ups/ });
  await expect(overdue).toBeVisible();
  // Choosing a slice narrows the palette in place rather than closing it.
  await overdue.click();
  await expect(page.locator(".command-dialog")).toBeVisible();
  await expect(page.locator(".command-section-title", { hasText: "Records" })).toBeVisible();
  const first = page.locator('.command-section:has(.command-section-title:text("Records")) .command-item').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/late|overdue|Follow up/i);
});

test("a record opened once is offered again as recent, and can be pinned", async ({ page }) => {
  await signIn(page);
  await page.goto("/workspace/all-companies/sales-orders");
  const row = page.locator("tbody .record-link").first();
  await expect(row).toBeVisible();
  await row.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Read the name from the opened record: a row's text begins with the
  // avatar's initials, which is not what the palette lists.
  const name = (await dialog.getByRole("heading").first().innerText()).trim();
  expect(name.length).toBeGreaterThan(2);
  await dialog.getByRole("button", { name: /^Pin / }).click();
  await expect(page.locator(".toast")).toContainText("Pinned");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openPalette(page);
  await expect(page.locator(".command-section-title", { hasText: "Pinned" })).toBeVisible();
  await expect(page.locator(".command-results")).toContainText(name);
});

test("the palette is usable on a phone without a keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  // Reachable by pointer, not only by shortcut.
  await page.locator(".top-right").getByRole("button", { name: /command|quick actions|search/i }).first().click();
  await expect(page.locator(".command-dialog")).toBeVisible();

  const item = page.getByRole("option").first();
  const box = (await item.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
