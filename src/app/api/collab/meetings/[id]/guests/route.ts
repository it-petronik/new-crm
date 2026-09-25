import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { waitingGuests } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";

type Params = { params: Promise<{ id: string }> };

/** GET (hosts): guests waiting to be let in. */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can admit guests.");
    const guests = await waitingGuests(db, meeting.id);
    return json({ guests: guests.map((g) => ({ id: g.id, name: g.name, since: g.createdAt.toISOString() })) });
  });
}
