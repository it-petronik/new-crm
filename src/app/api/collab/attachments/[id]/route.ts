import { isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json, requireRead } from "@/lib/collab-auth";
import { discardPendingAttachment, findAttachment } from "@/lib/collab-data";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE: discard an upload removed from the composer before sending. Only
 * its uploader may, only while it is still pending; a sent file goes with its
 * message. The R2 object is purged by the scheduled purge.
 */
export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const id = (await params).id;
    const notFound = new CollabError(404, "Attachment not found.");
    if (!isId(id)) throw notFound;
    const attachment = await findAttachment(db, id);
    if (!attachment || attachment.uploaderId !== actor.id || attachment.messageId || attachment.deletedAt) throw notFound;
    await requireRead(db, actor, attachment.conversationId).catch(() => {
      throw notFound;
    });
    await discardPendingAttachment(db, id, new Date());
    return json({ ok: true });
  });
}
