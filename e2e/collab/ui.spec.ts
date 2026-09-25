import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client } from "./client";
import { PAGING_ROOM } from "./people";

/**
 * User flows through the real UI, in real browsers, against the local
 * Worker with realtime. People used here: pg34–pg37 and pg40 (read-only)
 * (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";

async function signedIn(browser: Browser, key: string, viewport = { width: 1440, height: 900 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport });
  await client.signInBrowser(context);
  const page = await context.newPage();
  return { client, context, page };
}

// A message by its own words (not a reply that quotes them).
const message = (page: Page, text: string) =>
  page.locator(".collab-msg").filter({ has: page.locator(".collab-msg-body", { hasText: text }) });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });

async function sendFrom(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(message(page, text)).toHaveCount(1);
}

test("a room from creation to archive, with two people live", async ({ browser }) => {
  const owner = await signedIn(browser, "pg34");
  const member = await signedIn(browser, "pg35");
  const op = owner.page;
  const mp = member.page;

  // Open Collaboration from the sidebar.
  await op.goto("/workspace/all-companies/overview");
  await op.getByRole("button", { name: /^Collaboration/ }).first().click();
  await expect(op).toHaveURL(/\/collaboration/);
  await expect(op.getByRole("heading", { name: "Collaboration", level: 1 })).toBeVisible();
  await expect(op.getByText("No conversations yet.").first()).toBeVisible();

  // Create a room with a member, through the dialog.
  await op.getByRole("button", { name: "New room", exact: true }).first().click();
  const create = op.getByRole("dialog", { name: "New room" });
  await create.getByLabel("Room name").fill("Launch crew");
  await create.getByLabel("Description").fill("Everything about the launch");
  await create.getByLabel("Search people").fill("Group35");
  await create.getByRole("button", { name: /Petra Group35/ }).click();
  await create.getByRole("button", { name: "Create room" }).click();
  await expect(create).toBeHidden();
  await expect(op.getByRole("heading", { name: "Launch crew", level: 2 })).toBeVisible();

  // Send; exactly one copy despite the optimistic entry, the response and
  // the realtime echo all describing the same message.
  await sendFrom(op, "Hello crew");
  await op.waitForTimeout(1200);
  await expect(message(op, "Hello crew")).toHaveCount(1);

  // The member sees an unread badge, opening the room clears it.
  await mp.goto(HUB);
  await expect(mp.getByRole("button", { name: /^Collaboration, 1 unread/ }).first()).toBeVisible();
  const row = mp.getByRole("listitem").filter({ hasText: "Launch crew" });
  await expect(row.getByLabel("1 unread")).toBeVisible();
  await row.click();
  await expect(message(mp, "Hello crew")).toBeVisible();
  await expect(mp.getByRole("button", { name: "Collaboration", exact: true }).first()).toBeVisible();
  await expect(row.getByLabel("1 unread")).toHaveCount(0);

  // Live delivery without a reload.
  await sendFrom(op, "Second note");
  await expect(message(mp, "Second note")).toBeVisible();

  // Mention through the autocomplete.
  await composer(mp).fill("");
  await composer(mp).pressSequentially("@Petra G");
  const suggestions = mp.getByRole("listbox", { name: "Mention someone" });
  await expect(suggestions.getByRole("option")).toHaveCount(1);
  await composer(mp).press("Enter");
  await expect(composer(mp)).toHaveValue("@Petra Group34 ");
  await composer(mp).pressSequentially("can you check?");
  await composer(mp).press("Enter");
  const mentioned = message(op, "can you check?");
  await expect(mentioned.locator(".collab-mention.is-me")).toHaveText("@Petra Group34");
  await op.getByRole("tab", { name: /Mentions/ }).click();
  await expect(op.locator(".collab-mentions").getByText("can you check?")).toBeVisible();
  await op.getByRole("tab", { name: /All chats/ }).click();

  // Reply, then follow the quote back to the original.
  await mentioned.hover();
  await mentioned.getByRole("button", { name: "Reply" }).click();
  await expect(op.getByText("Replying to")).toBeVisible();
  await sendFrom(op, "On it");
  const reply = message(op, "On it");
  await expect(reply.locator(".collab-quote")).toContainText("Petra Group35");
  await reply.locator(".collab-quote").click();
  await expect(mentioned).toHaveClass(/is-flash/);
  await expect(message(mp, "On it").locator(".collab-quote")).toBeVisible();

  // Edit own message; the other person sees the change live.
  const hello = message(op, "Hello crew");
  await hello.hover();
  await hello.getByRole("button", { name: "Edit" }).click();
  const editor = op.getByRole("textbox", { name: "Edit message" });
  await editor.fill("Hello crew, updated");
  await editor.press("Enter");
  await expect(message(op, "Hello crew, updated")).toContainText("(edited)");
  await expect(message(mp, "Hello crew, updated")).toBeVisible();
  // Someone else's message offers no Edit or Delete.
  await message(op, "can you check?").hover();
  await expect(message(op, "can you check?").getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(message(op, "can you check?").getByRole("button", { name: "Delete" })).toHaveCount(0);

  // Delete own message, confirmed.
  const second = message(op, "Second note");
  await second.hover();
  await second.getByRole("button", { name: "Delete" }).click();
  await op.getByRole("dialog", { name: "Delete message?" }).getByRole("button", { name: "Delete" }).click();
  await expect(message(op, "Second note")).toHaveCount(0);
  await expect(mp.getByText("This message was deleted.")).toBeVisible();

  // Add a member from the details panel.
  await op.getByRole("button", { name: "Show details" }).click();
  const details = op.getByRole("complementary", { name: "Conversation details" });
  await details.getByRole("button", { name: "Add", exact: true }).click();
  const add = op.getByRole("dialog", { name: "Add people" });
  await add.getByLabel("Search people").fill("Group36");
  await add.getByRole("button", { name: /Petra Group36/ }).click();
  await add.getByRole("button", { name: /^Add 1/ }).click();
  await expect(details.getByText("Petra Group36")).toBeVisible();

  // The member leaves.
  await mp.getByRole("button", { name: "Show details" }).click();
  await mp.getByRole("button", { name: "Leave room" }).click();
  await mp.getByRole("dialog", { name: "Leave room?" }).getByRole("button", { name: "Leave" }).click();
  await expect(mp.getByRole("listitem").filter({ hasText: "Launch crew" })).toHaveCount(0);
  await expect(details.getByText("Petra Group35")).toHaveCount(0);

  // Archive: history stays, the composer becomes read-only.
  await details.getByRole("button", { name: "Archive" }).click();
  await op.getByRole("dialog", { name: "Archive room?" }).getByRole("button", { name: "Archive" }).click();
  await expect(op.getByText("This room is archived. Messages are read-only.")).toBeVisible();
  await expect(composer(op)).toHaveCount(0);
  await expect(message(op, "On it")).toBeVisible();

  await owner.context.close();
  await member.context.close();
});

test("direct message, text safety and links", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "pg36");
  await page.goto(HUB);
  await page.getByRole("button", { name: "New message", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByLabel("Search people").fill("Group37");
  // Someone from another company is not offered at all.
  await expect(dialog.getByText("Femi Afrilube7")).toHaveCount(0);
  await dialog.getByRole("button", { name: /Petra Group37/ }).click();
  await expect(page.getByRole("heading", { name: "Petra Group37", level: 2 })).toBeVisible();

  const hostile = `<b>bold</b><img src=x onerror="window.__pwned=1"> see https://example.com/x`;
  await sendFrom(page, hostile);
  const body = message(page, "see https://example.com/x").locator(".collab-msg-body");
  await expect(body).toContainText("<b>bold</b><img src=x");
  await expect(body.locator("b, img, script")).toHaveCount(0);
  const link = body.getByRole("link", { name: "https://example.com/x" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();

  // Multiline with Shift+Enter.
  await composer(page).fill("");
  await composer(page).pressSequentially("line one");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("line two");
  await composer(page).press("Enter");
  await expect(message(page, "line one")).toContainText("line one\nline two");
  await context.close();
});

test("history pages in as you scroll up", async ({ browser }) => {
  const { page, context } = await signedIn(browser, PAGING_ROOM.members[1]);
  await page.goto(`${HUB}?c=${PAGING_ROOM.id}`);
  await expect(page.getByRole("heading", { name: PAGING_ROOM.name, level: 2 })).toBeVisible();
  await expect(message(page, "History 095")).toBeVisible();
  // Only the newest page is loaded, not the whole history.
  expect(await page.locator(".collab-msg").count()).toBeLessThanOrEqual(45);
  await expect(message(page, "History 030")).toHaveCount(0);
  const scroller = page.locator(".collab-scroll");
  for (let i = 0; i < 6 && !(await page.getByText("Beginning of the conversation").isVisible()); i++) {
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(500);
  }
  await expect(page.getByText("Beginning of the conversation")).toBeVisible();
  await expect(message(page, "History 030")).toHaveCount(1);
  // No message appears twice after paging.
  const ids = await page.locator(".collab-msg").evaluateAll((els) => els.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);
  await context.close();
});

test("missed events are caught up when the tab regains focus", async ({ browser }) => {
  const reader = await signedIn(browser, "pg37");
  const author = await Client.login("pg36");
  const room = await author.createRoom({ members: ["pg37"], name: "Catch-up room" });
  // A socket that connects but never delivers: realtime silently lost.
  await reader.page.routeWebSocket(/\/api\/collab\/socket/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage(() => {});
  });
  await reader.page.goto(`${HUB}?c=${room.id}`);
  await expect(reader.page.getByRole("heading", { name: "Catch-up room", level: 2 })).toBeVisible();
  await author.send(room.id, "sent while you were away");
  await reader.page.waitForTimeout(1500);
  await expect(message(reader.page, "sent while you were away")).toHaveCount(0);
  await reader.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(message(reader.page, "sent while you were away")).toHaveCount(1);
  await reader.context.close();
});
