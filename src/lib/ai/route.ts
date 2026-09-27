import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { checkOrigin, currentActor } from "../auth";
import { getDb, isPreview } from "../db";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { AiError, answerOver, checkLimits } from "./gateway";
import type { AiContext } from "./context";
import type { AiFeature, AiTier } from "./config";
import { reviewSuggestions } from "./suggestions";

/**
 * Every Enercore AI endpoint: a signed-in employee (never a guest, never
 * preview), same-origin for requests that spend capacity, limits checked
 * first, and errors that say what to do without leaking internals.
 */
export async function aiEndpoint(request: Request, run: (ctx: { actor: Actor; db: Database }) => Promise<unknown>, options: { spend: boolean } = { spend: true }) {
  const noStore = { "Cache-Control": "no-store" };
  try {
    if (isPreview()) return NextResponse.json({ error: "Enercore AI isn't available in preview." }, { status: 409, headers: noStore });
    if (options.spend) checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503, headers: noStore });
    if (options.spend) await checkLimits(db, actor);
    return NextResponse.json(await run({ actor, db }), { headers: noStore });
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
    if (e instanceof ZodError || e instanceof SyntaxError) return NextResponse.json({ error: "Check the request and try again." }, { status: 400, headers: noStore });
    if (e instanceof Error && e.message.startsWith("Invalid request origin")) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
    console.error(JSON.stringify({ event: "ai_request_failed", detail: e instanceof Error ? e.name : "unknown" }));
    return NextResponse.json({ error: "Enercore AI couldn't answer right now. Try again." }, { status: 500, headers: noStore });
  }
}

/** Runs one answer over a prepared context and reviews its suggestions. */
export async function respond(db: Database, actor: Actor, feature: AiFeature, context: AiContext, instructions: string, question?: string, scope?: string, tier?: AiTier) {
  const { answer, model, cached, generatedAt } = await answerOver({ db, actor, feature, instructions, context, question, tier });
  const suggestions = await reviewSuggestions(db, actor, answer, context);
  return {
    feature,
    answer: { ...answer, suggestions: undefined },
    suggestions,
    references: context.references(),
    /** What the answer is (and isn't) based on — set by Enercore, not the model. */
    scope: scope ?? null,
    /** Enercore's own computed figures (authoritative), shown beside the answer. */
    figures: context.figures(),
    flaggedText: context.flagged,
    model,
    cached,
    generatedAt,
  };
}
