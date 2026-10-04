import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";
import { setRoomMetadata } from "../../src/lib/livekit";

const HUB = "/workspace/all-companies/collaboration";
// Local provider only. There is no recording storage/egress in this fixture.
const provider = { url: "ws://127.0.0.1:7880", apiKey: "devkey", apiSecret: "secret-for-local-livekit-dev-server-only" };
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

test("call recording requires consent, reports failures and announces provider state to both people", async ({ browser }) => {
  const host = await Client.login("mm7"), peer = await Client.login("mm8"), outsider = await Client.login("af8");
  const direct = await host.openDirect("mm8");
  const conversationId = direct.body.conversation.id;
  // Cleanly close only earlier calls in this test-owned conversation.
  for (const meeting of (await host.get(`/conversations/${conversationId}/meetings`)).body.meetings) {
    if (meeting.status === "live") await host.post(`/meetings/${meeting.id}/end`, {});
  }
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", permissions: ["camera", "microphone"] });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", permissions: ["camera", "microphone"] });
  await host.signInBrowser(a); await peer.signInBrowser(b);
  let meetingId = "", room = "", requests = 0;
  let failStart = true;
  const pa = await a.newPage(), pb = await b.newPage();
  const errors: string[] = [];
  for (const page of [pa, pb]) page.on("pageerror", error => errors.push(error.message));
  // Simulate a configured workspace for this UI test only. Actual recording
  // access/setup is checked against the real API below. No file is fabricated.
  await pa.route("**/api/collab/meetings/*/join", async route => {
    const response = await route.fetch();
    const grant = await response.json();
    expect(response.status()).toBe(200);
    meetingId = grant.meeting.id;
    room = JSON.parse(Buffer.from(grant.token.split(".")[1], "base64url").toString()).video.room;
    await route.fulfill({ response, json: { ...grant, canRecord: true } });
  });
  await pa.route("**/api/collab/meetings/*/recording", async route => {
    requests++;
    const action = route.request().postDataJSON().action;
    if (action === "start" && failStart) {
      failStart = false;
      return route.fulfill({ status: 502, json: { error: "The recording service is unavailable. Try again." } });
    }
    await setRoomMetadata(provider, room, { recording: action === "start" ? { by: host.person.name, at: new Date().toISOString() } : null });
    await route.fulfill({ json: { recording: { id: "simulated-recording-ui-only", status: action === "start" ? "recording" : "processing", url: null } } });
  });
  async function join(page: Page) {
    await page.goto(`${HUB}?c=${conversationId}`);
    await page.getByRole("button", { name: "Voice call", exact: true }).click();
    await page.getByRole("button", { name: "Connect call" }).click();
    await expect(page.locator('[data-call-layout="direct"]')).toBeVisible({ timeout: 30_000 });
  }
  try {
    await join(pa);
    await pa.getByRole("button", { name: "Record call", exact: true }).click();
    let dialog = pa.getByRole("dialog", { name: "Record this call?", exact: true });
    await expect(dialog).toContainText("Wait for the other person");
    await expect(dialog.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await join(pb);
    // Real backend checks: an unrelated person cannot record or discover the
    // call; an allowed person cannot record without configured storage.
    expect((await outsider.post(`/meetings/${meetingId}/recording`, { action: "start" })).status).toBe(404);
    expect((await host.post(`/meetings/${meetingId}/recording`, { action: "start" })).status).toBe(503);
    await pa.getByRole("button", { name: "Record call", exact: true }).click();
    dialog = pa.getByRole("dialog", { name: "Record this call?", exact: true });
    const start = dialog.getByRole("button", { name: "Start recording", exact: true });
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(480);
    await expect(start).toBeDisabled();
    expect(requests).toBe(0);
    await dialog.getByRole("checkbox").check();
    await pa.screenshot({ path: "test-results/call-record-confirmation.png" });
    await start.click();
    await expect(dialog.getByRole("alert")).toContainText("unavailable");
    await expect(pa.getByRole("button", { name: "Stop call recording", exact: true })).toHaveCount(0);
    await start.click();
    await expect(dialog).toHaveCount(0);
    for (const page of [pa, pb]) {
      await expect(page.getByRole("status").filter({ hasText: `Recording · Started by ${host.person.name}` })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop call recording", exact: true })).toBeVisible();
    }
    await pa.screenshot({ path: "test-results/call-record-active-desktop.png" });
    await pb.screenshot({ path: "test-results/call-record-active-phone.png" });
    await pb.evaluate(() => document.documentElement.dataset.theme = "dark");
    await pb.screenshot({ path: "test-results/call-record-active-dark.png" });
    await pa.getByRole("button", { name: "Stop call recording", exact: true }).click();
    await pa.getByRole("dialog", { name: "Stop recording?", exact: true }).getByRole("button", { name: "Stop recording", exact: true }).click();
    for (const page of [pa, pb]) {
      await expect(page.getByRole("button", { name: "Record call", exact: true })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "processing finishes" })).toBeVisible();
    }
    expect(requests).toBe(3);
    await pb.setViewportSize({ width: 667, height: 375 });
    await expect(pb.getByRole("button", { name: "End call", exact: true })).toBeInViewport();
    await pb.screenshot({ path: "test-results/call-controls-landscape.png" });
    await pb.route("**/api/collab/meetings/*/end", route => route.fulfill({ status: 503, json: { error: "Call service temporarily unavailable" } }), { times: 1 });
    await pb.getByRole("button", { name: "End call", exact: true }).click();
    await expect(pb.locator('[data-call-layout="direct"]').getByRole("alert")).toContainText("Couldn't close the call for everyone");
    await expect(pb.getByRole("button", { name: "Leave on this device", exact: true })).toBeVisible();
    await pb.getByRole("button", { name: "End call", exact: true }).click();
    await expect(pa.getByRole("heading", { name: "Call ended", exact: true })).toBeVisible();
    expect((await host.get(`/meetings/${meetingId}`)).body.meeting.status).toBe("ended");
    expect(errors).toEqual([]);
  } finally {
    if (room) await setRoomMetadata(provider, room, { recording: null }).catch(() => {});
    if (meetingId) await host.post(`/meetings/${meetingId}/end`, {});
    await a.close(); await b.close();
  }
});
