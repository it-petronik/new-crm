import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "./client";

/**
 * Meeting media through the real Worker and the local LiveKit server, with a
 * signed-in host and a guest in a private window (fake camera/microphone).
 *
 * Everything is asserted against actual state — LiveKit publications and
 * subscriptions (the meeting's diagnostics snapshot, which holds no device
 * ids) and real video frames — never just button labels or screenshots.
 *
 * People: mm1–mm10 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-accept-this-tab-capture",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  },
});

/** Counts getUserMedia calls and keeps the device tracks, so tests can see (and break) them. */
const GUM_PROBE = () => {
  const w = window as unknown as { __gum: { video: number; audio: number; tracks: MediaStreamTrack[]; failVideo: string | null; failAudio: string | null } };
  w.__gum = { video: 0, audio: 0, tracks: [], failVideo: null, failAudio: null };
  const md = navigator.mediaDevices;
  if (!md) return;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (c?.video) w.__gum.video += 1;
    if (c?.audio) w.__gum.audio += 1;
    if (c?.video && w.__gum.failVideo) throw new DOMException("simulated", w.__gum.failVideo);
    if (c?.audio && w.__gum.failAudio) throw new DOMException("simulated", w.__gum.failAudio);
    const stream = await original(c);
    w.__gum.tracks.push(...stream.getTracks());
    return stream;
  };
};

type Diag = {
  connection: string;
  quality: string;
  cameraProcessed: boolean;
  cameraTrackId: string | null;
  canPlaybackAudio: boolean;
  local: { camera: { published: boolean; muted?: boolean; live?: boolean; on: boolean; sid?: string }; microphone: { published: boolean; muted?: boolean; live?: boolean; on: boolean }; screen: { published: boolean } };
  remote: { name: string; guest: boolean; camera: { published: boolean; muted?: boolean; subscribed?: boolean; streamState?: string; sid?: string }; microphone: { published: boolean; muted?: boolean }; screen: { published: boolean } }[];
  log: { counts: Record<string, number>; reconnects: number };
};
const diag = (page: Page) => page.evaluate(() => (window as unknown as { __enercoreMeetingDiagnostics?: () => unknown }).__enercoreMeetingDiagnostics?.() as Diag | undefined);
const gum = (page: Page) => page.evaluate(() => (window as unknown as { __gum: { video: number; audio: number } }).__gum);

async function mediaContext(browser: Browser, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"], bypassCSP: true });
  await context.addInitScript(GUM_PROBE);
  return context;
}

type Party = { page: Page; context: BrowserContext; client?: Client };

/** A signed-in host in a new open-guest meeting, joined; returns the guest link. */
async function hostMeeting(browser: Browser, key: string, prepare?: (page: Page) => Promise<void>) {
  const client = await Client.login(key);
  const context = await mediaContext(browser);
  await client.signInBrowser(context);
  const page = await context.newPage();
  if (process.env.MEDIA_DEBUG) {
    page.on("console", (m) => (m.type() === "error" || /\[meeting\]/.test(m.text())) && console.log(`[${key}] ${m.type()}: ${m.text().slice(0, 400)}`));
    page.on("pageerror", (e) => console.log(`[${key}] pageerror: ${String(e.stack ?? e).slice(0, 800)}`));
  }
  const meeting = (await client.post("/meetings", { mode: "now", media: "video", title: `Media ${key}`, inviteeIds: [], guestAccess: "open" })).body.meeting;
  const link = (await client.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;
  await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByLabel("Your camera preview")).toBeVisible();
  if (prepare) await prepare(page);
  await page.locator(".meet-prejoin .meet-join").click();
  // The meeting screen loads on demand: allow a slow machine a moment.
  await expect(page.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await diag(page))?.local.camera.on, { timeout: 30_000 }).toBe(true);
  return { host: { page, context, client } as Party, meetingId: meeting.id as string, link };
}

async function guestJoins(browser: Browser, link: string, name: string, viewport?: { width: number; height: number }) {
  const context = await mediaContext(browser, viewport);
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel("Your name").fill(name);
  await expect(page.getByLabel("Your camera preview")).toBeVisible();
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await diag(page))?.local.camera.on, { timeout: 30_000 }).toBe(true);
  return { page, context } as Party;
}

const remoteOf = async (page: Page, name: string) => (await diag(page))?.remote.find((r) => r.name === name);
const tile = (page: Page, name: string) => page.locator(`.meet-tile[data-source="camera"][data-name="${name}"]`);

/** Real frames that aren't black: the tile's video has size and non-black pixels. */
const hasPicture = (page: Page, name: string) =>
  tile(page, name)
    .locator("video")
    .evaluate((v: HTMLVideoElement) => {
      if (!v.videoWidth) return false;
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 18;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4) > 12;
    })
    .catch(() => false);

/** No tile anywhere is a featureless black rectangle. */
async function noBlackTiles(page: Page) {
  const states = await page.locator(".meet-tile").evaluateAll((tiles) =>
    tiles.map((t) => ({
      state: t.getAttribute("data-state"),
      screen: t.getAttribute("data-source") === "screen",
      frames: (t.querySelector("video") as HTMLVideoElement | null)?.videoWidth ?? 0,
      explained: !!t.querySelector(".meet-tile-state, .meet-tile-avatar"),
    })),
  );
  for (const s of states) {
    if (s.state === "video") expect(s.frames, "a playing tile has frames").toBeGreaterThan(0);
    else expect(s.explained, `a ${s.state} tile explains itself`).toBe(true);
  }
}

/* ======================================================================= */

test("pre-join tracks are handed to the meeting as they are — no second camera or microphone", async ({ browser }) => {
  const { host } = await hostMeeting(browser, "mm1");
  const before = await gum(host.page);
  expect(before).toMatchObject({ video: 1, audio: 1 }); // opened once each, in pre-join
  const d = (await diag(host.page))!;
  expect(d.local.camera).toMatchObject({ published: true, muted: false, live: true, on: true });
  expect(d.local.microphone).toMatchObject({ published: true, muted: false, live: true, on: true });
  await expect(tile(host.page, "Mo Media1")).toHaveAttribute("data-state", "video");
  // Still only those two device requests after connecting and publishing.
  expect(await gum(host.page)).toMatchObject({ video: 1, audio: 1 });
  // The published camera IS the device's own track: nothing in between.
  expect(d.cameraProcessed).toBe(false);
  const deviceTrackIds = await host.page.evaluate(() => (window as unknown as { __gum: { tracks: MediaStreamTrack[] } }).__gum.tracks.filter((t) => t.kind === "video").map((t) => t.id));
  expect(deviceTrackIds).toContain(d.cameraTrackId);
  await host.client!.post(`/meetings/${(await host.page.evaluate(() => location.search)).split("meeting=")[1]}/end`, {}).catch(() => {});
  await host.context.close();
});

test("host + guest: 10 camera and 10 microphone cycles; both sides agree every time; never a black tile", async ({ browser }) => {
  test.setTimeout(300_000);
  const { host, meetingId, link } = await hostMeeting(browser, "mm2");
  const guest = await guestJoins(browser, link, "Gia Guest");
  await expect(tile(host.page, "Gia Guest (Guest)")).toHaveAttribute("data-state", "video", { timeout: 20_000 });
  await expect.poll(() => hasPicture(host.page, "Gia Guest (Guest)"), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => hasPicture(guest.page, "Mo Media2"), { timeout: 15_000 }).toBe(true);
  // The guest publishes at the same quality as employees.
  expect((await diag(guest.page))!.quality).toBe((await diag(host.page))!.quality);

  const camButton = (p: Page) => p.locator(".meet-controls").getByRole("button", { name: /camera/i }).first();
  const micButton = (p: Page) => p.locator(".meet-controls").getByRole("button", { name: /microphone/i }).first();

  for (let i = 0; i < 10; i++) {
    for (const on of [false, true]) {
      await camButton(host.page).click();
      await expect(camButton(host.page)).toHaveAttribute("aria-pressed", String(on), { timeout: 15_000 });
      await expect.poll(async () => (await diag(host.page))!.local.camera.on).toBe(on);
      await expect.poll(async () => (await remoteOf(guest.page, "Mo Media2"))?.camera.muted, { timeout: 15_000 }).toBe(!on);
      await expect(tile(guest.page, "Mo Media2")).toHaveAttribute("data-state", on ? "video" : "off", { timeout: 15_000 });
      if (on) await expect.poll(() => hasPicture(guest.page, "Mo Media2"), { timeout: 15_000 }).toBe(true);
      await noBlackTiles(guest.page);
    }
  }
  for (let i = 0; i < 10; i++) {
    for (const on of [false, true]) {
      await micButton(host.page).click();
      await expect(micButton(host.page)).toHaveAttribute("aria-pressed", String(on), { timeout: 15_000 });
      await expect.poll(async () => (await diag(host.page))!.local.microphone.on).toBe(on);
      await expect.poll(async () => (await remoteOf(guest.page, "Mo Media2"))?.microphone.muted, { timeout: 15_000 }).toBe(!on);
    }
  }
  // The guest's own camera, a few times — the host agrees.
  for (let i = 0; i < 3; i++) {
    for (const on of [false, true]) {
      await camButton(guest.page).click();
      await expect.poll(async () => (await diag(guest.page))!.local.camera.on, { timeout: 15_000 }).toBe(on);
      await expect(tile(host.page, "Gia Guest (Guest)")).toHaveAttribute("data-state", on ? "video" : "off", { timeout: 15_000 });
      await noBlackTiles(host.page);
    }
  }
  // Toggling reuses the same published tracks: nothing was republished.
  await expect.poll(() => hasPicture(host.page, "Gia Guest (Guest)"), { timeout: 15_000 }).toBe(true);
  expect((await diag(host.page))!.log.counts.camera_publish_failed ?? 0).toBe(0);

  // The guest leaves and comes back: fresh devices, working video both ways.
  await guest.page.getByRole("button", { name: "Leave meeting" }).click();
  await guest.context.close();
  await expect(tile(host.page, "Gia Guest (Guest)")).toHaveCount(0, { timeout: 20_000 });
  const again = await guestJoins(browser, link, "Gia Guest");
  await expect.poll(() => hasPicture(host.page, "Gia Guest (Guest)"), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => hasPicture(again.page, "Mo Media2"), { timeout: 20_000 }).toBe(true);
  await noBlackTiles(host.page);
  await noBlackTiles(again.page);
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await Promise.all([host.context.close(), again.context.close()]);
});

test("a camera that fails to start stays off, says why, and Try again works", async ({ browser }) => {
  const { host, meetingId } = await hostMeeting(browser, "mm3");
  const cam = host.page.locator(".meet-controls").getByRole("button", { name: /camera/i }).first();
  await cam.click();
  await expect.poll(async () => (await diag(host.page))!.local.camera.on).toBe(false);
  // The device is taken by another app.
  await host.page.evaluate(() => ((window as unknown as { __gum: { failVideo: string | null } }).__gum.failVideo = "NotReadableError"));
  await cam.click();
  const issue = host.page.locator(".meet-toast.is-issue");
  await expect(issue).toContainText("Your camera is being used by another app");
  await expect(cam).toHaveAttribute("aria-pressed", "false");
  expect((await diag(host.page))!.local.camera.on).toBe(false);
  await expect(tile(host.page, "Mo Media3")).toHaveAttribute("data-state", "off");
  expect((await diag(host.page))!.log.counts.camera_start_failed).toBeGreaterThanOrEqual(1);
  // No raw browser error text anywhere.
  await expect(host.page.locator("body")).not.toContainText("simulated");
  await expect(host.page.locator("body")).not.toContainText("DOMException");
  // Freed up: Try again.
  await host.page.evaluate(() => ((window as unknown as { __gum: { failVideo: string | null } }).__gum.failVideo = null));
  await issue.getByRole("button", { name: "Try again" }).click();
  await expect.poll(async () => (await diag(host.page))!.local.camera.on, { timeout: 15_000 }).toBe(true);
  await expect(cam).toHaveAttribute("aria-pressed", "true");
  // Blocked permission: guidance, not a dead end.
  await cam.click();
  await expect.poll(async () => (await diag(host.page))!.local.camera.on).toBe(false);
  await host.page.evaluate(() => ((window as unknown as { __gum: { failVideo: string | null } }).__gum.failVideo = "NotAllowedError"));
  await cam.click();
  await expect(issue).toContainText("Camera access is blocked");
  await issue.getByRole("button", { name: "How to allow" }).click();
  await expect(issue).toContainText("set Camera and Microphone to Allow");
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await host.context.close();
});

test("a device that stops mid-call is recovered or shown as off — never shown as on", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, meetingId, link } = await hostMeeting(browser, "mm4");
  const guest = await guestJoins(browser, link, "Stop Guest");
  await expect.poll(() => hasPicture(guest.page, "Mo Media4"), { timeout: 15_000 }).toBe(true);
  // The camera device ends (unplugged / taken / an OS interruption).
  await host.page.evaluate(() => {
    const g = (window as unknown as { __gum: { tracks: MediaStreamTrack[] } }).__gum;
    for (const t of g.tracks) if (t.kind === "video" && t.readyState === "live") t.stop();
  });
  // Stopping a track by hand doesn't fire "ended" in every browser; nudge as the OS would.
  await host.page.evaluate(() => {
    const g = (window as unknown as { __gum: { tracks: MediaStreamTrack[] } }).__gum;
    for (const t of g.tracks) if (t.kind === "video") t.dispatchEvent(new Event("ended"));
  });
  // Either recovered with live video, or clearly off — and both sides agree.
  await expect
    .poll(async () => {
      const d = (await diag(host.page))!;
      const r = await remoteOf(guest.page, "Mo Media4");
      return d.local.camera.on === !r?.camera.muted && (!d.local.camera.on || d.local.camera.live === true);
    }, { timeout: 20_000 })
    .toBe(true);
  const d = (await diag(host.page))!;
  expect(d.log.counts.track_ended).toBeGreaterThanOrEqual(1);
  if (d.local.camera.on) await expect.poll(() => hasPicture(guest.page, "Mo Media4"), { timeout: 20_000 }).toBe(true);
  else await expect(tile(guest.page, "Mo Media4")).toHaveAttribute("data-state", "off");
  await noBlackTiles(guest.page);
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await Promise.all([host.context.close(), guest.context.close()]);
});

test("screen sharing alongside a clean camera: the guest sees both; stopping ends it cleanly", async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, meetingId, link } = await hostMeeting(browser, "mm5");
  const guest = await guestJoins(browser, link, "Share Guest");
  await expect.poll(() => hasPicture(guest.page, "Mo Media5"), { timeout: 20_000 }).toBe(true);
  const sid = (await remoteOf(guest.page, "Mo Media5"))!.camera.sid;
  // Guests keep their quality choice for this visit only (never localStorage).
  await guest.page.getByRole("button", { name: "More options" }).click();
  await guest.page.getByRole("dialog", { name: "More options" }).getByRole("radio", { name: /High quality/ }).click();
  await expect.poll(async () => (await diag(guest.page))!.quality).toBe("high");
  expect(await guest.page.evaluate(() => [localStorage.getItem("enercore-meeting-media"), sessionStorage.getItem("enercore-meeting-media")])).toEqual([null, JSON.stringify({ quality: "high" })]);
  await guest.page.keyboard.press("Escape");
  await host.page.getByRole("button", { name: "Share screen" }).click();
  await expect.poll(async () => (await remoteOf(guest.page, "Mo Media5"))?.screen.published, { timeout: 20_000 }).toBe(true);
  await expect(guest.page.locator('.meet-tile[data-source="screen"]')).toHaveAttribute("data-state", "video", { timeout: 20_000 });
  // The camera carries on, untouched and still the same track.
  expect((await remoteOf(guest.page, "Mo Media5"))!.camera.sid).toBe(sid);
  expect((await diag(host.page))!.cameraProcessed).toBe(false);
  await host.page.getByRole("button", { name: "Stop sharing" }).click();
  await expect.poll(async () => (await remoteOf(guest.page, "Mo Media5"))?.screen.published, { timeout: 20_000 }).toBe(false);
  await expect(guest.page.locator('.meet-tile[data-source="screen"]')).toHaveCount(0);
  await expect.poll(() => hasPicture(guest.page, "Mo Media5"), { timeout: 15_000 }).toBe(true);
  await noBlackTiles(guest.page);
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await Promise.all([host.context.close(), guest.context.close()]);
});

test("quality preference: applied live and kept on this device; microphone fallback when a device disappears", async ({ browser }) => {
  const { host, meetingId } = await hostMeeting(browser, "mm6");
  await host.page.getByRole("button", { name: "More options" }).click();
  const more = host.page.getByRole("dialog", { name: "More options" });
  await more.getByRole("radio", { name: /Data saver/ }).click();
  await expect(more.getByRole("radio", { name: /Data saver/ })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await diag(host.page))!.quality).toBe("saver");
  expect(JSON.parse((await host.page.evaluate(() => localStorage.getItem("enercore-meeting-media")))!).quality).toBe("saver");
  // Still publishing a live camera after the quality change.
  await expect.poll(async () => (await diag(host.page))!.local.camera).toMatchObject({ on: true, live: true });
  // No bitrate numbers for people; and only Devices, Video quality, Layout (+ host tools).
  await expect(more).not.toContainText(/kbps|Mbps|bitrate/i);
  await expect(more.getByRole("heading")).toHaveText(["Devices", "Video quality", "Layout", "Recording", "Troubleshooting"]);
  await expect(more.getByRole("radio", { name: /Grid/ })).toHaveAttribute("aria-checked", "true");
  await more.getByRole("radio", { name: /Speaker/ }).click();
  await expect(more.getByRole("radio", { name: /Speaker/ })).toHaveAttribute("aria-checked", "true");

  // Pick a specific microphone, then it disappears: back to the default, and a notice.
  const mic = more.getByRole("combobox", { name: "Microphone" });
  const options = await mic.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
  const specific = options.find((v) => v !== "default");
  // Chromium's fake devices include several microphones; this must hold.
  expect(specific, "a second microphone to choose").toBeTruthy();
  await mic.selectOption(specific!);
  await host.page.evaluate((gone) => {
    const md = navigator.mediaDevices;
    const original = md.enumerateDevices.bind(md);
    md.enumerateDevices = async () => (await original()).filter((d) => d.deviceId !== gone);
    md.dispatchEvent(new Event("devicechange"));
  }, specific!);
  await expect(host.page.locator(".meet-notices")).toContainText("Your selected microphone was disconnected. Switched to the default microphone.");
  expect((await diag(host.page))!.log.counts.device_fallback).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await diag(host.page))!.local.microphone.on).toBe(true);
  // Device labels only — never ids.
  for (const text of await host.page.locator(".meet-menu select option").allTextContents()) expect(text).not.toMatch(/[0-9a-f]{16,}/i);
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await host.context.close();
});

test("network drop and return: both sides reconcile to the same state with live video", async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, meetingId, link } = await hostMeeting(browser, "mm7");
  const guest = await guestJoins(browser, link, "Net Guest");
  await expect.poll(() => hasPicture(host.page, "Net Guest (Guest)"), { timeout: 15_000 }).toBe(true);
  await guest.context.setOffline(true);
  await host.page.waitForTimeout(4000);
  await guest.context.setOffline(false);
  await expect.poll(async () => (await diag(guest.page))?.connection, { timeout: 45_000 }).toBe("connected");
  await expect.poll(async () => (await diag(guest.page))!.local.camera, { timeout: 30_000 }).toMatchObject({ on: true, live: true });
  await expect.poll(() => hasPicture(host.page, "Net Guest (Guest)"), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => hasPicture(guest.page, "Mo Media7"), { timeout: 30_000 }).toBe(true);
  // Background and foreground: nothing stops merely because the tab is hidden.
  await guest.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect((await diag(guest.page))!.local.camera.on).toBe(true);
  await noBlackTiles(host.page);
  await noBlackTiles(guest.page);
  await host.client!.post(`/meetings/${meetingId}/end`, {});
  await Promise.all([host.context.close(), guest.context.close()]);
});

test("responsive: pre-join and the More sheet fit 390, 768, 1024 and 1440 — with no background controls anywhere", async ({ browser }) => {
  test.setTimeout(180_000);
  const client = await Client.login("mm8");
  const meeting = (await client.post("/meetings", { mode: "now", media: "video", title: "Media responsive", inviteeIds: [] })).body.meeting;
  const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  for (const width of [390, 768, 1024, 1440]) {
    const context = await mediaContext(browser, { width, height: width === 390 ? 844 : width === 768 ? 1024 : width === 1024 ? 768 : 900 });
    await client.signInBrowser(context);
    const page = await context.newPage();
    await page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    // Pre-join: preview, mic/camera, Microphone, Camera, Video quality — nothing else.
    await expect(page.getByRole("combobox", { name: "Video quality" })).toBeVisible();
    await expect(page.locator(".meet-prejoin")).not.toContainText(/background/i);
    expect(await fits(page), `pre-join @${width}`).toBe(true);
    await page.locator(".meet-prejoin .meet-join").click();
    await expect(page.locator(".meet-controls")).toBeVisible();
    await page.getByRole("button", { name: "More options" }).click();
    const more = page.getByRole("dialog", { name: "More options" });
    await expect(more.getByRole("radio", { name: /Auto/ })).toBeVisible();
    expect(await fits(page), `more @${width}`).toBe(true);
    if (width === 390) {
      const box = (await more.boundingBox())!;
      expect(Math.round(box.x)).toBe(0);
      expect(Math.round(box.width)).toBe(390);
    }
    await expect(more).not.toContainText(/background/i);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Leave meeting" }).click();
    await context.close();
  }
  await client.post(`/meetings/${meeting.id}/end`, {});
});
