import { test, expect, type Browser, type Page } from "@playwright/test";
import { Client, FILES, PNG } from "./client";

/**
 * Collaboration V2 in real browsers: attachments, lightbox, PDF preview,
 * document cards, reactions, typing, presence, focus mode, the details
 * Media/Files sections, responsive layout and accessibility.
 * People used here: w1–w12 (exclusive to this file).
 */

const HUB = "/workspace/all-companies/collaboration";

async function signedIn(browser: Browser, key: string, viewport = { width: 1440, height: 900 }) {
  const client = await Client.login(key);
  const context = await browser.newContext({ viewport });
  await client.signInBrowser(context);
  const page = await context.newPage();
  return { client, context, page };
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
const file = (f: { name: string; bytes: Uint8Array }, mimeType: string) => ({ name: f.name, mimeType, buffer: Buffer.from(f.bytes) });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("attach, send and view: images, PDF, documents", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "w1");
  const room = await client.createRoom({ name: "Files room", members: ["w2"] });
  await page.goto(`${HUB}?c=${room.id}`);
  await expect(page.getByRole("heading", { name: "Files room", level: 2 })).toBeVisible();

  // Pick files with the real control: a tray shows each with progress/size.
  await page.getByRole("button", { name: "Attach files" }).click();
  await page.locator('.collab-composer input[type="file"]').setInputFiles([
    file(FILES.png, "image/png"),
    file({ name: "second.png", bytes: PNG }, "image/png"),
    file(FILES.pdf, "application/pdf"),
    file(FILES.docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  ]);
  const tray = page.getByRole("list", { name: "Attachments to send" });
  await expect(tray.getByRole("listitem")).toHaveCount(4);
  await expect(tray.locator(".collab-tray-item.is-ready")).toHaveCount(4);
  await expect(tray.getByRole("button", { name: "Remove memo.docx" })).toBeVisible();

  // Unsupported files are refused with a reason, and can be removed.
  await page.locator('.collab-composer input[type="file"]').setInputFiles([file(FILES.zip, "application/zip")]);
  await expect(tray.locator(".collab-tray-item.is-failed")).toContainText("ZIP archives aren't accepted");
  await tray.getByRole("button", { name: "Remove bundle.zip" }).click();

  await composer(page).fill("Here are the files");
  await composer(page).press("Enter");
  const message = page.locator(".collab-msg").filter({ hasText: "Here are the files" });
  await expect(message.locator(".collab-image img")).toHaveCount(2);
  await expect(message.locator(".collab-image img").first()).toHaveAttribute("loading", "lazy");
  await expect(message.getByRole("button", { name: "Preview report.pdf" })).toBeVisible();
  // Office documents: a card with Download only, no preview.
  await expect(message.getByRole("button", { name: /Preview memo.docx/ })).toHaveCount(0);
  await expect(message.getByRole("link", { name: "Download memo.docx" })).toHaveAttribute("href", /download=1/);

  // Files appear in the order they were picked, not upload-finish order.
  await expect(message.locator(".collab-image img").first()).toHaveAttribute("alt", "photo.png");
  // Lightbox: full image, sender, GST time, download, next/previous, Esc.
  await message.getByRole("button", { name: "Open image photo.png" }).click();
  const box = page.getByRole("dialog", { name: "photo.png" });
  await expect(box).toBeVisible();
  await expect(box).toContainText("Wes Browser1");
  await expect(box).toContainText("GST");
  await expect(box.getByRole("link", { name: "Download image" })).toHaveAttribute("href", /download=1/);
  await expect(box).toContainText("1 of 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "second.png" })).toBeVisible();
  await page.getByRole("button", { name: "Previous image" }).click();
  await expect(page.getByRole("dialog", { name: "photo.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // PDF: authorised in-app preview frame and download; nothing third-party.
  await message.getByRole("button", { name: "Preview report.pdf" }).click();
  const preview = page.getByRole("dialog", { name: "report.pdf" });
  const frame = preview.locator("iframe.collab-pdf-frame");
  const src = await frame.getAttribute("src");
  expect(src).toMatch(/^\/api\/collab\/files\/[A-Za-z0-9-]+$/);
  const served = await page.request.get(src!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("application/pdf");
  await expect(preview.getByRole("button", { name: "Download" })).toBeVisible();
  await preview.getByRole("button", { name: "Close", exact: true }).click();

  // Paste a screenshot into the composer: it becomes an attachment.
  await composer(page).focus();
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.querySelector(".collab-composer-input")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, Buffer.from(PNG).toString("base64"));
  await expect(tray.getByRole("listitem")).toHaveCount(1);
  await tray.getByRole("button", { name: "Remove pasted.png" }).click();

  // Details: Media and Files show what was shared; View all browses.
  await page.getByRole("button", { name: "Show details" }).click();
  const details = page.getByRole("complementary", { name: "Conversation details" });
  await expect(details.locator(".collab-media-tile")).toHaveCount(2);
  await expect(details.getByText("report.pdf")).toBeVisible();
  await details.getByRole("button", { name: "View all" }).first().click();
  const browserDialog = page.getByRole("dialog", { name: "Shared in this conversation" });
  await expect(browserDialog.locator(".collab-media-tile")).toHaveCount(2);
  await browserDialog.getByRole("tab", { name: "Files" }).click();
  await expect(browserDialog.getByText("memo.docx")).toBeVisible();
  await context.close();
});

test("reactions, typing and presence between two people, live", async ({ browser }) => {
  const a = await signedIn(browser, "w3");
  const b = await signedIn(browser, "w4");
  const dm = (await a.client.openDirect("w4")).body.conversation;
  await a.client.send(dm.id, "Morning!");
  await a.page.goto(`${HUB}?c=${dm.id}`);
  await b.page.goto(`${HUB}?c=${dm.id}`);

  // Presence: B is online in A's DM header and list, with a text label.
  await expect(a.page.locator(".collab-thread-title p")).toContainText("Online");
  await expect(a.page.getByRole("img", { name: "Online" }).first()).toBeVisible();

  // Typing: B types, A sees it; B sends, it clears.
  await composer(b.page).pressSequentially("On my way", { delay: 30 });
  await expect(a.page.locator(".collab-typing")).toContainText(/is typing…/);
  await composer(b.page).press("Enter");
  await expect(a.page.locator(".collab-typing")).toHaveText("");

  // Reactions: B reacts from the picker; A sees it live; A adds theirs.
  const msgB = b.page.locator(".collab-msg").filter({ hasText: "Morning!" });
  await msgB.hover();
  await msgB.getByRole("button", { name: "Add reaction" }).click();
  await b.page.getByRole("button", { name: "React 👍" }).click();
  const chipA = a.page.locator(".collab-msg").filter({ hasText: "Morning!" }).getByRole("button", { name: /^👍 1/ });
  await expect(chipA).toBeVisible();
  await chipA.click();
  await expect(b.page.locator(".collab-msg").filter({ hasText: "Morning!" }).getByRole("button", { name: /^👍 2/ })).toBeVisible();
  // Toggling mine off.
  await a.page.locator(".collab-msg").filter({ hasText: "Morning!" }).getByRole("button", { name: /^👍 2/ }).click();
  await expect(b.page.locator(".collab-msg").filter({ hasText: "Morning!" }).getByRole("button", { name: /^👍 1/ })).toBeVisible();

  // Profile card from an avatar.
  await a.page.getByRole("button", { name: "Profile of Wes Browser4" }).first().click();
  await expect(a.page.locator(".collab-profile-card")).toContainText("Wes Browser4");
  await a.page.keyboard.press("Escape");

  // B leaves: A sees last-seen instead of Online.
  await b.context.close();
  await expect(a.page.locator(".collab-thread-title p")).toContainText(/Last seen/, { timeout: 20_000 });
  await a.context.close();
});

test("focus mode: enter, persist, shortcut, exit", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "w5");
  const room = await client.createRoom({ name: "Focus room" });
  await page.goto(`${HUB}?c=${room.id}`);
  await expect(page.getByRole("heading", { name: "Focus room", level: 2 })).toBeVisible();
  const sidebar = page.locator(".desktop-sidebar");
  await expect(sidebar).toBeVisible();
  const before = (await page.locator(".collab").boundingBox())!.width;

  await page.getByRole("button", { name: "Focus mode" }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("button", { name: "Exit focus mode" })).toHaveAttribute("aria-pressed", "true");
  // The shell animates into the freed width; wait for it to settle.
  await expect.poll(async () => (await page.locator(".collab").boundingBox())!.width).toBeGreaterThan(before + 100);
  expect(await noOverflow(page)).toBe(true);
  await expect(page.locator(".topbar")).toBeVisible();

  await page.reload();
  await expect(page.locator(".desktop-sidebar")).toBeHidden();
  await page.keyboard.press("Alt+Shift+KeyF");
  await expect(page.locator(".desktop-sidebar")).toBeVisible();
  await page.keyboard.press("Alt+Shift+KeyF");
  await expect(page.locator(".desktop-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Exit focus mode" }).click();
  await expect(page.locator(".desktop-sidebar")).toBeVisible();

  // Leaving Collaboration always restores the normal shell.
  await page.getByRole("button", { name: "Focus mode" }).click();
  await page.goto("/workspace/all-companies/overview");
  await expect(page.locator(".desktop-sidebar")).toBeVisible();
  await context.close();
});

test("room images through Room settings", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "w6");
  const room = await client.createRoom({ name: "Pictured room", visibility: "private" });
  await page.goto(`${HUB}?c=${room.id}`);
  // Fallback: initials plus the private lock.
  await expect(page.locator(".collab-thread-head .collab-room-avatar")).toContainText("PR");
  await expect(page.locator(".collab-thread-head .collab-room-avatar-lock")).toBeVisible();
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Room settings" });
  await settings.locator('input[type="file"]').setInputFiles([file(FILES.png, "image/png")]);
  await expect(page.locator(".collab-thread-head .collab-room-avatar img")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Remove" })).toBeVisible();
  await settings.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".collab-thread-head .collab-room-avatar img")).toHaveCount(0);
  await expect(page.locator(".collab-thread-head .collab-room-avatar")).toContainText("PR");
  await context.close();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`V2 layout at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const { client, page, context } = await signedIn(browser, "w7", viewport);
    const other = await Client.login("w8");
    const room = await client.createRoom({ name: `Layout ${viewport.width}`, members: ["w8"] });
    const img = (await client.upload(room.id, FILES.png, { width: "1600", height: "900" }, { name: "t.png", bytes: PNG })).body.attachment;
    const doc = (await client.upload(room.id, { name: "A very long quarterly logistics report for the Jebel Ali terminal expansion.pdf", bytes: FILES.pdf.bytes })).body.attachment;
    const voice = (await client.upload(room.id, FILES.webm, { durationMs: "65000" })).body.attachment;
    const sent = (await client.send(room.id, "Everything at once", { attachmentIds: [img.id, doc.id, voice.id] })).body.message;
    await other.post(`/messages/${sent.id}/reactions`, { emoji: "👍", on: true });
    await other.post(`/messages/${sent.id}/reactions`, { emoji: "🎉", on: true });

    await page.goto(`${HUB}?c=${room.id}`);
    const message = page.locator(".collab-msg").filter({ hasText: "Everything at once" });
    await expect(message.locator(".collab-image")).toBeVisible();
    await expect(message.locator(".collab-file-card")).toBeVisible();
    await expect(message.locator(".collab-voice")).toBeVisible();
    await expect(message.locator(".collab-reaction")).toHaveCount(2);
    expect(await noOverflow(page)).toBe(true);
    // Everything fits its column.
    const scroller = await page.locator(".collab-scroll").boundingBox();
    for (const sel of [".collab-image", ".collab-file-card", ".collab-voice", ".collab-reactions"]) {
      const b = (await message.locator(sel).first().boundingBox())!;
      expect(b.x + b.width, sel).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
    }

    // Tray + emoji picker + composer.
    await page.locator('.collab-composer input[type="file"]').setInputFiles([
      file({ name: "an-attachment-with-a-rather-long-file-name.png", bytes: PNG }, "image/png"),
    ]);
    await expect(page.locator(".collab-tray-item.is-ready")).toBeVisible();
    await page.getByRole("button", { name: "Insert emoji" }).click();
    const picker = page.getByRole("dialog", { name: "Emoji" });
    const p = (await picker.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");
    const c = (await page.locator(".collab-composer-box").boundingBox())!;
    expect(c.y + c.height).toBeLessThanOrEqual(viewport.height);
    expect(await noOverflow(page)).toBe(true);

    // Lightbox fits.
    await message.getByRole("button", { name: /Open image/ }).click();
    const lb = (await page.locator(".collab-lightbox-stage img").boundingBox())!;
    expect(lb.x + lb.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");

    // Details Media/Files.
    await page.getByRole("button", { name: "Show details" }).click();
    const details = page.getByRole("complementary", { name: "Conversation details" });
    await expect(details.locator(".collab-media-tile")).toHaveCount(1);
    const d = (await details.boundingBox())!;
    expect(d.x + d.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await noOverflow(page)).toBe(true);
    await details.getByRole("button", { name: "Close details" }).click();

    // Focus mode where it applies (desktop); harmless on a phone.
    if (viewport.width > 760) {
      await page.getByRole("button", { name: "Focus mode" }).click();
      expect(await noOverflow(page)).toBe(true);
      await page.getByRole("button", { name: "Exit focus mode" }).click();
    }
    await context.close();
  });
}

test("accessibility of V2 controls", async ({ browser }) => {
  const { client, page, context } = await signedIn(browser, "w9");
  const room = await client.createRoom({ name: "A11y room", members: ["w10"] });
  const voice = (await client.upload(room.id, FILES.webm, { durationMs: "3000" })).body.attachment;
  const img = (await client.upload(room.id, FILES.png)).body.attachment;
  const sent = (await client.send(room.id, "labelled", { attachmentIds: [voice.id, img.id] })).body.message;
  await (await Client.login("w10")).post(`/messages/${sent.id}/reactions`, { emoji: "🎉", on: true });
  await page.goto(`${HUB}?c=${room.id}`);

  for (const name of ["Attach files", "Insert emoji", "Record voice message", "Focus mode", "Show details"])
    await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play voice message" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Voice message position" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download voice message" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^🎉 1: Wes Browser10\. React$/ })).toBeVisible();
  // Typing and upload progress live regions are polite, not assertive.
  await expect(page.locator(".collab-typing")).toHaveAttribute("aria-live", "polite");

  // Lightbox is keyboard-operable and returns focus.
  const opener = page.getByRole("button", { name: /Open image/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: img.name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close image" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();

  // Room image controls are named.
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Room settings" }).getByRole("button", { name: "Add image" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Presence is text as well as colour.
  await expect(page.locator(".collab-presence").first()).toHaveAttribute("aria-label", /Online|Away|Offline|Last seen/);
  await context.close();
});
