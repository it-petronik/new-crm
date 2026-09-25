import { z } from "zod";
import { isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { markLeft } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";
import { muteTrack, removeFromRoom } from "@/lib/livekit";
import { providerConfig } from "@/lib/livekit-config";

type Params = { params: Promise<{ id: string }> };

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mute"), identity: z.string().refine(isId), trackSid: z.string().min(2).max(64) }).strict(),
  z.object({ action: z.literal("remove"), identity: z.string().refine(isId) }).strict(),
]);

/**
 * POST: host controls — mute someone's microphone, or remove them from the
 * call. Performed by the server against the provider; the browser never
 * holds a token that could do this itself.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can do that.");
    if (meeting.status !== "live") throw new CollabError(409, "This meeting isn't running.");
    const body = input.parse(await request.json());
    if (body.identity === actor.id) throw new CollabError(400, "Use your own controls for yourself.");
    const config = await providerConfig();
    if (!config) throw new CollabError(503, "Meetings aren't set up yet.");
    if (body.action === "mute") await muteTrack(config, meeting.providerRoom, body.identity, body.trackSid);
    else {
      await removeFromRoom(config, meeting.providerRoom, body.identity);
      await markLeft(db, meeting.id, body.identity);
    }
    return json({ ok: true });
  });
}
