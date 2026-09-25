import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { meetingGuests } from "@/lib/schema";
import { hostsOf, requireMeeting } from "@/lib/meeting-service";
import { publish } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string; guestId: string }> };

const input = z.object({ decision: z.enum(["admit", "decline"]) }).strict();

/**
 * POST (hosts): admit or decline one waiting guest. Only a guest who is
 * still waiting, for THIS meeting, can be decided; other hosts are told so
 * their "is waiting" card goes away.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { id, guestId } = await params;
    const { meeting, canManage } = await requireMeeting(db, actor, id);
    if (!canManage) throw new CollabError(403, "Only the organiser can admit guests.");
    if (!isId(guestId)) throw new CollabError(404, "Guest not found.");
    const { decision } = input.parse(await request.json());
    const status = decision === "admit" ? "admitted" : "declined";
    const [changed] = await db
      .update(meetingGuests)
      .set({ status, decidedAt: new Date(), decidedBy: actor.id })
      .where(and(eq(meetingGuests.id, guestId), eq(meetingGuests.meetingId, meeting.id), eq(meetingGuests.status, "waiting")))
      .returning({ id: meetingGuests.id })
      .all();
    if (!changed) throw new CollabError(409, "That guest is no longer waiting.");
    await publish(await hostsOf(db, meeting), { type: "meeting.guest_decided", conversationId: meeting.conversationId ?? "", meetingId: meeting.id, guestId, decision: status });
    return json({ ok: true });
  });
}
