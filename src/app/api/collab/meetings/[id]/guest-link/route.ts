import { z } from "zod";
import { messageId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { meetingGuestInvites } from "@/lib/schema";
import { revokeGuestInvites, updateMeeting } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";
import { deriveToken, expiryFor, hashToken, randomToken } from "@/lib/meeting-guests";
import { guestLinkSecret } from "@/lib/livekit-config";
import { guestLinkStatus, guestUrl } from "@/lib/meeting-link-status";

type Params = { params: Promise<{ id: string }> };

const input = z
  .object({
    expiry: z.enum(["1h", "24h", "7d", "meeting_end"]).default("meeting_end"),
    // Omitted: keep the meeting's own rule, or "host must admit" when guests
    // were off — never silently "anyone with the link".
    admission: z.enum(["open", "admit"]).optional(),
  })
  .strict();

/**
 * GET (managers): the meeting's current guest link — the /meet/<token> URL
 * when the server can produce it again — or null when there is none.
 * Everyone else gets 403: the guest link is the organiser's to share.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting, access, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can share guest links.");
    const direct = access?.conversation.kind === "direct";
    const open = meeting.status === "scheduled" || meeting.status === "live";
    return json({ link: direct ? null : await guestLinkStatus(db, meeting), allowed: !direct && open, admission: meeting.guestAccess === "off" ? "admit" : meeting.guestAccess });
  });
}

/**
 * POST (managers): create a guest link, or regenerate one — which revokes
 * every earlier link for this meeting. Only the token's hash is stored; the
 * token itself is derived from the new invite's random id with a server
 * secret, so it can be shown to managers again (see meeting-link-status).
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, access, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can share guest links.");
    if (access?.conversation.kind === "direct") throw new CollabError(400, "Guest links aren't available for one-to-one calls.");
    if (!(meeting.status === "scheduled" || meeting.status === "live")) throw new CollabError(409, "This meeting is over.");
    const body = input.parse(await request.json());
    const admission = body.admission ?? (meeting.guestAccess === "open" ? "open" : "admit");
    const now = new Date();
    await revokeGuestInvites(db, meeting.id, now);
    const id = messageId(now.getTime());
    const secret = await guestLinkSecret();
    const token = secret ? await deriveToken(secret, id) : randomToken();
    const expiresAt = expiryFor(body.expiry, now.getTime());
    await db
      .insert(meetingGuestInvites)
      .values({ id, meetingId: meeting.id, tokenHash: await hashToken(token), createdBy: actor.id, createdAt: now, expiresAt, revokedAt: null })
      .run();
    await updateMeeting(db, meeting.id, { guestAccess: admission });
    return json({
      url: guestUrl(token),
      expiresAt: expiresAt?.toISOString() ?? null,
      untilMeetingEnd: !expiresAt,
      admission,
    });
  });
}

/** DELETE (managers): revoke the guest link; nobody new can use it. */
export function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can revoke guest links.");
    await revokeGuestInvites(db, meeting.id);
    await updateMeeting(db, meeting.id, { guestAccess: "off" });
    return json({ ok: true });
  });
}
