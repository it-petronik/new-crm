import { test, expect } from "@playwright/test";

/**
 * Preview mode (this suite's dev server runs APP_MODE=preview) has no
 * collaboration backend: every API refuses before touching anything, and the
 * page explains rather than failing. The live behaviour is covered by the
 * separate Collaboration suite (playwright.collab.config.ts).
 */

test("collaboration APIs refuse preview mode", async ({ request, baseURL }) => {
  const origin = { Origin: baseURL!, "Content-Type": "application/json" };
  const id = "00000000-0000-4000-8000-000000000000";
  const calls = [
    request.get("/api/collab/conversations"),
    request.get("/api/collab/summary"),
    request.get("/api/collab/mentions"),
    request.get(`/api/collab/conversations/${id}/messages`),
    request.post("/api/collab/conversations", { headers: origin, data: { kind: "direct", userId: id } }),
    request.post(`/api/collab/conversations/${id}/messages`, { headers: origin, data: { body: "hi" } }),
    request.patch(`/api/collab/messages/${id}`, { headers: origin, data: { body: "hi" } }),
  ];
  for (const response of await Promise.all(calls)) expect(response.status()).toBe(409);
});

test("the Collaboration page explains preview instead of breaking", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Collaboration", exact: true }).first().click();
  await expect(page).toHaveURL(/\/collaboration/);
  await expect(page.getByText("Collaboration is part of the live workspace.")).toBeVisible();
});

test("meetings refuse preview mode: no creation, no join tokens, no provider webhook", async ({ request, baseURL }) => {
  const origin = { Origin: baseURL!, "Content-Type": "application/json" };
  const id = "0000000001aaaaaaaaaaaa";
  const calls = [
    request.get(`/api/collab/conversations/${id}/meetings`),
    request.post(`/api/collab/conversations/${id}/meetings`, { headers: origin, data: { mode: "now", media: "video" } }),
    request.get(`/api/collab/meetings/${id}`),
    request.post(`/api/collab/meetings/${id}/join`, { headers: origin, data: {} }),
    request.post(`/api/collab/meetings/${id}/end`, { headers: origin, data: {} }),
  ];
  for (const response of await Promise.all(calls)) expect(response.status()).toBe(409);
  expect((await request.post("/api/meetings/webhook", { data: "{}" })).status()).toBe(404);
});

test("preview never signs anyone in: no refresh, no session, no remember-me, no guest links", async ({ request, page, baseURL, context }) => {
  const origin = { Origin: baseURL!, "Content-Type": "application/json" };
  // A refresh credential (even a well-formed one) is refused outright.
  await context.addCookies([{ name: "enercore_refresh", value: "a".repeat(64), url: baseURL! }]);
  expect((await request.post("/api/auth/refresh", { headers: { Origin: baseURL!, Cookie: `enercore_refresh=${"a".repeat(64)}` } })).status()).toBe(503);
  expect(await (await request.get("/api/auth")).json()).toEqual({ signedIn: false });
  // Credential sign-in is refused, and nothing is set.
  const signIn = await request.post("/api/auth", { headers: origin, data: { email: "md@enercore.test", password: "x", remember: true } });
  expect(signIn.ok()).toBe(false);
  expect(signIn.headers()["set-cookie"] ?? "").not.toMatch(/enercore_(session|refresh)=[0-9a-f]/);
  expect((await request.post("/api/meet/lookup", { headers: origin, data: { token: "x".repeat(43) } })).status()).toBe(404);
  // The login page offers demo accounts only: no "keep me signed in", no resume.
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /md@enercore.test/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Keep me signed in/ })).toHaveCount(0);
  await expect(page.getByText("Signing you back in")).toHaveCount(0);
});
