"use client";

import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import { Button } from "../ui/controls";
import { CollabRequestError } from "@/lib/collab-client";
import { closeMeeting, enterRoom, getMeeting, requestJoin } from "@/lib/meeting-client";
import { scopeLabel, type MeetingView } from "@/lib/meetings";
import { businessStamp } from "@/lib/gst";
import { DeviceChoices, DevicePreview, useDeviceSetup } from "./device-setup";

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
  const [joinError, setJoinError] = useState("");
  const setup = useDeviceSetup({ audio: true, video: meeting?.media === "video" }, !!meeting);

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

  // Escape closes the pre-join screen (nothing has connected yet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !joining && (setup.release(), closeMeeting());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [joining, setup]);

  async function join() {
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
      setJoinError(status === 404 ? "You no longer have access to this meeting." : e instanceof Error ? e.message : "Couldn't join. Check your connection and try again.");
    }
  }

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
            <Button className="primary meet-join" disabled={!meeting || !available || joining} onClick={() => void join()}>
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
