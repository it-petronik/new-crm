import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { RealApollo, ApolloError } from "../src/lib/prospecting/provider";
import {
  diagnosticEndpoint,
  diagnosticException,
  diagnosticErrorCode,
  type ApolloDiagnostic,
} from "../src/lib/prospecting/diagnostics";
import { searchInput } from "../src/lib/prospecting/model";
const criteria = searchInput.parse({
  kind: "company",
  keywords: "private-query",
  location: "private-location",
});
const key = "fictional-secret-do-not-log";
function capture(t: TestContext) {
  const records: ApolloDiagnostic[] = [];
  t.mock.method(console, "info", (label: string, data: ApolloDiagnostic) => {
    assert.equal(label, "apollo_provider_diagnostic");
    records.push(data);
  });
  return records;
}
function safe(records: ApolloDiagnostic[]) {
  const serialized = JSON.stringify(records);
  for (const value of [
    key,
    "private-query",
    "private-location",
    "private@example.test",
    "private-body",
  ])
    assert.ok(!serialized.includes(value));
  assert.equal(records.length, 1);
  assert.deepEqual(
    Object.keys(records[0]).sort(),
    [
      "endpoint",
      "upstreamStatus",
      "errorCategory",
      "errorCode",
      "durationMs",
      "timeout",
      "responseParse",
      "fetchException",
    ].sort(),
  );
  assert.ok(records[0].durationMs >= 0);
}
test("safe diagnostics distinguish fetch failure without logging exception secrets", async (t) => {
  const records = capture(t);
  let calls = 0;
  const p = new RealApollo(key, async () => {
    calls++;
    throw new TypeError(
      `fetch failed ${key} private@example.test private-body`,
    );
  });
  await assert.rejects(p.search(criteria), /Apollo is unavailable/);
  assert.equal(calls, 1);
  safe(records);
  assert.equal(records[0].upstreamStatus, null);
  assert.equal(records[0].responseParse, "not_attempted");
  assert.equal(records[0].timeout, false);
  assert.deepEqual(records[0].fetchException, {
    class: "TypeError",
    message: "Fetch network failure",
  });
});
test("safe diagnostics retain upstream status/code without raw response, preserving rejection", async (t) => {
  const records = capture(t);
  const p = new RealApollo(key, async () =>
    Response.json(
      { error_code: "invalid_api_key", message: `${key} private-body` },
      { status: 401 },
    ),
  );
  await assert.rejects(p.search(criteria), /credential is invalid/);
  safe(records);
  assert.equal(records[0].upstreamStatus, 401);
  assert.equal(records[0].errorCode, "invalid_api_key");
  assert.equal(records[0].responseParse, "success");
  assert.equal(records[0].fetchException, null);
});
test("safe diagnostics identify malformed HTTP 200 JSON without quoting body", async (t) => {
  const records = capture(t);
  await assert.rejects(
    new RealApollo(key, async () => new Response(`private-body ${key}`)).search(
      criteria,
    ),
    /Apollo is unavailable/,
  );
  safe(records);
  assert.equal(records[0].upstreamStatus, 200);
  assert.equal(records[0].responseParse, "failure");
  assert.equal(records[0].errorCategory, "response_parse_failure");
  assert.equal(records[0].fetchException, null);
});
test("safe diagnostics record success without company data and leave returned result intact", async (t) => {
  const records = capture(t);
  const p = new RealApollo(key, async () =>
    Response.json({
      organizations: [{ id: "fictional-1", name: "private-body" }],
      pagination: { total_entries: 1 },
    }),
  );
  const result = await p.search(criteria);
  assert.equal(result.prospects[0].name, "private-body");
  safe(records);
  assert.equal(records[0].upstreamStatus, 200);
  assert.equal(records[0].responseParse, "success");
  assert.equal(records[0].errorCategory, null);
});
test("safe diagnostics observe 12 second abort without adding retries", async (t) => {
  const records = capture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const p = new RealApollo(key, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      ),
    );
  });
  const pending = assert.rejects(p.search(criteria), /Apollo timed out/);
  t.mock.timers.tick(12000);
  await pending;
  safe(records);
  assert.equal(calls, 1);
  assert.equal(records[0].timeout, true);
  assert.equal(records[0].errorCategory, "timeout");
});
test("bounded diagnostics preserve Retry-After and ignore untrusted code/message values", async (t) => {
  const records = capture(t);
  const p = new RealApollo(key, async () =>
    Response.json(
      { code: key, message: "private-body" },
      { status: 429, headers: { "Retry-After": "7" } },
    ),
  );
  await assert.rejects(
    p.search(criteria),
    (e: unknown) => e instanceof ApolloError && e.retryAfter === 7,
  );
  safe(records);
  assert.equal(records[0].errorCode, null);
  assert.equal(records[0].upstreamStatus, 429);
});
test("diagnostics omit arbitrary exception text and dynamic endpoint identifiers", () => {
  assert.equal(
    diagnosticEndpoint("webhook_result/private-body"),
    "webhook_result/:request_id",
  );
  assert.equal(diagnosticEndpoint("unknown/private-body"), "other");
  assert.equal(diagnosticErrorCode(key), null);
  assert.deepEqual(diagnosticException(new Error(key)), {
    class: "Error",
    message: "Unclassified exception; raw message withheld",
  });
});
