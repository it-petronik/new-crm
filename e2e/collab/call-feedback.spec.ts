import { test, expect } from "@playwright/test";
import { Client } from "./client";
import { callSounds, probeCallAudio } from "./call-audio-probe";

const HUB = "/workspace/all-companies/collaboration";
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=document-user-activation-required"] } });

test("blocked incoming audio can be enabled; decline, prejoin cancellation and hangup stop both sides", async ({ browser }) => {
  const host = await Client.login("mt13"), peer = await Client.login("mt14");
  const direct = await host.openDirect("mt14");
  const id = direct.body.conversation.id;
  const previous = await host.get(`/conversations/${id}/meetings`);
  for (const meeting of previous.body.meetings) if (meeting.status === "live") await host.post(`/meetings/${meeting.id}/end`, {});
  const a = await browser.newContext({ viewport: { width: 1280, height: 850 }, permissions: ["camera", "microphone"] });
  // No user gesture or capture permission before the invitation. The audio
  // policy state is forced because headless Chrome can allow autoplay anyway.
  const b = await browser.newContext({ viewport: { width: 320, height: 740 } });
  await probeCallAudio(a); await probeCallAudio(b, true);
  await host.signInBrowser(a); await peer.signInBrowser(b);
  const pa = await a.newPage(), pb = await b.newPage();
  const errors: string[] = [];
  pa.on("pageerror", e => errors.push(e.message)); pb.on("pageerror", e => errors.push(e.message));
  await pb.addInitScript(() => {
    let captures = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => { captures++; return original(constraints); };
    Object.assign(window, { __captureRequests: () => captures });
  });
  try {
    await pb.goto(`${HUB}?c=${id}`);
    await expect(pb.locator(".collab-composer-input")).toBeVisible();
    await pa.goto(`${HUB}?c=${id}`);
    await pa.getByRole("button", { name: "Voice call", exact: true }).click();
    const incoming = pb.locator(".meet-incoming");
    await expect(incoming).toHaveAttribute("data-ringtone", "blocked");
    await expect(incoming.getByRole("button", { name: "Enable sound" })).toBeVisible();
    await pb.screenshot({ path: "test-results/call-enable-sound-phone.png", animations: "disabled" });
    expect(await pb.evaluate(() => (window as unknown as { __captureRequests: () => number }).__captureRequests())).toBe(0);
    await incoming.getByRole("button", { name: "Enable sound" }).click();
    await expect(incoming).toHaveAttribute("data-ringtone", "playing");
    expect((await callSounds(pb)).some(s => s.running && s.peak > .01)).toBe(true);
    await pa.getByRole("button", { name: "Connect call" }).click();
    await expect(pa.locator('[data-call-layout="direct"]')).toHaveAttribute("data-ringback", "playing");
    await incoming.getByRole("button", { name: "Silence", exact: true }).click();
    await expect(incoming).toContainText("Ringing silenced");
    expect((await callSounds(pb)).filter(s => s.running)).toHaveLength(0);
    // A failed request must not pretend that the caller was disconnected.
    await pb.route("**/api/collab/meetings/*/end", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Try again" }) }));
    await incoming.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(incoming.getByRole("alert")).toContainText("Couldn't decline");
    await pb.unroute("**/api/collab/meetings/*/end");
    await incoming.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(incoming).toHaveCount(0);
    await expect(pa.getByRole("heading", { name: "Call ended", exact: true })).toBeVisible();
    expect((await callSounds(pa)).filter(s => s.running)).toHaveLength(0);
    expect(await pb.evaluate(() => (window as unknown as { __captureRequests: () => number }).__captureRequests())).toBe(0);
    await pa.getByRole("button", { name: "Back to Enercore", exact: true }).click();

    // Cancelling before connecting also closes the remote invitation.
    await pa.getByRole("button", { name: "Voice call", exact: true }).click();
    await expect(incoming).toHaveAttribute("data-ringtone", "playing");
    await pa.locator('[data-call-layout="prejoin"]').getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(incoming).toHaveCount(0);
    expect((await callSounds(pb)).filter(s => s.running)).toHaveLength(0);
    await expect(pa.locator('[data-call-layout="prejoin"]')).toHaveCount(0);

    // Hanging up an unanswered connected call stops both output graphs.
    await pa.getByRole("button", { name: "Voice call", exact: true }).click();
    await pa.getByRole("button", { name: "Connect call" }).click();
    await expect(incoming).toHaveAttribute("data-ringtone", "playing");
    await expect(pa.locator('[data-call-layout="direct"]')).toHaveAttribute("data-ringback", "playing");
    await pa.getByRole("button", { name: "End call", exact: true }).click();
    await expect(incoming).toHaveCount(0);
    await expect(pa.getByRole("heading", { name: "Call ended", exact: true })).toBeVisible();
    for (const p of [pa, pb]) expect((await callSounds(p)).filter(s => s.running)).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    const meetings = await host.get(`/conversations/${id}/meetings`);
    for (const meeting of meetings.body.meetings ?? []) if (meeting.status === "live") await host.post(`/meetings/${meeting.id}/end`, {});
    await a.close(); await b.close();
  }
});

test("an unanswered invitation expires and releases its audio output after 45 seconds", async ({ browser }) => {
  const host = await Client.login("pg31"), peer = await Client.login("pg32");
  const direct = await host.openDirect("pg32");
  const id = direct.body.conversation.id;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await probeCallAudio(context); await peer.signInBrowser(context);
  const page = await context.newPage();
  let meetingId: string | undefined;
  try {
    await page.clock.install();
    await page.goto(`${HUB}?c=${id}`);
    await page.locator(".collab-composer-input").click();
    const response = await host.post(`/conversations/${id}/meetings`, { mode: "now", media: "voice" });
    expect([200, 201]).toContain(response.status);
    meetingId = response.body.meeting.id;
    await expect(page.locator(".meet-incoming")).toHaveAttribute("data-ringtone", "playing");
    await page.clock.fastForward(46_000);
    await expect(page.locator(".meet-incoming")).toHaveCount(0);
    expect((await callSounds(page)).filter(s => s.running)).toHaveLength(0);
    // Later clicks must not start this expired sound again.
    await page.locator(".collab-composer-input").click();
    expect((await callSounds(page)).filter(s => s.running)).toHaveLength(0);
  } finally { if (meetingId) await host.post(`/meetings/${meetingId}/end`, {}); await context.close(); }
});
