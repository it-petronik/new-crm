import { z } from "zod";
import { aiEndpoint, respond } from "@/lib/ai/route";
import { meetingContext } from "@/lib/ai/tools/meetings-collab";

const input = z.object({ id: z.string().min(1).max(64) }).strict();

/** POST { id }: a summary of one meeting the person may open. */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { id } = input.parse(await request.json());
    const { context, instructions, scope } = await meetingContext(db, actor, id);
    return respond(db, actor, "meeting", context, instructions, undefined, scope);
  });
}
