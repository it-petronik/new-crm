import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Readiness check for adding a SECOND administrator, against the real Workers
 * runtime with a local D1 binding.
 *
 *   npm run db:migrate
 *   npm run cf:preview -- --port 8788
 *   npx playwright test e2e/second-administrator.spec.ts
 *
 * Creates its administrator in LOCAL D1 only, with a throwaway address, and
 * removes it afterwards. The production administrator is never created here.
 */
const WORKER = "http://localhost:8788";
const H = { Origin: WORKER, "Content-Type": "application/json" };
const ADMIN = { email: "admin@example.test", password: "AdminLocalPassword2026" };

const SECOND = {
  email: `second.admin.local@example.test`,
  password: "SecondAdminLocalPassword2026",
  name: "Second Administrator",
};

/**
 * Runs one statement against the local D1 database and returns its output.
 *
 * Retries briefly: the preview Worker holds this same local SQLite file open
 * while serving the suite, so an external write can lose a lock race when spec
 * files run in parallel. The contention is transient, and retrying is
 * preferable to serialising the suite or loosening what the test asserts.
 */
function d1(command: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return execFileSync(
        "npx",
        ["wrangler", "d1", "execute", "enercore-crm", "--local", "--json", "--command", command],
        { encoding: "utf8" },
      );
    } catch (error) {
      last = error;
      execFileSync("sleep", [String(0.4 * (attempt + 1))]);
    }
  }
  throw last;
}
/**
 * Removes this spec's throwaway administrator and only its own rate-limit
 * counters. Scoped rather than truncating the table, so it cannot race other
 * specs sharing this local database when spec files run in parallel.
 */
const loginKey = (email: string) => createHash("sha256").update(email).digest("hex");

function cleanUp() {
  const keys = [ADMIN.email, SECOND.email].map(loginKey).map((k) => `'${k}'`);
  try {
    d1(`DELETE FROM "User" WHERE "email" = '${SECOND.email}'`);
    d1(`DELETE FROM "LoginAttempt" WHERE "key" LIKE 'reset-%' OR "key" IN (${keys.join(",")})`);
  } catch {
    // Local fixture housekeeping only; never fatal.
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
  if (available) cleanUp();
});
test.afterAll(() => {
  if (available) cleanUp();
});
test.beforeEach(() => {
  test.skip(!available, "Local Worker not running on :8788 (npm run cf:preview)");
});

async function sessionFor(request: APIRequestContext, email: string, password: string) {
  const response = await request.post(`${WORKER}/api/auth`, { headers: H, data: { email, password } });
  const cookie = (response.headers()["set-cookie"] || "").match(/enercore_session=([a-f0-9]+)/);
  return cookie?.[1] ?? "";
}
const as = (session: string) => ({ ...H, Cookie: `enercore_session=${session}` });

/**
 * Creates the second administrator exactly as the Access Control form does,
 * and returns its id. `branches` mirrors the first administrator's scope,
 * which is what makes the two accounts peers.
 */
async function createSecondAdmin(request: APIRequestContext, session: string, branches: string[]) {
  const response = await request.post(`${WORKER}/api/users`, {
    headers: as(session),
    data: {
      name: SECOND.name,
      email: SECOND.email,
      password: SECOND.password,
      role: "MD",
      companies: ["Petronik", "Afrilube", "Petronex", "Istanegry"],
      branches,
      moduleAccess: {},
    },
  });
  return { status: response.status(), body: await response.json() };
}

test("an MD can create a second MD, stored with Argon2id and recorded in the audit history", async ({ request }) => {
  cleanUp();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");

  const created = await createSecondAdmin(request, admin, []);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.user.role).toBe("MD");
  // The response must never carry password material.
  expect(JSON.stringify(created.body)).not.toContain(SECOND.password);
  expect(JSON.stringify(created.body)).not.toContain("passwordHash");

  // The password is stored as Argon2id, not bcrypt and not plaintext.
  const stored = d1(`SELECT "passwordHash" FROM "User" WHERE "email" = '${SECOND.email}'`);
  expect(stored).toContain("$argon2id$");
  expect(stored).not.toContain(SECOND.password);

  // The creation is attributable: who did it, to whom, and that it was an MD.
  const audit = d1(
    `SELECT "actor","actorId","action" FROM "AuditEvent" WHERE "recordId" = '${created.body.user.id}'`,
  );
  expect(audit, "creating an administrator must be audited").toContain("Created user");
  expect(audit).toContain("(MD)");
  expect(audit).toContain("admin-1");
  expect(audit).not.toContain(SECOND.password);

  // Note: the row is persisted and attributable, but the Activity log only
  // surfaces events whose recordId matches a visible business record, so
  // account-administration events are not currently shown there. That is a
  // pre-existing display filter in scopedWorkspace, not a gap in the record.

  // The new administrator can sign in and administer users.
  const second = await sessionFor(request, SECOND.email, SECOND.password);
  expect(second, "the second administrator must be able to sign in").not.toBe("");
  expect((await request.get(`${WORKER}/api/users`, { headers: as(second) })).status()).toBe(200);
});

test("the two administrators can reset each other but never themselves", async ({ request }) => {
  cleanUp();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");
  const created = await createSecondAdmin(request, admin, []);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const secondId = created.body.user.id;
  const second = await sessionFor(request, SECOND.email, SECOND.password);
  expect(second).not.toBe("");

  // First administrator issues for the second.
  const forward = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: as(admin), data: { userId: secondId },
  });
  expect(forward.status(), await forward.text()).toBe(200);

  // Second administrator issues for the first. This is the recovery path that
  // makes a lost MD password survivable without touching the database.
  const backward = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: as(second), data: { userId: "admin-1" },
  });
  expect(backward.status(), await backward.text()).toBe(200);

  // Neither may issue for itself, in either direction.
  expect(
    (await request.post(`${WORKER}/api/users/reset-link`, { headers: as(admin), data: { userId: "admin-1" } })).status(),
  ).toBe(403);
  expect(
    (await request.post(`${WORKER}/api/users/reset-link`, { headers: as(second), data: { userId: secondId } })).status(),
  ).toBe(403);

  // Nor may either edit its own access.
  expect(
    (
      await request.patch(`${WORKER}/api/users`, {
        headers: as(second),
        data: { id: secondId, role: "MD", companies: ["Petronik"], branches: [], moduleAccess: {} },
      })
    ).status(),
  ).toBe(400);
});

test("a branch-scoped second MD cannot administer the unscoped first MD", async ({ request }) => {
  cleanUp();
  const admin = await sessionFor(request, ADMIN.email, ADMIN.password);
  test.skip(!admin, "admin fixture not present in local D1");

  // The first administrator is group-wide (branches: []). Giving the second a
  // branch list makes it a subordinate, not a peer: scope checks compare the
  // target's branches against the actor's, and an unscoped target is outside
  // any branch list. Mutual recovery would then only work one way, which is
  // the failure this guards against.
  const created = await createSecondAdmin(request, admin, ["Main"]);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const second = await sessionFor(request, SECOND.email, SECOND.password);
  expect(second).not.toBe("");

  const backward = await request.post(`${WORKER}/api/users/reset-link`, {
    headers: as(second), data: { userId: "admin-1" },
  });
  expect(backward.status(), "a branch-scoped MD must not reach the group-wide MD").toBe(403);

  // And it cannot even see that account in Access Control.
  const visible = await (await request.get(`${WORKER}/api/users`, { headers: as(second) })).json();
  expect(visible.users.some((u: { id: string }) => u.id === "admin-1")).toBe(false);
});
