import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";
import { callSounds, probeCallAudio } from "./call-audio-probe";

const HUB = "/workspace/all-companies/collaboration";
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const diagnostics = (page: Page) => page.evaluate(() => (window as unknown as { __enercoreMeetingDiagnostics?: () => { connection: string; local: { camera: { on: boolean }; microphone: { on: boolean } }; remote: unknown[] } }).__enercoreMeetingDiagnostics?.());
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

test("bounded priorities, left/right bubbles and readable AI results on desktop and phones", async ({ browser }) => {
  const actor = await Client.login("studio");
  const peer = await Client.login("cmsales");
  const room = await actor.createRoom({ name: "Compact design review", company: "Petronik", members: ["cmsales"] });
  await peer.send(room.id, "The quotation is ready. Please review the quantities and delivery terms.");
  await actor.send(room.id, "Thanks. I will review it before our call.");
  await peer.send(room.id, "Perfect — the updated delivery date is in the quotation.");
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await actor.signInBrowser(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/workspace/all-companies/overview");
    await page.getByRole("button", { name: /^My priorities/ }).click();
    const priorities = page.getByRole("region", { name: "Your next moves" });
    await expect(priorities).toBeVisible();
    const size = await priorities.evaluate(e => ({ height: e.clientHeight, scroll: e.scrollHeight }));
    expect(size.height).toBeLessThanOrEqual(width < 640 ? 300 : 380);
    expect(size.scroll).toBeGreaterThan(size.height);
    await priorities.evaluate(e => e.scrollTop = e.scrollHeight);
    await priorities.getByRole("button").last().scrollIntoViewIfNeeded();
    await expect(priorities.getByRole("button").last()).toBeInViewport();
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/compact-priorities-${width}.png` });

    await page.goto(`${HUB}?c=${room.id}`);
    const mine = page.locator(".collab-msg.is-mine .collab-msg-main").first();
    const theirs = page.locator(".collab-msg:not(.is-mine) .collab-msg-main").first();
    await expect(mine).toBeVisible();
    await expect(theirs).toBeVisible();
    await expect(mine).toHaveCSS("justify-self", "end");
    await expect(theirs).toHaveCSS("justify-self", "start");
    const thread = page.locator(".collab-thread");
    expect((await thread.boundingBox())!.height).toBeLessThanOrEqual(844);
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: `test-results/compact-chat-${width}.png` });
    if (width === 1440) {
      await page.getByRole("button", { name: "Summarise with Enercore AI", exact: true }).click();
      const answer = page.getByRole("dialog").locator(".ai-answer");
      await expect(answer).toBeVisible();
      await expect(answer.locator(".ai-result-heading")).toContainText("AI insight");
      await page.screenshot({ path: "test-results/compact-context-ai.png" });
    }
    await page.goto("/workspace/all-companies/enercore-ai");
    await page.getByRole("textbox", { name: "Your question" }).fill("[[route:top_open_deals,,]] What should I focus on?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const answer = page.locator(".ai-turn .ai-answer").first();
    await expect(answer.locator(".ai-summary")).toHaveText("Fake answer from the test model.");
    await expect(answer.locator(".ai-result-heading")).toContainText("Review before use");
    expect((await answer.boundingBox())!.height).toBeLessThanOrEqual(680);
    expect(await fits(page)).toBe(true);
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/compact-ai-${width}.png` });
    if (width === 390) {
      await page.evaluate(() => document.documentElement.dataset.theme = "dark");
      await page.screenshot({ path: "test-results/compact-ai-dark.png" });
      await page.evaluate(() => document.documentElement.dataset.theme = "light");
    }
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("direct calls use a compact screen, real audio/video and end when the other person leaves", async ({ browser }) => {
  const host = await Client.login("mm9"), peer = await Client.login("mm10");
  const direct = await host.openDirect("mm10");
  expect([200, 201]).toContain(direct.status);
  const id = direct.body.conversation.id;
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera", "microphone"] });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  await probeCallAudio(a); await probeCallAudio(b);
  await host.signInBrowser(a); await peer.signInBrowser(b);
  const pa = await a.newPage(), pb = await b.newPage();
  try {
    await pb.goto(`${HUB}?c=${id}`);
    // Normal workspace interaction primes audio before a later invitation.
    await pb.locator(".collab-composer-input").click();
    await pa.goto(`${HUB}?c=${id}`);
    await pa.evaluate(() => document.documentElement.dataset.theme = "light");
    await pa.getByRole("button", { name: "Voice call", exact: true }).click();
    const prejoin = pa.locator('[data-call-layout="prejoin"]');
    await expect(prejoin).toBeVisible();
    await expect(pb.locator(".meet-incoming")).toHaveAttribute("data-ringtone", "playing");
    await expect.poll(async () => (await callSounds(pb)).filter(s => s.running && s.peak > .01).length).toBe(1);
    await pb.screenshot({ path: "test-results/call-incoming-phone.png" });
    await prejoin.getByRole("button", { name: "Turn microphone off" }).click();
    await expect(prejoin.getByRole("button", { name: "Turn microphone on" })).toBeVisible();
    await prejoin.getByRole("button", { name: "Turn microphone on" }).click();
    await prejoin.getByRole("button", { name: "Connect call" }).click();
    await expect(pa.locator('[data-call-layout="direct"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await diagnostics(pa))?.local.microphone.on).toBe(true);
    expect((await diagnostics(pa))?.local.camera.on).toBe(false);
    await expect(pa.locator('[data-call-layout="direct"]')).toHaveAttribute("data-ringback", "playing");
    expect((await callSounds(pa)).some(s => s.running && s.peak > .01)).toBe(true);
    await pa.getByRole("button", { name: "Call settings" }).click();
    const device = pa.locator('[data-call-layout="direct"] .device-select-control').first();
    const lightDevice = await device.evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, token: getComputedStyle(e).getPropertyValue("--e-surface-sunken").trim() }));
    expect(lightDevice.bg).not.toBe("rgb(36, 44, 51)");
    await expect(device.locator("select")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(device.locator("select")).toHaveCSS("border-top-width", "0px");
    await pa.screenshot({ path: "test-results/call-settings-light-desktop.png" });
    await pa.getByRole("button", { name: "Call settings" }).click();
    await pb.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(pb.locator(".meet-incoming")).toHaveCount(0);
    expect((await callSounds(pb)).filter(s => s.running)).toHaveLength(0);
    await pb.getByRole("button", { name: "Connect call" }).click();
    await expect.poll(async () => (await diagnostics(pa))?.remote.length).toBe(1);
    await expect.poll(async () => (await diagnostics(pb))?.local.microphone.on).toBe(true);
    await expect(pa.locator('[data-call-layout="direct"]')).toHaveAttribute("data-ringback", "idle");
    expect((await callSounds(pa)).filter(s => s.running)).toHaveLength(0);
    for (const width of [390, 360, 320]) {
      await pb.setViewportSize({ width, height: 844 });
      const controls = pb.getByRole("group", { name: "Call controls" });
      await expect(controls.getByRole("button")).toHaveCount(5);
      const buttons = await controls.getByRole("button").all();
      for (const button of buttons) {
        await expect(button).toBeInViewport();
        const circle = button.locator("span").first();
        const box = (await circle.boundingBox())!;
        expect(box.width).toBe(56); expect(box.height).toBe(56);
      }
      expect(await fits(pb)).toBe(true);
      await pb.getByRole("button", { name: "Record call", exact: true }).click();
      const dialog = pb.getByRole("dialog", { name: "Call recording", exact: true });
      await expect(dialog.getByRole("heading", { name: "Recording needs setup" })).toBeVisible();
      await expect(dialog).toContainText("not being recorded");
      // The confirmation must be above, not hidden underneath, the call.
      expect(await dialog.evaluate(e => Number(getComputedStyle(e).zIndex))).toBeGreaterThan(200);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await pb.screenshot({ path: `test-results/call-controls-${width}.png` });
    }
    await pb.setViewportSize({ width: 390, height: 844 });
    await pa.screenshot({ path: "test-results/compact-voice-desktop.png" });
    await pb.screenshot({ path: "test-results/compact-voice-phone.png" });
    for (const p of [pa, pb]) {
      await expect(p.locator(".meet-controls")).toHaveCount(0);
      await p.getByRole("button", { name: "Turn camera on", exact: true }).click();
      await expect.poll(async () => (await diagnostics(p))?.local.camera.on).toBe(true);
      expect(await fits(p)).toBe(true);
      await expect(p.getByRole("button", { name: "End call", exact: true })).toBeInViewport();
    }
    for (const p of [pa, pb]) {
      await expect(p.locator('.meet-tile[data-state="video"]')).toHaveCount(2, { timeout: 30_000 });
      await expect.poll(() => p.locator('.meet-tile video').first().evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0)).toBeGreaterThan(0);
    }
    await pa.screenshot({ path: "test-results/compact-video-desktop.png" });
    await pb.screenshot({ path: "test-results/compact-video-phone.png" });
    await pb.getByRole("button", { name: "Call settings" }).click();
    await expect(pb.getByLabel("Call microphone", { exact: true })).toBeVisible();
    expect(await fits(pb)).toBe(true);
    await pb.screenshot({ path: "test-results/call-settings-light-phone.png" });
    await pb.evaluate(() => document.documentElement.dataset.theme = "dark");
    await pb.screenshot({ path: "test-results/call-settings-dark-phone.png" });
    await pb.getByRole("button", { name: "Call settings" }).click();
    await pb.getByRole("button", { name: "End call", exact: true }).click();
    await expect(pa.getByRole("heading", { name: "Call ended", exact: true })).toBeVisible();
    await expect(pb.getByRole("heading", { name: "Call ended", exact: true })).toBeVisible();
    await expect(pa.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(pb.locator("html")).toHaveAttribute("data-theme", "dark");
    const endedLight = await pa.locator(".meet-ended").evaluate(e => getComputedStyle(e).backgroundColor);
    const endedDark = await pb.locator(".meet-ended").evaluate(e => getComputedStyle(e).backgroundColor);
    expect(endedLight).not.toBe(endedDark);
    expect(endedLight).not.toBe("rgb(15, 20, 24)");
    for (const p of [pa, pb]) {
      expect((await callSounds(p)).filter(s => s.running)).toHaveLength(0);
      expect(await fits(p)).toBe(true);
    }
    await pa.screenshot({ path: "test-results/call-ended-light-desktop.png" });
    await pb.screenshot({ path: "test-results/call-ended-dark-phone.png" });
  } finally { await a.close(); await b.close(); }
});
