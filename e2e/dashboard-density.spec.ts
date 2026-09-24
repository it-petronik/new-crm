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

test("the brief is sized by its content, not by fixed padding", async ({ page }) => {
  await signIn(page);
  const brief = page.locator(".morning-brief");
  await expect(brief).toBeVisible();
  await expect(page.locator(".skeleton-region")).toHaveCount(0);

  const box = (await brief.boundingBox())!;
  const lines = await brief.locator(".brief-line").count();
  const content = (await brief.locator(".morning-brief-list, .morning-brief-clear").first().boundingBox())!;
  const heading = (await brief.locator(".panel-heading").boundingBox())!;

  // Whatever is left over is padding and the gap between the two. Four lines
  // must not produce a panel with a large empty region beneath them.
  const slack = box.height - (heading.height + content.height);
  expect(slack, `brief has ${lines} lines and ${Math.round(slack)}px of slack`).toBeLessThan(60);
});

test("attention rows are compact and hide their presets behind one control", async ({ page }) => {
  await signIn(page);
  // Wait for the loaded dashboard: an immediate count would race the skeleton
  // and skip the test without checking anything.
  const section = page.locator(".command-attention");
  await expect(section).toBeVisible();

  // The presets must not be rendered on every row.
  await expect(section.locator(".follow-up-presets")).toHaveCount(0);
  for (const label of ["Tomorrow", "In 3 days", "In 2 weeks"])
    await expect(section.getByRole("button", { name: label, exact: true })).toHaveCount(0);

  const rows = section.locator(".attention-row");
  const count = await rows.count();
  expect(count, "the first screen shows a readable top slice").toBeLessThanOrEqual(5);

  for (let i = 0; i < count; i++) {
    const box = (await rows.nth(i).boundingBox())!;
    expect(box.height, `row ${i} height`).toBeLessThanOrEqual(72);
  }

  // The choices are one click away.
  const trigger = section.getByRole("button", { name: /Follow up/ }).first();
  if (await trigger.count()) {
    await trigger.click();
    await expect(page.locator(".follow-up-menu")).toBeVisible();
    await expect(page.locator(".follow-up-menu").getByRole("button", { name: "Tomorrow" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("the header clock shows Gulf time wherever the reader is", async ({ browser }) => {
  // A device deliberately far from Dubai must not change what is displayed.
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  await signIn(page);

  const clock = page.locator(".business-clock");
  await expect(clock).toBeVisible();
  await expect(clock).toContainText("GST");
  await expect(clock).toContainText("UTC+4");

  const shown = (await clock.locator(".business-clock-time").innerText()).replace(/\s*GST$/, "").trim();
  const expected = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date()).toLowerCase();
  expect(shown).toBe(expected);

  // Seconds are not displayed.
  expect(shown).not.toMatch(/:\d{2}:\d{2}/);
  await context.close();
});

test("the dashboard has no horizontal overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.locator(".morning-brief")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
