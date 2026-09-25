/**
 * The R2 bucket holding Collaboration files (binding COLLAB_FILES, live
 * environment only). Minimal local types, so the DOM-typed app does not load
 * the Workers type library globally.
 *
 * Nothing here decides access; callers authorise first.
 */

export type R2ObjectBodyLike = {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number };
};

export type BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; contentDisposition?: string } },
  ): Promise<unknown>;
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectBodyLike | null>;
  delete(keys: string | string[]): Promise<void>;
};

/** The bucket, or null where it is not bound (preview, local next dev). */
export async function collabBucket(): Promise<BucketLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    return (context.env as unknown as { COLLAB_FILES?: BucketLike }).COLLAB_FILES ?? null;
  } catch {
    return null;
  }
}
