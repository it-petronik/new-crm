import { drizzle } from "drizzle-orm/d1";
import * as schema from "../lib/schema";
import type { Database } from "../lib/d1";
import { conversationAccess } from "../lib/collab-access";
import { findAttachment, findConversation, purgeableAttachments, deleteAttachmentRows } from "../lib/collab-data";
import { contentDisposition, inlineKinds } from "../lib/collab-files";
import type { BucketLike } from "../lib/collab-storage";
import { sessionActor, type D1Like } from "./session";

/**
 * Collaboration files, served by the Worker itself (ahead of Next.js) so the
 * response headers are exactly these and bytes stream straight from R2.
 *
 * Every request re-authorises from scratch: a live session for an active
 * account, then CURRENT access to the file's conversation (membership and
 * company/branch scope, via the same conversationAccess the API uses). A
 * refused, missing, pending-but-not-yours or deleted file is one identical
 * 404, so neither an attachment id nor an R2 key grants anything — and the
 * bucket itself is never public.
 */

export type FilesEnv = { DB?: D1Like; COLLAB_FILES?: BucketLike; APP_MODE?: string };

const ID = /^[A-Za-z0-9-]{8,64}$/;
const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

function database(env: FilesEnv): Database | null {
  return env.DB ? (drizzle(env.DB as never, { schema }) as unknown as Database) : null;
}

/** Parses a single "bytes=a-b" range against a known size. */
function parseRange(header: string | null, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match || size <= 0) return null;
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start)) {
    // "bytes=-N": the last N bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function headers(contentType: string, disposition: string, inlinePdf: boolean, cache: string) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cache,
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    // A PDF may be shown in the app's own preview frame, and the browser's
    // PDF viewer needs to run; everything else is inert and unframeable.
    ...(inlinePdf
      ? { "Content-Security-Policy": "frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN" }
      : { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox", "X-Frame-Options": "DENY" }),
  };
}

export async function collabFile(request: Request, env: FilesEnv, id: string): Promise<Response> {
  if (env.APP_MODE === "preview") return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const db = database(env);
  if (!db || !env.DB || !env.COLLAB_FILES || !ID.test(id)) return notFound();
  const found = await sessionActor(request, env.DB);
  if (!found) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { actor } = found;

  const attachment = await findAttachment(db, id);
  if (!attachment || attachment.deletedAt) return notFound();
  // Not yet sent: visible to its uploader only.
  if (!attachment.messageId && attachment.uploaderId !== actor.id) return notFound();
  const access = await conversationAccess(db, actor, attachment.conversationId).catch(() => null);
  if (!access?.canRead) return notFound();

  const search = new URL(request.url).searchParams;
  const wantsThumb = search.has("thumb") && !!attachment.thumbKey;
  const download = search.has("download");
  const inline = !download && inlineKinds.includes(attachment.kind);
  const disposition = contentDisposition(attachment.originalName, inline);
  // Media may be kept by this browser but must be revalidated on every use,
  // and revalidation passes through the access check above: a removed member
  // gets 404, not the cached copy. Documents are never stored at all.
  const cache = attachment.kind === "image" || attachment.kind === "audio" ? "private, no-cache" : "private, no-store";
  const etag = `"${attachment.id}-${search.has("thumb") && attachment.thumbKey ? "t" : "f"}"`;
  if (cache.includes("no-cache") && request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cache } });
  const inlinePdf = inline && attachment.kind === "pdf";

  if (wantsThumb) {
    const object = await env.COLLAB_FILES.get(attachment.thumbKey!);
    if (!object) return notFound();
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        ...headers(object.httpMetadata?.contentType ?? "image/jpeg", disposition, false, cache),
        "Content-Length": String(object.size),
        ETag: etag,
      },
    });
  }

  const range = parseRange(request.headers.get("Range"), attachment.size);
  const object = await env.COLLAB_FILES.get(
    attachment.storageKey,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
  );
  if (!object) return notFound();
  const base = {
    ...headers(attachment.mimeType, disposition, inlinePdf, cache),
    "Accept-Ranges": "bytes",
    ...(cache.includes("no-cache") ? { ETag: etag } : {}),
  };
  if (range)
    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${range.start}-${range.end}/${attachment.size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: { ...base, "Content-Length": String(attachment.size) },
  });
}

/**
 * A room's image. Visible to anyone who may read the room, or who could join
 * it (a workspace room's public face includes its image); otherwise 404.
 */
export async function roomAvatar(request: Request, env: FilesEnv, conversationId: string): Promise<Response> {
  if (env.APP_MODE === "preview") return notFound();
  const db = database(env);
  if (!db || !env.DB || !env.COLLAB_FILES || !ID.test(conversationId)) return notFound();
  const found = await sessionActor(request, env.DB);
  if (!found) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const access = await conversationAccess(db, found.actor, conversationId).catch(() => null);
  if (!access || !(access.canRead || access.canJoin)) return notFound();
  const room = await findConversation(db, conversationId);
  if (!room?.avatarKey) return notFound();
  // Revalidated on every use, like other private media.
  const etag = `"${room.avatarKey.slice(-16)}"`;
  if (request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  const object = await env.COLLAB_FILES.get(room.avatarKey);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      ...headers(object.httpMetadata?.contentType ?? "image/jpeg", 'inline; filename="room.jpg"', false, "private, no-cache"),
      "Content-Length": String(object.size),
      ETag: etag,
    },
  });
}

/**
 * Scheduled retention (daily): uploads never sent within a day, and files of
 * messages deleted more than 30 days ago, lose their R2 objects and rows.
 * Deleted files are unreachable from the moment of deletion; the 30 days are
 * a recovery window, not visibility.
 */
export async function purgeAttachments(env: FilesEnv) {
  const db = database(env);
  if (!db || !env.COLLAB_FILES || env.APP_MODE === "preview") return 0;
  let purged = 0;
  for (let round = 0; round < 5; round++) {
    const rows = await purgeableAttachments(db, Date.now());
    if (!rows.length) break;
    // Per attachment: a row goes only once its objects are gone, so a failed
    // R2 delete leaves that row to be retried next run and touches no other.
    const done: string[] = [];
    for (const row of rows) {
      try {
        await env.COLLAB_FILES.delete([row.storageKey, ...(row.thumbKey ? [row.thumbKey] : [])]);
        done.push(row.id);
      } catch {
        // Retried on the next scheduled run.
      }
    }
    await deleteAttachmentRows(db, done);
    purged += done.length;
    if (done.length < rows.length) break;
  }
  return purged;
}
