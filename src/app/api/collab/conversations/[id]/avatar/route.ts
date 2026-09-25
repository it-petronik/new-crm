import { CollabError, collabContext, handle, json, rateLimit, requireAdmin } from "@/lib/collab-auth";
import { updateConversation } from "@/lib/collab-data";
import { ROOM_AVATAR_MAX, detectImage, formatBytes, storageKey } from "@/lib/collab-files";
import { collabBucket } from "@/lib/collab-storage";
import { announceChange, summaryFor } from "@/lib/collab-service";
import { auditRoom } from "@/lib/collab-audit";

type Params = { params: Promise<{ id: string }> };

/**
 * POST (multipart "image"): set a room's image. Owners and admins only; a
 * real JPEG/PNG/WebP/GIF of at most 2 MB (the client crops and scales to a
 * square first). Stored in R2 under a fresh random key — never in D1 — and
 * the previous image object is deleted.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireAdmin(db, actor, (await params).id);
    await rateLimit(db, actor, "avatar");
    const length = Number(request.headers.get("content-length"));
    if (!length || length > ROOM_AVATAR_MAX + 64 * 1024)
      throw new CollabError(413, `Room images can be at most ${formatBytes(ROOM_AVATAR_MAX)}.`);
    const bucket = await collabBucket();
    if (!bucket) throw new CollabError(503, "File storage is not available here.");
    const image = (await request.formData()).get("image");
    if (!(image instanceof File)) throw new CollabError(400, "Choose an image.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.length > ROOM_AVATAR_MAX)
      throw new CollabError(413, `Room images can be at most ${formatBytes(ROOM_AVATAR_MAX)}.`);
    const mime = detectImage(bytes);
    if (!mime) throw new CollabError(415, "Use a JPEG, PNG, WebP or GIF image.");

    const room = access.conversation;
    const key = storageKey("room");
    await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    const now = new Date();
    await updateConversation(db, room.id, { avatarKey: key, avatarUpdatedAt: now, updatedAt: now });
    if (room.avatarKey) await bucket.delete(room.avatarKey).catch(() => {});
    await auditRoom(db, actor, room, "Changed room image");
    await announceChange(db, room.id);
    return json({ conversation: await summaryFor(db, actor, room.id) });
  });
}

/** DELETE: back to the generated initials. */
export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireAdmin(db, actor, (await params).id);
    const room = access.conversation;
    if (!room.avatarKey) return json({ conversation: await summaryFor(db, actor, room.id) });
    const now = new Date();
    await updateConversation(db, room.id, { avatarKey: null, avatarUpdatedAt: now, updatedAt: now });
    const bucket = await collabBucket();
    if (bucket) await bucket.delete(room.avatarKey).catch(() => {});
    await auditRoom(db, actor, room, "Removed room image");
    await announceChange(db, room.id);
    return json({ conversation: await summaryFor(db, actor, room.id) });
  });
}
