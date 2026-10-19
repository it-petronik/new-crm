import test from "node:test";
import assert from "node:assert/strict";
import {
  friendlyError,
  requestJson,
  readJsonResponse,
} from "../src/lib/client-request";
test("technical errors and HTML are never shown as user-facing messages", async () => {
  assert.equal(
    friendlyError(
      new SyntaxError("Unexpected token <, not valid JSON"),
      "Try again safely.",
    ),
    "Try again safely.",
  );
  assert.equal(
    friendlyError("SQLITE_CONSTRAINT: secret query", "Try again."),
    "Try again.",
  );
  assert.equal(
    friendlyError("Choose at least one company."),
    "Choose at least one company.",
  );
  await assert.rejects(
    readJsonResponse(
      new Response("<!DOCTYPE html><h1>Server busy</h1>", { status: 503 }),
      "The account list couldn’t load.",
    ),
    /account list couldn’t load/,
  );
  await assert.rejects(
    readJsonResponse(Response.json({ error: "Unauthorized" }, { status: 401 })),
    /sign in again/,
  );
  await assert.rejects(readJsonResponse(Response.json(null)), /couldn’t load/);
});
test("safe reads retry a malformed transient response, writes never replay, and validation fields survive", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () =>
      ++calls === 1
        ? new Response("<html>Temporary error</html>")
        : Response.json({ users: [] });
    assert.deepEqual(await requestJson("/api/users"), { users: [] });
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      requestJson("/api/users", { method: "POST", body: "{}" }),
      /couldn’t confirm this change/,
    );
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json(
        {
          error: "Check the email address.",
          fields: { email: "Enter a work email." },
        },
        { status: 400 },
      );
    };
    await assert.rejects(requestJson("/api/users", { method: "POST" }), (e) => {
      assert.equal((e as any).fields.email, "Enter a work email.");
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
