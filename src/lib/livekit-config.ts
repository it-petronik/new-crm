import { configFrom, recordingStorageFrom, type ProviderConfig, type RecordingStorage } from "./livekit";
import type { BucketLike } from "./collab-storage";

/**
 * Provider settings inside a request (API routes). Kept apart from
 * livekit.ts so the scheduled Worker, which reads its env directly through
 * `configFrom`, never bundles the request-context adapter.
 */
async function requestEnv(): Promise<Record<string, unknown> | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return (await getCloudflareContext({ async: true })).env as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The secret guest-link tokens are derived with: its own MEETING_LINK_SECRET
 * when set, else the provider secret (under its own HMAC label, so the two
 * uses never collide). Rotating it only means earlier links can't be shown
 * again — they keep working until revoked, and a new one can be created.
 */
export async function guestLinkSecret(): Promise<string | null> {
  const env = await requestEnv();
  const value = env?.MEETING_LINK_SECRET ?? env?.LIVEKIT_API_SECRET;
  return typeof value === "string" && value.length >= 16 ? value : null;
}

export async function providerConfig(): Promise<ProviderConfig | null> {
  const env = await requestEnv();
  return env ? configFrom(env) : null;
}

/**
 * Cloud recording needs BOTH the provider and private storage it can write
 * to (the recording S3 settings) and that Enercore can read back from (the
 * COLLAB_FILES bucket). Missing either, recording is unavailable — never
 * started with nowhere to go.
 */
export async function recordingSetup(): Promise<{ config: ProviderConfig; storage: RecordingStorage; bucket: BucketLike } | null> {
  const env = await requestEnv();
  if (!env) return null;
  const config = configFrom(env);
  const storage = recordingStorageFrom(env);
  const bucket = env.COLLAB_FILES as BucketLike | undefined;
  return config && storage && bucket ? { config, storage, bucket } : null;
}
