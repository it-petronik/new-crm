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
  await panel.getByRole("textbox", { name: "Quantity", exact: true }).fill("500 MT/month");
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
  await intel.getByRole("button", { name: "Save", exact: true }).click();
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

/* ------------------------------------------------------ print / save PDF */

const printable = async (page: Page) => {
  // Headless print: record the call, keep the print state, then look at the page as print media.
  await page.evaluate(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => void ((window as unknown as { __printed: number }).__printed += 1);
  });
  await page.getByRole("region", { name: "AI meeting notes" }).getByRole("button", { name: "Print / Save PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  const doc = page.locator(".intel-print-root .intel-print");
  await expect(doc).toBeVisible();
  return doc;
};

test("print / save PDF: the authorised report only, readable sources, disclosure, A4 without clipping", async ({ browser }) => {
  const host = await Client.login("aim7");
  const viewer = await Client.login("aim8");
  const lead = await host.request("POST", "/api/records", {
    kind: "leads", title: "Print Lead Trading", company: "Petronik", branch: "Main", contact: "Ahmed", product: "Base Oil SN500",
    quantity: 500, unit: "MT", amount: 12000, currency: "USD", due: new Date(Date.now() + 4 * 3600_000 + 5 * 86_400_000).toISOString().slice(0, 10), detail: "", source: "Test",
  });
  expect(lead.status).toBe(201);
  const meeting = (await host.post("/meetings", { mode: "now", media: "video", title: "Print report meeting", inviteeIds: [viewer.id], guestAccess: "off", relatedRecordId: lead.body.record.id })).body.meeting;
  await host.post(`/meetings/${meeting.id}/messages`, { body: "Customer now requires 800 MT per month. Can you do LC at sight?", clientKey: `pr${Date.now()}` });
  await host.request("POST", `/api/collab/meetings/${meeting.id}/notes`, { kind: "decision", text: "Prepare the revised quotation." });
  await host.request("POST", `/api/collab/meetings/${meeting.id}/notes`, { kind: "action", text: "Check LC at sight with accounts", owner: "Nadia Notesui", due: "2026-12-01" });
  await host.post(`/meetings/${meeting.id}/end`, {});
  expect((await host.request("POST", `/api/ai/meeting-report/${meeting.id}`, {})).status).toBe(200);
  expect((await host.request("PATCH", `/api/ai/meeting-report/${meeting.id}`, { summary: "Edited: SN500, 800 MT/month; LC at sight to confirm." })).status).toBe(200);

  // The organiser (may read the lead).
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await host.signInBrowser(context);
  const page = await context.newPage();
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  await expect(page.getByRole("region", { name: "AI meeting notes" }).getByText("Executive summary")).toBeVisible();
  // On screen the print document is hidden.
  await expect(page.locator(".intel-print-root .intel-print")).toBeHidden();
  const doc = await printable(page);
  await expect(doc.locator("h1")).toHaveText("Meeting Intelligence Report");
  await expect(doc).toContainText("ENERCORE");
  await expect(doc).toContainText("Print report meeting");
  await expect(doc.locator(".intel-print-disclosure")).toHaveText("No transcript is available. This report is based on meeting details, attendance, Meeting Chat and meeting notes.");
  await expect(doc).toContainText("Organiser");
  await expect(doc).toContainText("Related lead");
  await expect(doc).toContainText("Print Lead Trading");
  await expect(doc).toContainText("Edited: SN500, 800 MT/month; LC at sight to confirm.");
  await expect(doc).toContainText("Edited by Nadia Notesui");
  // Commercial information with readable sources — and no internal ids.
  const commercial = doc.locator(".intel-print-section", { hasText: "Commercial information" });
  await expect(commercial).toContainText("LC at sight");
  await expect(commercial).toContainText("Discussed — not confirmed");
  await expect(commercial).toContainText(/Meeting (Chat|note)/);
  const text = await doc.innerText();
  expect(text).not.toMatch(/\b[RS]\d+\b/);
  // Action item with owner and due date; not the full chat.
  await expect(doc.locator(".intel-print-section", { hasText: "Action items" })).toContainText("Nadia Notesui");
  await expect(doc.locator(".intel-print-section", { hasText: "Action items" })).toContainText("2026-12-01");
  expect(await doc.locator(".meet-report-chat, [id^='chat-']").count()).toBe(0);
  // Nothing interactive in the printout; nothing else of the page printed.
  expect(await doc.locator("button, a, input, textarea, select").count()).toBe(0);
  await expect(page.locator(".main-shell, .meet-report").first()).toBeHidden();

  // A4: nothing wider than the printable area; a real PDF renders.
  await page.setViewportSize({ width: 718, height: 1016 }); // A4 at 96dpi minus 14mm side margins
  const overflow = await doc.evaluate((root) => {
    const limit = root.getBoundingClientRect().right + 1;
    return [...root.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > limit).map((el) => el.className || el.tagName);
  });
  expect(overflow).toEqual([]);
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true });
  expect(pdf.byteLength).toBeGreaterThan(5_000);
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(1);
  await context.close();

  // An invitee who can't read the lead: the report prints without it.
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await viewer.signInBrowser(other);
  const vpage = await other.newPage();
  await vpage.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  await expect(vpage.getByRole("region", { name: "AI meeting notes" }).getByText("Executive summary")).toBeVisible();
  const vdoc = await printable(vpage);
  await expect(vdoc).not.toContainText("Related lead");
  await expect(vdoc).not.toContainText("Print Lead Trading");
  await other.close();
});

test("print: a report with no decisions or action items says so", async ({ browser }) => {
  const host = await Client.login("aim7");
  const meeting = (await host.post("/meetings", { mode: "now", media: "video", title: "Quiet print meeting", inviteeIds: [], guestAccess: "off" })).body.meeting;
  await host.request("POST", `/api/collab/meetings/${meeting.id}/notes`, { kind: "note", text: "Customer compares two suppliers." });
  await host.post(`/meetings/${meeting.id}/end`, {});
  expect((await host.request("POST", `/api/ai/meeting-report/${meeting.id}`, {})).status).toBe(200);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await host.signInBrowser(context);
  const page = await context.newPage();
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  await expect(page.getByRole("region", { name: "AI meeting notes" }).getByText("Executive summary")).toBeVisible();
  const doc = await printable(page);
  await expect(doc.locator(".intel-print-section", { hasText: "Decisions" })).toContainText("None recorded.");
  await expect(doc.locator(".intel-print-section", { hasText: "Action items" })).toContainText("None recorded.");
  await expect(doc).toContainText("AI-generated");
  await context.close();
});
