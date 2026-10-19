import { test, expect } from "@playwright/test";
import { Client } from "./client";
let session: Promise<Client> | undefined;
const actor = () => (session ??= Client.login("studio"));
test("follow-up choice has a persistent selected background and clears correctly", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/sales-pipeline");
  await page.locator(".lead-card").first().click();
  await page.getByRole("button", { name: "Log activity", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Log activity",
    exact: true,
  });
  const tomorrow = dialog.getByRole("button", {
    name: "Tomorrow",
    exact: true,
  });
  await tomorrow.click();
  await expect(tomorrow).toHaveAttribute("aria-pressed", "true");
  expect(
    await tomorrow.evaluate((e) => getComputedStyle(e).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  await dialog
    .getByRole("button", { name: "No follow-up", exact: true })
    .click();
  await expect(tomorrow).toHaveAttribute("aria-pressed", "false");
  await expect(
    dialog.getByRole("button", { name: "No follow-up", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".follow-up-presets input")).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await context.close();
});
test("dashboard insights use the available width and the assistant layout stays balanced", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1000 },
  });
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".dash-analysis > summary").click();
  const insights = page.locator(".business-insights");
  await expect(insights).toBeVisible();
  const bounds = await insights.boundingBox();
  const main = await page.locator("#main").evaluate((e) => ({
    right: e.getBoundingClientRect().right,
    padding: parseFloat(getComputedStyle(e).paddingRight),
  }));
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(
    main.right - main.padding - 2,
  );
  await page.goto("/workspace/all-companies/enercore-ai");
  await expect(page.locator(".ai-ask textarea")).toBeVisible();
  for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      await page.screenshot({
        path: `test-results-premium/ai-${theme}-${width}.png`,
      });
    }
  await context.close();
});
test("sidebar remembers scroll after reload and keeps the current page visible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 780 },
  });
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/access-control");
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  const active = nav.getByRole("button", {
    name: "Access control",
    exact: true,
  });
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect.poll(() => nav.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  const before = await nav.evaluate((e) => e.scrollTop);
  await page.reload();
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect
    .poll(async () =>
      Math.abs((await nav.evaluate((e) => e.scrollTop)) - before),
    )
    .toBeLessThan(35);
  const bounds = await nav.boundingBox(),
    item = await active.boundingBox();
  expect(item!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(item!.y + item!.height).toBeLessThanOrEqual(
    bounds!.y + bounds!.height + 1,
  );
  await context.close();
});
test("Quick Add stays neutral through focus changes and switching types, then validates on save", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/overview");
  await page.locator(".quick-add-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await dialog.locator('[name="email"]').click();
  await dialog.locator('[name="email"]').fill("invalid");
  await dialog.locator('[name="name"]').click();
  await expect(dialog.locator(".ui-field-message.is-error")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save lead", exact: true }).click();
  await expect(
    dialog.locator(".ui-field-message.is-error").first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Customer", exact: true }).click();
  await expect(dialog.locator(".ui-field-message.is-error")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await context.close();
});
test("invalid sign-in details get a useful message rather than an expired-session error", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/api/auth", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Invalid credentials" }),
    }),
  );
  await page.goto("/login");
  await page.locator('[name="email"]').fill("person@example.test");
  await page.locator('[name="password"]').fill("fictional-invalid-password");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(page.locator(".login-box").getByRole("alert")).toContainText(
    "Those sign-in details don’t match",
  );
  await expect(page.locator(".login-box").getByRole("alert")).not.toContainText("session has ended");
  await context.close();
});
test("credit balance refreshes on entry, periodically and on reconnect without repeating search", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  const actions: string[] = [];
  await page.route("**/api/prospecting", (route) => {
    try {
      actions.push(route.request().postDataJSON().action);
    } catch {}
    return route.continue();
  });
  await page.goto("/workspace/all-companies/prospecting");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Credits & usage", exact: true })
    .click();
  await expect
    .poll(() => actions.filter((a) => a === "refresh-account").length)
    .toBe(1);
  await page
    .getByRole("button", { name: "Refresh balance", exact: true })
    .waitFor();
  await expect(
    page.getByRole("button", { name: "Refresh balance", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(66000);
  await expect
    .poll(() => actions.filter((a) => a === "refresh-account").length)
    .toBe(2);
  await expect(
    page.getByRole("button", { name: "Refresh balance", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => actions.filter((a) => a === "refresh-account").length)
    .toBe(3);
  expect(actions.filter((a) => /search|enrich/.test(a))).toEqual([]);
  await context.close();
});
test("assistant is on demand, respects its scope and fits a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await (await actor()).signInBrowser(context);
  const page = await context.newPage();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/ask")) calls++;
  });
  await page.goto("/workspace/all-companies/tasks");
  await page
    .getByRole("button", { name: "Open Enercore assistant", exact: true })
    .click();
  const panel = page.getByLabel("Enercore assistant", { exact: true });
  await expect(
    panel.getByRole("textbox", { name: "Ask the assistant" }),
  ).toBeVisible();
  expect(calls).toBe(0);
  await panel
    .getByRole("textbox", { name: "Ask the assistant" })
    .fill("[[route:pipeline_summary,,]] How is the pipeline?");
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(panel.locator(".ai-answer")).toBeVisible({ timeout: 30000 });
  expect(calls).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.goto("/workspace/all-companies/enercore-ai");
  await expect(
    page.getByRole("heading", { name: "Enercore AI", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ai-about")).not.toHaveAttribute("open");
  await context.close();
});
test("auth screens use the new logo, stay neutral and fit phone to desktop", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ["/login", "/reset-password"]) {
    await page.goto(path);
    await expect(page.locator(".auth-story img")).toHaveAttribute(
      "src",
      "/brands/enercore-lockup-white.svg",
    );
    for (const width of [320, 390, 768, 1440])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (t) => document.documentElement.setAttribute("data-theme", t),
          theme,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await expect(page.locator(".ui-field-message.is-error")).toHaveCount(0);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `test-results-premium/auth-${path.slice(1)}-${theme}-${width}.png`,
          });
      }
    await page.getByRole("textbox").first().focus();
    await page.getByRole("heading").last().click();
    await expect(page.locator(".ui-field-message.is-error")).toHaveCount(0);
  }
  await context.close();
});
