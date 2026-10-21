import { sql } from "drizzle-orm";
import type { Database } from "../d1";
import { loginAttempts } from "../schema";
import { AiError } from "./model";

/** Reservations include schema and output allowance, not just typed text.
 * This is a conservative estimate, NOT the provider's tokenizer/billing cap.
 * Provider limits remain authoritative. No refunds on retries or failures.
 */
export function estimatedTokens(system: string, prompt: string, schema: unknown, outputTokens: number) {
  return Math.ceil(new TextEncoder().encode(system + prompt + JSON.stringify(schema)).length / 2) + outputTokens + 512;
}

export async function reserveGroqAttempt(db: Database, tokens: number) {
  if (tokens > 7_000) throw new AiError(400, "This AI request is too large for the free allowance. Choose one brand or record, or shorten the inquiry.");
  const now = Date.now();
  async function reserve(key: string, amount: number, window: number, limit: number) {
    const result = await db.get<{count: number; resetAt: number}>(sql`
      INSERT INTO ${loginAttempts} ("key", "count", "resetAt") VALUES (${key}, ${amount}, ${now + window})
      ON CONFLICT("key") DO UPDATE SET
        "count" = CASE WHEN "LoginAttempt"."resetAt" < ${now} THEN ${amount} ELSE "LoginAttempt"."count" + ${amount} END,
        "resetAt" = CASE WHEN "LoginAttempt"."resetAt" < ${now} THEN ${now + window} ELSE "LoginAttempt"."resetAt" END
      RETURNING "count", "resetAt"
    `);
    if (!result || result.count > limit) throw new AiError(429, "The workspace AI allowance has been reached. Try later; you can still enter and update records normally.");
    return {key, amount, resetAt: result.resetAt};
  }
  // Atomic per-counter reservations count EACH model attempt (including fallback).
  const day = await reserve("ai-groq-tokens-day", tokens, 86_400_000, 150_000);
  const minute = await reserve("ai-groq-tokens-minute", tokens, 60_000, 7_000);
  await reserve("ai-groq-calls-day", 1, 86_400_000, 800);
  // Reconcile to provider-reported use, including reasoning tokens. Unknown
  // usage retains the full reservation. Never credit a newer reset window.
  return async (usage: {promptTokens?: number; completionTokens?: number}) => {
    if (!Number.isInteger(usage.promptTokens) || !Number.isInteger(usage.completionTokens) || usage.promptTokens! < 0 || usage.completionTokens! < 0) return;
    const actual = usage.promptTokens! + usage.completionTokens!;
    if (actual <= 0 || actual > 1_000_000) return;
    for (const reservation of [day, minute]) await db.run(sql`
      UPDATE ${loginAttempts} SET "count" = MAX(0, "count" + ${actual - reservation.amount})
      WHERE "key" = ${reservation.key} AND "resetAt" = ${reservation.resetAt}
    `);
  };
}
