import type { ZodType } from "zod";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { recordLoginAttempt } from "../data";
import { aiUsage } from "../schema";
import { messageId } from "../collab";
import { AI_LIMITS, aiBinding, type AiFeature } from "./config";
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

/**
 * A structured, validated result from the model (primary, then fallback
 * once). Throws AiError with a person-readable message on any failure.
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
}): Promise<{ data: T; model: string }> {
  const ai = await aiBinding();
  if (!ai) throw new AiError(503, "Enercore AI isn't set up here yet.");
  const system = `${RULES}\n\nTask:\n${options.instructions}`;
  const promptChars = system.length + options.prompt.length;
  return structuredCall({
    ai,
    system,
    prompt: options.prompt,
    schema: options.schema,
    jsonSchema: options.jsonSchema,
    prepare: options.prepare,
    onAttempt: (a) => logUsage(options.db, options.actor, { ...a, feature: options.feature, promptChars, flagged: options.flagged ?? 0 }),
  });
}

/** Keeps only references the model was actually given (and drops empty items). */
export function keepKnownRefs(answer: AiAnswer, references: Reference[]): AiAnswer {
  const known = new Set(references.map((r) => r.id));
  const fix = (items: AiAnswer["points"]) => items.map((i) => ({ ...i, refs: i.refs.filter((r) => known.has(r)) }));
  return { ...answer, points: fix(answer.points), risks: fix(answer.risks), nextActions: fix(answer.nextActions), suggestions: answer.suggestions.filter((s) => known.has(s.recordRef)) };
}

/** One answer over a prepared context. */
export async function answerOver(options: { db: Database; actor: Actor; feature: AiFeature; instructions: string; context: AiContext; question?: string }) {
  const prompt = `${options.question ? `QUESTION (from the signed-in employee): ${options.question}\n\n` : ""}CONTEXT:\n${options.context.render()}`;
  const { data, model } = await generateStructured({
    db: options.db,
    actor: options.actor,
    feature: options.feature,
    instructions: `${options.instructions}\n\n${ANSWER_FORMAT}`,
    prompt,
    schema: answerSchema,
    jsonSchema: answerJsonSchema,
    prepare: prepareAnswer,
    flagged: options.context.flagged,
  });
  return { answer: keepKnownRefs(data, options.context.references()), model };
}
