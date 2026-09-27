import type { ZodType } from "zod";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { recordLoginAttempt } from "../data";
import { aiUsage } from "../schema";
import { messageId } from "../collab";
import { AI_LIMITS, TIER_MODELS, aiBinding, type AiFeature, type AiTier } from "./config";
import { AiError, CAPACITY_MESSAGE, RULES, structuredCall, type Attempt } from "./model";
import type { AiContext, Reference } from "./context";
import { ANSWER_FORMAT, answerJsonSchema, answerSchema, prepareAnswer, type AiAnswer } from "./schema";

/**
 * The one way Enercore talks to Workers AI.
 *
 * - The model only ever sees what a tool assembled for THIS person after
 *   checking their access (an AiContext) — never the database.
 * - Every answer is JSON-schema constrained and validated; an answer that
 *   doesn't validate is retried once on the fallback model, then refused
 *   (see model.ts — the same code the capability check runs).
 * - References the model cites are checked against the ones it was given.
 * - Per-person and company-wide limits, a hard timeout, and a usage row
 *   (no content) for every request.
 */

export { AiError, parseModelJson, RULES } from "./model";



type UsageRow = Attempt & { feature: AiFeature; promptChars: number; flagged: number };

async function logUsage(db: Database, actor: Actor, u: UsageRow) {
  try {
    await db
      .insert(aiUsage)
      .values({
        id: messageId(),
        userId: actor.id,
        feature: u.feature,
        model: u.model,
        status: u.status,
        durationMs: Math.max(0, Math.round(u.durationMs)),
        promptChars: u.promptChars,
        outputChars: u.outputChars,
        promptTokens: u.promptTokens ?? null,
        completionTokens: u.completionTokens ?? null,
        flaggedBlocks: u.flagged,
        createdAt: new Date(),
      })
      .run();
  } catch {
    // Usage logging must never break an answer.
  }
}

/** Per-person and company-wide limits (atomic counters). Checked before any model call. */
export async function checkLimits(db: Database, actor: Actor) {
  const [tenMin, day, global] = await Promise.all([
    recordLoginAttempt(db, `ai-10m:${actor.id}`, 10 * 60_000),
    recordLoginAttempt(db, `ai-day:${actor.id}`, 24 * 3600_000),
    recordLoginAttempt(db, "ai-day:all", 24 * 3600_000),
  ]);
  if (tenMin > AI_LIMITS.perUserPer10Min) throw new AiError(429, "You've asked Enercore AI a lot in the last few minutes. Try again shortly.");
  if (day > AI_LIMITS.perUserPerDay) throw new AiError(429, "You've reached today's Enercore AI limit. It resets within 24 hours.");
  if (global > AI_LIMITS.globalPerDay) throw new AiError(503, CAPACITY_MESSAGE);
}

/* ------------------------------------------------------------ caching */

type EdgeCache = { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> };
const edgeCache = () => (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;

const sha256 = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The fingerprint of one request: a hash of exactly what the model would be
 * given (rules, task, context — which carries record updates, notes, message
 * ids, meeting state and today's date) plus the person and the tier. Any
 * change to the data yields a new fingerprint, so a cached answer can never
 * be stale; and it is per person, so it never crosses permissions.
 */
const fingerprintOf = (actorId: string, tier: AiTier, system: string, prompt: string, jsonSchema: unknown) =>
  sha256(JSON.stringify([actorId, tier, system, prompt, jsonSchema]));

/**
 * The cache key: an internal URL on the app's own origin (the Cache API
 * stores per zone). Nothing is ever served from it — requests reach the
 * Worker first — and the key is a per-person fingerprint no one can guess.
 */
const cacheRequest = (key: string) => {
  let origin = "https://enercore-ai-cache.invalid";
  try {
    if (process.env.APP_URL) origin = new URL(process.env.APP_URL).origin;
  } catch {}
  return new Request(`${origin}/__enercore-ai-cache/${key}`);
};

/**
 * A structured, validated result from the model (by tier: each model tried
 * once, in order). Identical requests from the same person reuse a recent
 * answer (edge cache, 30 min) instead of calling the model again.
 * Throws AiError with a person-readable message on any failure.
 */
export async function generateStructured<T>(options: {
  db: Database;
  actor: Actor;
  feature: AiFeature;
  instructions: string;
  prompt: string;
  schema: ZodType<T>;
  jsonSchema: unknown;
  prepare?: (raw: unknown) => unknown;
  flagged?: number;
  tier?: AiTier;
}): Promise<{ data: T; model: string; cached: boolean; generatedAt: string; fingerprint: string }> {
  const ai = await aiBinding();
  if (!ai) throw new AiError(503, "Enercore AI isn't set up here yet.");
  const tier = options.tier ?? "primary";
  const system = `${RULES}\n\nTask:\n${options.instructions}`;
  const promptChars = system.length + options.prompt.length;
  const fingerprint = await fingerprintOf(options.actor.id, tier, system, options.prompt, options.jsonSchema);
  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(cacheRequest(fingerprint));
      if (hit) {
        const stored = (await hit.json()) as { data: unknown; model: string; generatedAt: string };
        const parsed = options.schema.safeParse(stored.data);
        if (parsed.success) {
          await logUsage(options.db, options.actor, { model: stored.model, status: "cached", durationMs: 0, outputChars: 0, feature: options.feature, promptChars, flagged: options.flagged ?? 0 });
          return { data: parsed.data, model: stored.model, cached: true, generatedAt: stored.generatedAt, fingerprint };
        }
      }
    } catch {
      // A cache problem only means a fresh answer.
    }
  }
  const { data, model } = await structuredCall({
    ai,
    system,
    prompt: options.prompt,
    schema: options.schema,
    jsonSchema: options.jsonSchema,
    prepare: options.prepare,
    models: TIER_MODELS[tier],
    onAttempt: (a) => logUsage(options.db, options.actor, { ...a, feature: options.feature, promptChars, flagged: options.flagged ?? 0 }),
  });
  const generatedAt = new Date().toISOString();
  if (cache) {
    try {
      await cache.put(
        cacheRequest(fingerprint),
        // Not "private": the Cache API would refuse to store it. The key is per person.
        new Response(JSON.stringify({ data, model, generatedAt }), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${AI_LIMITS.cacheSeconds}` } }),
      );
    } catch {}
  }
  return { data, model, cached: false, generatedAt, fingerprint };
}

/** Keeps only references the model was actually given (and drops empty items). */
export function keepKnownRefs(answer: AiAnswer, references: Reference[]): AiAnswer {
  const known = new Set(references.map((r) => r.id));
  const fix = (items: AiAnswer["points"]) => items.map((i) => ({ ...i, refs: i.refs.filter((r) => known.has(r)) }));
  return { ...answer, points: fix(answer.points), risks: fix(answer.risks), nextActions: fix(answer.nextActions), suggestions: answer.suggestions.filter((s) => known.has(s.recordRef)) };
}

/** One answer over a prepared context. */
export async function answerOver(options: { db: Database; actor: Actor; feature: AiFeature; instructions: string; context: AiContext; question?: string; tier?: AiTier }) {
  const prompt = `${options.question ? `QUESTION (from the signed-in employee): ${options.question}\n\n` : ""}CONTEXT:\n${options.context.render()}`;
  const r = await generateStructured({
    db: options.db,
    actor: options.actor,
    feature: options.feature,
    instructions: `${options.instructions}\n\n${ANSWER_FORMAT}`,
    prompt,
    schema: answerSchema,
    jsonSchema: answerJsonSchema,
    prepare: prepareAnswer,
    flagged: options.context.flagged,
    tier: options.tier,
  });
  return { answer: keepKnownRefs(r.data, options.context.references()), model: r.model, cached: r.cached, generatedAt: r.generatedAt };
}
