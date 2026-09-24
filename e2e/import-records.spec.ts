import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * CSV import against the real Workers runtime with a local D1 binding.
 * Verifies that an import goes through the ordinary create path: authorised,
 * audited, and idempotent per row.
 */
const WORKER = "http://localhost:8788";
const H = { Origin: WORKER, "Content-Type": "application/json" };
const ADMIN = { email: "admin@example.test", password: "AdminLocalPassword2026" };

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

let available = false;
test.beforeAll(async () => {
  try {
    const probe = await playwrightRequest.newContext();
    available = (await probe.get(`${WORKER}/login`)).ok();
    await probe.dispose();
  } catch { available = false; }
});
test.beforeEach(() => test.skip(!available, "Local Worker not running on :8788"));

async function sessionFor(request: APIRequestContext) {
  const response = await request.post(`${WORKER}/api/auth`, { headers: H, data: ADMIN });
  return (response.headers()["set-cookie"] || "").match(/enercore_session=([a-f0-9]+)/)?.[1] ?? "";
}
const row = (batch: string, n: number) => ({
  kind: "leads", company: "Petronik", branch: "Main",
  title: `Imported ${batch}-${n}`, contact: "Sara", product: "Base oil",
  quantity: 5, unit: "MT", amount: 1000, currency: "USD",
  due: "2026-12-01", detail: "", source: "CSV import",
  requestId: `${batch}:${n}`, importBatch: batch,
});

test("an import is authorised, audited and cannot duplicate its rows", async ({ request }) => {
  const session = await sessionFor(request);
  test.skip(!session, "admin fixture not present in local D1");
  const auth = { ...H, Cookie: `enercore_session=${session}` };
  const batch = `imp${Date.now().toString(36)}`;

  // Unauthenticated import is refused outright. A fresh context is required:
  // the shared one already holds the session cookie from signing in above.
  const anonymous = await playwrightRequest.newContext();
  expect((await anonymous.post(`${WORKER}/api/records`, { headers: H, data: row(batch, 99) })).status()).toBe(401);
  await anonymous.dispose();

  const before = Number(
    d1(`SELECT count(*) AS n FROM "BusinessRecord"`).match(/"n":\s*(\d+)/)?.[1] ?? 0,
  );

  // First pass: three rows.
  const first = await Promise.all([1, 2, 3].map((n) =>
    request.post(`${WORKER}/api/records`, { headers: auth, data: row(batch, n) })));
  expect(first.map((r) => r.status())).toEqual([201, 201, 201]);

  // Same file imported again, and a double-clicked row: neither may duplicate.
  const second = await Promise.all([1, 2, 3, 3].map((n) =>
    request.post(`${WORKER}/api/records`, { headers: auth, data: row(batch, n) })));
  for (const response of second) {
    expect(response.status()).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
  }

  const after = Number(
    d1(`SELECT count(*) AS n FROM "BusinessRecord"`).match(/"n":\s*(\d+)/)?.[1] ?? 0,
  );
  expect(after - before, "only the three original rows may exist").toBe(3);

  // Each imported record is audited like any other creation, and says it came
  // from an import without carrying file contents.
  const audit = d1(`SELECT "action" FROM "AuditEvent" WHERE "action" LIKE '%${batch}%'`);
  expect((audit.match(/CSV import/g) || []).length).toBe(3);
  expect(audit).not.toContain("Sara");
  expect(audit).not.toContain("base oil");

  // Housekeeping: remove this test's rows from the local fixture database.
  d1(`DELETE FROM "AuditEvent" WHERE "action" LIKE '%${batch}%'`);
  d1(`DELETE FROM "BusinessRecord" WHERE json_extract("payload",'$.title') LIKE 'Imported ${batch}%'`);
});

test("a row that fails validation is refused and writes nothing", async ({ request }) => {
  const session = await sessionFor(request);
  test.skip(!session, "admin fixture not present in local D1");
  const auth = { ...H, Cookie: `enercore_session=${session}` };
  const before = Number(d1(`SELECT count(*) AS n FROM "BusinessRecord"`).match(/"n":\s*(\d+)/)?.[1] ?? 0);

  const bad = { ...row("impbadbatch", 1), currency: "GBP" };
  expect((await request.post(`${WORKER}/api/records`, { headers: auth, data: bad })).status()).toBe(400);

  const after = Number(d1(`SELECT count(*) AS n FROM "BusinessRecord"`).match(/"n":\s*(\d+)/)?.[1] ?? 0);
  expect(after).toBe(before);
});
