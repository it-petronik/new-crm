import { test, expect } from "@playwright/test";
import { Client, FILES } from "../collab/client";

/**
 * Without file storage, file features are absent rather than broken: the
 * server says so, the composer offers no attach or voice control, room
 * settings offer no image, uploads refuse cleanly, and text chat and
 * notifications work exactly as before. People: pg1, pg2.
 */

test("no file storage: file features are hidden and refused; chat still works", async ({ page, context }) => {
  const [owner, member] = await Promise.all(["pg1", "pg2"].map(Client.login));
  const room = await owner.createRoom({ name: "No files room", members: ["pg2"] });

  const list = await owner.get("/conversations");
  expect(list.status).toBe(200);
  expect(list.body.files).toBe(false);

  const upload = await owner.upload(room.id, FILES.png);
  expect(upload.status).toBe(503);
  expect(upload.body.error).toBe("File storage is not available here.");
  expect((await owner.file("/api/collab/files/0000000001aaaaaaaaaaaa")).status).toBe(404);

  await owner.signInBrowser(context);
  await page.goto(`/workspace/all-companies/collaboration?c=${room.id}`);
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(message).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach files" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record voice message" })).toHaveCount(0);

  await message.fill("Text still works");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".collab-msg", { hasText: "Text still works" })).toBeVisible();
  expect((await member.page(room.id)).body.messages.at(-1).body).toBe("Text still works");

  // Room settings open as usual, with no image control.
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Room settings" });
  await expect(settings.getByRole("textbox", { name: "Room name" })).toBeVisible();
  await expect(settings.getByRole("button", { name: /Add image|Change image/ })).toHaveCount(0);
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
});
