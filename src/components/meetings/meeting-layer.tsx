"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "../ui/controls";
import { Avatar } from "../avatar";
import { useCollabEvents } from "@/lib/collab-client";
import { openPrejoin, useMeetingFlow } from "@/lib/meeting-client";
import type { MeetingView } from "@/lib/meetings";

// Loaded only when someone actually opens a meeting, so the provider's
// client never weighs on the rest of the CRM.
const Prejoin = dynamic(() => import("./prejoin"), { ssr: false });
const MeetingRoom = dynamic(() => import("./meeting-room"), { ssr: false });

/**
 * Meetings above the whole workspace: the ringing card for an incoming
 * call, the pre-join screen and the meeting itself. While a meeting is
 * open the CRM underneath is covered (and inert to assistive tech); leaving
 * reveals it exactly as it was.
 */
export default function MeetingLayer({ meId }: { meId: string }) {
  const flow = useMeetingFlow();
  const open = flow.phase !== "idle";

  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.meeting = flow.phase;
    else delete root.dataset.meeting;
    return () => void delete root.dataset.meeting;
  }, [open, flow.phase]);

  return (
    <>
      <IncomingCall busy={flow.phase === "room"} />
      {flow.phase === "prejoin" && <Prejoin meetingId={flow.meetingId} />}
      {flow.phase === "room" && <MeetingRoom key={flow.grant.token} meetingId={flow.meetingId} grant={flow.grant} choices={flow.choices} meId={meId} />}
    </>
  );
}

/**
 * A direct call ringing. Joining goes to the pre-join screen — the camera
 * and microphone are never touched by the invitation itself. It stops
 * ringing when declined, answered, ended, or after 45 seconds.
 */
function IncomingCall({ busy }: { busy: boolean }) {
  const [call, setCall] = useState<{ meeting: MeetingView; from: { id: string; name: string } } | null>(null);
  useCollabEvents(true, (event) => {
    if (event.type === "meeting.invited") setCall({ meeting: event.meeting, from: event.from });
    if (event.type === "meeting.ended") setCall((c) => (c?.meeting.id === event.meeting.id ? null : c));
  });
  useEffect(() => {
    if (!call) return;
    const t = setTimeout(() => setCall(null), 45_000);
    return () => clearTimeout(t);
  }, [call]);
  if (!call) return null;
  const video = call.meeting.media === "video";
  return (
    <div className="meet-incoming" role="alertdialog" aria-labelledby="meet-incoming-title" aria-describedby="meet-incoming-detail">
      <Avatar name={call.from.name} size={44} />
      <div className="meet-incoming-text">
        <b id="meet-incoming-title">{call.from.name}</b>
        <span id="meet-incoming-detail">{busy ? "is calling you (you're in a meeting)" : `${video ? "Video" : "Voice"} call`}</span>
      </div>
      <Button className="meet-round is-decline" aria-label="Decline" onClick={() => setCall(null)}>
        <PhoneOff size={18} />
      </Button>
      <Button
        className="meet-round is-accept"
        aria-label={video ? "Answer with video" : "Answer"}
        disabled={busy}
        onClick={() => {
          openPrejoin(call.meeting.id);
          setCall(null);
        }}
      >
        {video ? <Video size={18} /> : <Phone size={18} />}
      </Button>
    </div>
  );
}
