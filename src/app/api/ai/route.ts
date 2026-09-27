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
  leads_attention: ["Which leads need attention?"],
  quotations_waiting: ["Which quotations are waiting for a response?"],
  high_value_no_next_action: ["Which high-value opportunities have no next action?"],
  search: ["Find leads for SN500", "Which leads are going to Mombasa?"],
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
          proactive: true,
          sales: allowedModules(actor).includes("leads"),
        },
        tools: tools.map((t) => ({ id: t, description: TOOL_CATALOGUE[t].description })),
        examples: tools.flatMap((t) => EXAMPLES[t] ?? []).slice(0, 8),
        limits: { per10Minutes: AI_LIMITS.perUserPer10Min, perDay: AI_LIMITS.perUserPerDay },
      };
    },
    { spend: false },
  );
}
