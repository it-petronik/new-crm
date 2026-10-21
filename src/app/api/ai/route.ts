import { aiEndpoint } from "@/lib/ai/route";
import { aiBinding, AI_LIMITS, AI_MODELS, modelsFor } from "@/lib/ai/config";
import { allowedModules } from "@/lib/domain";
import { TOOL_CATALOGUE, toolsFor } from "@/lib/ai/tools/management";
import { roleAiExamples } from "@/lib/ai/role-focus";

/** GET: whether Enercore AI is on here, and what this person can use. No model call. */
export function GET(request: Request) {
  return aiEndpoint(
    request,
    async ({ actor }) => {
      const tools = toolsFor(actor);
      const binding = await aiBinding();
      return {
        available: !!binding,
        provider: binding ? "groq" : null,
        model: binding ? modelsFor(binding, "primary")[0] : AI_MODELS.primary,
        features: {
          deal: allowedModules(actor).includes("leads"),
          lead: allowedModules(actor).includes("leads"),
          customer: allowedModules(actor).includes("customers"),
          ask: tools.length > 0,
          meeting: true,
          conversation: true,
          proactive: true,
          sales: allowedModules(actor).includes("leads"),
        },
        tools: tools.map((t) => ({ id: t, description: TOOL_CATALOGUE[t].description })),
        examples: roleAiExamples(actor),
        limits: { per10Minutes: AI_LIMITS.perUserPer10Min, perDay: AI_LIMITS.perUserPerDay },
      };
    },
    { spend: false },
  );
}
