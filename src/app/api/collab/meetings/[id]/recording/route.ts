import { z } from "zod";
import { eq } from "drizzle-orm";
import { messageId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { meetingRecordings } from "@/lib/schema";
import { activeRecording, findRecording, logActivity } from "@/lib/meeting-data";
import { announce, requireMeeting } from "@/lib/meeting-service";
import { setRoomMetadata, startRecording, stopRecording } from "@/lib/livekit";
import { recordingSetup } from "@/lib/livekit-config";
import { recordingView } from "@/lib/meeting-recordings";
import { afterResponse } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string }> };

const input = z.object({ action: z.enum(["start", "stop"]) }).strict();

/**
 * POST (managers): start or stop the meeting's cloud recording.
 *
 * Never silent: starting sets the room's metadata, which every participant
 * — guests included — receives at once and shows as a persistent
 * "● Recording" with who started it; stopping clears it. The file goes to
 * private storage through the provider; only metadata is kept here. The
 * database allows one running recording per meeting.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can record this meeting.");
    const { action } = input.parse(await request.json());
    const setup = await recordingSetup();
    if (!setup) throw new CollabError(503, "Cloud recording isn't set up yet. Ask your administrator.");
    const { config, storage } = setup;

    if (action === "start") {
      if (meeting.status !== "live") throw new CollabError(409, "Recording is available while the meeting is running.");
      const now = new Date();
      const id = messageId(now.getTime());
      const fileKey = `recordings/${meeting.id}/${id}.mp4`;
      try {
        await db.insert(meetingRecordings).values({ id, meetingId: meeting.id, egressId: null, startedBy: actor.name, startedAt: now, stoppedAt: null, status: "starting", fileKey, durationSeconds: null, error: null }).run();
      } catch {
        throw new CollabError(409, "This meeting is already being recorded.");
      }
      try {
        const egressId = await startRecording(config, storage, meeting.providerRoom, fileKey);
        await db.update(meetingRecordings).set({ egressId, status: "recording" }).where(eq(meetingRecordings.id, id)).run();
        await setRoomMetadata(config, meeting.providerRoom, { recording: { by: actor.name, at: now.toISOString() } });
      } catch (error) {
        await db.update(meetingRecordings).set({ status: "failed", stoppedAt: new Date(), error: String((error as Error)?.message ?? error).slice(0, 200) }).where(eq(meetingRecordings.id, id)).run();
        throw new CollabError(502, "The recording couldn't start. Try again in a moment.");
      }
      await logActivity(db, meeting.id, "recording_started", actor.name, now);
      await afterResponse("meeting-recording", () => announce(db, "meeting.updated", meeting));
      return json({ recording: recordingView((await findRecording(db, id))!) }, 201);
    }

    const active = await activeRecording(db, meeting.id);
    if (!active) throw new CollabError(409, "Nothing is being recorded.");
    if (active.egressId) await stopRecording(config, meeting.providerRoom, active.egressId).catch(() => {});
    const now = new Date();
    await db.update(meetingRecordings).set({ status: "processing", stoppedAt: now }).where(eq(meetingRecordings.id, active.id)).run();
    await setRoomMetadata(config, meeting.providerRoom, { recording: null }).catch(() => {});
    await logActivity(db, meeting.id, "recording_stopped", actor.name, now);
    await afterResponse("meeting-recording", () => announce(db, "meeting.updated", meeting));
    return json({ recording: recordingView((await findRecording(db, active.id))!) });
  });
}
