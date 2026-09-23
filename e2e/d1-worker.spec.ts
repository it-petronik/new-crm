import { test, expect, request as playwrightRequest } from "@playwright/test";

/**
 * Integration tests for the D1 data layer, run against the real Workers
 * runtime with a local D1 binding.
 *
 *   npm run db:migrate          # once
 *   npm run cf:preview -- --port 8788
 *   npx playwright test e2e/d1-worker.spec.ts
 *
 * Skipped automatically when that Worker is not running, so the default suite
 * stays green without it.
 */
const WORKER = "http://localhost:8788";
const ORIGIN = { Origin: WORKER, "Content-Type": "application/json" };

let available = false;
test.beforeAll(async () => {
  try {
    const probe = await playwrightRequest.newContext();
    available = (await probe.get(`${WORKER}/login`)).ok();
    await probe.dispose();
  } catch {
    available = false;
  }
});
test.beforeEach(() => {
  test.skip(!available, "Local Worker not running on :8788 (npm run cf:preview)");
});

test("the Worker serves pages and static assets from D1-backed Next.js", async ({ request }) => {
  for (const path of ["/", "/login", "/icon.svg", "/brands/petronik.png"])
    expect((await request.get(`${WORKER}${path}`)).status(), path).toBe(200);
});

test("an unauthenticated API call is rejected", async ({ request }) => {
  expect((await request.get(`${WORKER}/api/records`)).status()).toBe(401);
});

test("login fails for an unknown account without revealing that it is unknown", async ({ request }) => {
  const response = await request.post(`${WORKER}/api/auth`, {
    headers: ORIGIN,
    data: { email: `absent-${Date.now()}@example.test`, password: "NotARealPassword1" },
  });
  expect(response.status()).toBe(401);
  // Same wording as a wrong password, so account existence is not disclosed.
  expect((await response.json()).error).toBe("Email or password is incorrect.");
});

test("login attempts are counted and the eleventh is blocked", async ({ request }) => {
  const email = `ratelimit-${Date.now()}@example.test`;
  const codes: number[] = [];
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await request.post(`${WORKER}/api/auth`, {
      headers: ORIGIN,
      data: { email, password: "DefinitelyWrongPassword" },
    });
    codes.push(response.status());
  }
  // Ten attempts are allowed, the eleventh is rate limited.
  expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  expect(codes[10]).toBe(429);
});

test("a cross-origin write is refused", async ({ request }) => {
  const response = await request.post(`${WORKER}/api/auth`, {
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    // The credentials are irrelevant: the origin check must reject this first.
    data: { email: "origin-check@example.invalid", password: "irrelevant" },
  });
  expect(response.status()).toBe(400);
});
