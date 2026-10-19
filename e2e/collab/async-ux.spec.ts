import { test, expect } from "@playwright/test";
import { Client } from "./client";
let session: Promise<Client> | undefined;
const login = () => (session ??= Client.login("studio"));
test("selection menus have consistent spacing, fit the viewport and remain keyboard friendly", async ({
  browser,
}) => {
  const actor = await login(),
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/workspace/all-companies/tasks");
  for (const width of [390, 768, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      const trigger = page.getByRole("combobox", {
        name: "Priority",
        exact: true,
      });
      await trigger.click();
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const option = page.getByRole("option", { name: "High", exact: true });
      await expect(option).toBeVisible();
      expect(
        await option.evaluate((e) =>
          parseFloat(getComputedStyle(e).paddingTop),
        ),
      ).toBeGreaterThanOrEqual(10);
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await option.click();
      await expect(trigger).toContainText("High");
    }
  const trigger = page.getByRole("combobox", { name: "Priority", exact: true });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "High", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Urgent", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText("Urgent");
  await context.close();
});
test("Access control has a real skeleton, friendly HTML failure and recoverable account list", async ({
  browser,
}) => {
  const actor = await login(),
    context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  let fail = true,
    release: () => void = () => {};
  const hold = new Promise<void>((r) => (release = r));
  await page.route("**/api/users", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await hold;
    if (fail)
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!DOCTYPE html><h1>Temporary edge error</h1>",
      });
    await route.continue();
  });
  await page.goto("/workspace/all-companies/access-control");
  await expect(
    page.getByRole("status", { name: "Loading team accounts" }),
  ).toBeVisible();
  await expect(
    page.getByText("No users to show yet.", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(page.locator("#main").getByRole("alert")).toContainText(
    "account list couldn’t load",
  );
  await expect(page.locator("#main")).not.toContainText(
    /Unexpected token|DOCTYPE|valid JSON|0 accounts/,
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add user", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "test-results/ux-account-recovery.png" });
  await context.close();
});
test("Action Center keeps its shape while loading and offers friendly retry", async ({
  browser,
}) => {
  const actor = await login(),
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  let fail = true,
    release: () => void = () => {};
  const hold = new Promise<void>((r) => (release = r));
  await page.route("**/api/proactive?*", async (route) => {
    await hold;
    if (fail)
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<!doctype html>Bad gateway",
      });
    await route.continue();
  });
  await page.goto("/workspace/all-companies/action-center");
  await expect(
    page.getByRole("status", { name: "Loading the Action Center" }),
  ).toBeVisible();
  release();
  await expect(page.locator("#main").getByRole("alert")).toContainText(
    "Action Center couldn’t load",
  );
  await expect(page.locator("#main")).not.toContainText(
    /DOCTYPE|Unexpected token|Bad gateway/,
  );
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Loading the Action Center" }),
  ).toHaveCount(0);
  await context.close();
});
