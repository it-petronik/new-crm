"use client";

import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, Video, Users, X } from "lucide-react";
import { Button } from "../ui/controls";
import { CollabRequestError, useCollabEvents } from "@/lib/collab-client";
import { closeMeeting, endMeetingForAll, enterRoom, getMeeting, requestJoin } from "@/lib/meeting-client";
import { isDirectCall, joinable, scopeLabel, type MeetingView } from "@/lib/meetings";
import { businessStamp } from "@/lib/gst";
import { DeviceChoices, DevicePreview, useDeviceSetup } from "./device-setup";
import { Avatar } from "../avatar";
import { mediaMessage } from "@/lib/meeting-media";
import styles from "./direct-call.module.css";

/**
 * Pre-join: see yourself, pick devices, decide mic/camera, then Join.
 *
 * Opened only by the person (Join, Call, a notification); it never connects
 * on its own. The preview uses the devices only while this screen is open
 * and releases them before the meeting takes over.
 */
export default function Prejoin({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingView | null>(null);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [joining, setJoining] = useState(false);
  const [closing, setClosing] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [expired, setExpired] = useState(false);
  const canJoin = !!meeting && joinable(meeting) && !expired;
  const setup = useDeviceSetup({ audio: true, video: meeting?.media === "video" }, canJoin && available);
  useCollabEvents(true, (event) => {
    if ((event.type === "meeting.ended" || event.type === "meeting.updated" || event.type === "meeting.started") && event.meeting.id === meetingId) {
      setMeeting(event.meeting);
      const terminal = ["ended", "cancelled", "missed"].includes(event.meeting.status);
      setExpired(terminal);
      if (!joinable(event.meeting)) setup.release();
    }
  });

  useEffect(() => {
    let active = true;
    getMeeting(meetingId)
      .then(({ meeting, available }) => {
        if (!active) return;
        setMeeting(meeting);
        setAvailable(available);
      })
      .catch((e) => active && setLoadError(e instanceof CollabRequestError && e.status === 404 ? "This meeting isn't available to you." : "The meeting couldn't be loaded."));
    return () => {
      active = false;
    };
  }, [meetingId]);

  async function cancel() {
    if (joining || closing) return;
    setup.release();
    // Broadcast views do not carry viewer-specific management flags. Either
    // side of an instant direct call can cancel; the endpoint rechecks access.
    if (meeting && canJoin && isDirectCall(meeting)) {
      setClosing(true); setJoinError("");
      try { await endMeetingForAll(meetingId); }
      catch { setJoinError("Couldn't cancel the call. Try again to stop the invitation for the other person."); setClosing(false); return; }
    }
    closeMeeting();
  }

  // Cancelling a direct call also stops the other person's invitation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function join() {
    if (!canJoin || !available || joining || closing) return;
    setJoining(true);
    setJoinError("");
    try {
      const grant = await requestJoin(meetingId);
      // The live preview tracks move into the meeting as they are.
      const choices = { audio: setup.audio, video: setup.video, audioDeviceId: setup.micId || undefined, videoDeviceId: setup.camId || undefined, media: setup.handOff() };
      enterRoom(meetingId, grant, choices);
    } catch (e) {
      setJoining(false);
      const status = e instanceof CollabRequestError ? e.status : 0;
      if (status === 410) { setExpired(true); setup.release(); }
      setJoinError(status === 404 ? "You no longer have access to this meeting." : e instanceof Error ? e.message : "Couldn't join. Check your connection and try again.");
    }
  }

  if (!meeting) return <div className={styles.prejoin} role="dialog" aria-modal="true" aria-labelledby="meet-prejoin-title"><div className={styles.prejoinCard}><h1 id="meet-prejoin-title">{loadError ? "Call unavailable" : "Getting ready…"}</h1><p role={loadError ? "alert" : "status"}>{loadError || "Loading call details"}</p><Button variant="secondary" onClick={() => closeMeeting()}>Back to workspace</Button></div></div>;

  if (meeting && !canJoin) return (
    <div className={styles.prejoin} role="dialog" aria-modal="true" aria-labelledby="meet-prejoin-title">
      <div className={styles.prejoinCard}>
        <Avatar name={meeting.conversationTitle || meeting.title} size={72}/>
        <h1 id="meet-prejoin-title">{meeting.status === "scheduled" && !expired && new Date(meeting.scheduledAt || 0).getTime() > Date.now() ? "This meeting hasn’t started yet" : "This call or meeting has ended"}</h1>
        <p>{meeting.title}</p>
        <p>{meeting.status === "scheduled" && !expired && new Date(meeting.scheduledAt || 0).getTime() > Date.now() ? "You can join from 15 minutes before its scheduled start." : "This invitation has expired. Start a new call from the conversation to reconnect."}</p>
        <Button className="primary" onClick={() => (setup.release(), closeMeeting())}>Back to workspace</Button>
      </div>
    </div>
  );

  if (meeting && isDirectCall(meeting)) return (
    <div className={styles.prejoin} role="dialog" aria-modal="true" aria-labelledby="meet-prejoin-title" data-call-layout="prejoin">
      <div className={styles.prejoinCard}>
        <Avatar name={meeting.conversationTitle || meeting.title} size={80}/>
        <div><p>{meeting.media === "voice" ? "Voice call" : "Video call"}</p><h1 id="meet-prejoin-title">{meeting.conversationTitle || meeting.title}</h1></div>
        {meeting.media === "video" && <DevicePreview setup={setup} voice={false} />}
        {meeting.media === "voice" && <Button className="secondary" aria-pressed={setup.audio} aria-label={setup.audio ? "Turn microphone off" : "Turn microphone on"} onClick={() => setup.setAudio(!setup.audio)}>{setup.audio ? <Mic size={18}/> : <MicOff size={18}/>} {setup.audio ? "Microphone on" : "Microphone off"}</Button>}
        <p>Check your devices, then connect. {setup.audio ? "Microphone on" : "Microphone off"} · {setup.video ? "Camera on" : "Camera off"}.</p>
        {setup.micError && <p role="alert">{mediaMessage("microphone", setup.micError)}</p>}
        <details><summary>Microphone & camera settings</summary><DeviceChoices setup={setup} voice={meeting.media === "voice"} /></details>
        {!available && <p role="alert">Calls aren’t set up here yet. Ask your administrator.</p>}
        {joinError && <p role="alert">{joinError}</p>}
        <div className={styles.prejoinActions}>
          <Button className="secondary" disabled={joining || closing} onClick={() => void cancel()}>{closing ? "Cancelling…" : "Cancel"}</Button>
          <Button className="primary" disabled={!available || joining || closing} onClick={() => void join()}>{meeting.media === "voice" ? <Phone size={17}/> : <Video size={17}/>} {joining ? "Connecting…" : "Connect call"}</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="meet-prejoin" role="dialog" aria-modal="true" aria-labelledby="meet-prejoin-title">
      <header className="meet-prejoin-head">
        <div>
          <h1 id="meet-prejoin-title">{meeting?.title ?? "Meeting"}</h1>
          {meeting && (
            <p>
              {scopeLabel(meeting)}
              {meeting.conversationTitle ? ` · ${meeting.conversationTitle}` : ""}
              {" · "}
              {meeting.status === "live"
                ? `Started by ${meeting.createdBy.name}`
                : meeting.scheduledAt
                  ? `${businessStamp(meeting.scheduledAt)}`
                  : `Organised by ${meeting.createdBy.name}`}
              {meeting.participants.length > 0 && (
                <>
                  {" · "}
                  <Users size={13} aria-hidden="true" /> {meeting.participants.length} joined
                </>
              )}
            </p>
          )}
        </div>
        <Button className="icon-button" aria-label="Close" onClick={() => (setup.release(), closeMeeting())}>
          <X size={18} />
        </Button>
      </header>

      {loadError ? (
        <p className="meet-notice" role="alert">{loadError}</p>
      ) : (
        <div className="meet-prejoin-body">
          <DevicePreview setup={setup} voice={meeting?.media === "voice"} />
          <div className="meet-prejoin-side">
            <DeviceChoices setup={setup} voice={meeting?.media === "voice"} />
            {!available && <p className="meet-notice" role="alert">Meetings aren&apos;t set up yet. Ask your administrator.</p>}
            {joinError && <p className="meet-notice" role="alert">{joinError}</p>}
            <Button className="primary meet-join" disabled={!canJoin || !available || joining} onClick={() => void join()}>
              {joining ? "Joining…" : meeting?.status === "live" ? "Join now" : "Start meeting"}
            </Button>
            <p className="meet-fineprint">
              {setup.audio ? "Microphone on" : "Microphone off"} · {setup.video ? "camera on" : "camera off"}. You can change both in the meeting.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
