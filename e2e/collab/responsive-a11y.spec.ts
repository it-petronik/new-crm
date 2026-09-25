import { test, expect, type Page } from "@playwright/test";
import { Client } from "./client";

/**
 * Responsive layout and accessibility. People used here: pg38 (viewer) with
 * pa4, pa5, pa6, af8 as content authors (exclusive to this file). Rooms are
 * created through the API so this file tests layout, not the flows (those
 * are in ui.spec.ts).
 */

const HUB = "/workspace/all-companies/collaboration";
const LONG_NAME = "Quarterly logistics coordination for Jebel Ali terminal and customs clearance";
const UNBROKEN = "X".repeat(320);

let roomId = "";
let viewer: Client;
let author: Client;

test.beforeAll(async () => {
  viewer = await Client.login("pg38");
  author = await Client.login("pa4");
  // A worker restarted after a failure runs this again; reuse the room so
  // there is only ever one with this name.
  const existing = (await author.get("/conversations")).body.conversations.find((c: any) => c.title === LONG_NAME);
  if (existing) {
    roomId = existing.id;
    return;
  }
  // pa4 is branch-scoped, so the room is an Abu Dhabi room; pg38 is
  // group-wide in the same company and may be a member.
  const room = await author.createRoom({ name: LONG_NAME, members: ["pg38", "pa5"], branch: "Abu Dhabi" });
  roomId = room.id;
  await author.send(roomId, UNBROKEN);
  await author.send(roomId, "A long ordinary sentence that should wrap naturally across several lines on a narrow phone screen without ever pushing the layout sideways.");
  await author.send(roomId, `@${viewer.person.name} please look`, { mentionIds: [viewer.id] });
});

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await viewer.signInBrowser(page.context());
  await page.goto(HUB);
  await expect(page.getByRole("heading", { name: "Collaboration", level: 1 })).toBeVisible();
}

// A message by its own words (not a reply that quotes them).
const message = (page: Page, text: string) =>
  page.locator(".collab-msg").filter({ has: page.locator(".collab-msg-body", { hasText: text }) });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`layout at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await open(page, viewport);
    expect(await noHorizontalOverflow(page)).toBe(true);

    // The list is usable and a long room name is truncated inside its row.
    const row = page.getByRole("listitem").filter({ hasText: LONG_NAME.slice(0, 20) });
    await expect(row).toBeVisible();
    const list = await page.locator(".collab-sidebar").boundingBox();
    const rowBox = await row.boundingBox();
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(list!.x + list!.width + 1);
    const title = row.locator(".collab-row-top b");
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    await row.click();
    const thread = page.getByRole("region", { name: /^Conversation:/ });
    await expect(thread).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);

    // Long messages wrap inside the thread.
    await expect(message(page, "XXXXXXXX")).toBeVisible();
    expect(await page.locator(".collab-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    // The composer is on screen and usable from the keyboard.
    const composer = page.getByRole("textbox", { name: "Message", exact: true });
    const box = await composer.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await composer.fill(`typed at ${viewport.width}`);
    await composer.press("Enter");
    await expect(page.locator(".collab-msg", { hasText: `typed at ${viewport.width}` })).toBeVisible();

    const mobile = viewport.width <= 760;
    if (mobile) {
      // Full-screen conversation over everything, list hidden, back returns.
      const main = await page.locator(".collab-main").boundingBox();
      expect(main).toMatchObject({ x: 0, y: 0, width: viewport.width });
      expect(Math.round(main!.height)).toBe(viewport.height);
      await expect(page.locator(".collab-sidebar")).toBeHidden();
      await page.getByRole("button", { name: "Back to conversations" }).click();
      await expect(row).toBeVisible();
      await expect(thread).toBeHidden();
      await row.click();
    } else {
      await expect(page.getByRole("button", { name: "Back to conversations" })).toBeHidden();
      await expect(page.locator(".collab-sidebar")).toBeVisible();
    }

    // The details panel opens within the viewport and closes.
    await page.getByRole("button", { name: "Show details" }).click();
    const details = page.getByRole("complementary", { name: "Conversation details" });
    await expect(details.getByRole("heading", { name: /^Members/ })).toBeVisible();
    const d = await details.boundingBox();
    expect(d!.x).toBeGreaterThanOrEqual(0);
    expect(d!.x + d!.width).toBeLessThanOrEqual(viewport.width + 1);
    await details.getByRole("button", { name: "Close details" }).click();
    await expect(details).toBeHidden();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
}

test("keyboard: select a conversation, act on a message, dialogs return focus", async ({ page }) => {
  await open(page, { width: 1440, height: 900 });
  // Filters are tabs with a selected state.
  await expect(page.getByRole("tab", { name: "All chats" })).toHaveAttribute("aria-selected", "true");
  const row = page.getByRole("listitem").filter({ hasText: LONG_NAME.slice(0, 20) });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /^Conversation:/ })).toBeVisible();

  // Message actions are reachable by keyboard and revealed on focus.
  const target = message(page, "A long ordinary sentence");
  const reply = target.getByRole("button", { name: "Reply" });
  await reply.focus();
  await expect(target.locator(".collab-msg-actions")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Replying to")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Replying to")).toHaveCount(0);

  // Dialogs: named, Escape closes, focus returns to the opener.
  const opener = page.getByRole("button", { name: "New room", exact: true }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New room" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New room" }).getByLabel("Room name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New room" })).toBeHidden();
  await expect(opener).toBeFocused();
});

test("meaning is carried by text and labels, not colour alone", async ({ page }) => {
  // Fresh unread state: earlier tests in this file have read the room.
  await author.send(roomId, `@${viewer.person.name} one more`, { mentionIds: [viewer.id] });
  await open(page, { width: 1440, height: 900 });
  const row = page.getByRole("listitem").filter({ hasText: LONG_NAME.slice(0, 20) });
  // Unread and mention counts have accessible names; the sidebar entry says it.
  await expect(row.getByLabel(/^\d+ unread$/)).toBeVisible();
  await expect(row.getByLabel(/^\d+ mentions$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Collaboration, \d+ unread, \d+ mentions$/ }).first()).toBeVisible();
  await row.click();
  // A mention is the literal "@Name" text, not just a highlight.
  await expect(message(page, "one more").locator(".collab-mention.is-me")).toHaveText(`@${viewer.person.name}`);
  // The live indicator is labelled; the composer and send button are named.
  await expect(page.getByRole("img", { name: /^(Live|Connecting…|Reconnecting…)$/ })).toBeVisible();
  // Empty composer offers the microphone; with text, Send.
  const box = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(page.getByRole("button", { name: "Record voice message" })).toBeVisible();
  await box.fill("draft");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await box.fill("");
  // Member controls in the details panel are named per person.
  await page.getByRole("button", { name: "Show details" }).click();
  await expect(page.getByRole("button", { name: /^Actions for Amir Abudhabi5$/ })).toBeVisible();
});

test("loading states are announced; reduced motion is respected", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await viewer.signInBrowser(page.context());
  // Hold the list response so the loading state is observable.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/collab/conversations", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(HUB);
  await expect(page.getByLabel("Loading conversations")).toHaveAttribute("aria-busy", "true");
  release();
  const row = page.getByRole("listitem").filter({ hasText: LONG_NAME.slice(0, 20) });
  await row.click();
  // Jumping to a quoted message highlights without animating.
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  const target = message(page, "A long ordinary sentence");
  await target.getByRole("button", { name: "Reply" }).focus();
  await page.keyboard.press("Enter");
  await composer.fill("quoting");
  await composer.press("Enter");
  await message(page, "quoting").locator(".collab-quote").click();
  await expect(target).toHaveClass(/is-flash/);
  await expect(target).toHaveCSS("animation-name", "none");
});
