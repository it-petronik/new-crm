import { configFrom, type ProviderConfig } from "./livekit";

/**
 * Provider settings inside a request (API routes). Kept apart from
 * livekit.ts so the scheduled Worker, which reads its env directly through
 * `configFrom`, never bundles the request-context adapter.
 */
export async function providerConfig(): Promise<ProviderConfig | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return configFrom((await getCloudflareContext({ async: true })).env as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

