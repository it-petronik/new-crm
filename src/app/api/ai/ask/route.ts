import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { AiError, generateStructured } from "@/lib/ai/gateway";
import { redactSensitive, clip } from "@/lib/ai/sanitize";
import { ROUTE_FORMAT, routeJsonSchema, routeSchema, type Route } from "@/lib/ai/schema";
import { TOOL_CATALOGUE, keywordRoute, managementContext, toolsFor } from "@/lib/ai/tools/management";

const input = z.object({ question: z.string().min(2).max(600) }).strict();

/**
 * POST { question }: a management question. The model first picks ONE of
 * the tools this person may use (never data); the tool computes the facts
 * over what they may read; the model then explains those facts.
 */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const question = clip(redactSensitive(input.parse(await request.json()).question), 600);
    const tools = toolsFor(actor);
    if (!tools.length) throw new AiError(403, "Enercore AI questions cover sales, pipeline and receivables — none of which your role includes.");
    let route: Route;
    try {
      route = (
        await generateStructured({
          db,
          actor,
          feature: "ask",
          instructions: `Choose the ONE tool that answers the employee's question, or "none" if none fits. Tools:\n${tools.map((t) => `- ${t}: ${TOOL_CATALOGUE[t].description}`).join("\n")}\nOptional filters: "company" (one of: ${actor.companies.join(", ")}; null for all), "kind" (for status_breakdown only).\n\n${ROUTE_FORMAT}`,
          prompt: `QUESTION: ${question}`,
          schema: routeSchema,
          jsonSchema: routeJsonSchema,
        })
      ).data;
    } catch (e) {
      // A malformed or slow route falls back to keywords; limits and "not set up" don't.
      if (!(e instanceof AiError) || e.status === 429 || e.status === 503) throw e;
      route = keywordRoute(question, actor);
    }
    const prepared = route.tool === "none" ? null : await managementContext(db, actor, route);
    if (!prepared)
      return {
        feature: "ask",
        answer: {
          summary: `I can answer questions about: ${tools.map((t) => TOOL_CATALOGUE[t].description.replace(/\.$/, "").toLowerCase()).join("; ")}. Try asking one of those, for a company you work with.`,
          points: [], risks: [], nextActions: [], draft: null, confidence: "high", missing: [],
        },
        suggestions: [],
        references: [],
        scope: null,
        figures: [],
        flaggedText: 0,
        model: null,
        generatedAt: new Date().toISOString(),
      };
    return { ...(await respond(db, actor, "ask", prepared.context, prepared.instructions, question)), tool: route.tool };
  });
}
