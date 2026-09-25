import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, isPreview } from "@/lib/db";
import { verifyWebhook } from "@/lib/livekit";
import { providerConfig } from "@/lib/livekit-config";
import { closeSession, findMeetingByRoom, findRecordingByEgress, logActivity, openSession } from "@/lib/meeting-data";
import { announce, endMeeting } from "@/lib/meeting-service";
import { afterResponse } from "@/lib/collab-realtime";
import { meetingRecordings } from "@/lib/schema";
import { isGuestIdentity } from "@/lib/meetings";

/**
 * The meeting provider's webhook: who actually connected or left, screen
 * sharing starting or stopping, a room closing, and a recording finishing.
 * Trusted only after its signature and body hash verify; only the events
 * below change anything. It records attendance and status — it can never
 * grant access, and participant metadata is never read.
 */

const HANDLED = new Set(["participant_joined", "participant_left", "room_finished", "track_published", "track_unpublished", "egress_ended", "egress_updated"]);
const isScreen = (source: unknown) => source === "SCREEN_SHARE" || source === 3;
const EGRESS_DONE = new Set(["EGRESS_COMPLETE", 3]);
const EGRESS_FAILED = new Set(["EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED", 4, 5, 6]);

export async function POST(request: Request) {
  if (isPreview()) return new NextResponse(null, { status: 404 });
  const config = await providerConfig();
  const db = await getDb();
  if (!config || !db) return new NextResponse(null, { status: 503 });
  const body = await request.text();
  if (body.length > 64_000) return new NextResponse(null, { status: 413 });
  const event = await verifyWebhook(config, body, request.headers.get("authorization"));
  if (!event) return new NextResponse(null, { status: 401 });
  if (!HANDLED.has(event.event)) return NextResponse.json({ ok: true });

  // Recordings are matched by their egress id, not by room.
  if (event.event === "egress_ended" || event.event === "egress_updated") {
    const info = event.egressInfo ?? {};
    const egressId = (info.egressId ?? info.egress_id) as string | undefined;
    const recording = egressId ? await findRecordingByEgress(db, egressId) : undefined;
    if (!recording) return NextResponse.json({ ok: true });
    const status = info.status as string | number | undefined;
    const files = (info.fileResults ?? info.file_results ?? []) as { duration?: string | number }[];
    if (EGRESS_DONE.has(status as never)) {
      const ns = Number(files[0]?.duration ?? 0);
      await db
        .update(meetingRecordings)
        .set({ status: "saved", stoppedAt: recording.stoppedAt ?? new Date(), durationSeconds: ns ? Math.round(ns / 1e9) : null })
        .where(eq(meetingRecordings.id, recording.id))
        .run();
    } else if (EGRESS_FAILED.has(status as never))
      await db
        .update(meetingRecordings)
        .set({ status: "failed", stoppedAt: recording.stoppedAt ?? new Date(), error: String(info.error ?? "The recording failed.").slice(0, 200) })
        .where(eq(meetingRecordings.id, recording.id))
        .run();
    return NextResponse.json({ ok: true });
  }

  const room = event.room?.name;
  const meeting = room ? await findMeetingByRoom(db, room) : undefined;
  // Rooms Enercore did not create are ignored.
  if (!meeting) return NextResponse.json({ ok: true });
  const identity = event.participant?.identity;
  const guest = !!identity && isGuestIdentity(identity);
  const name = event.participant?.name ?? null;
  const at = new Date();

  if (event.event === "participant_joined" && identity) {
    await openSession(db, { meetingId: meeting.id, identity, userId: guest ? null : identity, guestName: guest ? (name ?? "Guest").replace(/ \(Guest\)$/, "") : null, at });
    await afterResponse("meeting-joined", () => announce(db, "meeting.updated", meeting));
  } else if (event.event === "participant_left" && identity) {
    await closeSession(db, meeting.id, identity, at);
    await afterResponse("meeting-left", () => announce(db, "meeting.updated", meeting));
  } else if ((event.event === "track_published" || event.event === "track_unpublished") && isScreen(event.track?.source)) {
    await logActivity(db, meeting.id, event.event === "track_published" ? "screen_share_started" : "screen_share_stopped", name, at);
  } else if (event.event === "room_finished") {
    await endMeeting(db, meeting.id);
  }
  return NextResponse.json({ ok: true });
}
