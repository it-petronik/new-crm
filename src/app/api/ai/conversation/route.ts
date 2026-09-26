import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { conversationContext } from "@/lib/ai/tools/meetings-collab";

const input = z.object({ id: z.string().min(1).max(64) }).strict();

/** POST { id }: a summary of a conversation the person is a member of. */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { id } = input.parse(await request.json());
    const { context, instructions, scope } = await conversationContext(db, actor, id);
    return respond(db, actor, "conversation", context, instructions, undefined, scope);
  });
}
