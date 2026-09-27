import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";

/**
 * Sales Copilot in real browsers (built Worker, fake Workers AI): the Copilot
 * home and "What should I work on today?", drafts (channels, edit, copy, use
 * as note), the lead panel (deterministic next action first, one request per
 * click, requirement sources, quotation draft through the ordinary form), My
 * Day suggestions, post-meeting review, and a 390px phone.
 *
 * People: aisui (desktop), aisui2 (phone). Data: AIT-UP*, AIT-UM* in ai-data.ts.
 */

const AI = "/workspace/all-companies/enercore-ai";
const HUB = "/workspace/all-companies/collaboration";

const sessions = new Map<string, Promise<Client>>();
const login = (k: string) => {
  if (!sessions.has(k)) sessions.set(k, Client.login(k));
  return sessions.get(k)!;
};
async function signedIn(browser: Browser, key: string, viewport = { width: 1440, height: 900 }) {
  const client = await login(key);
  const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
  await client.signInBrowser(context);
  return { client, context, page: await context.newPage() };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
function posts(page: Page, path: string) {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === path) seen.push(r.url());
  });
  return seen;
}
const openRecord = (page: Page, kind: string, id: string) =>
  page.evaluate(([kind, id]) => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id } })), [kind, id]);

test("Sales Copilot home: greeting, Enercore's priorities, AI explanation on request, drafts", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aisui");
  const explain = posts(page, "/api/ai/sales/today");
  await page.goto(AI);
  const home = page.getByRole("region", { name: /^Good (morning|afternoon|evening), Sol$/ });
  await expect(home).toBeVisible();
  const cards = home.locator(".copilot-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Screen Copilot Oils");
  await expect(cards.nth(0)).toContainText("Follow-up overdue 2 days");
  await expect(cards.nth(0)).toContainText("Suggested Send a follow-up");
  await expect(home.getByText("Quotation awaiting response for 5 days")).toBeVisible();
  // Nothing asked of the model yet: the list is Enercore's.
  expect(explain).toHaveLength(0);
  await expect(home.getByText("Priorities are ranked by Enercore")).toBeVisible();

  await home.getByRole("button", { name: "What should I work on today?" }).dblclick();
  await expect(cards.nth(0).locator(".copilot-card-why")).toHaveText("It matters today because of its facts.");
  expect(explain).toHaveLength(1);

  // Draft a follow-up: channel, editable text, copy, nothing sent.
  await cards.nth(0).getByRole("button", { name: "Draft follow-up" }).click();
  const dialog = page.getByRole("dialog", { name: "Draft follow-up · Screen Copilot Oils" });
  await dialog.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Subject" })).toHaveValue("Following up");
  const body = dialog.getByRole("textbox", { name: "Draft" });
  await expect(body).toHaveValue(/We are reviewing it and will revert shortly/);
  await body.fill("Hello,\nChecking in on the SN500 requirement.\n[Your name]");
  await dialog.getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Subject: Following up\n\nHello,\nChecking in on the SN500 requirement.\n[Your name]");
  await expect(dialog.getByText("Nothing is sent")).toBeVisible();
  // WhatsApp: no subject.
  await dialog.getByRole("radio", { name: "WhatsApp" }).click();
  await dialog.getByRole("button", { name: "Redraft" }).click();
  await expect(dialog.getByRole("textbox", { name: "Subject" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  expect(await noOverflow(page)).toBe(true);
  await context.close();
});

test("lead panel: next action first, one brief per click, sources, and a quotation draft with no price", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "aisui");
  const briefs = posts(page, "/api/ai/sales/lead-brief");
  await page.goto("/workspace/all-companies/sales-pipeline");
  await openRecord(page, "leads", "AIT-UP1");
  const dialog = page.getByRole("dialog", { name: "Screen Copilot Oils" });
  const panel = dialog.getByRole("region", { name: "Enercore AI" });
  // Deterministic, before any AI.
  await expect(panel.locator(".copilot-next")).toContainText("Send a follow-up");
  await expect(panel.locator(".copilot-next")).toContainText("Why: Follow-up overdue 2 days.");
  await expect(panel.locator(".copilot-signals")).toContainText("Follow-up overdue 2 days");
  expect(briefs).toHaveLength(0);

  await panel.getByRole("button", { name: "Brief me" }).dblclick();
  await expect(panel.locator(".copilot-answer")).toBeVisible();
  expect(briefs).toHaveLength(1);
  const profile = panel.locator(".copilot-profile");
  await expect(profile.locator("div", { has: page.locator("dt", { hasText: /^Incoterm$/ }) })).toContainText("CFR");
  // Source AND status: the notes only say the customer needs CFR — not confirmed.
  await expect(profile.locator("div", { has: page.locator("dt", { hasText: /^Incoterm$/ }) })).toContainText("Lead notes · Requested — not confirmed");
  await expect(profile.locator(".copilot-readiness")).toContainText("Requested / discussed — not confirmed");
  await expect(profile.locator(".copilot-readiness")).toContainText("Payment terms");
  // Missing-information request draft.
  await panel.getByRole("button", { name: "Draft request for missing information" }).click();
  await expect(page.getByRole("dialog", { name: "Draft request for missing information · Screen Copilot Oils" })).toBeVisible();
  await page.getByRole("dialog", { name: "Draft request for missing information · Screen Copilot Oils" }).getByRole("button", { name: "Close dialog" }).click();

  // Prepare quotation → the normal quotation form, known values only, price blank.
  await panel.getByRole("button", { name: "Prepare quotation" }).click();
  const quote = panel.locator(".copilot-quote");
  await expect(quote).toContainText("Set by you on the quotation: Price, Freight, Availability / stock, Quotation validity");
  await quote.getByRole("button", { name: "Create quotation draft" }).click();
  const form = page.getByRole("dialog", { name: "New quotation" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Destination / Port")).toHaveValue("Mombasa");
  await expect(form.getByLabel("Item 1 product")).toHaveValue("Base Oil SN500");
  // Known values from the requirement (packaging from the notes); the unit price is never filled in.
  await expect(form.getByLabel("Item 1 packaging")).toHaveValue("208L drums");
  await expect(form.getByLabel(/^Unit price/)).toHaveValue("0");
  await form.getByRole("button", { name: "Cancel" }).click();
  // Nothing was created.
  const quotes = (await client.request("GET", "/api/records")).body.records.filter((r: any) => r.kind === "quotations" && r.parentId === "AIT-UP1");
  expect(quotes).toEqual([]);
  await context.close();
});

test("My Day shows a few Copilot suggestions (not the overdue ones it already lists)", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aisui");
  await page.goto("/");
  const block = page.getByRole("region", { name: "AI suggestions" });
  await expect(block).toBeVisible();
  const items = block.locator(".copilot-myday-list li");
  await expect(items).toHaveCount(2);
  await expect(block).toContainText("Screen Asphalt Buyer");
  await expect(block).toContainText("Screen Quiet Grease");
  await expect(block).not.toContainText("Screen Copilot Oils");
  await items.first().getByRole("button", { name: "Draft message" }).click();
  await expect(page.getByRole("dialog", { name: /^Draft quotation follow-up · Screen Asphalt Buyer$/ })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await block.getByRole("button", { name: "Review priorities" }).click();
  await expect(page).toHaveURL(/\/enercore-ai$/);
  await context.close();
});

test("post-meeting review in the meeting report: checklist, status never pre-ticked, applied as the person", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "aisui");
  const meeting = (await client.post("/meetings", { mode: "now", media: "video", title: "Screen outcome call", inviteeIds: [], guestAccess: "off", relatedRecordId: "AIT-UP1" })).body.meeting;
  await client.post(`/meetings/${meeting.id}/messages`, { body: "Customer now requires 800 MT per month. [[fake:suggest]]", clientKey: `ui${Date.now()}` });
  await client.post(`/meetings/${meeting.id}/end`, {});
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  const outcome = page.getByRole("region", { name: "Meeting outcome" });
  await outcome.getByRole("button", { name: "Review outcome" }).click();
  await expect(outcome.locator(".ai-scope")).toHaveText("No transcript is available. This summary uses meeting details and Meeting Chat.");
  const list = outcome.locator(".copilot-checklist li");
  await expect(list).toHaveCount(4);
  const status = list.filter({ hasText: "Change Screen Copilot Oils" });
  await expect(status.getByRole("checkbox")).not.toBeChecked();
  const profile = list.filter({ hasText: "Update the requirement on Screen Copilot Oils" });
  await expect(profile).toContainText("Quantity → 800 MT per month");
  await expect(profile.getByRole("checkbox")).toBeChecked();
  // Leave only the outcome note ticked, then apply.
  await profile.getByRole("checkbox").uncheck();
  await list.filter({ hasText: "Set the next follow-up" }).getByRole("checkbox").uncheck();
  await outcome.getByRole("button", { name: "Apply selected" }).click();
  await expect(list.filter({ hasText: "Add the meeting outcome" })).toContainText("Applied");
  const lead = (await client.request("GET", "/api/records?id=AIT-UP1")).body.record;
  expect([lead.quantity, lead.status]).toEqual([500, "Qualified"]);
  expect(lead.notes.at(-1).text).toMatch(/^Meeting outcome — Screen outcome call \(from the meeting chat; no transcript\):/);
  await context.close();
});

test("on a 390px phone: single-column cards, reachable Copy, no sideways scrolling", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aisui2", { width: 390, height: 844 });
  await page.goto(AI);
  const home = page.getByRole("region", { name: /^Good (morning|afternoon|evening), Sam$/ });
  const cards = home.locator(".copilot-card");
  await expect(cards).toHaveCount(2);
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(a!.x).toBe(b!.x);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  expect(a!.x + a!.width).toBeLessThanOrEqual(391);
  expect(await noOverflow(page)).toBe(true);

  await cards.nth(0).getByRole("button", { name: "Draft follow-up" }).click();
  const dialog = page.getByRole("dialog", { name: /^Draft follow-up · / });
  await dialog.getByRole("button", { name: "Draft", exact: true }).click();
  const copy = dialog.getByRole("button", { name: "Copy" });
  await expect(copy).toBeInViewport();
  expect(await noOverflow(page)).toBe(true);
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  await page.goto("/workspace/all-companies/sales-pipeline");
  await openRecord(page, "leads", "AIT-UM1");
  const panel = page.getByRole("dialog", { name: "Mobile Copilot Oils" }).getByRole("region", { name: "Enercore AI" });
  await panel.getByRole("button", { name: "Brief me" }).click();
  await expect(panel.locator(".copilot-profile")).toBeVisible();
  for (const el of await panel.locator(".copilot-profile-list > div, .copilot-actions > button").all()) {
    const box = await el.boundingBox();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  expect(await noOverflow(page)).toBe(true);
  await context.close();
});
