import { test, expect, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { Client } from "./client";
import { WORKER } from "./people";

/**
 * Sharing a meeting: the GUEST link (/meet/<token>, for people outside
 * Enercore, organisers only) versus the INTERNAL link (Collaboration,
 * sign-in required) — over the API, in the Meetings list and details, and
 * inside the meeting — then the real external flow from a copied link in a
 * private window.
 *
 * People: gl1–gl6 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";
const GUEST_URL = /^http:\/\/localhost:8788\/meet\/[A-Za-z0-9_-]{43}$/;
const tokenOf = (url: string) => url.split("/meet/")[1];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

const standalone = (client: Client, body: Record<string, unknown>) =>
  client.post("/meetings", { mode: "now", media: "video", title: "Link test", inviteeIds: [], ...body });
const lookup = (token: string) =>
  fetch(`${WORKER}/api/meet/lookup`, { method: "POST", headers: { Origin: WORKER, "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then((r) => r.status);

test("the guest link: organisers only, /meet/<token>, shown again on any device, admission never loosened", async () => {
  const [owner, invitee] = await Promise.all(["gl1", "gl2"].map(Client.login));
  const meeting = (await standalone(owner, { title: "Pricing call", inviteeIds: [invitee.id] })).body.meeting;

  // None yet; only the organiser may even ask.
  expect((await owner.get(`/meetings/${meeting.id}/guest-link`)).body).toEqual({ link: null, allowed: true, admission: "admit" });
  expect((await invitee.get(`/meetings/${meeting.id}/guest-link`)).status).toBe(403);
  expect((await invitee.post(`/meetings/${meeting.id}/guest-link`, {})).status).toBe(403);

  // Create & copy with no choices: host must admit, until the meeting ends.
  const created = await owner.post(`/meetings/${meeting.id}/guest-link`, {});
  expect(created.status).toBe(200);
  expect(created.body).toMatchObject({ admission: "admit", untilMeetingEnd: true });
  expect(created.body.url).toMatch(GUEST_URL);
  const token = tokenOf(created.body.url);
  expect(token).not.toBe(meeting.id);
  expect(await lookup(token)).toBe(200);

  // The organiser gets the same link back later (another device, the list, the meeting)…
  const again = (await owner.get(`/meetings/${meeting.id}/guest-link`)).body;
  expect(again.link).toMatchObject({ active: true, url: created.body.url });
  expect((await owner.get(`/meetings/${meeting.id}`)).body.guestLink.url).toBe(created.body.url);
  // …never its hash; and nobody else sees it at all.
  for (const body of [again, (await owner.get(`/meetings/${meeting.id}`)).body]) expect(JSON.stringify(body)).not.toContain(sha256(token));
  const inviteeView = (await invitee.get(`/meetings/${meeting.id}`)).body;
  expect(inviteeView.guestLink).toBeNull();
  expect(JSON.stringify(inviteeView)).not.toContain(token);
  expect(JSON.stringify((await invitee.get("/meetings")).body)).not.toContain(token);

  // Regenerating kills the old link; revoking kills the new one.
  const fresh = (await owner.post(`/meetings/${meeting.id}/guest-link`, {})).body.url;
  expect(fresh).not.toBe(created.body.url);
  expect(await lookup(token)).toBe(404);
  expect(await lookup(tokenOf(fresh))).toBe(200);
  expect((await owner.del(`/meetings/${meeting.id}/guest-link`)).status).toBe(200);
  expect(await lookup(tokenOf(fresh))).toBe(404);
  expect((await owner.get(`/meetings/${meeting.id}/guest-link`)).body.link).toBeNull();

  // A meeting set to "anyone with the link" stays that way; one set to admit stays admit.
  const open = (await standalone(owner, { guestAccess: "open" })).body.meeting;
  expect((await owner.post(`/meetings/${open.id}/guest-link`, {})).body.admission).toBe("open");
  const admit = (await standalone(owner, { guestAccess: "admit" })).body.meeting;
  expect((await owner.post(`/meetings/${admit.id}/guest-link`, {})).body.admission).toBe("admit");

  // Over: the link stops working and none can be made.
  const last = (await owner.post(`/meetings/${meeting.id}/guest-link`, {})).body.url;
  await owner.post(`/meetings/${meeting.id}/end`, {});
  expect(await lookup(tokenOf(last))).toBe(404);
  expect((await owner.get(`/meetings/${meeting.id}/guest-link`)).body).toMatchObject({ link: null, allowed: false });
  expect((await owner.post(`/meetings/${meeting.id}/guest-link`, {})).status).toBe(409);
  for (const m of [open, admit]) await owner.post(`/meetings/${m.id}/end`, {});
  // Cancelled: the same.
  const planned = (await owner.post("/meetings", { mode: "schedule", media: "video", title: "Later", scheduledAt: new Date(Date.now() + 3600_000).toISOString(), inviteeIds: [] })).body.meeting;
  const plannedLink = (await owner.post(`/meetings/${planned.id}/guest-link`, {})).body.url;
  expect(await lookup(tokenOf(plannedLink))).toBe(200);
  await owner.patch(`/meetings/${planned.id}`, { cancel: true });
  expect(await lookup(tokenOf(plannedLink))).toBe(404);
});

/* ------------------------------------------------------------- browsers */

async function signedIn(browser: Browser, key: string, viewport = { width: 1280, height: 860 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], bypassCSP: true });
  await client.signInBrowser(context);
  return { client, context, page: await context.newPage() };
}
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

async function joinFromPrejoin(page: Page) {
  await expect(page.locator(".meet-prejoin-head")).toBeVisible();
  await page.locator(".meet-prejoin .meet-join").click();
  await expect(page.locator(".meet-controls")).toBeVisible();
}

test("Meetings list and details: organisers copy the guest link (created on the spot); others the internal link", async ({ browser }) => {
  const host = await signedIn(browser, "gl3");
  const member = await signedIn(browser, "gl4");
  const meeting = (await standalone(host.client, { title: `Share me ${Date.now()}`, inviteeIds: [member.client.id] })).body.meeting;

  await host.page.goto(`${HUB}?tab=meetings`);
  const row = host.page.locator(".meet-row", { hasText: meeting.title });
  await expect(row.getByRole("button", { name: "Join", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Details" })).toBeVisible();
  // No link yet: one confirmation creates and copies it.
  await row.getByRole("button", { name: "Copy meeting link" }).click();
  const ask = host.page.getByRole("dialog", { name: "Create guest link?" });
  await expect(ask).toContainText("You admit each guest");
  await ask.getByRole("button", { name: "Create & copy" }).click();
  await expect(ask).toHaveCount(0);
  const copied = await clipboard(host.page);
  expect(copied).toMatch(GUEST_URL);
  await expect(host.page.getByRole("status")).toContainText("Guest link copied");
  // Next time: straight to the clipboard, the same link.
  await host.page.evaluate(() => navigator.clipboard.writeText(""));
  await row.getByRole("button", { name: "Copy meeting link" }).click();
  await expect.poll(() => clipboard(host.page)).toBe(copied);

  // Details: the guest link, labelled for clients; the internal link separately.
  await row.getByRole("button", { name: "Details" }).click();
  await expect(host.page.getByRole("textbox", { name: "Guest link" })).toHaveValue(copied);
  await expect(host.page.locator(".meet-details")).toContainText("For clients and other people outside Enercore");
  await host.page.getByRole("button", { name: "Copy internal link" }).click();
  await expect.poll(() => clipboard(host.page)).toBe(`http://localhost:8788${HUB}?tab=meetings&meeting=${meeting.id}`);

  // An invited colleague: the internal link only; never the guest link.
  await member.page.goto(`${HUB}?tab=meetings`);
  const theirs = member.page.locator(".meet-row", { hasText: meeting.title });
  await expect(theirs.getByRole("button", { name: "Copy meeting link" })).toHaveCount(0);
  await theirs.getByRole("button", { name: "Copy internal link" }).click();
  await expect.poll(() => clipboard(member.page)).toBe(`http://localhost:8788${HUB}?tab=meetings&meeting=${meeting.id}`);
  await theirs.getByRole("button", { name: "Details" }).click();
  await expect(member.page.getByRole("heading", { name: meeting.title })).toBeVisible();
  await expect(member.page.getByRole("region", { name: "Guest link" }).or(member.page.getByRole("textbox", { name: "Guest link" }))).toHaveCount(0);
  await expect(member.page.locator("body")).not.toContainText(tokenOf(copied));

  await host.client.post(`/meetings/${meeting.id}/end`, {});
  await Promise.all([host.context.close(), member.context.close()]);
});

test("inside the meeting: Copy meeting link and Meeting info; the copied link lets a private-window guest in", async ({ browser }) => {
  test.setTimeout(150_000);
  const host = await signedIn(browser, "gl5");
  const lead = await host.client.request("POST", "/api/records", {
    kind: "leads", title: `Link Lead ${Date.now()}`, company: "Petronik", branch: "Main", contact: "", product: "Base Oil",
    quantity: 1, unit: "MT", amount: 0, currency: "USD", due: new Date().toISOString().slice(0, 10), detail: "", source: "",
  });
  const leadTitle = lead.body.record.title as string;
  const meeting = (await standalone(host.client, { title: "Client review", relatedRecordId: lead.body.record.id })).body.meeting;
  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  await host.page.getByRole("button", { name: "Join", exact: true }).click();
  await joinFromPrejoin(host.page);

  // Near the top: title, "Secure meeting", Copy meeting link, Meeting info.
  const top = host.page.locator(".meet-top");
  await expect(top).toContainText("Client review");
  await expect(top).toContainText("Secure meeting");
  await top.getByRole("button", { name: "Copy meeting link" }).click();
  const ask = host.page.getByRole("dialog", { name: "Create guest link?" });
  await ask.getByRole("button", { name: "Create & copy" }).click();
  await expect.poll(() => clipboard(host.page)).toMatch(GUEST_URL);
  const link = await clipboard(host.page);
  expect(link).not.toContain(meeting.id);

  await top.getByRole("button", { name: "Meeting info" }).click();
  const info = host.page.getByRole("dialog", { name: "Meeting information" });
  await expect(info).toContainText("Gil Link5");
  await expect(info).toContainText("you admit each one");
  await expect(info.getByLabel("Meeting link")).toHaveValue(link);
  await expect(info.getByRole("button", { name: "Open meeting details" })).toBeVisible();
  await host.page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);

  // The copied link, in a private window with no Enercore cookies at all.
  const incognito = await browser.newContext({ permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], bypassCSP: true });
  const g = await incognito.newPage();
  await g.goto(link);
  expect(new URL(g.url()).pathname).toBe(`/meet/${tokenOf(link)}`); // not /login
  await expect(g.getByText("Enercore Meeting")).toBeVisible();
  await expect(g.getByRole("heading", { name: "Client review" })).toBeVisible();
  await expect(g.getByLabel("Your name")).toBeVisible();
  await expect(g.getByLabel("Your camera preview")).toBeVisible();
  await expect(g.locator(".device-select-label", { hasText: /^Camera$/ })).toBeVisible();
  await expect(g.locator(".device-select-label", { hasText: /^Microphone$/ })).toBeVisible();
  await expect(g.getByRole("button", { name: "Join meeting" })).toBeVisible();
  await g.getByLabel("Your name").fill("Ahmed");
  await g.getByRole("button", { name: "Join meeting" }).click();
  await expect(g.getByText("Waiting for the host to let you in.")).toBeVisible();
  const waiting = host.page.getByRole("region", { name: "Guests waiting" });
  await expect(waiting).toContainText("Ahmed is waiting");
  await waiting.getByRole("button", { name: "Admit" }).click();
  await expect(g.locator(".meet-controls")).toBeVisible({ timeout: 20_000 });
  for (const p of [host.page, g]) await expect(p.locator(".meet-tile")).toHaveCount(2, { timeout: 20_000 });

  // The guest's own view: the link they came with, nothing about the CRM.
  await g.getByRole("button", { name: "Meeting info" }).click();
  const theirs = g.getByRole("dialog", { name: "Meeting information" });
  await expect(theirs).toContainText("Joined as a guest");
  await expect(theirs.getByLabel("Meeting link")).toHaveValue(link);
  await expect(theirs.getByRole("button", { name: "Open meeting details" })).toHaveCount(0);
  await expect(g.locator("body")).not.toContainText(leadTitle);
  await expect(g.locator("body")).not.toContainText("Petronik");
  await g.keyboard.press("Escape");
  await g.getByRole("button", { name: "Copy meeting link" }).click();
  await expect.poll(() => clipboard(g)).toBe(link);
  // Zero CRM access: no cookies, every CRM API refuses.
  expect(await incognito.cookies()).toEqual([]);
  for (const path of ["/api/records", "/api/collab/conversations", `/api/collab/meetings/${meeting.id}`, `/api/collab/meetings/${meeting.id}/guest-link`, "/api/notifications"])
    expect(await g.evaluate(async (p) => (await fetch(p)).status, path), path).toBe(401);

  await host.client.post(`/meetings/${meeting.id}/end`, {});
  await Promise.all([host.context.close(), incognito.close()]);
});

test("phones: Meeting info opens as a bottom sheet", async ({ browser }) => {
  const host = await signedIn(browser, "gl6", { width: 390, height: 844 });
  const meeting = (await standalone(host.client, { title: "Phone share" })).body.meeting;
  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  await host.page.getByRole("button", { name: "Join", exact: true }).click();
  await joinFromPrejoin(host.page);
  const top = host.page.locator(".meet-top");
  await expect(top.getByRole("button", { name: "Copy meeting link" })).toBeVisible();
  await top.getByRole("button", { name: "Meeting info" }).click();
  const sheet = host.page.getByRole("dialog", { name: "Meeting information" });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(await host.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await sheet.getByRole("button", { name: "Close meeting information" }).click();
  await expect(sheet).toHaveCount(0);
  await host.client.post(`/meetings/${meeting.id}/end`, {});
  await host.context.close();
});
