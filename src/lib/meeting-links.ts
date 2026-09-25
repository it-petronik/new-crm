import type { Database } from "./d1";
import { findGuestInviteByHash, findMeeting } from "./meeting-data";
import { hashToken, linkUsable, looksLikeToken } from "./meeting-guests";

/**
 * Resolves a raw guest-link token to its invite and meeting — only while the
 * link is usable (not revoked, not expired, guests allowed, meeting open).
 * Looks up by the token's SHA-256; the raw token is never stored.
 */
export async function resolveLink(db: Database, token: unknown, now = Date.now()) {
  if (!looksLikeToken(token)) return null;
  const invite = await findGuestInviteByHash(db, await hashToken(token));
  if (!invite) return null;
  const meeting = await findMeeting(db, invite.meetingId);
  if (!meeting || meeting.guestAccess === "off" || !linkUsable(invite, meeting, now)) return null;
  return { invite, meeting };
}
