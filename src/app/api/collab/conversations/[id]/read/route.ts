import { z } from "zod";
import { isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json, requireRead } from "@/lib/collab-auth";
import { advanceRead, findMessage } from "@/lib/collab-data";
import { publish } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string }> };

const input = z.object({ messageId: z.string().refine(isId) }).strict();

/**
 * POST: "I have seen up to this message". Stored server-side on the member
 * row, so it is the same on every device; the cursor only ever moves forward.
 * The caller's other devices are told, so their badges clear too.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireRead(db, actor, (await params).id);
    const { messageId } = input.parse(await request.json());
    const message = await findMessage(db, messageId);
    if (!message || message.conversationId !== access.conversation.id)
      throw new CollabError(400, "Invalid message.");
    await advanceRead(db, access.conversation.id, actor.id, messageId);
    await publish([actor.id], {
      type: "read",
      conversationId: access.conversation.id,
      lastReadMessageId: messageId,
    });
    return json({ ok: true });
  });
}
