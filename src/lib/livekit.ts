/**
 * The meeting provider (LiveKit Cloud), server side only.
 *
 * - Join tokens are short-lived JWTs (HS256, signed with WebCrypto) for ONE
 *   person and ONE meeting room, minted only after Enercore has re-checked
 *   access. The browser never sees the API secret.
 * - Server actions (end for everyone, remove, mute) use LiveKit's
 *   RoomService over HTTP with a separate, room-scoped admin token.
 * - Webhooks (who joined/left, room finished) are verified by their signed
 *   JWT and the body's SHA-256 before anything is trusted.
 *
 * Configuration comes from Worker secrets/vars: LIVEKIT_URL (wss://…),
 * LIVEKIT_API_KEY and LIVEKIT_API_SECRET. Without them meetings report
 * "not set up" instead of failing.
 */

export type ProviderConfig = { url: string; apiKey: string; apiSecret: string };

/** From a Worker env (the scheduled job has no request context). */
export function configFrom(env: Record<string, unknown>): ProviderConfig | null {
  const url = env.LIVEKIT_URL, apiKey = env.LIVEKIT_API_KEY, apiSecret = env.LIVEKIT_API_SECRET;
  if (typeof url !== "string" || typeof apiKey !== "string" || typeof apiSecret !== "string") return null;
  // TLS always — except a LiveKit dev server on this machine, for tests.
  const secure = /^wss:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(url);
  const local = /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url);
  if (!(secure || local) || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

/* ------------------------------------------------------------------ JWT */

const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (value: unknown) => b64url(encoder.encode(JSON.stringify(value)));
const fromB64url = (text: string) => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJwt(claims: Record<string, unknown>, secret: string) {
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(claims);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(signature)}`;
}

/** Verifies an HS256 JWT; returns its claims, or null if anything is off. */
export async function verifyJwt(token: string, secret: string, now = Date.now()): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (header.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as Record<string, unknown>;
    const seconds = Math.floor(now / 1000);
    if (typeof claims.exp === "number" && claims.exp < seconds - 30) return null;
    if (typeof claims.nbf === "number" && claims.nbf > seconds + 30) return null;
    return claims;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- tokens */

/**
 * A participant token for one person in one room. The identity is the
 * Enercore user id; the name is shown to others. Publishing is limited to
 * camera, microphone and screen share; a person cannot change their own
 * name or metadata once connected.
 */
export function joinToken(
  config: ProviderConfig,
  p: { identity: string; name: string; room: string; ttlSeconds: number; host: boolean; now?: number },
) {
  const now = Math.floor((p.now ?? Date.now()) / 1000);
  return signJwt(
    {
      iss: config.apiKey,
      sub: p.identity,
      name: p.name,
      nbf: now - 10,
      exp: now + p.ttlSeconds,
      jti: crypto.randomUUID(),
      metadata: JSON.stringify({ host: p.host }),
      video: {
        room: p.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"],
        canUpdateOwnMetadata: false,
      },
    },
    config.apiSecret,
  );
}

/** Short-lived, room-scoped admin token for RoomService calls. */
function adminToken(config: ProviderConfig, room: string) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ iss: config.apiKey, sub: "enercore-server", nbf: now - 10, exp: now + 60, video: { room, roomAdmin: true } }, config.apiSecret);
}

/* ----------------------------------------------------------- RoomService */

async function roomService(config: ProviderConfig, room: string, method: string, body: Record<string, unknown>) {
  const base = config.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
  const response = await fetch(`${base}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await adminToken(config, room)}` },
    body: JSON.stringify(body),
  });
  // A room or participant that is already gone is the outcome we wanted.
  if (!response.ok && response.status !== 404) throw new Error(`Meeting provider ${method} failed (${response.status}).`);
}

/** Disconnects everyone and closes the room. */
export const closeRoom = (config: ProviderConfig, room: string) => roomService(config, room, "DeleteRoom", { room });

/** Disconnects one person (removed from the conversation, deactivated, or by the host). */
export const removeFromRoom = (config: ProviderConfig, room: string, identity: string) =>
  roomService(config, room, "RemoveParticipant", { room, identity });

/** Host control: mutes one published track (the person can unmute themselves). */
export const muteTrack = (config: ProviderConfig, room: string, identity: string, trackSid: string) =>
  roomService(config, room, "MutePublishedTrack", { room, identity, track_sid: trackSid, muted: true });

/* -------------------------------------------------------------- webhooks */

export type ProviderEvent = {
  event: string;
  room?: { name?: string };
  participant?: { identity?: string };
  createdAt?: number | string;
};

/**
 * A provider webhook is trusted only if its Authorization JWT verifies with
 * our secret, was issued by our key, and carries the SHA-256 of this exact
 * body. Anything else is rejected.
 */
export async function verifyWebhook(config: ProviderConfig, body: string, authorization: string | null): Promise<ProviderEvent | null> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const claims = await verifyJwt(token, config.apiSecret);
  if (!claims || claims.iss !== config.apiKey || typeof claims.sha256 !== "string") return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const expected = btoa(String.fromCharCode(...digest));
  if (claims.sha256 !== expected) return null;
  try {
    return JSON.parse(body) as ProviderEvent;
  } catch {
    return null;
  }
}
