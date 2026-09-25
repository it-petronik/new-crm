import { isId, messageId, type AttachmentKind, type AttachmentPage } from "@/lib/collab";
import { CollabError, collabContext, handle, json, rateLimit, requireRead } from "@/lib/collab-auth";
import { attachmentView, insertAttachment, pageAttachments } from "@/lib/collab-data";
import {
  ATTACHMENT_LIMITS,
  THUMBNAIL_MAX,
  UPLOAD_REQUEST_MAX,
  VOICE_NOTE_MAX_MS,
  detectFile,
  detectImage,
  formatBytes,
  safeFileName,
  storageKey,
} from "@/lib/collab-files";
import { collabBucket } from "@/lib/collab-storage";

type Params = { params: Promise<{ id: string }> };

const BROWSE: Record<string, AttachmentKind[]> = {
  media: ["image"],
  files: ["pdf", "document"],
  audio: ["audio"],
};

/** GET ?kind=media|files|audio&before=: a room's attachments, paged. */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const access = await requireRead(db, actor, (await params).id);
    const search = new URL(request.url).searchParams;
    const kinds = BROWSE[search.get("kind") ?? "media"];
    if (!kinds) throw new CollabError(400, "Unknown attachment kind.");
    const before = search.get("before") ?? undefined;
    if (before !== undefined && !isId(before)) throw new CollabError(400, "Invalid cursor.");
    const limit = Math.min(Math.max(Number(search.get("limit")) || 30, 1), 60);
    const page: AttachmentPage = await pageAttachments(db, access.conversation.id, kinds, before, limit);
    return json(page);
  });
}

const intIn = (value: FormDataEntryValue | null, min: number, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * POST (multipart): upload one file for a message not yet sent. The caller
 * must be able to post in the conversation; the file is stored under a random
 * key and recorded as pending until a message links it.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireRead(db, actor, (await params).id);
    if (!access.canPost) throw new CollabError(403, "You can't send files in this conversation.");
    await rateLimit(db, actor, "upload");

    // Refuse oversized bodies before reading them.
    const length = Number(request.headers.get("content-length"));
    if (!length || length > UPLOAD_REQUEST_MAX)
      throw new CollabError(413, `Files can be at most ${formatBytes(ATTACHMENT_LIMITS.pdf)}.`);

    const bucket = await collabBucket();
    if (!bucket) throw new CollabError(503, "File storage is not available here.");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new CollabError(400, "Choose a file to upload.");
    const name = safeFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new CollabError(400, "That file is empty.");

    // The type is decided by the bytes and the extension together; the
    // browser's claim (file.type) is deliberately ignored.
    const detected = detectFile(bytes, name);
    if (!detected)
      throw new CollabError(415, "This file type isn't supported. Send images, PDFs, Word, Excel or PowerPoint files, text or CSV files, or audio. ZIP archives aren't accepted.");
    if (bytes.length > ATTACHMENT_LIMITS[detected.kind])
      throw new CollabError(413, `${detected.label} files can be at most ${formatBytes(ATTACHMENT_LIMITS[detected.kind])}.`);

    // Layout hints from the client are bounded, never trusted for anything
    // but reserving space.
    const width = detected.kind === "image" ? intIn(form.get("width"), 1, 20000) : null;
    const height = detected.kind === "image" ? intIn(form.get("height"), 1, 20000) : null;
    const durationMs = detected.kind === "audio" ? intIn(form.get("durationMs"), 0, VOICE_NOTE_MAX_MS + 5000) : null;

    // An image may carry a small client-made preview; it must itself be a
    // real image within its own limit, or it is simply not used.
    let thumb: { bytes: Uint8Array; mime: string } | null = null;
    const thumbnail = form.get("thumbnail");
    if (detected.kind === "image" && thumbnail instanceof File && thumbnail.size <= THUMBNAIL_MAX) {
      const thumbBytes = new Uint8Array(await thumbnail.arrayBuffer());
      const mime = detectImage(thumbBytes);
      if (mime) thumb = { bytes: thumbBytes, mime };
    }

    const key = storageKey("att");
    const thumbKey = thumb ? `${key}.thumb` : null;
    await bucket.put(key, bytes, { httpMetadata: { contentType: detected.mimeType } });
    if (thumb && thumbKey) await bucket.put(thumbKey, thumb.bytes, { httpMetadata: { contentType: thumb.mime } });

    const now = new Date();
    const row = {
      id: messageId(now.getTime()),
      conversationId: access.conversation.id,
      messageId: null,
      uploaderId: actor.id,
      storageKey: key,
      thumbKey,
      originalName: name,
      mimeType: detected.mimeType,
      kind: detected.kind,
      size: bytes.length,
      width,
      height,
      durationMs,
      position: null,
      createdAt: now,
      deletedAt: null,
    };
    try {
      await insertAttachment(db, row);
    } catch (error) {
      await bucket.delete([key, ...(thumbKey ? [thumbKey] : [])]).catch(() => {});
      throw error;
    }
    return json({ attachment: attachmentView(row) }, 201);
  });
}
