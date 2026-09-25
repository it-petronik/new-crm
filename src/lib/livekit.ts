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
      metadata: JSON.stringify({ host: p.host, guest: false }),
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

/**
 * A guest's token: one meeting, camera and microphone only (no screen
 * share, no data channel), and a name marked as a guest's. Issued only after
 * the guest link and the host's admission (when required) were checked.
 */
export function guestToken(config: ProviderConfig, p: { identity: string; name: string; room: string; ttlSeconds: number; now?: number }) {
  const now = Math.floor((p.now ?? Date.now()) / 1000);
  return signJwt(
    {
      iss: config.apiKey,
      sub: p.identity,
      name: p.name,
      nbf: now - 10,
      exp: now + p.ttlSeconds,
      jti: crypto.randomUUID(),
      metadata: JSON.stringify({ host: false, guest: true }),
      video: {
        room: p.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: ["camera", "microphone"],
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

const httpBase = (config: ProviderConfig) => config.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");

async function roomService(config: ProviderConfig, room: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`${httpBase(config)}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await adminToken(config, room)}` },
    body: JSON.stringify(body),
  });
  // A room or participant that is already gone is the outcome we wanted.
  if (!response.ok && response.status !== 404) throw new Error(`Meeting provider ${method} failed (${response.status}).`);
}

/**
 * Room metadata every participant (guests included) receives live — used to
 * announce recording, so it can never run unseen.
 */
export const setRoomMetadata = (config: ProviderConfig, room: string, metadata: Record<string, unknown>) =>
  roomService(config, room, "UpdateRoomMetadata", { room, metadata: JSON.stringify(metadata) });

/* ------------------------------------------------------------- recording */

/**
 * Where cloud recordings are written: private S3-compatible storage (the
 * R2 bucket, through its S3 API). All four settings are Worker secrets;
 * without them recording is simply unavailable.
 */
export type RecordingStorage = { endpoint: string; bucket: string; accessKey: string; secret: string };

export function recordingStorageFrom(env: Record<string, unknown>): RecordingStorage | null {
  const endpoint = env.RECORDING_S3_ENDPOINT, bucket = env.RECORDING_S3_BUCKET, accessKey = env.RECORDING_S3_ACCESS_KEY, secret = env.RECORDING_S3_SECRET;
  if (![endpoint, bucket, accessKey, secret].every((v) => typeof v === "string" && v)) return null;
  if (!/^https:\/\//.test(endpoint as string)) return null;
  return { endpoint: endpoint as string, bucket: bucket as string, accessKey: accessKey as string, secret: secret as string };
}

async function egressCall(config: ProviderConfig, room: string, method: string, body: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({ iss: config.apiKey, sub: "enercore-server", nbf: now - 10, exp: now + 60, video: { room, roomRecord: true } }, config.apiSecret);
  const response = await fetch(`${httpBase(config)}/twirp/livekit.Egress/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Recording ${method} failed (${response.status}).`);
  return result;
}

/** Starts a composite (everyone, one file) MP4 recording of the room; returns the egress id. */
export async function startRecording(config: ProviderConfig, storage: RecordingStorage, room: string, fileKey: string) {
  const info = await egressCall(config, room, "StartRoomCompositeEgress", {
    room_name: room,
    layout: "grid",
    file_outputs: [
      {
        file_type: "MP4",
        filepath: fileKey,
        disable_manifest: true,
        s3: { access_key: storage.accessKey, secret: storage.secret, region: "auto", endpoint: storage.endpoint, bucket: storage.bucket, force_path_style: true },
      },
    ],
  });
  const id = (info.egress_id ?? info.egressId) as string | undefined;
  if (!id) throw new Error("Recording did not start.");
  return id;
}

export const stopRecording = (config: ProviderConfig, room: string, egressId: string) => egressCall(config, room, "StopEgress", { egress_id: egressId });

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
  participant?: { identity?: string; name?: string };
  track?: { source?: string | number; type?: string | number };
  egressInfo?: Record<string, unknown>;
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
