"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, X, Users, Phone } from "lucide-react";
import { Button, Field, Select } from "../ui/controls";
import { CollabRequestError } from "@/lib/collab-client";
import { closeMeeting, enterRoom, getMeeting, requestJoin, type JoinChoices } from "@/lib/meeting-client";
import type { MeetingView } from "@/lib/meetings";
import { businessStamp } from "@/lib/gst";

/**
 * Pre-join: see yourself, pick devices, decide mic/camera, then Join.
 *
 * Opened only by the person (Join, Call, a notification); it never connects
 * on its own. The preview uses the devices only while this screen is open
 * and releases them before the meeting takes over.
 */

type DeviceError = "denied" | "missing" | "busy" | "other" | null;

function explain(error: unknown): DeviceError {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "other";
}

const MESSAGES: Record<Exclude<DeviceError, null>, string> = {
  denied: "Access is blocked. Allow the camera and microphone for this site in your browser's settings, or join without them.",
  missing: "No device was found. Connect one, or join without it.",
  busy: "The device is in use by another app. Close it there, or join without it.",
  other: "The device couldn't start. You can still join without it.",
};

export default function Prejoin({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingView | null>(null);
  const [available, setAvailable] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(false);
  const [micError, setMicError] = useState<DeviceError>(null);
  const [camError, setCamError] = useState<DeviceError>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [camId, setCamId] = useState<string>("");
  const [level, setLevel] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const videoEl = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);

  // The meeting, and the starting choice: a voice call starts camera-off.
  useEffect(() => {
    let active = true;
    getMeeting(meetingId)
      .then(({ meeting, available }) => {
        if (!active) return;
        setMeeting(meeting);
        setAvailable(available);
        setVideo(meeting.media === "video");
      })
      .catch((e) => active && setLoadError(e instanceof CollabRequestError && e.status === 404 ? "This meeting isn't available to you." : "The meeting couldn't be loaded."));
    return () => {
      active = false;
    };
  }, [meetingId]);

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId));
      setCams(all.filter((d) => d.kind === "videoinput" && d.deviceId));
    } catch {}
  };

  // Camera preview while "camera on" is chosen.
  useEffect(() => {
    if (!meeting || !video) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: camId ? { deviceId: { exact: camId } } : { facingMode: "user" } })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        camStream.current = stream;
        setCamError(null);
        if (videoEl.current) videoEl.current.srcObject = stream;
        void refreshDevices();
      })
      .catch((e) => !cancelled && (setCamError(explain(e)), setVideo(false)));
    return () => {
      cancelled = true;
      camStream.current?.getTracks().forEach((t) => t.stop());
      camStream.current = null;
    };
  }, [meeting, video, camId]);

  // Microphone level while "mic on" is chosen (where the browser supports it).
  useEffect(() => {
    if (!meeting || !audio) return;
    let cancelled = false;
    let frame = 0;
    let context: AudioContext | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        micStream.current = stream;
        setMicError(null);
        void refreshDevices();
        try {
          context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          context.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(data);
            setLevel(Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 90));
            frame = requestAnimationFrame(tick);
          };
          tick();
        } catch {}
      })
      .catch((e) => !cancelled && (setMicError(explain(e)), setAudio(false)));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      void context?.close().catch(() => {});
      micStream.current?.getTracks().forEach((t) => t.stop());
      micStream.current = null;
      setLevel(0);
    };
  }, [meeting, audio, micId]);

  const release = () => {
    for (const s of [camStream.current, micStream.current]) s?.getTracks().forEach((t) => t.stop());
    camStream.current = micStream.current = null;
  };
  useEffect(() => release, []);

  async function join() {
    setJoining(true);
    setJoinError("");
    try {
      const grant = await requestJoin(meetingId);
      const choices: JoinChoices = { audio, video, audioDeviceId: micId || undefined, videoDeviceId: camId || undefined };
      release();
      enterRoom(meetingId, grant, choices);
    } catch (e) {
      setJoining(false);
      const status = e instanceof CollabRequestError ? e.status : 0;
      setJoinError(
        status === 404
          ? "You no longer have access to this meeting."
          : e instanceof Error
            ? e.message
            : "Couldn't join. Check your connection and try again.",
      );
    }
  }

  const title = meeting?.title ?? "Meeting";
  return (
    <div className="meet-prejoin" role="dialog" aria-modal="true" aria-labelledby="meet-prejoin-title">
      <header className="meet-prejoin-head">
        <div>
          <h1 id="meet-prejoin-title">{title}</h1>
          {meeting && (
            <p>
              {meeting.status === "live"
                ? `Started by ${meeting.createdBy.name}`
                : meeting.scheduledAt
                  ? `Scheduled for ${businessStamp(meeting.scheduledAt)}`
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
        <Button className="icon-button" aria-label="Close" onClick={() => (release(), closeMeeting())}>
          <X size={18} />
        </Button>
      </header>

      {loadError ? (
        <p className="meet-notice" role="alert">{loadError}</p>
      ) : (
        <div className="meet-prejoin-body">
          <div className={`meet-preview${video ? "" : " is-off"}`}>
            {video ? (
              <video ref={videoEl} autoPlay playsInline muted aria-label="Your camera preview" />
            ) : (
              <div className="meet-preview-off">
                {meeting?.media === "voice" ? <Phone size={34} aria-hidden="true" /> : <VideoOff size={34} aria-hidden="true" />}
                <span>{meeting?.media === "voice" ? "Voice call — camera off" : "Camera is off"}</span>
              </div>
            )}
            <div className="meet-preview-controls">
              <Button
                className={`meet-round${audio ? "" : " is-off"}`}
                aria-pressed={audio}
                aria-label={audio ? "Turn microphone off" : "Turn microphone on"}
                onClick={() => (setMicError(null), setAudio(!audio))}
              >
                {audio ? <Mic size={20} /> : <MicOff size={20} />}
              </Button>
              <Button
                className={`meet-round${video ? "" : " is-off"}`}
                aria-pressed={video}
                aria-label={video ? "Turn camera off" : "Turn camera on"}
                onClick={() => (setCamError(null), setVideo(!video))}
              >
                {video ? <Video size={20} /> : <VideoOff size={20} />}
              </Button>
            </div>
            {audio && (
              <div className="meet-level" aria-hidden="true">
                <span style={{ transform: `scaleX(${level})` }} />
              </div>
            )}
          </div>

          <div className="meet-prejoin-side">
            <Field hint={mics.length ? undefined : "Turn the microphone on to choose one."}>
              Microphone
              <Select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={!mics.length}>
                {mics.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field hint={cams.length ? undefined : "Turn the camera on to choose one."}>
              Camera
              <Select value={camId} onChange={(e) => setCamId(e.target.value)} disabled={!cams.length}>
                {cams.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            {micError && <p className="meet-notice" role="alert">Microphone: {MESSAGES[micError]}</p>}
            {camError && <p className="meet-notice" role="alert">Camera: {MESSAGES[camError]}</p>}
            {!available && <p className="meet-notice" role="alert">Meetings aren&apos;t set up yet. Ask your administrator.</p>}
            {joinError && <p className="meet-notice" role="alert">{joinError}</p>}
            <Button className="primary meet-join" disabled={!meeting || !available || joining} onClick={() => void join()}>
              {joining ? "Joining…" : meeting?.status === "live" ? "Join now" : "Start meeting"}
            </Button>
            <p className="meet-fineprint">
              {audio ? "Microphone on" : "Microphone off"} · {video ? "camera on" : "camera off"}. You can change both in the meeting.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
