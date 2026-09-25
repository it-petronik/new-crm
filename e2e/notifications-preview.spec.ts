import { test, expect } from "@playwright/test";

/**
 * Preview mode (this suite's dev server runs APP_MODE=preview) never reads
 * or writes the notification inbox: reads are empty and every write is
 * refused before anything is touched. Live behaviour is covered by
 * e2e/collab/notifications.spec.ts against the built Worker.
 */

test("notification APIs refuse to write in preview, and read nothing", async ({ request, baseURL }) => {
  const headers = { Origin: baseURL!, "Content-Type": "application/json" };
  const id = "0000000001aaaaaaaaaaaa";
  const writes = [
    request.patch("/api/notifications", { headers, data: { action: "read", ids: [id] } }),
    request.patch("/api/notifications", { headers, data: { action: "read_all", upTo: id } }),
    request.put("/api/notifications/preferences", { headers, data: { desktop: true, preview: false } }),
  ];
  for (const response of await Promise.all(writes)) expect(response.status()).toBe(409);

  const read = await request.get("/api/notifications");
  expect(read.status()).toBe(200);
  expect(await read.json()).toEqual({
    items: [],
    unread: 0,
    nextBefore: null,
    preferences: { desktop: false, preview: true },
  });
});

test("preview cannot assign records or list assignees", async ({ request, baseURL }) => {
  const assign = await request.patch("/api/records", {
    headers: { Origin: baseURL!, "Content-Type": "application/json" },
    data: { action: "assign", id: "EC-1", assigneeId: "someone" },
  });
  // Refused before any read or write: by the preview guard, or by the
  // origin check that precedes it when APP_URL names another origin.
  expect([400, 409]).toContain(assign.status());
  expect((await request.get("/api/records/assignees?id=EC-1")).status()).toBe(401);
});

test("the preview workspace shows an empty notification centre without errors", async ({ page }) => {
  await page.goto("/?view=notifications");
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open notifications", exact: true })).toBeVisible();
});
