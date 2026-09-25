import { z } from "zod";
import { messageId } from "@/lib/collab";
import { meetingGuests } from "@/lib/schema";
import { GONE, guestContext, guestJson, resolveLink } from "@/lib/meeting-guest-api";
import { cleanGuestName, hashToken, randomToken } from "@/lib/meeting-guests";
import { grantForGuest } from "@/lib/meeting-guest-grant";
import { guestWaiting } from "@/lib/meeting-service";

/**
 * POST { token, name }: a guest asks to join. The link must still be valid
 * and the meeting running. With "host must admit" the guest waits and the
 * hosts are told; with "anyone with the link" they get a meeting token at
 * once. Either way they receive a random secret — for this request's
 * outcome only — and NEVER a CRM session.
 */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const { db } = context;
  const body = z.object({ token: z.string().max(100), name: z.string().max(200) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return guestJson({ error: "Enter your name to join." }, 400);
  const link = await resolveLink(db, body.data.token);
  if (!link) return guestJson({ error: GONE }, 404);
  const name = cleanGuestName(body.data.name);
  if (!name) return guestJson({ error: "Enter your name (up to 60 characters)." }, 400);
  if (link.meeting.status !== "live") return guestJson({ state: "not_started", scheduledAt: link.meeting.scheduledAt?.toISOString() ?? null });

  const secret = randomToken();
  const admitted = link.meeting.guestAccess === "open";
  const guest = { id: messageId(), name };
  await db
    .insert(meetingGuests)
    .values({ id: guest.id, meetingId: link.meeting.id, inviteId: link.invite.id, name, secretHash: await hashToken(secret), status: admitted ? "admitted" : "waiting", createdAt: new Date(), decidedAt: admitted ? new Date() : null, decidedBy: null })
    .run();
  if (!admitted) {
    await guestWaiting(db, link.meeting, guest);
    return guestJson({ state: "waiting", secret });
  }
  const grant = await grantForGuest(link.meeting, guest);
  if (!grant) return guestJson({ error: "Meetings are unavailable right now." }, 503);
  return guestJson({ state: "admitted", secret, grant });
}
