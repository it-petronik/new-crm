import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { leadContext } from "@/lib/ai/tools/crm";

const input = z.object({ id: z.string().min(1).max(100) }).strict();

/** POST { id }: an AI brief of one lead the person may read. */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { id } = input.parse(await request.json());
    const { context, instructions } = await leadContext(db, actor, id);
    return respond(db, actor, "lead", context, instructions);
  });
}
