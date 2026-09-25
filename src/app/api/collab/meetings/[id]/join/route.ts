import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { goLive, markJoined, meetingViews } from "@/lib/meeting-data";
import { meetingStarted, requireMeeting } from "@/lib/meeting-service";
import { joinToken } from "@/lib/livekit";
import { providerConfig } from "@/lib/livekit-config";
import { JOIN_TOKEN_TTL_S, joinable, type JoinGrant } from "@/lib/meetings";

type Params = { params: Promise<{ id: string }> };

/**
 * POST: a fresh, short-lived join token for THIS person and THIS meeting.
 *
 * Issued only after the same checks every Collaboration read makes: a live
 * session for an active account, current membership and company/branch
 * scope for the meeting's conversation. A removed or deactivated person is
 * refused here, so they can never obtain a new token. The token is good for
 * connecting for ten minutes; it names the person (their user id) and the
 * one provider room, and carries no secret.
 *
 * Joining a scheduled meeting within its window starts it.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, access, canManage } = await requireMeeting(db, actor, (await params).id);
    if (meeting.status === "ended" || meeting.status === "cancelled")
      throw new CollabError(410, meeting.status === "ended" ? "This meeting has ended." : "This meeting was cancelled.");
    if (!joinable({ status: meeting.status, scheduledAt: meeting.scheduledAt }))
      throw new CollabError(409, "This meeting hasn't opened yet. You can join 15 minutes before it starts.");
    const config = await providerConfig();
    if (!config) throw new CollabError(503, "Meetings aren't set up yet. Ask your administrator.");

    let row = meeting;
    if (meeting.status === "scheduled") {
      // Exactly one caller starts it; the database refuses a second live
      // meeting in the same conversation.
      const live = await goLive(db, meeting.id);
      if (!live) throw new CollabError(409, "Another meeting is already running in this conversation. Join that one instead.");
      row = live.row;
      if (live.started)
        await meetingStarted(db, row, actor, { direct: access.conversation.kind === "direct", roomName: access.conversation.name });
    }
    const token = await joinToken(config, {
      identity: actor.id,
      name: actor.name,
      room: row.providerRoom,
      ttlSeconds: JOIN_TOKEN_TTL_S,
      host: canManage,
    });
    // Provisional until the provider's webhook confirms the connection.
    await markJoined(db, row.id, actor.id);
    const grant: JoinGrant = {
      serverUrl: config.url,
      token,
      expiresIn: JOIN_TOKEN_TTL_S,
      meeting: (await meetingViews(db, [row], () => canManage))[0],
      identity: actor.id,
      host: canManage,
    };
    return json(grant);
  });
}
