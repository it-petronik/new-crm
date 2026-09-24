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

test("logging a contact takes a few taps and schedules the next follow-up", async ({ page }) => {
  await signIn(page);
  await page.goto("/workspace/all-companies/customers");
  await page.locator(".log-activity-trigger").first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // What happened, how it went, when to try again — one tap each, no typing.
  await dialog.getByRole("button", { name: "Called" }).click();
  await dialog.getByRole("button", { name: "Interested", exact: true }).click();
  await dialog.getByRole("button", { name: "In 3 days" }).click();
  await expect(dialog).toContainText(/Next follow-up \d{4}-\d{2}-\d{2}/);

  await dialog.getByRole("button", { name: /Log activity/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText(/Activity logged/);
});

test("a follow-up can be declined without leaving the record untouched", async ({ page }) => {
  await signIn(page);
  await page.goto("/workspace/all-companies/customers");
  await page.locator(".log-activity-trigger").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "No follow-up" }).click();
  await expect(dialog).toContainText(/No follow-up will be scheduled/);
});

test("lists say what to do next without opening the record", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/sales-orders");
  await expect(page.getByRole("columnheader", { name: "Next action" })).toBeVisible();
  const first = page.locator(".next-action").first();
  await expect(first).toBeVisible();
  await expect(first).not.toBeEmpty();
});

test("the MD opens on a brief counted from the data, not generated prose", async ({ page }) => {
  await signIn(page, "md");
  const brief = page.locator(".morning-brief");
  await expect(brief).toBeVisible();

  // It leads the page, above the attention list.
  const attention = page.locator(".command-attention");
  if (await attention.count())
    expect((await brief.boundingBox())!.y).toBeLessThan((await attention.boundingBox())!.y);

  // Nothing is padded with zeroes, and it stays short.
  const text = await brief.innerText();
  expect(text).not.toMatch(/\b0 (items|deals|shipments|quotations)\b/);
  expect((await brief.locator(".brief-line").count())).toBeLessThanOrEqual(7);
});

test("advancing a record offers the next follow-up instead of relying on memory", async ({ page }) => {
  await signIn(page, "md");
  await page.goto("/workspace/all-companies/customers");
  // The status control is the app's Select, which renders a listbox trigger
  // rather than a native <select>.
  const status = page.locator(".inline-status").first();
  await expect(status).toBeVisible();
  const current = (await status.innerText()).trim();

  await status.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const choices = (await listbox.getByRole("option").allInnerTexts()).map((o) => o.trim());
  expect(choices.length, "a record must have somewhere to move to").toBeGreaterThan(1);
  const next = choices.find((o) => o !== current)!;
  expect(next, "another status must be available").toBeTruthy();
  await listbox.getByRole("option", { name: next, exact: true }).click();

  const prompt = page.locator(".after-action");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(/Set the next follow-up\?/);
  // It is an offer, not a demand.
  await prompt.getByRole("button", { name: "Dismiss" }).click();
  await expect(prompt).toHaveCount(0);
});

test("log activity is usable one-handed on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/workspace/all-companies/customers");
  await page.locator(".log-activity-trigger").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  for (const name of ["Called", "Interested"]) {
    const box = (await dialog.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.height, `${name} tap target`).toBeGreaterThanOrEqual(38);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
