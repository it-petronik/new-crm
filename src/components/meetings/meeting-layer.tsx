"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Phone, PhoneOff, Video, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/controls";
import { Avatar } from "../avatar";
import { CollabRequestError, useCollabEvents } from "@/lib/collab-client";
import { closeMeeting, endMeetingForAll, openPrejoin, reportLeft, requestJoin, sessionFromGrant, useMeetingFlow } from "@/lib/meeting-client";
import { isDirectCall, type MeetingView } from "@/lib/meetings";
import { CALL_RING_MS } from "@/lib/call-audio";
import { useCallAudioUnlock, useCallTone } from "./use-call-tone";

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
export default function MeetingLayer() {
  const flow = useMeetingFlow();
  const open = flow.phase !== "idle";
  useCallAudioUnlock();

  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.meeting = flow.phase;
    else delete root.dataset.meeting;
    return () => void delete root.dataset.meeting;
  }, [open, flow.phase]);

  return (
    <>
      <IncomingCall busy={flow.phase === "room"} activeId={flow.phase === "idle" ? null : flow.meetingId} />
      {flow.phase === "prejoin" && <Prejoin key={flow.meetingId} meetingId={flow.meetingId} />}
      {flow.phase === "room" && (
        <MeetingRoom
          key={flow.session.token}
          session={flow.session}
          choices={flow.choices}
          onLeave={() => {
            void reportLeft(flow.meetingId);
            closeMeeting();
          }}
          onRejoin={async () => {
            // A fresh token re-checks access from scratch.
            try {
              return sessionFromGrant(await requestJoin(flow.meetingId));
            } catch (e) {
              const status = e instanceof CollabRequestError ? e.status : 0;
              return {
                error: status === 404 ? "You no longer have access to this meeting." : e instanceof Error ? e.message : "Check your connection and try again.",
                final: status === 404 || status === 410,
              };
            }
          }}
        />
      )}
    </>
  );
}

/**
 * A direct call ringing. Joining goes to the pre-join screen — the camera
 * and microphone are never touched by the invitation itself. It stops
 * ringing when declined, answered, ended, or after 45 seconds.
 */
function IncomingCall({ busy, activeId }: { busy: boolean; activeId: string | null }) {
  const [call, setCall] = useState<{ meeting: MeetingView; from: { id: string; name: string }; until: number; silent: boolean } | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [error, setError] = useState("");
  useCollabEvents(true, (event) => {
    if (event.type === "meeting.invited" && event.meeting.status === "live" && isDirectCall(event.meeting)) {
      const until = (event.meeting.startedAt ? Date.parse(event.meeting.startedAt) : Date.now()) + CALL_RING_MS;
      if (until > Date.now() && event.meeting.id !== activeId) {
        setError("");
        setCall(c => c?.meeting.id === event.meeting.id ? c : { meeting: event.meeting, from: event.from, until, silent: false });
      }
    }
    if (event.type === "meeting.ended") setCall((c) => (c?.meeting.id === event.meeting.id ? null : c));
    if (event.type === "conversation.removed") setCall(c => c?.meeting.conversationId === event.conversationId ? null : c);
  });
  const visible = !!call && call.meeting.id !== activeId;
  const tone = useCallTone(visible && !busy && !call.silent && declining !== call.meeting.id ? "incoming" : null, call?.until ?? 0);
  useEffect(() => {
    if (activeId) setCall(c => c?.meeting.id === activeId ? null : c);
  }, [activeId]);
  useEffect(() => {
    if (!call) return;
    const t = setTimeout(() => setCall(c => c?.meeting.id === call.meeting.id ? null : c), Math.max(0, call.until - Date.now()));
    return () => clearTimeout(t);
  }, [call]);
  if (!call || !visible) return null;
  const video = call.meeting.media === "video";
  async function decline() {
    if (!call || declining) return;
    const id = call.meeting.id;
    setDeclining(id); setError("");
    setCall(c => c?.meeting.id === id ? { ...c, silent: true } : c);
    try {
      // Either participant may end an instant direct call; the existing
      // server access check and ended event also stop the caller's ringback.
      await endMeetingForAll(id);
      setCall(c => c?.meeting.id === id ? null : c);
    } catch { setError("Couldn't decline the call. Try again; ringing is silenced."); }
    finally { setDeclining(null); }
  }
  return (
    <div className="meet-incoming" data-ringtone={tone.state} role="alertdialog" aria-labelledby="meet-incoming-title" aria-describedby="meet-incoming-detail">
      <Avatar name={call.from.name} size={44} />
      <div className="meet-incoming-text">
        <b id="meet-incoming-title">{call.from.name}</b>
        <span id="meet-incoming-detail">{busy ? "is calling you (you're in a meeting)" : `${video ? "Video" : "Voice"} call`}</span>
      </div>
      <Button className="meet-round is-decline" aria-label="Decline" disabled={!!declining} onClick={() => void decline()}>
        <PhoneOff size={18} />
      </Button>
      <Button
        className="meet-round is-accept"
        aria-label={video ? "Answer with video" : "Answer"}
        disabled={busy || !!declining}
        onClick={() => {
          openPrejoin(call.meeting.id);
          setCall(null);
        }}
      >
        {video ? <Video size={18} /> : <Phone size={18} />}
      </Button>
      {!busy && <div className="meet-incoming-sound">
        <span>{tone.state === "blocked" ? "Sound needs your permission" : tone.state === "unavailable" ? "Sound unavailable in this browser" : call.silent ? "Ringing silenced" : "Incoming call"}</span>
        {tone.state === "blocked" ? <Button variant="ghost" size="small" onClick={tone.enable}><Volume2 size={14}/>Enable sound</Button> : !call.silent && <Button variant="ghost" size="small" onClick={() => setCall(c => c ? { ...c, silent: true } : c)}><VolumeX size={14}/>Silence</Button>}
      </div>}
      {error && <p className="meet-incoming-error" role="alert">{error}</p>}
    </div>
  );
}
