import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { d1, migratedDatabase } from "./support/sqlite-d1";
import * as schema from "../src/lib/schema";
import type { Database } from "../src/lib/d1";
import { configuredAi, AI_MODELS, modelsFor } from "../src/lib/ai/config";
import { createGroqBinding } from "../src/lib/ai/groq";
import { AiError, structuredCall } from "../src/lib/ai/model";
import { estimatedTokens, reserveGroqAttempt } from "../src/lib/ai/budget";
import { redactSensitive } from "../src/lib/ai/sanitize";
import { detectInquiry, fillEmptyFields, verifiedCapture } from "../src/lib/ai/capture-fields";

const request = {messages: [{role: "user", content: "Fictional inquiry"}], response_format: {json_schema: {type: "object", properties: {ok: {type: "boolean"}}}}, max_tokens: 1400, temperature: .2};
const completed = (content = '{"ok":true}') => Response.json({choices: [{message: {content, reasoning: "Do not display this"}}], usage: {prompt_tokens: 42, completion_tokens: 12}});

test("Groq adapter fixes host/model, keeps secret server-side and suppresses reasoning", async () => {
  const fakeKey = "fictional-unit-test-secret";
  let body: any, headers: Headers | undefined;
  const ai = createGroqBinding(fakeKey, (async (url, init) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(init?.redirect, "error");
    headers = new Headers(init?.headers); body = JSON.parse(String(init?.body));
    return completed();
  }) as typeof fetch);
  const result = await ai.run(AI_MODELS.primary, request) as any;
  assert.equal(headers!.get("Authorization"), `Bearer ${fakeKey}`);
  assert.equal(body.include_reasoning, false);
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_completion_tokens, 1400);
  assert.equal(body.response_format.json_schema.strict, false);
  assert.deepEqual(body.response_format.json_schema.schema, request.response_format.json_schema);
  assert.deepEqual(result, {response: '{"ok":true}', usage: {prompt_tokens: 42, completion_tokens: 12}});
  assert.doesNotMatch(JSON.stringify(result), /reasoning|fictional-unit-test-secret/);
  await assert.rejects(ai.run("unapproved-model", request), (e: any) => e.status === 400);
});

test("preview, unknown provider, old Cloudflare binding and missing key never enable inference", async () => {
  assert.equal(await configuredAi({APP_MODE: "preview", GROQ_API_KEY: "fictional"}), null);
  assert.equal(await configuredAi({AI_PROVIDER: "workers-ai", GROQ_API_KEY: "fictional"}), null);
  assert.equal(await configuredAi({AI_PROVIDER: "groq"}), null);
  assert.equal(await configuredAi({AI: {run: () => {throw Error("Must not run");}}} as never), null);
  const ai = await configuredAi({AI_PROVIDER: "groq", GROQ_API_KEY: "fictional"});
  assert.equal(ai?.provider, "groq");
  assert.deepEqual(modelsFor(ai!, "primary"), ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n"));
  assert.equal(config.env.live.vars.AI_PROVIDER, "groq");
  assert.equal(config.env.live.ai, undefined); assert.equal(config.ai, undefined);
});

for (const [status, expected] of [[401, 503], [403, 503], [429, 429], [400, 400], [500, 502]]) test(`Groq ${status} produces a safe human-readable error`, async () => {
  const ai = createGroqBinding("fictional-secret", (async () => new Response("Private prompt and token must not escape", {status})) as typeof fetch);
  await assert.rejects(ai.run(AI_MODELS.primary, request), (e: any) => {
    assert.equal(e.status, expected); assert.doesNotMatch(e.message, /Private prompt|token|fictional-secret/); return true;
  });
});

test("a quota or authentication error never retries another model/provider", async () => {
  for (const status of [401, 429]) {
    let calls = 0;
    const ai = createGroqBinding("fictional", (async () => {calls++; return new Response("not retained", {status});}) as typeof fetch);
    await assert.rejects(structuredCall({ai, system: "Fictional", prompt: "test", schema: z.object({ok: z.boolean()}), jsonSchema: {}, models: modelsFor(ai, "primary")}));
    assert.equal(calls, 1);
  }
});

test("timeout aborts the outgoing fetch; fallback is at most one other Groq model", async () => {
  let aborted = false, calls = 0;
  const ai = createGroqBinding("fictional", (async (_url, init) => {
    calls++;
    if (calls > 1) return completed();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => {aborted = true; reject(Error("aborted"));}));
  }) as typeof fetch);
  const result = await structuredCall({ai, system: "test", prompt: "test", schema: z.object({ok: z.boolean()}), jsonSchema: {}, models: modelsFor(ai, "primary"), timeoutMs: 10});
  assert.equal(aborted, true); assert.equal(calls, 2); assert.equal(result.model, AI_MODELS.fallback);
});

test("malformed, oversized and content-less responses are refused", async () => {
  for (const response of [new Response("<html>bad</html>"), new Response("x".repeat(128001)), Response.json({choices: []})]) {
    const ai = createGroqBinding("fictional", (async () => response) as typeof fetch);
    await assert.rejects(ai.run(AI_MODELS.primary, request), (e: any) => e instanceof AiError && e.status === 502);
  }
});

test("provider secrets are redacted even without a key label", () => {
  const fictional = `gsk_${"fictional".repeat(6)}`;
  assert.doesNotMatch(redactSensitive(`Note: ${fictional}`), /gsk_|fictional/);
});

test("attempt reservations are atomic, include schema/output and reconcile actual usage", async () => {
  const sqlite = migratedDatabase(), db = drizzle(d1(sqlite) as never, {schema}) as Database;
  try {
    assert.ok(estimatedTokens("x", "y", {a: "z"}, 100) > 610);
    const settled = await reserveGroqAttempt(db, 5000);
    await settled({promptTokens: 100, completionTokens: 50});
    assert.equal(sqlite.prepare('SELECT count FROM LoginAttempt WHERE key=?').get("ai-groq-tokens-minute")!.count, 150);
    await Promise.all([reserveGroqAttempt(db, 3000), reserveGroqAttempt(db, 3000)]);
    await assert.rejects(reserveGroqAttempt(db, 1000), (e: any) => e.status === 429);
    await assert.rejects(reserveGroqAttempt(db, 7001), (e: any) => e.status === 400);
    assert.equal(sqlite.prepare('SELECT count FROM LoginAttempt WHERE key=?').get("ai-groq-calls-day")!.count, 3);
  } finally {sqlite.close();}
});

test("late reconciliation never credits a fresh budget window", async () => {
  const sqlite = migratedDatabase(), db = drizzle(d1(sqlite) as never, {schema}) as Database;
  try {
    const settle = await reserveGroqAttempt(db, 5000);
    sqlite.prepare('UPDATE LoginAttempt SET resetAt=resetAt+12345, count=6000').run();
    await settle({promptTokens: 1, completionTokens: 1});
    assert.equal(sqlite.prepare('SELECT count FROM LoginAttempt WHERE key=?').get("ai-groq-tokens-minute")!.count, 6000);
  } finally {sqlite.close();}
});

test("local inquiry detection extracts explicit details without guessing commercial decisions", () => {
  const draft = detectInquiry("Company: Fictional Acme\nContact: Alex\nProduct: Base Oil SN500\n80 KG\nDestination: Mombasa\nEmail: buyer@example.com\nPhone: +971 50 123 4567");
  assert.deepEqual(draft, {title: "Fictional Acme", contact: "Alex", product: "Base Oil SN500", destination: "Mombasa", email: "buyer@example.com", phone: "+971 50 123 4567", grade: "SN500", quantity: "80", unit: "KG"});
  const ambiguous = detectInquiry("Company: A buyer\nCompany: Another buyer\n10 MT or 50 KG. a@example.com or b@example.com");
  assert.equal(ambiguous.title, undefined); assert.equal(ambiguous.quantity, undefined); assert.equal(ambiguous.email, undefined);
  assert.equal(detectInquiry("-80 KG SN500 or SN150").quantity, undefined);
  assert.equal(detectInquiry("SN500 or SN150").grade, undefined);
});

test("filling from an inquiry preserves entered values and keeps quantity/unit paired", () => {
  const current = {title: "Typed by user", email: "typed@example.com", unit: "KG"};
  assert.deepEqual(fillEmptyFields(current, {title: "Replace", email: "replace@example.com", product: "Base Oil", quantity: "80", unit: "MT"}), {...current, product: "Base Oil"});
  assert.deepEqual(fillEmptyFields({}, {quantity: "80", unit: "KG"}), {quantity: "80", unit: "KG"});
});

test("AI capture drops invented values, secrets, conflicting evidence and unsupported fields", () => {
  const text = "Acme wants 80 MT. Contact buyer@example.com. SN500 or SN150.";
  assert.deepEqual(verifiedCapture(text, [
    {field: "title", value: "Acme", evidence: "Acme wants"},
    {field: "destination", value: "Durban", evidence: "Durban"},
    {field: "email", value: "buyer@example.com", evidence: "buyer@example.com"},
    {field: "quantity", value: "80", evidence: "80 MT"},
    {field: "unit", value: "MT", evidence: "80 MT"},
    {field: "grade", value: "SN500", evidence: "SN500 or SN150"},
    {field: "grade", value: "SN150", evidence: "SN500 or SN150"},
    {field: "owner" as never, value: "Acme", evidence: "Acme"},
  ]), {title: "Acme", email: "buyer@example.com", quantity: "80", unit: "MT"});
  assert.deepEqual(verifiedCapture("80 MT in 20 KG bags", [{field:"quantity",value:"80",evidence:"80 MT"},{field:"unit",value:"KG",evidence:"20 KG"}]), {});
});
