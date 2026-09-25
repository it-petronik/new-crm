import { test, expect, type Browser, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Client } from "./client";
import { byKey, WORKER } from "./people";

/**
 * Meetings V3.1 through the real Worker, D1, CollabHub and the local LiveKit
 * dev server: standalone meetings and invitations, scheduled meetings, guest
 * links and the waiting room, attendance and the report, the CRM relation,
 * the dialogs, and the Start race. Nothing here reaches production.
 *
 * People: mv1–mv12, mvs, mvs2 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";
const HEX_ID = /[0-9a-f]{16,}/i;
// Unique per run, so repeated runs against one database never collide.
const tag = () => Math.random().toString(36).slice(2, 7);

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const tokenOf = (url: string) => url.split("/meet/")[1];

/** A guest's request: no cookie at all, from the app's own origin. */
async function guest<T = any>(path: string, body: unknown, origin: string | null = WORKER) {
  const response = await fetch(`${WORKER}/api/meet/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: response.status, body: parsed as T, headers: response.headers };
}

const standalone = (client: Client, body: Record<string, unknown>) =>
  client.post("/meetings", { mode: "now", media: "video", title: "Standalone", inviteeIds: [], ...body });

async function createLead(client: Client, title: string) {
  const result = await client.request("POST", "/api/records", {
    kind: "leads", title, company: "Petronik", branch: "Main", contact: "Ahmed", product: "Base Oil SN500",
    quantity: 1, unit: "MT", amount: 0, currency: "USD", due: new Date().toISOString().slice(0, 10), detail: "", source: "",
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.record as { id: string; title: string; ownerId: string };
}

/* --------------------------------------------------- standalone, scheduled */

test("standalone meetings: invitations, invitee-only access, removal disconnects", async () => {
  const [owner, invitee, colleague] = await Promise.all(["mv1", "mv2", "mv3"].map(Client.login));
  const created = await standalone(owner, { title: "Pricing sync", inviteeIds: [invitee.id] });
  expect(created.status).toBe(201);
  const meeting = created.body.meeting;
  // The organiser plus one invitee.
  expect(meeting).toMatchObject({ scope: "standalone", conversationId: null, status: "live", inviteeCount: 2, related: null });

  // The invitee is told it has started, sees it at once, and may join; nobody else can find it.
  await expect
    .poll(async () => ((await invitee.request("GET", "/api/notifications")).body.items as any[]).find((n) => n.target?.meetingId === meeting.id)?.type)
    .toBe("meeting.started");
  expect(((await colleague.request("GET", "/api/notifications")).body.items as any[]).some((n) => n.target?.meetingId === meeting.id)).toBe(false);
  expect((await invitee.get("/meetings")).body.meetings.map((m: any) => m.id)).toContain(meeting.id);
  expect((await invitee.post(`/meetings/${meeting.id}/join`, {})).status).toBe(200);
  const notFound = await colleague.post(`/meetings/${meeting.id}/join`, {});
  expect(notFound).toEqual({ status: 404, body: { error: "Meeting not found." } });
  expect((await colleague.get(`/meetings/${meeting.id}`)).status).toBe(404);
  expect((await colleague.get("/meetings")).body.meetings.map((m: any) => m.id)).not.toContain(meeting.id);
  // Invitees are not organisers.
  expect((await invitee.post(`/meetings/${meeting.id}/end`, {})).status).toBe(403);
  expect((await invitee.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h" })).status).toBe(403);

  // Removing the invitee closes the door (and any connection).
  expect((await owner.patch(`/meetings/${meeting.id}`, { inviteeIds: [] })).status).toBe(200);
  expect(await invitee.post(`/meetings/${meeting.id}/join`, {})).toEqual(notFound);
  // Only people who share a company can be invited.
  expect((await standalone(owner, { inviteeIds: [byKey("mtf").id] })).status).toBe(400);
  await owner.post(`/meetings/${meeting.id}/end`, {});
});

test("a scheduled meeting appears at once for everyone, in GST, and opens 15 minutes before", async ({ browser }) => {
  const [owner, member] = await Promise.all(["mv4", "mv5"].map(Client.login));
  const room = await owner.createRoom({ name: "Schedule room", members: ["mv5"] });
  const at = inMinutes(90);
  const planned = await owner.post(`/conversations/${room.id}/meetings`, { mode: "schedule", media: "video", title: "Supplier review", scheduledAt: at, durationMin: 30 });
  expect(planned.status).toBe(201);
  const id = planned.body.meeting.id;
  // Visible immediately — to the organiser and the member — in the room and on the Meetings page.
  for (const who of [owner, member]) {
    expect((await who.get(`/conversations/${room.id}/meetings`)).body.meetings.map((m: any) => m.id)).toContain(id);
    expect((await who.get("/meetings")).body.meetings.find((m: any) => m.id === id)).toMatchObject({ status: "scheduled", scheduledAt: new Date(at).toISOString() });
  }
  // Not joinable 90 minutes early; joinable once within 15 minutes.
  expect((await member.post(`/meetings/${id}/join`, {})).status).toBe(409);
  expect((await owner.patch(`/meetings/${id}`, { scheduledAt: inMinutes(10) })).status).toBe(200);
  expect((await member.post(`/meetings/${id}/join`, {})).status).toBe(200);
  expect((await member.get(`/meetings/${id}`)).body.meeting.status).toBe("live");
  await owner.post(`/meetings/${id}/end`, {});

  // The organiser's own browser shows it at once, with its GST time.
  const context = await browser.newContext();
  try {
    await owner.signInBrowser(context);
    const page = await context.newPage();
    const title = `Budget call ${tag()}`;
    const later = await owner.post(`/conversations/${room.id}/meetings`, { mode: "schedule", media: "voice", title, scheduledAt: inMinutes(120) });
    await page.goto(`${HUB}?c=${room.id}`);
    await expect(page.locator(".meet-banner")).toContainText(title);
    await page.goto(`${HUB}?tab=meetings`);
    const row = page.locator(".meet-row", { hasText: title });
    await expect(row).toContainText("GST");
    await expect(row.locator(".meet-status-pill")).toHaveText("Upcoming");
    await owner.patch(`/meetings/${later.body.meeting.id}`, { cancel: true });
  } finally {
    await context.close();
  }
});

test("race: everyone pressing Start on a scheduled meeting gives one live meeting, started once", async () => {
  const people = await Promise.all(["mv6", "mv7", "mv8"].map(Client.login));
  const [owner] = people;
  const planned = await owner.post("/meetings", { mode: "schedule", media: "video", title: "Race", scheduledAt: inMinutes(5), inviteeIds: [people[1].id, people[2].id] });
  expect(planned.status).toBe(201);
  const id = planned.body.meeting.id;
  const results = await Promise.all([...people, owner, owner].map((p) => p.post(`/meetings/${id}/join`, {})));
  for (const r of results) expect(r.status).toBe(200);
  expect(new Set(results.map((r) => r.body.meeting.providerRoom ?? r.body.meeting.id)).size).toBe(1);
  const report = (await owner.get(`/meetings/${id}/report`)).body;
  expect(report.activity.filter((a: any) => a.type === "started")).toHaveLength(1);
  await expect
    .poll(async () => ((await people[1].request("GET", "/api/notifications")).body.items as any[]).filter((n) => n.target?.meetingId === id && n.type === "meeting.started").length)
    .toBe(1);
  await owner.post(`/meetings/${id}/end`, {});
});

/* ---------------------------------------------------------------- guests */

test("guest links: hashed, single-purpose, revocable; guests get no CRM access at all", async () => {
  const [owner, invitee] = await Promise.all(["mv9", "mv10"].map(Client.login));
  const lead = await createLead(owner, "Guest-proof Trading LLC");
  const meeting = (await standalone(owner, { title: "Customer call", inviteeIds: [invitee.id], relatedRecordId: lead.id, guestAccess: "admit" })).body.meeting;

  // Only the organiser creates links; never for a DM.
  expect((await invitee.post(`/meetings/${meeting.id}/guest-link`, { expiry: "24h" })).status).toBe(403);
  const dm = (await owner.openDirect("mv10")).body.conversation;
  const call = (await owner.post(`/conversations/${dm.id}/meetings`, { mode: "now", media: "voice" })).body.meeting;
  expect((await owner.post(`/meetings/${call.id}/guest-link`, { expiry: "24h" })).status).toBe(400);
  await owner.post(`/meetings/${call.id}/end`, {});

  const first = await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "24h", admission: "admit" });
  expect(first.status).toBe(200);
  const token = tokenOf(first.body.url);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The details say a link exists — never what it is.
  const details = (await owner.get(`/meetings/${meeting.id}`)).body;
  expect(details.guestLink).toMatchObject({ active: true, untilMeetingEnd: false });
  expect(JSON.stringify(details)).not.toContain(token);

  // What a guest may learn: title, time, organiser's first name. No CRM data.
  const lookup = await guest("lookup", { token });
  expect(lookup.status).toBe(200);
  expect(lookup.body).toEqual({ title: "Customer call", status: "live", scheduledAt: null, organiser: "Mina", admission: "admit" });
  expect(lookup.headers.get("set-cookie")).toBeNull();
  // Wrong origin, or a made-up token: refused.
  expect((await guest("lookup", { token }, "https://evil.example")).status).toBe(403);
  expect((await guest("lookup", { token: "x".repeat(43) })).status).toBe(404);

  // Join → waiting (host must admit). The host is told; decline sticks.
  const a = await guest("join", { token, name: "  Ahmed   Khan " });
  expect(a.body.state).toBe("waiting");
  expect(a.headers.get("set-cookie")).toBeNull();
  const waiting = (await owner.get(`/meetings/${meeting.id}/guests`)).body.guests;
  expect(waiting.map((g: any) => g.name)).toEqual(["Ahmed Khan"]);
  expect((await invitee.get(`/meetings/${meeting.id}/guests`)).status).toBe(403);
  expect((await owner.post(`/meetings/${meeting.id}/guests/${waiting[0].id}`, { decision: "decline" })).status).toBe(200);
  expect((await guest("status", { secret: a.body.secret })).body).toEqual({ state: "declined" });
  expect((await owner.post(`/meetings/${meeting.id}/guests/${waiting[0].id}`, { decision: "admit" })).status).toBe(409);

  // Another guest is admitted: a short-lived token for this room only, as a guest.
  const b = await guest("join", { token, name: "Bea Buyer" });
  const bId = (await owner.get(`/meetings/${meeting.id}/guests`)).body.guests[0].id;
  await owner.post(`/meetings/${meeting.id}/guests/${bId}`, { decision: "admit" });
  const admitted = (await guest("status", { secret: b.body.secret })).body;
  expect(admitted.state).toBe("admitted");
  const claims = JSON.parse(Buffer.from(admitted.grant.token.split(".")[1], "base64url").toString());
  expect(claims.sub).toBe(`guest:${bId}`);
  expect(claims.video.roomAdmin).toBeUndefined();
  expect(claims.exp - claims.nbf).toBeLessThanOrEqual(610);
  // The guest's view of the meeting carries nothing about the lead or the people.
  const guestPayload = JSON.stringify(admitted);
  for (const secret of [lead.id, lead.title, "Petronik", owner.person.email, invitee.person.name]) expect(guestPayload).not.toContain(secret);

  // A guest has no CRM session: every CRM API refuses them.
  for (const path of ["/api/records", `/api/records?id=${lead.id}`, "/api/collab/conversations", `/api/collab/meetings/${meeting.id}`, `/api/collab/meetings/${meeting.id}/report`, "/api/notifications"]) {
    const r = await owner.request("GET", path, undefined, { cookie: null });
    expect(r.status, path).toBe(401);
  }
  expect(await owner.request("GET", "/api/users", undefined, { cookie: null })).toEqual({ status: 403, body: { error: "Access denied." } });

  // Removed from the meeting: that guest can't come back; nor through the link unseen.
  expect((await owner.post(`/meetings/${meeting.id}/participants`, { action: "remove", identity: `guest:${bId}` })).status).toBe(200);
  expect((await guest("status", { secret: b.body.secret })).body).toEqual({ state: "declined" });

  // Anyone-with-the-link, then regenerate: the old link dies at once.
  const open = await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "meeting_end", admission: "open" });
  expect((await guest("lookup", { token })).status).toBe(404);
  const openToken = tokenOf(open.body.url);
  const c = await guest("join", { token: openToken, name: "Cy Direct" });
  expect(c.body.state).toBe("admitted");
  const cId = JSON.parse(Buffer.from(c.body.grant.token.split(".")[1], "base64url").toString()).sub;
  expect((await owner.post(`/meetings/${meeting.id}/participants`, { action: "remove", identity: cId })).status).toBe(200);
  // After a removal, even an open link makes guests wait for a host.
  expect((await guest("join", { token: openToken, name: "Cy Again" })).body.state).toBe("waiting");

  // Revoked: gone. Names are cleaned and bounded.
  expect((await guest("join", { token: openToken, name: "x".repeat(61) })).status).toBe(400);
  expect((await owner.del(`/meetings/${meeting.id}/guest-link`)).status).toBe(200);
  expect((await guest("lookup", { token: openToken })).status).toBe(404);
  expect((await guest("join", { token: openToken, name: "Late" })).status).toBe(404);

  // Ended: every guest secret stops working.
  await owner.post(`/meetings/${meeting.id}/end`, {});
  expect((await guest("status", { secret: c.body.secret })).body).toEqual({ state: "ended" });
});

/* ------------------------------------------------------------ CRM relation */

test("CRM relation: a meeting never opens the lead, and the lead never opens the meeting", async () => {
  const [manager, seller, otherManager] = await Promise.all(["mv11", "mvs", "mv12"].map(Client.login));
  const sellersLead = await createLead(seller, "Seller Lead Co");
  const managersLead = await createLead(manager, "Private Lead Co");

  // A Sales Executive can't link a lead they can't read.
  expect((await standalone(seller, { relatedRecordId: managersLead.id })).status).toBe(400);
  expect((await standalone(manager, { relatedRecordId: "NOPE-1" })).status).toBe(400);

  // Manager: a private meeting about their own lead, inviting the seller.
  const planned = await manager.post("/meetings", { mode: "schedule", media: "video", title: "Meeting with Private Lead Co", scheduledAt: inMinutes(60), inviteeIds: [seller.id], relatedRecordId: managersLead.id });
  expect(planned.status).toBe(201);
  const id = planned.body.meeting.id;
  expect(planned.body.meeting.related).toEqual({ id: managersLead.id, kind: "leads", title: "Private Lead Co" });
  // The invited seller sees the meeting but not the lead, and can't read it through the meeting.
  const sellerView = (await seller.get(`/meetings/${id}`)).body;
  expect(sellerView.meeting.related).toBeNull();
  expect(JSON.stringify(sellerView)).not.toContain(managersLead.id);
  expect(JSON.stringify((await seller.get("/meetings")).body)).not.toContain(managersLead.id);
  expect((await seller.request("GET", `/api/records?id=${managersLead.id}`)).status).toBe(404);
  expect((await seller.get(`/meetings?recordId=${managersLead.id}`)).status).toBe(404);
  expect((await seller.request("PATCH", "/api/records", { action: "note", id: managersLead.id, text: "sneaky" })).status).not.toBe(200);
  // Another manager can read the lead — but not the private meeting about it.
  expect((await otherManager.request("GET", `/api/records?id=${managersLead.id}`)).status).toBe(200);
  expect((await otherManager.get(`/meetings/${id}`)).status).toBe(404);
  expect((await otherManager.get(`/meetings?recordId=${managersLead.id}`)).body.meetings).toEqual([]);
  // The lead's own meetings, for someone who may see both.
  expect((await manager.get(`/meetings?recordId=${managersLead.id}`)).body.meetings.map((m: any) => m.id)).toEqual([id]);

  // Start now, standalone, about the seller's own lead: the seller sees it linked.
  const now = await standalone(seller, { title: "Meeting with Seller Lead Co", relatedRecordId: sellersLead.id });
  expect(now.body.meeting).toMatchObject({ scope: "standalone", conversationId: null, related: { id: sellersLead.id, kind: "leads" } });
  await seller.post(`/meetings/${now.body.meeting.id}/end`, {});
  // The report is reachable from the lead, and carries the link for its reader.
  const report = (await seller.get(`/meetings/${now.body.meeting.id}/report`)).body;
  expect(report.meeting.related).toMatchObject({ id: sellersLead.id });

  // Log outcome: the ordinary, audited record update — a note plus the follow-up date.
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  expect((await seller.request("PATCH", "/api/records", { action: "note", id: sellersLead.id, text: 'Meeting "Meeting with Seller Lead Co": agreed a trial order', due })).status).toBe(200);
  const record = (await seller.request("GET", `/api/records?id=${sellersLead.id}`)).body.record;
  expect(record.due).toBe(due);
  expect(record.notes.at(-1).text).toContain("agreed a trial order");
  // The record history (MD's view) shows the audited change.
  const audit = (await (await Client.login("admin")).request("GET", "/api/records")).body.audit as any[];
  expect(audit.find((a) => a.recordId === sellersLead.id && a.action === "Logged activity and scheduled follow-up")).toBeTruthy();
  await manager.patch(`/meetings/${id}`, { cancel: true });
});

/* ----------------------------------------------------- real media, browsers */

async function signedIn(browser: Browser, key: string, viewport = { width: 1280, height: 860 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], bypassCSP: true, acceptDownloads: true });
  await client.signInBrowser(context);
  return { client, context, page: await context.newPage() };
}

async function joinFromPrejoin(page: Page) {
  await expect(page.locator(".meet-prejoin-head")).toBeVisible();
  await expect(page.locator(".meet-prejoin select").first()).toBeEnabled();
  // Friendly device names only — never a raw device id.
  const options = await page.locator(".meet-prejoin select option").allTextContents();
  expect(options.length).toBeGreaterThan(0);
  for (const o of options) expect(o).not.toMatch(HEX_ID);
  await page.locator(".meet-prejoin .meet-join").click();
  await expect(page.locator(".meet-controls")).toBeVisible();
}

test("guest in a private window: waiting room, admit, camera and mic, decline; then the report", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await signedIn(browser, "mv1");
  const absent = await Client.login("mv3");
  const lead = await createLead(host.client, "Waiting Room Trading");
  const meeting = (await standalone(host.client, { title: "=Guest demo", inviteeIds: [absent.id], relatedRecordId: lead.id, guestAccess: "admit" })).body.meeting;
  const link = (await host.client.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "admit" })).body.url as string;

  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  await expect(host.page.getByRole("heading", { name: "=Guest demo" })).toBeVisible();
  await expect(host.page.locator(".meet-facts")).toContainText("Waiting Room Trading");
  await host.page.getByRole("button", { name: "Join", exact: true }).click();
  await joinFromPrejoin(host.page);

  // A private window: no cookies, no CRM session.
  const guestContext = await browser.newContext({ permissions: ["camera", "microphone"], bypassCSP: true });
  const g = await guestContext.newPage();
  await g.goto(`/meet/${tokenOf(link)}`);
  await expect(g.getByRole("heading", { name: "=Guest demo" })).toBeVisible();
  await expect(g.locator("body")).not.toContainText("Waiting Room Trading");
  await g.getByLabel("Your name").fill("Gina Guest");
  await g.getByRole("button", { name: "Join meeting" }).click();
  await expect(g.getByText("Waiting for the host to let you in.")).toBeVisible();

  // The host sees them waiting and admits them.
  const waiting = host.page.getByRole("region", { name: "Guests waiting" });
  await expect(waiting).toContainText("Gina Guest");
  await waiting.getByRole("button", { name: "Admit" }).click();
  await expect(g.locator(".meet-controls")).toBeVisible({ timeout: 20_000 });
  for (const p of [host.page, g]) await expect(p.locator(".meet-tile")).toHaveCount(2, { timeout: 20_000 });
  // The guest's camera and microphone reach the host.
  await expect.poll(() => host.page.locator(".meet-tile video").evaluateAll((vs) => vs.filter((v) => (v as HTMLVideoElement).readyState >= 2).length), { timeout: 20_000 }).toBe(2);
  await host.page.getByRole("button", { name: "Participants" }).click();
  await expect(host.page.locator(".meet-person", { hasText: "Gina Guest" })).toContainText("Guest");
  // Nothing about the CRM in the guest's window, and no way in.
  await expect(g.locator("body")).not.toContainText("Waiting Room Trading");
  expect(await guestContext.cookies()).toEqual([]);
  expect(await g.evaluate(async () => (await fetch("/api/records")).status)).toBe(401);
  expect(await g.evaluate(async (id) => (await fetch(`/api/collab/meetings/${id}`)).status, meeting.id)).toBe(401);

  // A second guest is declined.
  const second = await browser.newContext({ permissions: ["camera", "microphone"], bypassCSP: true });
  const s = await second.newPage();
  await s.goto(`/meet/${tokenOf(link)}`);
  await s.getByLabel("Your name").fill("Dan Declined");
  await s.getByRole("button", { name: "Join meeting" }).click();
  await expect(host.page.locator(".meet-person.is-waiting", { hasText: "Dan Declined" })).toBeVisible();
  await host.page.locator(".meet-person.is-waiting", { hasText: "Dan Declined" }).getByRole("button", { name: "Decline" }).click();
  await expect(s.getByRole("heading", { name: "The host didn't let you in" })).toBeVisible({ timeout: 15_000 });

  // Recording isn't configured here: plainly unavailable, never a live control.
  const more = host.page.getByRole("button", { name: "More options" });
  await more.click();
  await expect(host.page.getByRole("menuitem", { name: "Recording isn't set up" })).toBeDisabled();
  await expect(host.page.getByRole("menuitem", { name: "Record meeting" })).toHaveCount(0);
  // The More menu closes on Escape and on a click outside it.
  await host.page.keyboard.press("Escape");
  await expect(host.page.locator(".meet-menu")).toHaveCount(0);
  await more.click();
  await expect(host.page.locator(".meet-menu")).toBeVisible();
  await host.page.locator(".meet-stage").click({ position: { x: 5, y: 5 } });
  await expect(host.page.locator(".meet-menu")).toHaveCount(0);

  // The guest leaves; the host ends it.
  await g.getByRole("button", { name: "Leave meeting" }).click();
  await expect(g.getByRole("heading", { name: "You left the meeting" })).toBeVisible();
  await expect(host.page.locator(".meet-tile")).toHaveCount(1, { timeout: 20_000 });
  await host.page.getByRole("button", { name: "More options" }).click();
  await host.page.getByRole("menuitem", { name: "End meeting for everyone" }).click();
  // A deliberate confirmation: everyone, guests included, is disconnected.
  await host.page.getByRole("dialog", { name: "End the meeting for everyone?" }).getByRole("button", { name: "End for everyone" }).click();
  await expect(host.page.getByRole("heading", { name: "The meeting has ended" })).toBeVisible({ timeout: 20_000 });

  // The report: guest and organiser attended; the invitee didn't.
  await expect
    .poll(async () => ((await host.client.get(`/meetings/${meeting.id}/report`)).body.participants as any[]).map((p) => `${p.kind}:${p.name}`).sort())
    .toEqual(["guest:Gina Guest", "internal:Mina Vee1"]);
  const report = (await host.client.get(`/meetings/${meeting.id}/report`)).body;
  expect(report.absent.map((p: any) => p.id)).toEqual([absent.id]);
  for (const p of report.participants) {
    expect(p.sessions).toBeGreaterThanOrEqual(1);
    expect(p.lastLeft).not.toBeNull();
  }

  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}&mview=report`);
  await expect(host.page.getByRole("heading", { name: "Meeting report" })).toBeVisible();
  await expect(host.page.locator(".meet-report-table")).toContainText("Gina Guest");
  await expect(host.page.locator(".meet-report")).toContainText("didn't attend");
  // CSV: formula-safe.
  const [download] = await Promise.all([host.page.waitForEvent("download"), host.page.getByRole("button", { name: "CSV" }).click()]);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Gina Guest");
  expect(csv).not.toMatch(/(^|,)"?=Guest demo/m);
  expect(csv).toContain("'=Guest demo");
  // Print / PDF: only the report prints.
  await host.page.evaluate(() => (window.print = () => void document.documentElement.setAttribute("data-printed", document.documentElement.dataset.printReport ?? "")));
  await host.page.getByRole("button", { name: "Print / PDF" }).click();
  expect(await host.page.evaluate(() => document.documentElement.getAttribute("data-printed"))).toBe("true");
  await host.page.evaluate(() => (document.documentElement.dataset.printReport = "true"));
  await host.page.emulateMedia({ media: "print" });
  await expect(host.page.locator(".meet-report-actions")).toBeHidden();
  await expect(host.page.locator(".meet-report-table")).toBeVisible();
  await host.page.emulateMedia({ media: "screen" });

  await Promise.all([host.context.close(), guestContext.close(), second.close()]);
});

test("lead detail: schedule (prefilled), start now, upcoming and past, report, log outcome", async ({ browser }) => {
  test.setTimeout(150_000);
  const seller = await Client.login("mvs2");
  const name = `Lead Detail Lubricants ${tag()}`;
  const lead = await createLead(seller, name);
  const m = await signedIn(browser, "mv2");
  await m.page.goto("/?module=leads");
  await m.page.locator(".lead-card", { hasText: name }).click();
  const section = m.page.locator(".record-meetings");
  await expect(section.getByRole("heading", { name: "Meetings" })).toBeVisible();
  await expect(section).toContainText("No meetings about this yet.");

  // Schedule: title and the lead's owner filled in.
  await section.getByRole("button", { name: "Schedule meeting" }).click();
  let dialog = m.page.getByRole("dialog", { name: "Schedule a meeting" });
  await expect(dialog.getByLabel("Title")).toHaveValue(`Meeting with ${name}`);
  await expect(dialog.getByRole("list", { name: "Invited" })).toContainText("Sara Seller");
  await expect(dialog).toContainText("Guests never see CRM details");
  // Unchanged: an outside click closes it.
  await ready(m.page, ".meet-form-dialog");
  await m.page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  // Changed: an outside click keeps it; Escape (deliberate) closes it.
  await section.getByRole("button", { name: "Schedule meeting" }).click();
  dialog = m.page.getByRole("dialog", { name: "Schedule a meeting" });
  await dialog.getByLabel("Title").fill(`Meeting with ${name} — pricing`);
  await ready(m.page, ".meet-form-dialog");
  await m.page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await m.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Save it for real.
  await section.getByRole("button", { name: "Schedule meeting" }).click();
  dialog = m.page.getByRole("dialog", { name: "Schedule a meeting" });
  await dialog.getByRole("button", { name: "Create meeting" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(section.locator(".record-meetings-group", { hasText: "Upcoming" })).toContainText(`Meeting with ${name}`);
  // The owner was invited and sees the lead linked.
  const scheduled = (await seller.get(`/meetings?recordId=${lead.id}`)).body.meetings[0];
  expect(scheduled).toMatchObject({ status: "scheduled", related: { id: lead.id } });

  // Start now: a standalone meeting, straight to the pre-join screen.
  await section.getByRole("button", { name: "Start now" }).click();
  dialog = m.page.getByRole("dialog", { name: "Start a meeting" });
  await dialog.getByRole("button", { name: "Start meeting" }).click();
  await joinFromPrejoin(m.page);
  const live = ((await m.client.get(`/meetings?recordId=${lead.id}`)).body.meetings as any[]).find((x) => x.status === "live");
  expect(live).toMatchObject({ scope: "standalone", conversationId: null });
  await m.page.getByRole("button", { name: "More options" }).click();
  await m.page.getByRole("menuitem", { name: "End meeting for everyone" }).click();
  // A deliberate confirmation: everyone, guests included, is disconnected.
  await m.page.getByRole("dialog", { name: "End the meeting for everyone?" }).getByRole("button", { name: "End for everyone" }).click();
  await expect(m.page.getByRole("heading", { name: "The meeting has ended" })).toBeVisible({ timeout: 20_000 });
  // Back to Enercore: the lead is open again, where they left it.
  await m.page.getByRole("button", { name: "Back to Enercore" }).click();
  await expect(m.page.getByRole("dialog", { name })).toBeVisible();

  // Past, with its report, from the lead.
  const past = section.locator(".record-meetings-group", { hasText: "Past" });
  await expect(past).toContainText("Ended", { timeout: 15_000 });
  await past.getByRole("button", { name: "Report" }).click();
  await expect(m.page.getByRole("heading", { name: "Meeting report" })).toBeVisible();
  await expect(m.page.locator(".meet-facts")).toContainText(name);

  // Log outcome from the meeting: an audited note on the lead.
  await m.page.goto(`${HUB}?tab=meetings&meeting=${live.id}`);
  await m.page.getByRole("button", { name: "Log outcome" }).click();
  const outcome = m.page.getByRole("dialog", { name: "Log meeting outcome" });
  await outcome.getByLabel("Outcome and notes").fill("Agreed a trial of 5 MT");
  await outcome.getByRole("button", { name: "Save outcome" }).click();
  await expect(m.page.getByRole("status")).toContainText("Outcome saved to the lead");
  const record = (await seller.request("GET", `/api/records?id=${lead.id}`)).body.record;
  expect(record.notes.at(-1).text).toContain("Agreed a trial of 5 MT");
  expect(((await (await Client.login("admin")).request("GET", "/api/records")).body.audit as any[]).some((a) => a.recordId === lead.id && a.action === "Added note")).toBe(true);
  await m.client.patch(`/meetings/${scheduled.id}`, { cancel: true });
  await m.context.close();
});

/**
 * The popover is open and listening: focus has moved into it, and the
 * outside-click listener it adds on the next timer tick is attached (timers
 * run in order, so one more tick here comes after it). Chromium runs input
 * ahead of timers, so a test — unlike a person — could otherwise click first.
 */
async function ready(page: Page, layer = ".meet-start-menu") {
  await expect(page.locator(`${layer}:focus-within`)).toHaveCount(1);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

test("the Start menu and New meeting close on an outside click and on Escape", async ({ browser }) => {
  const a = await signedIn(browser, "mv4");
  const room = await a.client.createRoom({ name: "Menu room" });
  await a.page.goto(`${HUB}?c=${room.id}`);
  const start = a.page.getByRole("button", { name: "Start meeting" });
  await start.click();
  await expect(a.page.getByRole("menuitem", { name: "Video meeting" })).toBeVisible();
  await ready(a.page);
  await a.page.mouse.click(5, 400);
  await expect(a.page.getByRole("menuitem", { name: "Video meeting" })).toHaveCount(0);
  await start.click();
  await ready(a.page);
  await a.page.keyboard.press("Escape");
  await expect(a.page.getByRole("menuitem", { name: "Video meeting" })).toHaveCount(0);

  await a.page.goto(`${HUB}?tab=meetings`);
  await a.page.getByRole("button", { name: "New meeting" }).click();
  const dialog = a.page.getByRole("dialog", { name: "New meeting" });
  await expect(dialog).toBeVisible();
  await ready(a.page, ".meet-form-dialog");
  await a.page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await a.page.getByRole("button", { name: "New meeting" }).click();
  await dialog.getByLabel("Title").fill("Half-typed");
  await ready(a.page, ".meet-form-dialog");
  await a.page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await a.context.close();
});

test("Meetings, details, report, a lead's meetings and the guest page fit 390, 768, 1024 and 1440", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await Client.login("mv8");
  const lead = await createLead(owner, `Responsive Lead ${tag()}`);
  const meeting = (await standalone(owner, { title: "A rather long meeting title to test wrapping at every width", relatedRecordId: lead.id, guestAccess: "admit" })).body.meeting;
  const link = (await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "admit" })).body.url as string;
  await owner.post(`/meetings/${meeting.id}/end`, {});
  const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  for (const width of [390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await owner.signInBrowser(context);
    const page = await context.newPage();
    await page.goto(`${HUB}?tab=meetings`);
    await expect(page.locator(".meet-row").first()).toBeVisible();
    expect(await fits(page), `list @${width}`).toBe(true);
    await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
    await expect(page.getByRole("button", { name: "View report" })).toBeVisible();
    expect(await fits(page), `details @${width}`).toBe(true);
    await page.getByRole("button", { name: "View report" }).click();
    await expect(page.getByRole("heading", { name: "Meeting report" })).toBeVisible();
    await expect(page.locator(".meet-report")).toContainText("Nobody joined.");
    expect(await fits(page), `report @${width}`).toBe(true);
    await page.goto("/?module=leads");
    await page.locator(".lead-card", { hasText: lead.title }).click();
    await expect(page.locator(".record-meetings")).toContainText("A rather long meeting title");
    expect(await fits(page), `lead @${width}`).toBe(true);
    await context.close();
    // The guest page, in a private window (the meeting is over: its link says so).
    const guestContext = await browser.newContext({ viewport: { width, height: 900 } });
    const g = await guestContext.newPage();
    await g.goto(`/meet/${tokenOf(link)}`);
    await expect(g.getByRole("heading", { name: "This link can't be used" })).toBeVisible();
    expect(await fits(g), `guest @${width}`).toBe(true);
    await guestContext.close();
  }
});
