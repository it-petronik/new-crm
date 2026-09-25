import { collabContext, handle, json } from "@/lib/collab-auth";
import { closeSession } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";

type Params = { params: Promise<{ id: string }> };

/**
 * POST: "I left". Best effort, so presence and attendance are right even
 * when the provider's webhook is late; the webhook remains the authority.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    await closeSession(db, meeting.id, actor.id);
    return json({ ok: true });
  });
}
