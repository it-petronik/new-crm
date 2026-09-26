import type { Database } from "./d1";
import { findGuestBySecret, findMeeting } from "./meeting-data";
import { hashToken, looksLikeToken } from "./meeting-guests";

/**
 * The guest behind a meeting secret — only while they are ADMITTED and the
 * meeting is LIVE. Removed or declined guests, guests who left, and every
 * guest once the meeting ends get nothing (the caller answers "gone").
 */
export async function admittedGuest(db: Database, secret: unknown) {
  if (!looksLikeToken(secret)) return null;
  const guest = await findGuestBySecret(db, await hashToken(secret));
  if (!guest || guest.status !== "admitted") return null;
  const meeting = await findMeeting(db, guest.meetingId);
  if (!meeting || meeting.status !== "live") return null;
  return { guest, meeting };
}
