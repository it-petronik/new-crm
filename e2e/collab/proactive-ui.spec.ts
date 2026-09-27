import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";

/**
 * The Action Center in real browsers (built Worker): My Day digest, the
 * page's sections and filters, snooze with undo, Quick Complete (only the
 * missing fields), and the previewed follow-up — on a 390px phone and a
 * desktop. No AI request is made unless someone asks for a brief.
 *
 * Person: pxui. Data: PX-U1 (overdue follow-up), PX-U2 (Negotiation without
 * a destination) in proactive-data.ts. Serial: the desktop test resolves both.
 */

test.describe.configure({ mode: "serial" });

const ACTIONS = "/workspace/all-companies/action-center";
const HOME = "/workspace/all-companies/overview";

async function signedIn(browser: Browser, viewport = { width: 1440, height: 900 }) {
  const client = await Client.login("pxui");
  const context = await browser.newContext({ viewport });
  await client.signInBrowser(context);
  return { context, page: await context.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
function aiRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === "POST" && (path.startsWith("/api/ai") || path === "/api/proactive/brief")) seen.push(path);
  });
  return seen;
}

test("phone (390px): the My Day digest leads to the Action Center, which fits the screen", async ({ browser }) => {
  const { page, context } = await signedIn(browser, { width: 390, height: 844 });
  const ai = aiRequests(page);
  await page.goto(HOME);
  const digest = page.getByRole("region", { name: "Action Center" });
  await expect(digest).toBeVisible();
  await expect(digest.locator(".action-digest-counts div").filter({ hasText: "Needs action" }).locator("dd")).toHaveText("1");
  await expect(digest.locator(".action-digest-counts div").filter({ hasText: "Data to complete" }).locator("dd")).toHaveText("1");
  // Counted, not named again: the follow-up is in My Day's own list, the lead's data gap is not repeated.
  await expect(digest.locator(".copilot-myday-list")).toHaveCount(0);
  await expect(digest).not.toContainText("Sharjah Screen");
  await digest.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${ACTIONS}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Action Center" })).toBeVisible();
  const data = page.getByRole("region", { name: /^Data to complete/ });
  await expect(data.locator(".action-card")).toHaveCount(1);
  expect(await noOverflow(page)).toBe(true);
  await data.getByRole("button", { name: "Complete details" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete details · Sharjah Screen Complete" });
  await expect(dialog.getByLabel("Destination")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(ai).toEqual([]);
  await context.close();
});

test("desktop: sections, snooze with undo, Quick Complete and a previewed follow-up", async ({ browser }) => {
  const { page, context } = await signedIn(browser);
  const ai = aiRequests(page);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && new URL(r.url()).pathname === "/api/records") writes.push(r.postData() ?? "");
  });
  await page.goto(ACTIONS);
  await expect(page.getByRole("button", { name: "Action Center", exact: true }).first()).toHaveAttribute("aria-current", "page");
  const needs = page.getByRole("region", { name: /^Needs action/ });
  const data = page.getByRole("region", { name: /^Data to complete/ });
  const follow = needs.locator(".action-card").filter({ hasText: "Sharjah Screen Follow" });
  await expect(follow).toContainText("Follow-up overdue 2 days");
  await expect(follow.locator(".badge")).toHaveText("Important");
  // No team scope for a Sales Executive.
  await expect(page.getByRole("group", { name: "Whose work" })).toHaveCount(0);

  // Filters: operations has nothing of theirs.
  await page.getByRole("group", { name: "Filter" }).getByRole("button", { name: /^Operations/ }).click();
  await expect(needs.locator(".action-card")).toHaveCount(0);
  await page.getByRole("group", { name: "Filter" }).getByRole("button", { name: /^All/ }).click();
  await expect(follow).toBeVisible();

  // Snooze is personal and reversible; nothing in the CRM changes.
  await follow.getByRole("button", { name: "Snooze Sharjah Screen Follow until tomorrow" }).click();
  await expect(follow).toHaveCount(0);
  const notice = page.getByRole("status").filter({ hasText: "Snoozed until tomorrow · Sharjah Screen Follow" });
  await notice.getByRole("button", { name: "Undo" }).click();
  await expect(follow).toBeVisible();
  expect(writes).toEqual([]);

  // Quick Complete: only the missing field, then the gap is gone.
  await data.getByRole("button", { name: "Complete details" }).click();
  const dialog = page.getByRole("dialog", { name: "Complete details · Sharjah Screen Complete" });
  await expect(dialog.getByLabel("Product")).toHaveCount(0);
  await expect(dialog.getByLabel("Quantity")).toHaveCount(0);
  await dialog.getByLabel("Destination").fill("Sharjah Port");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  await expect(data.locator(".action-card")).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0])).toMatchObject({ action: "complete", id: "PX-U2", values: { destination: "Sharjah Port" } });
  expect(Object.keys(JSON.parse(writes[0]).values)).toEqual(["destination"]);

  // Follow-up: preview current → new, apply, per-item result, then resolved.
  await follow.getByRole("button", { name: "Set follow-up" }).click();
  const review = page.getByRole("dialog", { name: "Set follow-up · Sharjah Screen Follow" });
  await expect(review.getByRole("table", { name: "Changes to review" })).toContainText("choose a date");
  await expect(review.getByRole("button", { name: "Apply" })).toBeDisabled();
  await review.getByRole("button", { name: "Next week" }).click();
  const row = review.getByRole("row").filter({ hasText: "Sharjah Screen Follow" });
  await expect(row.locator(".action-preview-from")).not.toHaveText("none");
  await review.getByRole("button", { name: "Apply" }).click();
  await expect(row.locator(".action-result.is-ok")).toContainText("Follow-up set for");
  await review.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(follow).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[1])).toMatchObject({ action: "note", id: "PX-U1" });
  expect(ai).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
  await context.close();
});
