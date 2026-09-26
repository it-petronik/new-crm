import { z } from "zod";
import { GONE, guestContext, guestJson } from "@/lib/meeting-guest-api";
import { admittedGuest } from "@/lib/meeting-guest-chat";
import { listMeetingMessages, toView } from "@/lib/meeting-chat";

/**
 * POST { secret, after? }: the meeting chat for an admitted guest, while the
 * meeting runs — messages from their admission onwards only. No CRM
 * session, no Collaboration, nothing else.
 */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const body = z.object({ secret: z.string().max(100), after: z.number().int().positive().nullable().optional() }).safeParse(await request.json().catch(() => null));
  const found = body.success ? await admittedGuest(context.db, body.data.secret) : null;
  if (!body.success || !found) return guestJson({ error: GONE }, 404);
  const rows = await listMeetingMessages(context.db, found.meeting.id, {
    after: body.data.after ?? null,
    since: found.guest.decidedAt ?? found.guest.createdAt,
  });
  return guestJson({ messages: rows.map((r) => toView(r, { guestId: found.guest.id })) });
}
