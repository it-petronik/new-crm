import { test, expect } from "@playwright/test";

/**
 * Preview mode (this suite's dev server runs APP_MODE=preview) has no
 * Enercore AI: every AI endpoint refuses before anything runs, the sidebar
 * has no AI entry, and a direct link explains. Live behaviour is covered by
 * e2e/collab/ai.spec.ts and ai-ui.spec.ts against the built Worker.
 */

test("AI endpoints refuse preview mode", async ({ request, baseURL }) => {
  const headers = { Origin: baseURL!, "Content-Type": "application/json" };
  expect((await request.get("/api/ai")).status()).toBe(409);
  for (const [feature, data] of [
    ["lead", { id: "EC-1" }],
    ["customer", { id: "EC-1" }],
    ["meeting", { id: "m1" }],
    ["conversation", { id: "c1" }],
    ["ask", { question: "How is the pipeline?" }],
    ["sales/today", { scope: "mine" }],
    ["sales/lead-brief", { id: "EC-1" }],
    ["sales/draft", { id: "EC-1", channel: "email", tone: "professional", purpose: "follow_up" }],
    ["sales/quote-prep", { id: "EC-1" }],
    ["sales/meeting-review", { id: "m1" }],
  ] as const)
    expect((await request.post(`/api/ai/${feature}`, { headers, data })).status(), feature).toBe(409);
  for (const path of ["/api/ai/sales/today", "/api/ai/sales/lead?id=EC-1"]) expect((await request.get(path)).status(), path).toBe(409);
});

test("no Enercore AI in the preview workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Enercore AI" })).toHaveCount(0);
  await page.goto("/workspace/all-companies/enercore-ai");
  await expect(page.getByText("Enercore AI isn't available in the preview.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your question" })).toHaveCount(0);
});
