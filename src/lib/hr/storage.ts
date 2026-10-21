import type { BucketLike } from "../collab-storage";
export function localHrUploadsAllowed(enabled?: string, appUrl?: string) {
  try {
    const url = new URL(appUrl || "https://disabled.invalid");
    return (
      enabled === "true" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}
/** No production binding/flag is installed by this feature. */
export async function hrStorage(): Promise<BucketLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const e = env as unknown as {
      HR_FILES?: BucketLike;
      HR_UPLOADS_ENABLED?: string;
      APP_URL?: string;
      APP_MODE?: string;
    };
    // Local-only until a separate production storage approval and security review.
    return localHrUploadsAllowed(e.HR_UPLOADS_ENABLED, e.APP_URL)
      ? e.HR_FILES || null
      : null;
  } catch {
    return null;
  }
}
