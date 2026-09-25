import { z } from "zod";
import { findGuestBySecret, findMeeting } from "@/lib/meeting-data";
import { GONE, guestContext, guestJson } from "@/lib/meeting-guest-api";
import { hashToken, looksLikeToken } from "@/lib/meeting-guests";
import { grantForGuest } from "@/lib/meeting-guest-grant";

/**
 * POST { secret }: a guest's own status — still waiting, declined, or
 * admitted (with a fresh meeting token, so a dropped connection can
 * rejoin while the meeting runs). Knows nothing about anyone else.
 */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const { db } = context;
  const body = z.object({ secret: z.string().max(100) }).safeParse(await request.json().catch(() => null));
  if (!body.success || !looksLikeToken(body.data.secret)) return guestJson({ error: GONE }, 404);
  const guest = await findGuestBySecret(db, await hashToken(body.data.secret));
  const meeting = guest ? await findMeeting(db, guest.meetingId) : undefined;
  if (!guest || !meeting) return guestJson({ error: GONE }, 404);
  if (meeting.status !== "live") return guestJson({ state: "ended" });
  if (guest.status === "waiting") return guestJson({ state: "waiting" });
  if (guest.status === "declined") return guestJson({ state: "declined" });
  if (guest.status === "left") return guestJson({ state: "left" });
  const grant = await grantForGuest(meeting, guest);
  return grant ? guestJson({ state: "admitted", grant }) : guestJson({ error: "Meetings are unavailable right now." }, 503);
}
