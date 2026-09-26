import { GUEST_EXPIRY_MS, type GuestExpiry } from "./meetings";

/**
 * Guest-link credentials. A link's token and a waiting guest's secret are
 * 256 random bits each; only their SHA-256 is stored, so a database copy
 * reveals nothing usable. The raw token appears once, in the link given to
 * the organiser.
 */

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * A guest link's token, derived from its invite's random id with a server
 * secret: HMAC-SHA256 → 256 bits, unguessable without the secret. The
 * database still holds only the token's SHA-256, yet an authorised host can
 * have the server produce the same link again on any device, instead of it
 * existing only in the browser that created it.
 */
export async function deriveToken(secret: string, inviteId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`enercore-guest-link-v1:${inviteId}`));
  return b64url(new Uint8Array(mac));
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shape check before any lookup: 43 URL-safe characters (256 bits). */
export const looksLikeToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export function expiryFor(choice: GuestExpiry, now = Date.now()): Date | null {
  return choice === "meeting_end" ? null : new Date(now + GUEST_EXPIRY_MS[choice]);
}

/** A link is usable when not revoked, not expired, and its meeting is still open. */
export function linkUsable(
  invite: { revokedAt: Date | null; expiresAt: Date | null },
  meeting: { status: string },
  now = Date.now(),
) {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && invite.expiresAt.getTime() <= now) return false;
  return meeting.status === "live" || meeting.status === "scheduled";
}

/** A guest's display name: plain text, trimmed, 1–60 characters. */
export function cleanGuestName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}
