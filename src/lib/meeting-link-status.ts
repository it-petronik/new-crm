import type { Database } from "./d1";
import type { MeetingRow } from "./schema";
import { activeGuestInvite } from "./meeting-data";
import { deriveToken, hashToken, linkUsable } from "./meeting-guests";
import { guestLinkSecret } from "./livekit-config";
import type { GuestLinkStatus } from "./meetings";

/** The public origin guest links point at. */
export const appOrigin = () => (process.env.APP_URL ? new URL(process.env.APP_URL).origin : "");

export const guestUrl = (token: string) => `${appOrigin()}/meet/${token}`;

/**
 * A meeting's current guest link, for the people who may manage it: whether
 * one is active and, when the server can derive it again, its URL. Only a
 * link whose derived token still matches the stored hash is shown, so an
 * older (random) link or a rotated secret yields `url: null`, never a wrong
 * link. Callers must have checked `canManage`.
 */
export async function guestLinkStatus(db: Database, meeting: MeetingRow): Promise<GuestLinkStatus> {
  if (meeting.guestAccess === "off") return null;
  const invite = await activeGuestInvite(db, meeting.id);
  if (!invite || !linkUsable(invite, meeting)) return null;
  const secret = await guestLinkSecret();
  let url: string | null = null;
  if (secret) {
    const token = await deriveToken(secret, invite.id);
    if ((await hashToken(token)) === invite.tokenHash) url = guestUrl(token);
  }
  return {
    active: true,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    untilMeetingEnd: !invite.expiresAt,
    createdAt: invite.createdAt.toISOString(),
    url,
  };
}
