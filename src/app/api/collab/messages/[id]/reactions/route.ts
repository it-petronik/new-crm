import { z } from "zod";
import { EMOJI_SET, QUICK_REACTIONS, isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json, rateLimit, requireRead } from "@/lib/collab-auth";
import { findMessage, reactionsFor, setReaction } from "@/lib/collab-data";
import { audience } from "@/lib/collab-service";
import { publish } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string }> };

const ALLOWED = new Set([...QUICK_REACTIONS, ...EMOJI_SET]);
const input = z.object({ emoji: z.string().max(16), on: z.boolean() }).strict();

/**
 * POST { emoji, on }: add or remove the caller's reaction. Idempotent — the
 * (message, person, emoji) key makes a second "on" a no-op — and limited to
 * the known emoji set, so a reaction can never carry arbitrary text.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const id = (await params).id;
    const notFound = new CollabError(404, "Message not found.");
    if (!isId(id)) throw notFound;
    const message = await findMessage(db, id);
    if (!message) throw notFound;
    const access = await requireRead(db, actor, message.conversationId).catch(() => {
      throw notFound;
    });
    if (message.deletedAt) throw new CollabError(409, "This message was deleted.");
    if (!access.canPost) throw new CollabError(403, "You can't react in this conversation.");
    const body = input.parse(await request.json());
    if (!ALLOWED.has(body.emoji)) throw new CollabError(400, "That reaction isn't available.");
    await rateLimit(db, actor, "reaction");
    await setReaction(
      db,
      { messageId: id, userId: actor.id, emoji: body.emoji, conversationId: message.conversationId },
      body.on,
    );
    const reactions = await reactionsFor(db, id);
    await publish(await audience(db, message.conversationId), {
      type: "reaction",
      conversationId: message.conversationId,
      messageId: id,
      reactions,
    });
    return json({ reactions });
  });
}
