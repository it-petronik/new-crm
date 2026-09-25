import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { goLive } from "@/lib/meeting-data";
import { meetingStarted, requireMeeting, viewFor } from "@/lib/meeting-service";
import { joinToken } from "@/lib/livekit";
import { providerConfig, recordingSetup } from "@/lib/livekit-config";
import { JOIN_TOKEN_TTL_S, joinable, type JoinGrant } from "@/lib/meetings";

type Params = { params: Promise<{ id: string }> };

/**
 * POST: a fresh, short-lived join token for THIS person and THIS meeting.
 *
 * Issued only after the checks every Collaboration request makes (a live
 * session for an active account) plus the meeting's own: read access to
 * its conversation right now, or — for a standalone meeting — being its
 * organiser or an invitee. A removed or deactivated person is refused here,
 * so they can never obtain a new token. The token is good for connecting for
 * ten minutes, names the person and the one provider room, and carries no
 * secret. Joining a scheduled meeting within its window starts it — once.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, access, canManage } = await requireMeeting(db, actor, (await params).id);
    if (meeting.status === "ended" || meeting.status === "cancelled" || meeting.status === "missed")
      throw new CollabError(410, meeting.status === "ended" ? "This meeting has ended." : meeting.status === "cancelled" ? "This meeting was cancelled." : "This meeting didn't take place.");
    if (!joinable({ status: meeting.status, scheduledAt: meeting.scheduledAt }))
      throw new CollabError(409, "This meeting hasn't opened yet. You can join 15 minutes before it starts.");
    const config = await providerConfig();
    if (!config) throw new CollabError(503, "Meetings aren't set up yet. Ask your administrator.");

    let row = meeting;
    if (meeting.status === "scheduled") {
      const live = await goLive(db, meeting.id);
      if (!live) throw new CollabError(409, "Another meeting is already running in this conversation. Join that one instead.");
      row = live.row;
      if (live.started)
        await meetingStarted(db, row, actor, { direct: access?.conversation.kind === "direct", roomName: access?.conversation.name ?? null });
    }
    const token = await joinToken(config, { identity: actor.id, name: actor.name, room: row.providerRoom, ttlSeconds: JOIN_TOKEN_TTL_S, host: canManage });
    // Attendance is recorded from the provider's webhooks (joined / left),
    // which see the real connection — not from asking for a token.
    const grant: JoinGrant = {
      serverUrl: config.url,
      token,
      expiresIn: JOIN_TOKEN_TTL_S,
      meeting: await viewFor(db, actor, row, canManage),
      identity: actor.id,
      host: canManage,
      canRecord: canManage && !!(await recordingSetup()),
    };
    return json(grant);
  });
}
