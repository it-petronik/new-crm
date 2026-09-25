import { guestToken } from "./livekit";
import { providerConfig } from "./livekit-config";
import { JOIN_TOKEN_TTL_S, guestIdentity, type GuestGrant } from "./meetings";
import type { MeetingRow } from "./schema";

/** A short-lived provider token for an admitted guest — this meeting only. */
export async function grantForGuest(meeting: MeetingRow, guest: { id: string; name: string }): Promise<GuestGrant | null> {
  const config = await providerConfig();
  if (!config) return null;
  const identity = guestIdentity(guest.id);
  const token = await guestToken(config, { identity, name: `${guest.name} (Guest)`, room: meeting.providerRoom, ttlSeconds: JOIN_TOKEN_TTL_S });
  return { serverUrl: config.url, token, expiresIn: JOIN_TOKEN_TTL_S, identity, title: meeting.title };
}
