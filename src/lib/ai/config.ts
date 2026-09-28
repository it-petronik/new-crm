/**
 * Enercore AI — central configuration. Cloudflare Workers AI only: no other
 * provider is ever called, and nothing here is configurable from a request.
 */

export const AI_MODELS = {
  /**
   * Primary: strong instruction-following and JSON-schema output on Workers
   * AI, which every Enercore AI answer is constrained to.
   */
  primary: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  /** Used only if the primary fails or is unavailable. Also JSON-schema capable. */
  fallback: "@cf/meta/llama-4-scout-17b-16e-instruct",
  /**
   * Fast: short, bounded tasks (drafts, explaining deterministic priorities,
   * meeting preparation). Falls back to the primary.
   */
  fast: "@cf/meta/llama-3.1-8b-instruct-fast",
} as const;

/** Which models a task tier tries, in order (each once). */
export type AiTier = "primary" | "fast";
export const TIER_MODELS: Record<AiTier, readonly string[]> = {
  primary: [AI_MODELS.primary, AI_MODELS.fallback],
  fast: [AI_MODELS.fast, AI_MODELS.primary],
};

export const AI_LIMITS = {
  /** Low temperature: explanations of facts, not creativity. */
  temperature: 0.2,
  maxOutputTokens: 1400,
  /** Hard cap on the context sent to the model (characters, after sanitising). */
  maxContextChars: 24_000,
  /** One untrusted text block (a note, a message) is clipped to this. */
  maxBlockChars: 1_500,
  /** A request that takes longer is abandoned (the person can try again). */
  timeoutMs: 30_000,
  /** Per person. */
  perUserPer10Min: 20,
  perUserPerDay: 200,
  /** Across the whole company, per day (capacity guard). */
  globalPerDay: 3_000,
  /** A cached answer is reused for identical input (same person, same data) for this long. */
  cacheSeconds: 1_800,
} as const;

export type AiFeature = "deal" | "lead" | "customer" | "ask" | "meeting" | "conversation" | "sales" | "proactive" | "prospecting";

export const FEATURE_LABELS: Record<AiFeature, string> = {
  prospecting: "Prospecting interpretation",
  deal: "Deal brief",
  lead: "Lead brief",
  customer: "Customer 360",
  ask: "Ask Enercore AI",
  meeting: "Meeting summary",
  conversation: "Conversation summary",
  sales: "Sales Copilot",
  proactive: "Action Center brief",
};

type AiRun = (model: string, input: unknown, options?: unknown) => Promise<unknown>;
export type AiBinding = { run: AiRun };

/**
 * The Workers AI binding inside a request, or null: preview mode, no binding,
 * or no Cloudflare context (local Next dev) all mean AI is off.
 */
export async function aiBinding(): Promise<AiBinding | null> {
  if (process.env.APP_MODE === "preview") return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = (await getCloudflareContext({ async: true })).env as unknown as { AI?: AiBinding; APP_MODE?: string };
    if (env.APP_MODE === "preview") return null;
    return env.AI && typeof env.AI.run === "function" ? env.AI : null;
  } catch {
    return null;
  }
}
