import { z } from "zod";
import { aiEndpoint } from "@/lib/ai/route";
import { actionCenter, GROUPS } from "@/lib/proactive/service";

/**
 * GET: the Action Center for the signed-in employee — deterministic, no AI
 * call, over what they may read. ?scope=mine|team&group=all|sales|operations|finance|data
 */
const query = z.object({ scope: z.enum(["mine", "team"]).default("mine"), group: z.enum(Object.keys(GROUPS) as [keyof typeof GROUPS, ...(keyof typeof GROUPS)[]]).default("all") });
export function GET(request: Request) {
  return aiEndpoint(
    request,
    async ({ actor, db }) => {
      const q = new URL(request.url).searchParams;
      const { scope, group } = query.parse({ scope: q.get("scope") ?? undefined, group: q.get("group") ?? undefined });
      return actionCenter(db, actor, { scope, group });
    },
    { spend: false },
  );
}
