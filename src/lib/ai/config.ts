/**
 * Enercore AI — provider selection is server-owned, never request-controlled.
 */

export const AI_MODELS = {
  /** Hosted by Groq; no inference server is needed on the office Mac. */
  primary: "openai/gpt-oss-120b",
  /** A second Groq model, never a different provider. */
  fallback: "openai/gpt-oss-20b",
  /**
   * Fast: short, bounded tasks (drafts, explaining deterministic priorities,
   * meeting preparation). Falls back to the primary.
   */
  fast: "openai/gpt-oss-20b",
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
export type AiBinding = { run: AiRun; provider?: "groq"; models?: Record<AiTier, readonly string[]> };
export const modelsFor = (ai: AiBinding, tier: AiTier) => ai.models?.[tier] ?? TIER_MODELS[tier];

export async function configuredAi(env: { APP_MODE?: string; AI_PROVIDER?: string; GROQ_API_KEY?: string }): Promise<AiBinding | null> {
  if (env.APP_MODE === "preview") return null;
  if (!env.AI_PROVIDER || env.AI_PROVIDER === "groq") {
    if (!env.GROQ_API_KEY?.trim()) return null;
    const { createGroqBinding } = await import("./groq");
    return createGroqBinding(env.GROQ_API_KEY.trim());
  }
  // Workers AI and all other providers are removed, not fallbacks.
  return null;
}

/**
 * A Groq adapter using a private server secret. Preview never calls a model.
 */
export async function aiBinding(): Promise<AiBinding | null> {
  if (process.env.APP_MODE === "preview") return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = (await getCloudflareContext({ async: true })).env as unknown as Parameters<typeof configuredAi>[0];
    return configuredAi(env);
  } catch {
    return configuredAi(process.env as Parameters<typeof configuredAi>[0]);
  }
}
