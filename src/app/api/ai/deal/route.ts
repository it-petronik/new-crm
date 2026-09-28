import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { AiError } from "@/lib/ai/gateway";
import { CommercialError } from "@/lib/commercial/model";
import { dealContext } from "@/lib/commercial/ai";
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { id } = z
      .object({ id: z.string().min(1).max(100) })
      .strict()
      .parse(await request.json());
    try {
      const { context, instructions } = await dealContext(db, actor, id);
      return respond(db, actor, "deal", context, instructions);
    } catch (e) {
      if (e instanceof CommercialError) throw new AiError(e.status, e.message);
      throw e;
    }
  });
}
