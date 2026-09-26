import { aiEndpoint } from "@/lib/ai/route";
import { aiBinding, AI_LIMITS, AI_MODELS } from "@/lib/ai/config";
import { allowedModules } from "@/lib/domain";
import { TOOL_CATALOGUE, toolsFor } from "@/lib/ai/tools/management";

const EXAMPLES: Record<string, string[]> = {
  pipeline_summary: ["How is our pipeline looking?", "What did we win in the last 30 days?"],
  overdue_followups: ["Which follow-ups are overdue?"],
  status_breakdown: ["How many quotations are in each status?"],
  top_open_deals: ["What are our biggest open deals?"],
  receivables: ["How much is overdue from customers?"],
};

/** GET: whether Enercore AI is on here, and what this person can use. No model call. */
export function GET(request: Request) {
  return aiEndpoint(
    request,
    async ({ actor }) => {
      const tools = toolsFor(actor);
      return {
        available: !!(await aiBinding()),
        model: AI_MODELS.primary,
        features: {
          lead: allowedModules(actor).includes("leads"),
          customer: allowedModules(actor).includes("customers"),
          ask: tools.length > 0,
          meeting: true,
          conversation: true,
        },
        tools: tools.map((t) => ({ id: t, description: TOOL_CATALOGUE[t].description })),
        examples: tools.flatMap((t) => EXAMPLES[t] ?? []).slice(0, 6),
        limits: { per10Minutes: AI_LIMITS.perUserPer10Min, perDay: AI_LIMITS.perUserPerDay },
      };
    },
    { spend: false },
  );
}
