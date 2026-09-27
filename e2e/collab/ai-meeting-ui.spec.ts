import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";
import { WORKER } from "./people";

/**
 * Meeting notes and AI meeting notes in real browsers (zero-cost mode — no
 * transcript): the employee-only Notes panel in the room (never shown to a
 * guest), notes on the report, "Generate AI report" on request, citations
 * that jump to the chat/note, the organiser's edit, and a 390px phone.
 *
 * People: aim7 (exclusive to this file).
 */

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });
const HUB = "/workspace/all-companies/collaboration";
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function hostInMeeting(browser: Browser, client: Client, meetingId: string, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], bypassCSP: true });
  await client.signInBrowser(context);
  const page = await context.newPage();
  await page.goto(`${HUB}?tab=meetings&meeting=${meetingId}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.locator(".meet-prejoin .meet-join").click();
  await expect(page.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  return { context, page };
}

test("notes in the room (employees only), then the AI report on request, with jump-to-source citations", async ({ browser }) => {
  const host = await Client.login("aim7");
  const meeting = (await host.post("/meetings", { mode: "now", media: "video", title: "Notes UI meeting", inviteeIds: [], guestAccess: "open" })).body.meeting;
  const { page, context } = await hostInMeeting(browser, host, meeting.id);

  // Notes from the More menu: buttons, not slash commands.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Meeting notes" }).click();
  const panel = page.getByRole("complementary", { name: "Meeting notes" });
  await panel.getByRole("button", { name: "Customer requirement" }).click();
  await panel.getByLabel("Product").fill("Base Oil SN500");
  await panel.getByLabel("Quantity").fill("500 MT/month");
  await panel.getByLabel("Destination / port").fill("Mombasa");
  await expect(panel.getByLabel("What was said about it")).toHaveValue("requested");
  await panel.getByRole("button", { name: "Add customer requirement" }).click();
  await expect(panel.locator(".meet-note-list li")).toHaveCount(1);
  await expect(panel.locator(".meet-note-list li")).toContainText("Product: Base Oil SN500 · Quantity: 500 MT/month · Destination: Mombasa");
  await expect(panel.locator(".meet-note-list li")).toContainText("Requested by the customer — not an Enercore commitment unless agreed");
  await panel.getByRole("button", { name: "Decision", exact: true }).click();
  await panel.getByLabel("Decision").fill("Prepare the revised quotation.");
  await panel.getByRole("button", { name: "Add decision" }).click();
  await expect(panel.locator(".meet-note-list li")).toHaveCount(2);

  // A guest in the same meeting never sees the Notes entry.
  const link = (await host.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;
  const guest = await browser.newContext({ permissions: ["camera", "microphone"], bypassCSP: true });
  const gpage = await guest.newPage();
  await gpage.goto(link.replace(/^https?:\/\/[^/]+/, WORKER));
  await gpage.getByLabel("Your name").fill("Ahmed");
  await gpage.getByRole("button", { name: "Join meeting" }).click();
  await expect(gpage.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  await gpage.getByRole("button", { name: "More options" }).click();
  await expect(gpage.getByRole("button", { name: "Meeting notes" })).toHaveCount(0);
  await guest.close();

  await host.post(`/meetings/${meeting.id}/messages`, { body: "Can you do CIF Mombasa?", clientKey: `ui${Date.now()}` });
  await host.post(`/meetings/${meeting.id}/end`, {});
  await context.close();

  // The report: nothing generated until asked.
  const report = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await host.signInBrowser(report);
  const rpage = await report.newPage();
  const generate: string[] = [];
  rpage.on("request", (r) => r.method() === "POST" && new URL(r.url()).pathname === `/api/ai/meeting-report/${meeting.id}` && generate.push(r.url()));
  await rpage.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  const intel = rpage.getByRole("region", { name: "AI meeting notes" });
  await expect(intel.locator(".ai-scope")).toContainText("No transcript is available.");
  expect(generate).toHaveLength(0);
  await intel.getByRole("button", { name: "Generate AI report" }).dblclick();
  await expect(intel.getByText("Executive summary")).toBeVisible();
  expect(generate).toHaveLength(1);
  await expect(intel.locator(".ai-scope")).toHaveText("No transcript is available. This report uses meeting details, attendance and Meeting Chat. It also uses 2 meeting notes.");
  await expect(intel.getByText("AI-generated")).toBeVisible();
  // A requirement from the note, with its status; a citation jumps to the note.
  const reqs = intel.locator(".ai-section", { hasText: "Customer requirements" });
  await expect(reqs).toContainText("Destination / port: Mombasa");
  await expect(reqs).toContainText("Requested — not confirmed");
  await reqs.getByRole("button", { name: /^Note · Imran|^Note · Nadia/ }).first().click();
  await expect(rpage.locator(".meet-note-list li.is-cited")).toHaveCount(1);
  // Reloading shows the stored report: no new generation.
  await rpage.reload();
  await expect(intel.getByText("Executive summary")).toBeVisible();
  expect(generate).toHaveLength(1);
  // The organiser edits the summary; the label says so.
  await intel.getByRole("button", { name: "Edit" }).click();
  await intel.getByLabel("Executive summary").fill("SN500 for Mombasa; CIF and volumes to confirm.");
  await intel.getByRole("button", { name: "Save" }).click();
  await expect(intel.getByText("Edited by Nadia Notesui")).toBeVisible();
  await expect(intel.locator(".ai-summary")).toHaveText("SN500 for Mombasa; CIF and volumes to confirm.");
  await report.close();
});

test("the meeting report with AI notes on a 390px phone: no sideways scrolling", async ({ browser }) => {
  const host = await Client.login("aim7");
  const meeting = (await host.post("/meetings", { mode: "now", media: "video", title: "Phone report meeting", inviteeIds: [], guestAccess: "off" })).body.meeting;
  await host.request("POST", `/api/collab/meetings/${meeting.id}/notes`, { kind: "action", text: "Send the revised offer to the customer", owner: "Nadia Notesui", due: "2026-12-01" });
  await host.post(`/meetings/${meeting.id}/messages`, { body: "We need 208L drums for the first shipment.", clientKey: `ui${Date.now()}` });
  await host.post(`/meetings/${meeting.id}/end`, {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await host.signInBrowser(context);
  const page = await context.newPage();
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  const intel = page.getByRole("region", { name: "AI meeting notes" });
  await intel.getByRole("button", { name: "Generate AI report" }).click();
  await expect(intel.getByText("Executive summary")).toBeVisible();
  await expect(page.getByRole("region", { name: "Meeting notes", exact: true })).toContainText("Send the revised offer to the customer");
  expect(await noOverflow(page)).toBe(true);
  await context.close();
});
