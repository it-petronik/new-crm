import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { customerContext } from "@/lib/ai/tools/crm";

const input = z.object({ id: z.string().min(1).max(100) }).strict();

/** POST { id }: a 360° view of one customer the person may read. */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { id } = input.parse(await request.json());
    const { context, instructions, scope } = await customerContext(db, actor, id);
    return respond(db, actor, "customer", context, instructions, undefined, scope);
  });
}
