import { z } from "zod";
import { aiEndpoint } from "@/lib/ai/route";
import { proactiveBrief } from "@/lib/proactive/brief";

/** POST: an on-demand AI brief over deterministic facts (one fast-model call; cached). */
const input = z.object({ kind: z.enum(["today", "changes", "week"]) }).strict();
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => proactiveBrief(db, actor, input.parse(await request.json()).kind));
}
