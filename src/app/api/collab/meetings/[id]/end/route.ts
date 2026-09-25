import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { endMeeting, requireMeeting } from "@/lib/meeting-service";

type Params = { params: Promise<{ id: string }> };

/** POST: end the meeting for everyone (its organiser, a room admin, or either side of a call). */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can end this meeting for everyone.");
    await endMeeting(db, meeting.id);
    return json({ ok: true });
  });
}
