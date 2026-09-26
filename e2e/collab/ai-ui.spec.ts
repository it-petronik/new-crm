import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";
import { note } from "./ai-helpers";

/**
 * Enercore AI in real browsers, against the built Worker with the fake
 * Workers AI (see ai.spec.ts): the AI workspace on desktop and a 390px
 * phone, loading / answer / figures / references / errors, the contextual
 * buttons (lead, customer, meeting report, conversation), review-and-apply,
 * and one request per click however it's clicked.
 *
 * People: aiui1–aiui4 and aihr (read-only use here). Data: ai-data.ts.
 * Only notes are applied here, so ai.spec.ts's figures are unaffected.
 */

const AI = "/workspace/all-companies/enercore-ai";
const HUB = "/workspace/all-companies/collaboration";
const CAPACITY = "AI capacity has been reached for today. Your normal CRM workflows are still available.";

const sessions = new Map<string, Promise<Client>>();
const login = (k: string) => {
  if (!sessions.has(k)) sessions.set(k, Client.login(k));
  return sessions.get(k)!;
};

async function signedIn(browser: Browser, key: string, viewport = { width: 1440, height: 900 }) {
  const client = await login(key);
  const context = await browser.newContext({ viewport });
  await client.signInBrowser(context);
  const page = await context.newPage();
  return { client, context, page };
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openRecord = (page: Page, kind: string, id: string) =>
  page.evaluate(([kind, id]) => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id } })), [kind, id]);
/** Counts AI requests the page makes to one endpoint. */
function countRequests(page: Page, path: string) {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === path) seen.push(r.url());
  });
  return seen;
}

async function ask(page: Page, question: string) {
  const box = page.getByRole("textbox", { name: "Your question" });
  await box.fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

test("AI workspace on desktop: role prompts, loading, answer, figures, references, errors", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aiui1");
  const asks = countRequests(page, "/api/ai/ask");
  await page.goto(AI);
  await expect(page.getByRole("heading", { name: "Enercore AI", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Enercore AI" })).toHaveAttribute("aria-current", "page");
  // A Sales Manager: pipeline prompts, not receivables.
  const examples = page.getByLabel("Example questions").getByRole("button");
  await expect(examples.first()).toBeVisible();
  await expect(examples).toContainText(["How is our pipeline looking?"]);
  await expect(page.getByLabel("Example questions")).not.toContainText("owe");
  await expect(page.getByRole("heading", { name: "How Enercore AI works" })).toBeVisible();

  await ask(page, "[[route:pipeline_summary,Istanegry,]] How is the pipeline?");
  const turn = page.locator(".ai-turn").first();
  await expect(turn.locator(".ai-question")).toHaveText("[[route:pipeline_summary,Istanegry,]] How is the pipeline?");
  await expect(turn.locator(".ai-answer")).toBeVisible();
  await expect(turn.locator(".ai-summary")).toHaveText("Fake answer from the test model.");
  const figures = turn.locator(".ai-figures");
  await expect(figures).toHaveAttribute("open", "");
  await expect(figures.locator("dt", { hasText: /^Open leads$/ })).toBeVisible();
  await expect(turn.locator(".ai-fineprint").last()).toContainText("Figures are calculated by Enercore, not the AI");
  expect(asks).toHaveLength(1);

  // A reference opens the record through the normal detail view.
  await turn.locator(".ai-sources summary").click();
  const ref = turn.locator(".ai-sources .ai-ref").first();
  await ref.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  // Still on Enercore AI, answers kept.
  await expect(page).toHaveURL(/\/enercore-ai$/);
  await expect(page.locator(".ai-turn")).toHaveCount(1);

  // A capacity error: plain words, and nothing else breaks.
  await ask(page, "[[fake:quota]] [[route:pipeline_summary,,]] Anything?");
  await expect(page.locator(".ai-turn").first().getByRole("alert")).toHaveText(CAPACITY);
  expect(asks).toHaveLength(2);
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeEnabled();
  await context.close();
});

test("AI workspace on a 390px phone: no sideways scrolling, everything reachable", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aiui2", { width: 390, height: 844 });
  await page.goto(AI);
  await expect(page.getByRole("heading", { name: "Enercore AI", level: 1 })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await ask(page, "[[route:top_open_deals,,]] Biggest deals?");
  const turn = page.locator(".ai-turn").first();
  await expect(turn.locator(".ai-answer")).toBeVisible();
  await turn.locator(".ai-sources summary").click();
  await expect(turn.locator(".ai-draft")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  for (const el of await turn.locator(".ai-answer > *").all()) {
    const box = await el.boundingBox();
    if (box) expect(box.x + box.width, await el.evaluate((n) => n.className)).toBeLessThanOrEqual(391);
  }
  await context.close();
});

test("a role without AI tools sees why, with no prompts", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "aihr");
  await page.goto(AI);
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Your question" })).toHaveAttribute("placeholder", "Your role doesn't include sales or accounts questions.");
  await expect(page.getByLabel("Example questions")).toHaveCount(0);
  await context.close();
});

test("Lead AI: one request per click, suggestions change nothing until reviewed and applied", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "aiui3");
  await note(client, "AIT-U3", "Spoke to buyer. [[fake:suggest]]");
  const leads = countRequests(page, "/api/ai/lead");
  await page.goto("/workspace/all-companies/sales-pipeline");
  await openRecord(page, "leads", "AIT-U3");
  const dialog = page.getByRole("dialog", { name: "Screen Test Lead 3" });
  await expect(dialog).toBeVisible();
  const panel = dialog.getByRole("region", { name: "Enercore AI" });
  await panel.getByRole("button", { name: "Brief me on this lead" }).dblclick();
  await expect(panel.locator(".ai-answer")).toBeVisible();
  expect(leads).toHaveLength(1);
  await expect(panel.locator(".ai-draft")).toContainText("Nothing is sent. Review and send it yourself.");

  // Only the three safe kinds are offered.
  const items = panel.locator(".ai-suggestions li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Add a note to Screen Test Lead 3");
  await expect(items.nth(2)).toContainText("Change Screen Test Lead 3 from Qualified to Negotiation");

  // Review → cancel: nothing changes.
  await items.nth(0).getByRole("button", { name: "Review" }).click();
  const review = page.getByRole("dialog", { name: "Review suggested change" });
  await expect(review).toContainText("Customer confirmed interest in a trial order.");
  await expect(review).toContainText("(Suggested by Enercore AI, reviewed by Uma Aiscreen3.)");
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).toBeHidden();
  let record = (await client.request("GET", "/api/records?id=AIT-U3")).body.record;
  expect(record.notes).toHaveLength(1);

  // Review → Apply: saved through the records API as this person.
  await items.nth(0).getByRole("button", { name: "Review" }).click();
  await review.getByRole("button", { name: "Apply change" }).click();
  await expect(review).toBeHidden();
  await expect(items.nth(0)).toContainText("Applied");
  await expect(page.getByText("Change applied.")).toBeVisible();
  record = (await client.request("GET", "/api/records?id=AIT-U3")).body.record;
  expect(record.notes.map((n: { text: string }) => n.text).at(-1)).toBe("Customer confirmed interest in a trial order.\n\n(Suggested by Enercore AI, reviewed by Uma Aiscreen3.)");
  expect(record.status).toBe("Qualified");
  await context.close();
});

test("Customer 360, meeting report and conversation summaries in place", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "aiui4");

  // Customer 360 says its relationships are name-based.
  await page.goto("/workspace/all-companies/customers");
  await openRecord(page, "customers", "AIT-UC4");
  const customer = page.getByRole("dialog", { name: "Screen Test Lead 4" }).getByRole("region", { name: "Enercore AI" });
  await customer.getByRole("button", { name: "Customer 360 summary" }).click();
  await expect(customer.locator(".ai-scope")).toHaveText("Related records are matched by exact customer name (not a recorded link), so this history may be incomplete.");
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Meeting report: says there is no transcript.
  const meeting = (await client.post("/meetings", { mode: "now", media: "video", title: "Screen meeting", inviteeIds: [], guestAccess: "off" })).body.meeting;
  await client.post(`/meetings/${meeting.id}/messages`, { body: "We agreed on a trial order.", clientKey: `ui${Date.now()}` });
  await client.post(`/meetings/${meeting.id}/end`, {});
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  const report = page.getByRole("region", { name: "Enercore AI" });
  await report.getByRole("button", { name: "Summarise this meeting" }).click();
  await expect(report.locator(".ai-scope")).toHaveText("No transcript or recording is available — this is based only on attendance, meeting activity and the meeting chat (1 message).");

  // Conversation: the header button opens a summary with its scope.
  const room = await client.createRoom({ name: "Screen AI room", members: ["aiui1"] });
  await client.send(room.id, "Please confirm the trial order quantity.");
  const convo = countRequests(page, "/api/ai/conversation");
  await page.goto(`${HUB}?c=${room.id}`);
  await expect(page.getByRole("heading", { name: "Screen AI room", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Summarise with Enercore AI" }).click();
  const summary = page.getByRole("dialog", { name: "Summary · Screen AI room" });
  await expect(summary.locator(".ai-scope")).toHaveText("Based on all 1 message in this conversation.");
  expect(convo).toHaveLength(1);
  expect(await noOverflow(page)).toBe(true);
  await context.close();
});
