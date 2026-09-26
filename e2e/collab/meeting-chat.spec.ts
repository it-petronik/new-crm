import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";
import { byKey, WORKER } from "./people";

/**
 * Meeting chat through the real Worker, D1 and the local LiveKit server:
 * who may read and post (employees by their meeting access, guests only while
 * admitted and the meeting is live), live delivery host ↔ guest without
 * polling, review afterwards, room meetings with guests, and phones.
 *
 * People: mc1–mc8 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

const key = () => `ck${Math.random().toString(16).slice(2, 14)}${Date.now().toString(36)}`;
const tokenOf = (url: string) => url.split("/meet/")[1];

async function guestCall<T = any>(path: string, body: unknown, origin: string = WORKER) {
  const r = await fetch(`${WORKER}/api/meet/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, body: json as T, cookies: r.headers.getSetCookie() };
}
const standalone = (client: Client, body: Record<string, unknown> = {}) => client.post("/meetings", { mode: "now", media: "video", title: "Chat test", inviteeIds: [], guestAccess: "open", ...body });
const say = (client: Client, id: string, body: string, clientKey = key()) => client.post(`/meetings/${id}/messages`, { body, clientKey });

test("who may read and post: current meeting access for employees, admission for guests — nothing else", async () => {
  const [owner, invitee, outsider] = await Promise.all(["mc1", "mc2", "mc3"].map(Client.login));
  const meeting = (await standalone(owner, { inviteeIds: [invitee.id] })).body.meeting;
  const link = (await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;

  // Employees: organiser and invitee, not an outsider who knows the id.
  const k = key();
  const first = await say(owner, meeting.id, "Before guests", k);
  expect(first.status).toBe(201);
  expect(first.body.message).toMatchObject({ body: "Before guests", mine: true, sender: { name: "Cam Chat1", guest: false } });
  const retry = await say(owner, meeting.id, "Before guests", k);
  expect([retry.status, retry.body.message.id]).toEqual([200, first.body.message.id]);
  expect((await invitee.get(`/meetings/${meeting.id}/messages`)).body.messages.map((m: any) => m.body)).toEqual(["Before guests"]);
  expect((await outsider.get(`/meetings/${meeting.id}/messages`)).status).toBe(404);
  expect((await say(outsider, meeting.id, "sneaky")).status).toBe(404);
  // No session, or another website: refused.
  expect((await owner.request("GET", `/api/collab/meetings/${meeting.id}/messages`, undefined, { cookie: null })).status).toBe(401);
  expect((await owner.request("POST", `/api/collab/meetings/${meeting.id}/messages`, { body: "x", clientKey: key() }, { origin: "https://evil.example" })).status).toBe(403);

  // A guest: admitted, so they may read (from their admission on) and write.
  const joined = await guestCall("join", { token: tokenOf(link), name: "Gina Guest" });
  expect(joined.body.state).toBe("admitted");
  const secret = joined.body.secret as string;
  expect((await guestCall("chat", { secret })).body.messages).toEqual([]); // not the earlier one
  await say(owner, meeting.id, "Hello");
  const seen = (await guestCall("chat", { secret })).body.messages;
  expect(seen.map((m: any) => [m.body, m.sender.name, m.mine])).toEqual([["Hello", "Cam Chat1", false]]);
  expect(JSON.stringify(seen)).not.toMatch(/collab-user|Petronik|@collab\.test/);
  // The name shown is the admitted one — whatever the request says.
  const sent = await guestCall("chat/send", { secret, body: "Hi 👋", clientKey: key(), name: "The CEO" });
  expect(sent.status).toBe(201);
  expect(sent.body.message).toMatchObject({ body: "Hi 👋", mine: true, sender: { name: "Gina Guest", guest: true } });
  expect(sent.cookies).toEqual([]);
  expect((await owner.get(`/meetings/${meeting.id}/messages`)).body.messages.at(-1)).toMatchObject({ body: "Hi 👋", sender: { name: "Gina Guest", guest: true } });
  // Not from another website; not with a made-up secret.
  expect((await guestCall("chat", { secret }, "https://evil.example")).status).toBe(403);
  expect((await guestCall("chat", { secret: "x".repeat(43) })).status).toBe(404);
  // Guests have no way into Collaboration.
  for (const path of ["/api/collab/conversations", `/api/collab/meetings/${meeting.id}/messages`]) expect((await owner.request("GET", path, undefined, { cookie: null })).status).toBe(401);
  // A guest's own rate limit.
  let limited = 0;
  for (let i = 0; i < 21; i++) if ((await guestCall("chat/send", { secret, body: `spam ${i}`, clientKey: key() })).status === 429) limited++;
  expect(limited).toBeGreaterThanOrEqual(1);

  // Removed from the meeting: chat access ends at once.
  const identity = JSON.parse(Buffer.from(joined.body.grant.token.split(".")[1], "base64url").toString()).sub as string;
  const removed = await owner.post(`/meetings/${meeting.id}/participants`, { action: "remove", identity });
  expect(removed.status).toBe(200);
  expect((await guestCall("chat", { secret })).status).toBe(404);
  expect((await guestCall("chat/send", { secret, body: "still here?", clientKey: key() })).status).toBe(404);
  // An invitee who is removed loses it too.
  expect((await owner.patch(`/meetings/${meeting.id}`, { inviteeIds: [] })).status).toBe(200);
  expect((await invitee.get(`/meetings/${meeting.id}/messages`)).status).toBe(404);

  // Another admitted guest, then the meeting ends: guests lose the chat; the
  // organiser can still read it (read-only).
  // (After a removal, new guests wait for the host — an earlier rule.)
  const second = await guestCall("join", { token: tokenOf(link), name: "Gus" });
  expect(second.body.state).toBe("waiting");
  // Waiting isn't admitted: no chat yet.
  expect((await guestCall("chat", { secret: second.body.secret })).status).toBe(404);
  const waitingId = (await owner.get(`/meetings/${meeting.id}/guests`)).body.guests[0].id;
  await owner.post(`/meetings/${meeting.id}/guests/${waitingId}`, { decision: "admit" });
  expect((await guestCall("chat", { secret: second.body.secret })).status).toBe(200);
  await owner.post(`/meetings/${meeting.id}/end`, {});
  expect((await guestCall("chat", { secret: second.body.secret })).status).toBe(404);
  const after = (await owner.get(`/meetings/${meeting.id}/messages`)).body;
  expect(after.live).toBe(false);
  expect(after.messages.map((m: any) => m.body).slice(0, 3)).toEqual(["Before guests", "Hello", "Hi 👋"]);
  expect((await say(owner, meeting.id, "late")).status).toBe(409);
});

/* ------------------------------------------------------------- browsers */

async function hostInMeeting(browser: Browser, key: string, meetingId: string, viewport = { width: 1280, height: 860 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], bypassCSP: true });
  await client.signInBrowser(context);
  const page = await context.newPage();
  await page.goto(`${HUB}?tab=meetings&meeting=${meetingId}`);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.locator(".meet-prejoin .meet-join").click();
  await expect(page.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  return { client, context, page };
}
async function guestInMeeting(browser: Browser, link: string, name: string, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], bypassCSP: true });
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join meeting" }).click();
  await expect(page.locator(".meet-controls")).toBeVisible({ timeout: 30_000 });
  return { context, page };
}
const openChat = async (page: Page) => {
  await page.locator(".meet-controls").getByRole("button", { name: /^Chat/ }).click();
  const panel = page.getByRole("complementary", { name: "Chat" });
  await expect(panel).toBeVisible();
  return panel;
};
const sendIn = async (panel: ReturnType<Page["getByRole"]>, text: string) => {
  await panel.getByLabel("Message everyone").fill(text);
  await panel.getByRole("button", { name: "Send message" }).click();
};

test("standalone meeting: host and guest chat live (no polling), emoji, text stays text, reviewable afterwards", async ({ browser }) => {
  test.setTimeout(150_000);
  const owner = await Client.login("mc4");
  const meeting = (await standalone(owner, { title: "Client chat" })).body.meeting;
  const link = (await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;
  const host = await hostInMeeting(browser, "mc4", meeting.id);
  const guest = await guestInMeeting(browser, link, "Ahmed");

  // Guests have a Chat button too — and it's never a dead end.
  const hostChat = await openChat(host.page);
  await expect(hostChat).toContainText("No messages yet");
  await expect(hostChat).toContainText("Messages sent here are visible to everyone in this meeting.");
  await expect(host.page.locator("body")).not.toContainText("no chat room");
  const guestChat = await openChat(guest.page);

  // Count the guest's chat requests: after the first load, only announced messages fetch.
  let guestFetches = 0;
  guest.page.on("request", (r) => r.url().includes("/api/meet/chat") && !r.url().includes("/send") && guestFetches++);

  const t0 = Date.now();
  await sendIn(hostChat, "Hello");
  await expect(guestChat.locator(".meet-chat-list")).toContainText("Hello", { timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  await expect(guestChat.locator("li", { hasText: "Hello" })).toContainText("Cam Chat4");

  // The guest replies with an emoji from the picker.
  await guestChat.getByLabel("Message everyone").fill("Hi ");
  await guestChat.getByRole("button", { name: "Insert emoji" }).click();
  await guestChat.getByRole("button", { name: "Insert 👍" }).click();
  await guestChat.getByRole("button", { name: "Send message" }).click();
  await expect(hostChat.locator(".meet-chat-list")).toContainText("Hi 👍", { timeout: 5_000 });
  await expect(hostChat.locator("li", { hasText: "Hi 👍" })).toContainText("Guest");

  // Plain text: markup is shown as typed, never rendered.
  await sendIn(hostChat, "<b>not bold</b>");
  await expect(guestChat.locator(".meet-chat-list")).toContainText("<b>not bold</b>", { timeout: 5_000 });
  expect(await guestChat.locator(".meet-chat-list b", { hasText: "not bold" }).count()).toBe(0);

  // Quiet for a while: no polling.
  const before = guestFetches;
  await guest.page.waitForTimeout(8_000);
  expect(guestFetches - before).toBe(0);

  // With the panel closed, a new message marks the Chat button.
  await guest.page.getByRole("button", { name: "Close panel" }).click();
  await sendIn(hostChat, "Are you there?");
  await expect(guest.page.getByRole("button", { name: "Chat, new messages" })).toBeVisible({ timeout: 5_000 });

  // The meeting ends; the host reviews the chat from Meeting Details.
  await owner.post(`/meetings/${meeting.id}/end`, {});
  await expect(host.page.getByRole("heading", { name: "The meeting has ended" })).toBeVisible({ timeout: 20_000 });
  await host.page.getByRole("button", { name: "Back to Enercore" }).click();
  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  const review = host.page.locator(".meet-details-chat");
  await expect(review.getByRole("heading", { name: "Chat" })).toBeVisible();
  for (const text of ["Hello", "Hi 👍", "<b>not bold</b>", "Are you there?"]) await expect(review).toContainText(text);
  await expect(review).toContainText("The meeting has ended. The chat is read-only now.");
  await expect(review.getByLabel("Message everyone")).toHaveCount(0);
  await Promise.all([host.context.close(), guest.context.close()]);
});

test("room meeting with a guest: the guest gets the meeting chat only; employees get both, clearly labelled", async ({ browser }) => {
  test.setTimeout(150_000);
  const owner = await Client.login("mc5");
  const room = await owner.createRoom({ name: "Chat room", members: ["mc6"] });
  await owner.send(room.id, "Internal note — never for guests");
  const meeting = (await owner.post(`/conversations/${room.id}/meetings`, { mode: "now", media: "video" })).body.meeting;
  const link = (await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;
  const host = await hostInMeeting(browser, "mc5", meeting.id);
  const guest = await guestInMeeting(browser, link, "Rae");
  await expect(host.page.locator('.meet-tile[data-name="Rae (Guest)"]')).toBeVisible({ timeout: 20_000 });

  // The guest: meeting chat only — no room history, no tabs.
  const guestChat = await openChat(guest.page);
  await expect(guestChat.getByRole("tab")).toHaveCount(0);
  await expect(guestChat).not.toContainText("Internal note");
  // The host: both, labelled; room chat still shows the room's history.
  const hostChat = await openChat(host.page);
  await expect(hostChat.getByRole("tab", { name: /Room chat/ })).toHaveAttribute("aria-selected", "true");
  await expect(hostChat).toContainText("Internal note — never for guests");
  await hostChat.getByRole("tab", { name: /Meeting chat/ }).click();
  await sendIn(hostChat, "Welcome, Rae");
  await expect(guestChat).toContainText("Welcome, Rae", { timeout: 5_000 });
  await sendIn(guestChat, "Thanks!");
  await expect(hostChat).toContainText("Thanks!", { timeout: 5_000 });
  // Nothing was copied into the room.
  const roomMessages = (await owner.page(room.id)).body.messages.map((m: any) => m.body);
  expect(roomMessages).not.toContain("Welcome, Rae");
  expect(roomMessages).not.toContain("Thanks!");
  await owner.post(`/meetings/${meeting.id}/end`, {});
  // Afterwards the details show the guest chat, for employees.
  await host.page.getByRole("button", { name: "Back to Enercore" }).click();
  await host.page.goto(`${HUB}?tab=meetings&meeting=${meeting.id}`);
  await expect(host.page.locator(".meet-details-chat").getByRole("heading", { name: "Chat with guests" })).toBeVisible();
  await Promise.all([host.context.close(), guest.context.close()]);
});

test("phones: the chat is a sheet, the composer stays on screen, nothing overflows", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await Client.login("mc7");
  const meeting = (await standalone(owner, { title: "Phone chat" })).body.meeting;
  const link = (await owner.post(`/meetings/${meeting.id}/guest-link`, { expiry: "1h", admission: "open" })).body.url as string;
  const guest = await guestInMeeting(browser, link, "Pat", { width: 390, height: 844 });
  const panel = await openChat(guest.page);
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  const composer = (await panel.getByLabel("Message everyone").boundingBox())!;
  expect(composer.y + composer.height).toBeLessThanOrEqual(844);
  await sendIn(panel, "From my phone");
  await expect(panel).toContainText("From my phone");
  expect(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await owner.post(`/meetings/${meeting.id}/end`, {});
  await guest.context.close();
  expect(byKey("mc7").companies).toEqual(["Petronik"]);
});
