import { test, expect } from "@playwright/test";
import { Client } from "./client";

/**
 * Voice notes in Chromium with a fake microphone. Denied permission and an
 * unsupported browser are simulated deterministically. Safari's MP4
 * recording cannot be automated here and stays a manual production check.
 * People used here: w11–w12 (exclusive to this file).
 */

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  permissions: ["microphone"],
});

const HUB = "/workspace/all-companies/collaboration";

test("record → preview → send; discard; the note plays with a duration", async ({ page, context }) => {
  const client = await Client.login("w11");
  await client.signInBrowser(context);
  const room = await client.createRoom({ name: "Voice room" });
  await page.goto(`${HUB}?c=${room.id}`);

  // Discard first.
  await page.getByRole("button", { name: "Record voice message" }).click();
  await expect(page.getByRole("group", { name: "Voice message" })).toContainText(/Recording \d:\d\d/);
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect(page.getByRole("button", { name: "Record voice message" })).toBeVisible();

  // Record ~2 s, stop, preview, send.
  await page.getByRole("button", { name: "Record voice message" }).click();
  await expect(page.getByRole("group", { name: "Voice message" })).toContainText("Recording 0:0");
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("button", { name: "Play voice message" })).toBeVisible();
  await page.getByRole("button", { name: "Send voice message" }).click();

  const note = page.locator(".collab-msg .collab-voice");
  await expect(note).toBeVisible();
  await expect(note.locator(".collab-voice-time")).toHaveText(/0:0[1-3]/);
  // Stored with its duration, served as audio, seekable.
  const message = (await client.page(room.id)).body.messages.at(-1);
  const audio = message.attachments[0];
  expect(audio.kind).toBe("audio");
  expect(audio.durationMs).toBeGreaterThan(1500);
  const ranged = await client.file(audio.url, { Range: "bytes=0-15" });
  expect(ranged.status).toBe(206);
  expect(ranged.headers.get("content-type")).toMatch(/^audio\//);
  // Never autoplays: the element only loads on demand.
  await expect(page.locator(".collab-msg audio")).toHaveAttribute("preload", "none");
});

test("microphone denied, and a browser without recording, fail clearly", async ({ browser }) => {
  const client = await Client.login("w12");
  const room = await client.createRoom({ name: "Denied room" });

  const denied = await browser.newContext();
  await client.signInBrowser(denied);
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  const page = await denied.newPage();
  await page.goto(`${HUB}?c=${room.id}`);
  await page.getByRole("button", { name: "Record voice message" }).click();
  await expect(page.getByRole("group", { name: "Voice message" }).getByRole("alert")).toContainText("Microphone access was blocked");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await denied.close();

  const unsupported = await browser.newContext();
  await client.signInBrowser(unsupported);
  await unsupported.addInitScript(() => {
    // @ts-expect-error simulating a browser without MediaRecorder
    delete window.MediaRecorder;
  });
  const old = await unsupported.newPage();
  await old.goto(`${HUB}?c=${room.id}`);
  await expect(old.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  // No broken control is offered; sending text still works.
  await expect(old.getByRole("button", { name: "Record voice message" })).toHaveCount(0);
  await unsupported.close();
});
