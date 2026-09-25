import { NextResponse } from "next/server";
import { getDb, isPreview } from "@/lib/db";
import { verifyWebhook } from "@/lib/livekit";
import { providerConfig } from "@/lib/livekit-config";
import { findMeetingByRoom, markJoined, markLeft } from "@/lib/meeting-data";
import { announce, endMeeting } from "@/lib/meeting-service";
import { afterResponse } from "@/lib/collab-realtime";

/**
 * The meeting provider's webhook: who actually connected or left, and when
 * a room closed. Trusted only after its signature and body hash verify
 * (verifyWebhook); an unsigned or altered request changes nothing. It only
 * updates attendance and meeting status — it can never grant access, and
 * participant metadata is never read.
 */
const HANDLED = new Set(["participant_joined", "participant_left", "room_finished"]);

export async function POST(request: Request) {
  if (isPreview()) return new NextResponse(null, { status: 404 });
  const config = await providerConfig();
  const db = await getDb();
  if (!config || !db) return new NextResponse(null, { status: 503 });
  const body = await request.text();
  if (body.length > 64_000) return new NextResponse(null, { status: 413 });
  const event = await verifyWebhook(config, body, request.headers.get("authorization"));
  if (!event) return new NextResponse(null, { status: 401 });

  // Only these events change anything; everything else is acknowledged and ignored.
  if (!HANDLED.has(event.event)) return NextResponse.json({ ok: true });
  const room = event.room?.name;
  const meeting = room ? await findMeetingByRoom(db, room) : undefined;
  // Rooms Enercore did not create are ignored.
  if (!meeting) return NextResponse.json({ ok: true });
  const identity = event.participant?.identity;

  if (event.event === "participant_joined" && identity) {
    await markJoined(db, meeting.id, identity);
    await afterResponse("meeting-joined", () => announce(db, "meeting.updated", meeting));
  } else if (event.event === "participant_left" && identity) {
    await markLeft(db, meeting.id, identity);
    await afterResponse("meeting-left", () => announce(db, "meeting.updated", meeting));
  } else if (event.event === "room_finished") {
    await endMeeting(db, meeting.id);
  }
  return NextResponse.json({ ok: true });
}
