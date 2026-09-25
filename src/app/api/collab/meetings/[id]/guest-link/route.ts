import { z } from "zod";
import { messageId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { meetingGuestInvites } from "@/lib/schema";
import { revokeGuestInvites, updateMeeting } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";
import { expiryFor, hashToken, randomToken } from "@/lib/meeting-guests";

type Params = { params: Promise<{ id: string }> };

const input = z
  .object({
    expiry: z.enum(["1h", "24h", "7d", "meeting_end"]),
    admission: z.enum(["open", "admit"]).default("admit"),
  })
  .strict();

const origin = () => (process.env.APP_URL ? new URL(process.env.APP_URL).origin : "");

/**
 * POST (managers): create a guest link, or regenerate one — which revokes
 * every earlier link for this meeting. The raw token is returned ONCE, in
 * the URL; only its hash is stored, so it cannot be shown again later.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, access, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can share guest links.");
    if (access?.conversation.kind === "direct") throw new CollabError(400, "Guest links aren't available for one-to-one calls.");
    if (!(meeting.status === "scheduled" || meeting.status === "live")) throw new CollabError(409, "This meeting is over.");
    const body = input.parse(await request.json());
    const now = new Date();
    await revokeGuestInvites(db, meeting.id, now);
    const token = randomToken();
    const expiresAt = expiryFor(body.expiry, now.getTime());
    await db
      .insert(meetingGuestInvites)
      .values({ id: messageId(now.getTime()), meetingId: meeting.id, tokenHash: await hashToken(token), createdBy: actor.id, createdAt: now, expiresAt, revokedAt: null })
      .run();
    await updateMeeting(db, meeting.id, { guestAccess: body.admission });
    return json({
      url: `${origin()}/meet/${token}`,
      expiresAt: expiresAt?.toISOString() ?? null,
      untilMeetingEnd: !expiresAt,
      admission: body.admission,
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
