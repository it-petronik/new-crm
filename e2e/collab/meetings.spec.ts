import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";
import { byKey, WORKER } from "./people";

/**
 * Meetings V3 through the real Worker, D1, CollabHub and a LiveKit dev server
 * on this machine (started by collab-test-server.sh): authorisation and the
 * start race over the API, then real media in two browsers with fake
 * cameras and microphones. Nothing here reaches production or LiveKit Cloud.
 *
 * People: mt1–mt13, mtd, mtf, mtx (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";

// Fake camera and microphone, and an auto-accepted screen picker, for every
// browser in this file (the API-only tests simply never use them).
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Entire screen"],
  },
});
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

async function startNow(client: Client, conversationId: string, media: "video" | "voice" = "video") {
  return client.post(`/conversations/${conversationId}/meetings`, { mode: "now", media });
}
const join = (client: Client, meetingId: string) => client.post(`/meetings/${meetingId}/join`, {});

/* -------------------------------------------------------------- the API */

test("Start: one live meeting per room, even when everyone presses it at once", async () => {
  const people = await Promise.all(["mt1", "mt2", "mt3", "mt4", "mt5"].map(Client.login));
  const room = await people[0].createRoom({ name: "Race room", members: ["mt2", "mt3", "mt4", "mt5"] });
  const results = await Promise.all(people.map((p) => startNow(p, room.id)));
  for (const r of results) expect([200, 201]).toContain(r.status);
  const ids = new Set(results.map((r) => r.body.meeting.id));
  expect(ids.size).toBe(1);
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  // Pressing it again later: the same meeting.
  const again = await startNow(people[1], room.id);
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ existing: true, meeting: { id: [...ids][0], status: "live" } });
  const list = (await people[2].get(`/conversations/${room.id}/meetings`)).body;
  expect(list.meetings.filter((m: { status: string }) => m.status === "live")).toHaveLength(1);
  expect(list.available).toBe(true);
});

test("join tokens: server-side, 10 minutes, one person and one room, only for current readers", async () => {
  const [owner, member, outsider, dubai, abroad, leaver] = await Promise.all(["mt6", "mt7", "mt8", "mtd", "mtf", "mtx"].map(Client.login));
  const admin = await Client.login("admin");
  const room = await owner.createRoom({ name: "Scope room", members: ["mt7", "mtd", "mtx"] });
  const meeting = (await startNow(owner, room.id)).body.meeting;

  const a = await join(owner, meeting.id);
  const b = await join(member, meeting.id);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(a.body).toMatchObject({ serverUrl: "ws://127.0.0.1:7880", expiresIn: 600, identity: owner.id, host: true });
  expect(b.body).toMatchObject({ identity: member.id, host: false });
  const [ca, cb] = [claims(a.body.token), claims(b.body.token)];
  expect(ca.exp - ca.nbf).toBeLessThanOrEqual(610);
  expect(ca.sub).toBe(owner.id);
  expect(cb.sub).toBe(member.id);
  expect(ca.video.room).toBe(cb.video.room); // the same meeting room…
  expect(ca.video.room).toMatch(/^enc-[0-9a-f]{32}$/); // …named randomly
  expect(ca.video.roomAdmin).toBeUndefined();
  expect(JSON.stringify(a.body)).not.toContain("secret");

  // Everyone else gets the same "not found" as a meeting that does not exist.
  const missing = await join(member, "0000000001aaaaaaaaaaaa");
  expect(missing).toEqual({ status: 404, body: { error: "Meeting not found." } });
  for (const who of [outsider, abroad]) expect(await join(who, meeting.id)).toEqual(missing);
  expect((await outsider.get(`/meetings/${meeting.id}`)).status).toBe(404);

  // A member moved to another company loses the meeting with the room.
  expect((await join(dubai, meeting.id)).status).toBe(200);
  await admin.moveUser("mtd", ["Afrilube"], []);
  const moved = await Client.login("mtd");
  expect(await join(moved, meeting.id)).toEqual(missing);
  await admin.moveUser("mtd", ["Petronik"], ["Dubai"]);

  // Removed from the room: no new token.
  await owner.del(`/conversations/${room.id}/members?userId=${member.id}`);
  expect(await join(member, meeting.id)).toEqual(missing);

  // Deactivated: the session is gone, so nothing is issued at all.
  await admin.updateUser("mtx", { active: false });
  expect((await join(leaver, meeting.id)).status).toBe(401);
  await admin.updateUser("mtx", { active: true });
});

test("organiser controls, end for everyone, and a scheduled meeting's lifecycle", async () => {
  const [owner, member] = await Promise.all(["mt9", "mt10"].map(Client.login));
  const room = await owner.createRoom({ name: "Plans room", members: ["mt10"] });
  const live = (await startNow(owner, room.id)).body.meeting;
  // A member can't end it for everyone, nor moderate.
  expect((await member.post(`/meetings/${live.id}/end`, {})).status).toBe(403);
  expect((await member.post(`/meetings/${live.id}/participants`, { action: "remove", identity: owner.id })).status).toBe(403);
  expect((await member.post(`/meetings/${live.id}/leave`, {})).status).toBe(200);
  expect((await owner.post(`/meetings/${live.id}/end`, {})).status).toBe(200);
  expect((await join(member, live.id)).status).toBe(410);

  // Scheduled: announced and notified, not joinable early, cancellable by its organiser.
  const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const planned = await owner.post(`/conversations/${room.id}/meetings`, { mode: "schedule", media: "video", title: "Quarterly review", scheduledAt: at, durationMin: 60 });
  expect(planned.status).toBe(201);
  expect(planned.body.meeting).toMatchObject({ status: "scheduled", title: "Quarterly review", durationMin: 60 });
  await expect
    .poll(async () => ((await member.request("GET", "/api/notifications")).body.items as { type: string; target: { meetingId?: string } }[]).find((n) => n.type === "meeting.scheduled")?.target?.meetingId)
    .toBe(planned.body.meeting.id);
  expect(await join(member, planned.body.meeting.id)).toMatchObject({ status: 409 });
  expect((await member.patch(`/meetings/${planned.body.meeting.id}`, { cancel: true })).status).toBe(403);
  expect((await owner.patch(`/meetings/${planned.body.meeting.id}`, { cancel: true })).status).toBe(200);
  // In the past, or unknown fields: refused.
  expect((await owner.post(`/conversations/${room.id}/meetings`, { mode: "schedule", media: "video", title: "Late", scheduledAt: new Date(Date.now() - 3_600_000).toISOString() })).status).toBe(400);
  expect((await owner.post(`/conversations/${room.id}/meetings`, { mode: "now", media: "video", providerRoom: "mine" })).status).toBe(400);
});

test("forged or unsigned webhooks are rejected", async () => {
  const body = JSON.stringify({ event: "room_finished", room: { name: "enc-anything" } });
  for (const authorization of [undefined, "Bearer not-a-jwt", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJkZXZrZXkifQ.AAAA"]) {
    const response = await fetch(`${WORKER}/api/meetings/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/webhook+json", ...(authorization ? { Authorization: authorization } : {}) },
      body,
    });
    expect(response.status).toBe(401);
  }
});

/* ------------------------------------------------------------ real media */

async function meetingBrowser(browser: Browser, key: string, viewport = { width: 1280, height: 800 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({
    viewport,
    permissions: ["camera", "microphone"],
    // The local LiveKit dev server is ws://127.0.0.1:7880, which the
    // production CSP (LiveKit Cloud only) deliberately does not allow.
    bypassCSP: true,
  });
  await client.signInBrowser(context);
  const page = await context.newPage();
  return { client, context, page };
}

test.describe("with cameras and microphones", () => {
  const joinFromPrejoin = async (page: Page) => {
    const prejoin = page.getByRole("dialog").filter({ has: page.locator(".meet-prejoin-head") });
    await expect(prejoin).toBeVisible();
    await page.locator(".meet-prejoin .meet-join").click();
    await expect(page.locator(".meet-controls")).toBeVisible();
  };

  test("room meeting: pre-join, two people, controls, chat, leave, end for everyone", async ({ browser }) => {
    test.setTimeout(150_000);
    const a = await meetingBrowser(browser, "mt11");
    const b = await meetingBrowser(browser, "mt12");
    const room = await a.client.createRoom({ name: "Media room", members: ["mt12"] });
    await a.page.goto(`${HUB}?c=${room.id}`);

    // Start → pre-join: camera preview, mic level, toggles, device choice.
    await a.page.getByRole("button", { name: "Start meeting" }).click();
    await a.page.getByRole("menuitem", { name: "Video meeting" }).click();
    const preview = a.page.getByLabel("Your camera preview");
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
    await expect(a.page.locator(".meet-level")).toBeVisible();
    await a.page.getByRole("button", { name: "Turn camera off" }).click();
    await expect(a.page.getByText("Camera is off")).toBeVisible();
    await a.page.getByRole("button", { name: "Turn camera on" }).click();
    await expect(preview).toBeVisible();
    await a.page.getByRole("button", { name: "Turn microphone off" }).click();
    await a.page.getByRole("button", { name: "Turn microphone on" }).click();
    await expect(a.page.getByRole("combobox").first()).toBeEnabled();
    await joinFromPrejoin(a.page);
    await expect(a.page.locator(".meet-tile")).toHaveCount(1);

    // B sees it in the conversation and joins.
    await b.page.goto(`${HUB}?c=${room.id}`);
    await expect(b.page.locator(".meet-banner.is-live")).toContainText("in progress");
    await b.page.locator(".meet-banner").getByRole("button", { name: "Join" }).click();
    await joinFromPrejoin(b.page);
    for (const p of [a.page, b.page]) await expect(p.locator(".meet-tile")).toHaveCount(2, { timeout: 20_000 });
    // Real video from the other side.
    await expect.poll(() => a.page.locator(".meet-tile video").evaluateAll((vs) => vs.filter((v) => (v as HTMLVideoElement).readyState >= 2).length), { timeout: 20_000 }).toBe(2);

    // Participants: both, with the organiser marked.
    await a.page.getByRole("button", { name: "Participants" }).click();
    const people = a.page.locator(".meet-people");
    await expect(people.locator(".meet-person")).toHaveCount(2);
    await expect(people).toContainText("Organiser");

    // B mutes: A sees it. B turns the camera off: A sees the avatar.
    await b.page.getByRole("button", { name: "Mute microphone" }).click();
    await expect(people.locator(".meet-person", { hasText: "Maya Meet12" }).getByLabel("Microphone off")).toBeVisible();
    await b.page.getByRole("button", { name: "Turn camera off" }).click();
    await expect(people.locator(".meet-person", { hasText: "Maya Meet12" }).getByLabel("Camera off")).toBeVisible();
    await b.page.getByRole("button", { name: "Unmute microphone" }).click();

    // Chat in the meeting is the room's chat.
    await a.page.getByRole("button", { name: "Chat", exact: true }).click();
    await a.page.locator(".meet-chat-form textarea").fill("Hello from the meeting");
    await a.page.getByRole("button", { name: "Send message" }).click();
    await expect(a.page.locator(".meet-chat-list")).toContainText("Hello from the meeting");
    await expect.poll(async () => (await b.client.page(room.id)).body.messages.at(-1)?.body).toBe("Hello from the meeting");

    // Screen sharing starts, leads the stage, and stops.
    await a.page.getByRole("button", { name: "Share screen" }).click();
    await expect(a.page.getByRole("button", { name: "Stop sharing" })).toBeVisible({ timeout: 15_000 });
    await expect(b.page.locator(".meet-featured .meet-tile.is-screen")).toBeVisible({ timeout: 20_000 });
    await expect(b.page.getByRole("button", { name: "Share screen" })).toBeDisabled();
    await a.page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(b.page.locator(".meet-tile.is-screen")).toHaveCount(0, { timeout: 20_000 });

    // Presence: B shows "In a meeting" to someone outside it.
    const observer = await Client.login("mt13");
    await expect
      .poll(async () => (await observer.get(`/presence?ids=${b.client.id}`)).body.presence[b.client.id]?.inMeeting, { timeout: 20_000 })
      .toBe(true);

    // B leaves; A is alone again. A ends it for everyone.
    await b.page.getByRole("button", { name: "Leave meeting" }).click();
    await expect(b.page.locator(".meet-controls")).toHaveCount(0);
    await expect(a.page.locator(".meet-tile")).toHaveCount(1, { timeout: 20_000 });
    await a.page.getByRole("button", { name: "More options" }).click();
    await a.page.getByRole("menuitem", { name: "End meeting for everyone" }).click();
    // A deliberate confirmation: everyone, guests included, is disconnected.
    await a.page.getByRole("dialog", { name: "End the meeting for everyone?" }).getByRole("button", { name: "End for everyone" }).click();
    await expect(a.page.getByRole("heading", { name: "The meeting has ended" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await a.client.get(`/conversations/${room.id}/meetings`)).body.meetings[0]?.status).toBe("ended");
    // History records both people.
    const history = (await a.client.get(`/conversations/${room.id}/meetings`)).body.meetings[0];
    expect(history.participants.map((p: { name: string }) => p.name).sort()).toEqual(["Maya Meet11", "Maya Meet12"]);
    await a.context.close();
    await b.context.close();
  });

  test("DM calls ring the other person; a voice call starts with the camera off", async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await meetingBrowser(browser, "mt1");
    const b = await meetingBrowser(browser, "mt3");
    const dm = (await a.client.openDirect("mt3")).body.conversation;
    await b.page.goto("/");
    await a.page.goto(`${HUB}?c=${dm.id}`);
    // The header offers both kinds of call.
    await expect(a.page.getByRole("button", { name: "Video call" })).toBeVisible();
    await a.page.getByRole("button", { name: "Voice call" }).click();
    await expect(a.page.getByText("Voice call — camera off")).toBeVisible();

    // B, elsewhere in the CRM, is rung — and no camera or mic starts.
    const ring = b.page.getByRole("alertdialog");
    await expect(ring).toContainText("Maya Meet1");
    await expect(ring).toContainText("Voice call");
    expect(await b.page.evaluate(() => document.querySelectorAll("video").length)).toBe(0);
    // The ringing card, not a duplicate toast.
    await expect(b.page.locator(".notify-toast")).toHaveCount(0);
    // …and the call is in the inbox for later.
    await expect.poll(async () => ((await b.client.request("GET", "/api/notifications")).body.items as { type: string }[]).some((n) => n.type === "meeting.invited")).toBe(true);

    await ring.getByRole("button", { name: "Answer" }).click();
    await expect(b.page.getByText("Voice call — camera off")).toBeVisible();
    await joinFromPrejoin(b.page);
    await expect(b.page.getByRole("button", { name: "Turn camera on" })).toBeVisible();
    await a.page.locator(".meet-prejoin .meet-join").click();
    for (const p of [a.page, b.page]) await expect(p.locator(".meet-tile")).toHaveCount(2, { timeout: 20_000 });
    // Nobody is sending video in a voice call.
    expect(await b.page.locator(".meet-tile video").count()).toBe(0);
    await b.page.getByRole("button", { name: "Leave meeting" }).click();
    await a.page.getByRole("button", { name: "Leave meeting" }).click();
    await a.context.close();
    await b.context.close();
  });

  test("the meeting at 390px: pre-join, controls, people sheet, no overflow", async ({ browser }) => {
    test.setTimeout(90_000);
    const a = await meetingBrowser(browser, "mt5", { width: 390, height: 844 });
    const room = await a.client.createRoom({ name: "Phone room" });
    const meeting = (await startNow(a.client, room.id)).body.meeting;
    await a.page.goto(`${HUB}?c=${room.id}`);
    await a.page.locator(".meet-banner").getByRole("button", { name: "Join" }).click();
    await expect(a.page.getByLabel("Your camera preview")).toBeVisible();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await joinFromPrejoin(a.page);
    const controls = a.page.locator(".meet-controls");
    // Large controls, all reachable.
    for (const name of ["Mute microphone", "Turn camera off", "Participants", "Chat", "Leave meeting"]) {
      const box = await controls.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await a.page.getByRole("button", { name: "Participants" }).click();
    const sheet = a.page.locator(".meet-panel");
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.x + box.width)).toBe(390);
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.getByRole("button", { name: "Close panel" }).click();
    await a.page.getByRole("button", { name: "Leave meeting" }).click();
    await a.client.post(`/meetings/${meeting.id}/end`, {});
    await a.context.close();
  });
});

test("a meeting notification opens the pre-join screen, never the camera by itself", async ({ browser }) => {
  const owner = await Client.login("mt6");
  const member = await Client.login("mt2");
  const room = await owner.createRoom({ name: "Notify room", members: ["mt2"] });
  const meeting = (await startNow(owner, room.id)).body.meeting;
  const context = await browser.newContext();
  await member.signInBrowser(context);
  const page = await context.newPage();
  await page.goto("/?view=notifications");
  const row = page.locator(".notify-row", { hasText: "Video meeting started" }).filter({ hasText: "Notify room" });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll("video").length)).toBe(0);
  await row.locator(".notify-main").click();
  await expect(page.locator(".meet-prejoin-head")).toContainText(meeting.title);
  await page.getByRole("button", { name: "Close" }).click();
  await owner.post(`/meetings/${meeting.id}/end`, {});
  await context.close();
  expect(byKey("mt2").companies).toEqual(["Petronik"]);
});
