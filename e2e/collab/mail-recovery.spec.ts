import { test, expect } from "@playwright/test";
import { Client } from "./client";
test("mailbox recovers initial failure, failed bodies and offline sync without page refresh", async ({
  browser,
}) => {
  const actor = await Client.login("pg29");
  await actor.request("POST", "/api/mail/connection", {
    action: "disconnect",
    confirmed: true,
  });
  expect(
    (
      await actor.request("POST", "/api/mail/connection", {
        action: "connect",
        address: `recovery${Date.now()}@local-mail.invalid`,
        host: "mail.petronik.ae",
        password: "Local-Mailbox-Test-Only-1",
      })
    ).status,
  ).toBe(200);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  let settings = 0,
    bodyAttempts = 0,
    syncs = 0,
    images = 0;
  await page.route("**/api/mail/connection", async (route) => {
    if (route.request().method() === "GET" && ++settings <= 2)
      return route.fulfill({
        status: 503,
        json: { error: "Fictional temporary outage" },
      });
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.action === "sync"
    )
      syncs++;
    await route.continue();
  });
  await page.route("**/api/mail/message?*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !url.searchParams.has("part") &&
      !url.searchParams.has("metadata") &&
      ++bodyAttempts <= 3
    )
      return route.abort("failed");
    if (url.searchParams.has("part") && ++images === 1)
      return route.abort("failed");
    await route.continue();
  });
  await page.goto("/workspace/petronik/email");
  const nav = page.getByRole("navigation", { name: "Email folders" });
  await expect(nav.getByRole("button", { name: /^Inbox\s*108$/ })).toBeVisible({
    timeout: 25000,
  });
  const boot = await page.evaluate(() => {
    (window as any).recoveryBoot = crypto.randomUUID();
    return (window as any).recoveryBoot;
  });
  const rows = page.locator(".mail-message-list .mail-row");
  await expect(rows.first()).toContainText("Fictional SN500 quotation enquiry");
  await page
    .getByRole("button", { name: "Sort emails: newest first" })
    .click();
  await expect(rows.first()).toContainText("conversions");
  await page
    .getByRole("button", { name: "Sort emails: oldest first" })
    .click();
  await expect(rows.first()).toContainText("Fictional SN500 quotation enquiry");
  await page.getByRole("button", { name: /Possible enquiries/ }).click();
  await expect(
    page.getByText("1 enquiry matches · 108 total", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button",{name:"Show all emails · 108",exact:true})).toBeVisible();
  await expect(
    nav.getByRole("button", { name: /^Inbox\s*108$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Show all emails/ }).click();
  await rows.first().click();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".mail-body")).toHaveCount(0);
  await expect(
    page
      .frameLocator('iframe[title="Original email"]')
      .locator(".brand-header"),
  ).toBeVisible({ timeout: 15000 });
  expect(bodyAttempts).toBeGreaterThan(3);
  await expect
    .poll(() =>
      page
        .frameLocator('iframe[title="Original email"]')
        .getByRole("img", { name: "Embedded brand logo" })
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
  const previous = syncs;
  await context.setOffline(true);
  await page.getByRole("button", { name: "Sync inbox", exact: true }).click();
  await expect(
    page.locator('[aria-label="Your email connection"]'),
  ).toContainText("Connection interrupted");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => syncs).toBeGreaterThan(previous);
  await expect(
    page.locator('[aria-label="Your email connection"]'),
  ).not.toContainText("Connection interrupted");
  await expect(rows.first()).toContainText("Fictional SN500 quotation enquiry");
  expect(await page.evaluate(() => (window as any).recoveryBoot)).toBe(boot);
  await page.screenshot({ path: "test-results/mail-recovery-counts.png" });
  await actor.request("POST", "/api/mail/connection", {
    action: "disconnect",
    confirmed: true,
  });
  await context.close();
});
