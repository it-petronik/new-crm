import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Administrator-issued password reset, against the real Workers runtime with a
 * local D1 binding.
 *
 *   npm run db:migrate
 *   npm run cf:preview -- --port 8788      (APP_MODE must NOT be "preview")
 *   npx playwright test e2e/password-reset.spec.ts
 *
 * Skips itself when that Worker is not running, so the default suite stays
 * green without it. Uses local fixture accounts only; never remote D1.
 */
const WORKER = "http://localhost:8788";
const H = { Origin: WORKER, "Content-Type": "application/json" };
const ADMIN = { email: "admin@example.test", password: "AdminLocalPassword2026" };

/**
 * Clears only this spec's own rate-limit counters so a re-run is not throttled
 * by the previous one. The issuance limit deliberately counts rejected
 * attempts too, which is correct in production but accumulates across runs.
 *
 * Scoped deliberately: emptying the whole table would race other specs sharing
 * this local database — notably the login rate-limit test — when Playwright
 * runs spec files in parallel. Login counters are keyed by SHA-256 of the
 * address, matching `hashToken`. Local D1 only; remote is never touched.
 */
const loginKey = (email: string) => createHash("sha256").update(email).digest("hex");

function resetLocalRateLimits() {
  const keys = [ADMIN.email, "staff@example.test"].map(loginKey).map((k) => `'${k}'`);
  try {
    execFileSync(
      "npx",
      [
        "wrangler", "d1", "execute", "enercore-crm", "--local", "--command",
        `DELETE FROM "LoginAttempt" WHERE "key" LIKE 'reset-%' OR "key" IN (${keys.join(",")})`,
      ],
      { stdio: "ignore" },
    );
  } catch {
    // Not fatal: the tests simply start with whatever counters exist.
  }
}

let available = false;
test.beforeAll(async () => {
  try {
    const probe = await playwrightRequest.newContext();
    available = (await probe.get(`${WORKER}/login`)).ok();
    await probe.dispose();
  } catch {
    available = false;
  }
  if (available) resetLocalRateLimits();
});
test.beforeEach(() => {
  test.skip(!available, "Local Worker not running on :8788 (npm run cf:preview)");
});

async function sessionFor(request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${WORKER}/api/auth`, { headers: H, data: { email, password } });
  const cookie = (response.headers()["set-cookie"] || "").match(/enercore_session=([a-f0-9]+)/);
  return cookie?.[1] ?? "";
}

test("only an authorised administrator can issue a reset link", async ({ request }) => {
  // No session at all.
  const anonymous = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: H, data: { userId: "user-1" },
  });
  expect(anonymous.status()).toBe(401);

  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");

  // An administrator may not reset their own account; that is what a second
  // administrator is for.
  const self = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: { ...H, Cookie: `enercore_session=${admin}` },
    data: { userId: "admin-1" },
  });
  expect(self.status()).toBe(403);
});

test("a reset link is issued once and reveals no password material", async ({ request }) => {
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");
  const response = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: { ...H, Cookie: `enercore_session=${admin}` },
    data: { userId: "user-1" },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.link).toContain("/reset-password?token=");
  expect(body.expiresInMinutes).toBe(30);
  // The response must never carry a stored credential.
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("passwordHash");
  expect(raw).not.toContain("argon2");
});

test("issuing a new link invalidates the previous one", async ({ request }) => {
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");
  const headers = { ...H, Cookie: `enercore_session=${admin}` };
  const first = await (await request.post(`${WORKER}/api/users/reset-link`, { headers, data: { userId: "user-1" } })).json();
  await request.post(`${WORKER}/api/users/reset-link`, { headers, data: { userId: "user-1" } });
  const stale = first.link.split("token=")[1];

  const used = await request.post(`${WORKER}/api/password-reset/confirm`, {
    headers: H, data: { token: stale, password: "SupersededPassword26" },
  });
  expect(used.status()).toBe(400);
  expect((await used.json()).error).toContain("invalid or has expired");
});

test("malformed, tampered and weak input are all rejected", async ({ request }) => {
  const cases = [
    { token: "", password: "LongEnoughPassword26", why: "empty token" },
    { token: "z".repeat(64), password: "LongEnoughPassword26", why: "non-hex token" },
    { token: "a".repeat(63), password: "LongEnoughPassword26", why: "wrong length" },
    { token: "a".repeat(64), password: "short", why: "weak password" },
  ];
  for (const { token, password, why } of cases) {
    const response = await request.post(`${WORKER}/api/password-reset/confirm`, {
      headers: H, data: { token, password },
    });
    expect(response.status(), why).toBe(400);
  }
});

test("a cross-origin reset attempt is refused", async ({ request }) => {
  const response = await request.post(`${WORKER}/api/password-reset/confirm`, {
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    data: { token: "a".repeat(64), password: "LongEnoughPassword26" },
  });
  expect(response.status()).toBe(400);
});

/** Issues a link for the staff fixture and resets it to `password`. */
async function resetStaffTo(request: APIRequestContext, adminSession: string, password: string) {
  const issued = await (
    await request.post(`${WORKER}/api/users/reset-link`, {
      headers: { ...H, Cookie: `enercore_session=${adminSession}` },
      data: { userId: "user-1" },
    })
  ).json();
  const token = issued.link.split("token=")[1];
  const done = await request.post(`${WORKER}/api/password-reset/confirm`, {
    headers: H,
    data: { token, password },
  });
  return { token, status: done.status() };
}

test("a token works exactly once and cannot be replayed", async ({ request }) => {
  resetLocalRateLimits();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");
  // Self-contained: this test sets the password it then signs in with, so it
  // does not depend on any other test having run first.
  const password = `ReplayOnce${Date.now()}Ab`;
  const { token, status } = await resetStaffTo(request, admin, password);
  expect(status).toBe(200);

  // The row is deleted on use, so a replay cannot succeed.
  const replay = await request.post(`${WORKER}/api/password-reset/confirm`, {
    headers: H,
    data: { token, password: "DifferentPassword2026" },
  });
  expect(replay.status()).toBe(400);

  // The password this test set is the one that works.
  expect(await sessionFor(request, "staff@example.test", password)).not.toBe("");
  // The replay's password was never applied.
  expect(await sessionFor(request, "staff@example.test", "DifferentPassword2026")).toBe("");
});

test("a completed reset ends every session for that user", async ({ request }) => {
  resetLocalRateLimits();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");

  // Establish a known password, then sign in so there is a session to kill.
  const first = `SessionAlive${Date.now()}Ab`;
  expect((await resetStaffTo(request, admin, first)).status).toBe(200);
  const staffSession = await sessionFor(request, "staff@example.test", first);
  expect(staffSession, "staff should be signed in before the second reset").not.toBe("");
  expect(
    (await request.get(`${WORKER}/api/records`, { headers: { Cookie: `enercore_session=${staffSession}` } })).status(),
  ).toBe(200);

  // Second reset must terminate that session.
  const second = `SessionDead${Date.now()}Ab`;
  expect((await resetStaffTo(request, admin, second)).status).toBe(200);

  const after = await request.get(`${WORKER}/api/records`, {
    headers: { Cookie: `enercore_session=${staffSession}` },
  });
  expect(after.status(), "the pre-reset session must be dead").toBe(401);

  // The administrator's own session is unaffected.
  expect(
    (await request.get(`${WORKER}/api/records`, { headers: { Cookie: `enercore_session=${admin}` } })).status(),
  ).toBe(200);
});

test("only one of several simultaneous redemptions can succeed", async ({ request }) => {
  resetLocalRateLimits();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");

  const issued = await (
    await request.post(`${WORKER}/api/users/reset-link`, {
      headers: { ...H, Cookie: `enercore_session=${admin}` },
      data: { userId: "user-1" },
    })
  ).json();
  const token = issued.link.split("token=")[1];

  // Six requests race for the same token, each with a different password.
  const candidates = Array.from({ length: 6 }, (_, i) => `RacePassword${i}${Date.now()}`);
  const responses = await Promise.all(
    candidates.map((password) =>
      request.post(`${WORKER}/api/password-reset/confirm`, { headers: H, data: { token, password } }),
    ),
  );
  const statuses = responses.map((r) => r.status());
  const winners = statuses.filter((s) => s === 200);
  const losers = statuses.filter((s) => s !== 200);

  expect(winners, `exactly one redemption may succeed, got ${JSON.stringify(statuses)}`).toHaveLength(1);
  expect(losers).toHaveLength(5);
  // Six attempts sit well under the per-token limit of ten, so a throttled
  // response here would mean the race was never actually exercised.
  expect(statuses.filter((s) => s === 429), "no redemption may be throttled").toHaveLength(0);

  // Every loser must fail because it lost the race, not because a rate limit
  // cut it short — six attempts sit well under the per-token limit of ten.
  // Otherwise this test could pass without ever exercising the race.
  for (const response of responses) {
    if (response.status() === 200) continue;
    expect(response.status(), "losers must be genuine race losses, not throttling").toBe(400);
    const body = await response.json();
    // Byte-for-byte the message an unknown or expired token gets, so the race
    // outcome is indistinguishable from any other failure.
    expect(body.error).toBe(
      "That reset link is invalid or has expired. Ask an administrator for a new one.",
    );
    expect(JSON.stringify(body)).not.toContain(token);
  }

  // Exactly one candidate password is now live, and it is the winner's.
  const working: string[] = [];
  for (const password of candidates)
    if (await sessionFor(request, "staff@example.test", password)) working.push(password);
  expect(working, "exactly one password may have been applied").toHaveLength(1);

  // The token is spent: a further attempt still fails.
  const after = await request.post(`${WORKER}/api/password-reset/confirm`, {
    headers: H, data: { token, password: "AfterTheRacePassword26" },
  });
  expect(after.status()).not.toBe(200);
});

/** Runs one statement against the local D1 database and returns its output. */
function d1(command: string) {
  return execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "enercore-crm", "--local", "--json", "--command", command],
    { encoding: "utf8" },
  );
}

/**
 * Forces the fail-closed window deliberately.
 *
 * A user with no company makes the audit insert violate its NOT NULL
 * constraint, so the consequences batch fails *after* the token has been
 * claimed. That is the one path that cannot be reached through the UI, and the
 * behaviour it proves is the whole point of claiming before committing:
 * the token is spent, the password is not changed, and the caller is told
 * exactly what an invalid token would have been told.
 *
 * Local D1 only, with a throwaway account removed afterwards.
 */
const BROKEN_USER = "failclosed-user-local";
const SENTINEL = "$argon2id$sentinel$must$not$change";

test("an internal failure after the token is claimed stays generic and changes no password", async ({
  request,
}) => {
  resetLocalRateLimits();
  const token = createHash("sha256").update(`fixture-${Date.now()}`).digest("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  try {
    d1(
      `INSERT INTO "User" ("id","email","name","passwordHash","role","companies","branches","moduleAccess","active","createdAt")` +
        ` VALUES ('${BROKEN_USER}','failclosed.local@example.test','Fail Closed','${SENTINEL}','Sales Executive','[]','[]','{}',1,${now})`,
    );
    d1(
      `INSERT INTO "PasswordReset" ("id","userId","issuedBy","issuedByName","expiresAt","createdAt")` +
        ` VALUES ('${tokenHash}','${BROKEN_USER}','admin-1','Local Admin',${now + 30 * 60_000},${now})`,
    );

    const response = await request.post(`${WORKER}/api/password-reset/confirm`, {
      headers: H,
      data: { token, password: "FailClosedPassword2026" },
    });

    // Byte-identical to an unknown or expired token: the internal fault is not
    // distinguishable from outside.
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe(
      "That reset link is invalid or has expired. Ask an administrator for a new one.",
    );

    // The claim committed, so the link is spent and cannot be retried.
    expect(d1(`SELECT "id" FROM "PasswordReset" WHERE "id" = '${tokenHash}'`)).not.toContain(tokenHash);
    // The consequences rolled back, so no password was applied.
    expect(d1(`SELECT "passwordHash" FROM "User" WHERE "id" = '${BROKEN_USER}'`)).toContain(SENTINEL);
  } finally {
    d1(`DELETE FROM "PasswordReset" WHERE "userId" = '${BROKEN_USER}'`);
    d1(`DELETE FROM "User" WHERE "id" = '${BROKEN_USER}'`);
  }
});
