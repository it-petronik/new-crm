import { AI_MODELS, type AiBinding } from "./config";
import { AiError } from "./model";

export const GROQ_MODELS = {
  primary: AI_MODELS.primary,
  fast: AI_MODELS.fast,
} as const;

/** Fixed server-side destination. No request can supply a URL, model or key. */
export function createGroqBinding(key: string, send: typeof fetch = fetch): AiBinding {
  return {
    provider: "groq",
    models: { primary: [GROQ_MODELS.primary, GROQ_MODELS.fast], fast: [GROQ_MODELS.fast, GROQ_MODELS.primary] },
    async run(model, input, options) {
      if (!(Object.values(GROQ_MODELS) as string[]).includes(model)) throw new AiError(400, "This AI model is not enabled.");
      const value = input as { messages: {role: string; content: string}[]; response_format: {json_schema: unknown}; max_tokens: number; temperature: number };
      let response: Response;
      try {
        response = await send("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          signal: (options as {signal?: AbortSignal} | undefined)?.signal,
          redirect: "error",
          cache: "no-store",
          body: JSON.stringify({
            model, messages: value.messages, temperature: value.temperature,
            max_completion_tokens: value.max_tokens, stream: false,
            include_reasoning: false, reasoning_effort: "low",
            // Existing Enercore schemas have optional fields. Best-effort JSON
            // schema preserves that contract; Zod still rejects invalid answers.
            response_format: { type: "json_schema", json_schema: { name: "enercore_result", strict: false, schema: value.response_format.json_schema } },
          }),
        });
      } catch (error) {
        if ((options as {signal?: AbortSignal} | undefined)?.signal?.aborted) throw new AiError(504, "Enercore AI took too long. Please try again.");
        // Never echo provider errors, headers, credentials or prompt content.
        void error;
        throw new AiError(502, "The AI service could not be reached. Please try again.");
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AiError(503, "AI access needs attention. Please ask your administrator to check the private server key.");
        if (response.status === 429) throw new AiError(429, "The AI allowance is temporarily busy or used up. Please try later; your CRM still works normally.");
        if (response.status < 500) throw new AiError(400, "AI could not process this request. Try a shorter inquiry or a more specific question.");
        throw new AiError(502, "The AI service is temporarily unavailable. Please try again.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new AiError(502, "AI returned an empty answer. Please try again.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 128_000) throw new AiError(502, "The AI answer was too large. Try a narrower question.");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let result: { choices?: { message?: {content?: unknown} }[]; usage?: {prompt_tokens?: number; completion_tokens?: number} };
      try { result = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new AiError(502, "AI returned an unreadable answer. Please try again."); }
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new AiError(502, "AI returned an empty answer. Please try again.");
      return { response: content, usage: result.usage };
    },
  };
}
