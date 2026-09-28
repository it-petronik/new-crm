import test from "node:test";
import assert from "node:assert/strict";
import { RealApollo, ApolloError } from "../src/lib/prospecting/provider";
import { searchInput } from "../src/lib/prospecting/model";
import { CommercialError } from "../src/lib/commercial/model";
import { setup, sales } from "./support/phase7";
import * as ops from "../src/lib/prospecting/operations";
const key = "fictional-redirect-test-key";
const criteria = searchInput.parse({
  kind: "company",
  keywords: "lubricant",
  location: "Kenya",
});
test("provider uses fixed HTTPS origin and Cloudflare-compatible manual fetch options", async (t) => {
  t.mock.method(console, "info", () => {});
  let calls = 0;
  const p = new RealApollo(key, async function (this: unknown, url, init) {
    assert.equal(this, undefined);
    calls++;
    assert.equal(url, "https://api.apollo.io/api/v1/mixed_companies/search");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, "POST");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("x-api-key"), key);
    return Response.json({
      organizations: [
        { id: "fictional-company", name: "Fictional lubricant maker" },
      ],
      pagination: { total_entries: 1 },
    });
  });
  const page = await p.search(criteria);
  assert.equal(page.prospects.length, 1);
  assert.equal(calls, 1);
});
for (const status of [300, 301, 302, 303, 304, 305, 307, 308, 399])
  test(`HTTP ${status} is rejected without reading Location or forwarding credentials`, async (t) => {
    const logs: unknown[] = [];
    t.mock.method(console, "info", (_label: unknown, data: unknown) =>
      logs.push(data),
    );
    let calls = 0,
      locationReads = 0;
    const p = new RealApollo(key, async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).origin, "https://api.apollo.io");
      assert.equal(init?.redirect, "manual");
      const res = new Response(null, {
        status,
        headers: { Location: `https://redirect-destination.test/${key}` },
      });
      t.mock.method(res.headers, "get", () => {
        locationReads++;
        throw new Error("Location must not be read");
      });
      return res;
    });
    await assert.rejects(
      p.search(criteria),
      (e: unknown) =>
        e instanceof ApolloError &&
        e.status === 503 &&
        e.uncertain &&
        e.message.includes("not followed"),
    );
    assert.equal(calls, 1);
    assert.equal(locationReads, 0);
    assert.ok(!JSON.stringify(logs).includes(key));
    assert.ok(!JSON.stringify(logs).includes("redirect-destination"));
    assert.deepEqual(
      (logs[0] as { errorCategory: string }).errorCategory,
      "redirect_rejected",
    );
  });
for (const [status, message] of [
  [401, /credential is invalid/],
  [402, /credits are exhausted/],
  [403, /restricted by the account/],
  [429, /rate limit reached/],
] as const)
  test(`HTTP ${status} preserves existing error and retry behavior`, async (t) => {
    t.mock.method(console, "info", () => {});
    let calls = 0;
    const p = new RealApollo(key, async () => {
      calls++;
      return Response.json(
        { error_code: "invalid_request" },
        { status, headers: { "Retry-After": "9" } },
      );
    });
    await assert.rejects(
      p.search(criteria),
      (e: unknown) =>
        e instanceof CommercialError &&
        message.test(e.message) &&
        e.status === (status === 429 ? 429 : 503) &&
        (status !== 429 || (e instanceof ApolloError && e.retryAfter === 9)),
    );
    assert.equal(calls, 1);
  });
test("redirect remains an unknown paid outcome and the same request identity cannot dispatch twice", async (t) => {
  t.mock.method(console, "info", () => {});
  const f = setup();
  let calls = 0;
  const provider = new RealApollo(key, async () => {
    calls++;
    return new Response(null, {
      status: 307,
      headers: { Location: "https://redirect-destination.test" },
    });
  });
  const operation = await ops.prepare(f.db, sales, {
    company: "Petronik",
    branch: "Main",
    requestId: "redirect-identity",
    type: "search",
    criteria,
  });
  const result = await ops.advance(f.db, sales, operation.id, true, provider);
  assert.equal(result.status, "unknown");
  await ops.advance(f.db, sales, operation.id, true, provider);
  assert.equal(calls, 1);
  const receipt = f.sqlite
    .prepare("SELECT actualCredits,status FROM ApolloUsage WHERE operationId=?")
    .get(operation.id) as { actualCredits: null; status: string };
  assert.equal(receipt.actualCredits, null);
  assert.equal(receipt.status, "unknown");
});
