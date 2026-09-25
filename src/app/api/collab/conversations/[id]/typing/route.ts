import { z } from "zod";
import { CollabError, collabContext, handle, json, requireRead } from "@/lib/collab-auth";
import { audience } from "@/lib/collab-service";
import { publish, typingAllowed } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string }> };

const input = z.object({ state: z.enum(["start", "stop"]) }).strict();

/**
 * POST { state }: "I am typing here" / "I stopped". Realtime only — nothing
 * is stored. The caller must be able to post in the conversation, and the
 * event goes only to its current audience (never back to the typist).
 * Clients throttle starts to one per few seconds and receivers expire a
 * typing state on their own, so a lost "stop" cannot leave it stuck; each
 * recipient's hub also drops repeats, so a misbehaving client cannot flood
 * anyone.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const id = (await params).id;
    const { state } = input.parse(await request.json());
    // Throttle before any lookups or fan-out, so a flood costs almost
    // nothing. A throttled start is simply not repeated: 202, no event.
    if (!(await typingAllowed(actor.id, String(id), state))) return json({ ok: true, throttled: true }, 202);
    const access = await requireRead(db, actor, id);
    if (!access.canPost) throw new CollabError(403, "You can't post in this conversation.");
    const recipients = (await audience(db, access.conversation.id)).filter((id) => id !== actor.id);
    await publish(recipients, {
      type: "typing",
      conversationId: access.conversation.id,
      userId: actor.id,
      name: actor.name,
      state,
    });
    return json({ ok: true });
  });
}
