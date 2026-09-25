import { isId } from "@/lib/collab";
import { CollabError, collabContext, handle } from "@/lib/collab-auth";
import { findRecording } from "@/lib/meeting-data";
import { requireMeeting } from "@/lib/meeting-service";
import { recordingSetup } from "@/lib/livekit-config";

type Params = { params: Promise<{ id: string }> };

/**
 * GET: download a saved cloud recording. Signed-in, active people who may
 * reach the meeting right now only — the same check as the meeting itself.
 * Guests never can: a guest link opens a meeting, not its recordings, and
 * guests have no session. Streamed from private storage, never cached.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const id = (await params).id;
    const recording = isId(id) ? await findRecording(db, id) : undefined;
    if (!recording) throw new CollabError(404, "Recording not found.");
    // Throws the same 404 for anyone who may not reach the meeting.
    await requireMeeting(db, actor, recording.meetingId);
    if (recording.status !== "saved" || !recording.fileKey) throw new CollabError(404, "Recording not found.");
    const setup = await recordingSetup();
    const object = setup ? await setup.bucket.get(recording.fileKey) : null;
    if (!object) throw new CollabError(404, "Recording not found.");
    return new Response(object.body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="meeting-recording-${recording.id}.mp4"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
