"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, Phone, Video, VideoOff } from "lucide-react";
import { Button } from "../ui/controls";

/**
 * Camera and microphone choice, shared by the employee pre-join screen, the
 * guest page and the in-meeting device menu.
 *
 * Only friendly names are ever shown: the browser's labels cleaned of
 * "Default - " prefixes and USB id suffixes, or "Default microphone" /
 * "Default camera" before permission reveals real names. Device ids are
 * values, never text.
 */

type Kind = "audioinput" | "videoinput";
export type DeviceError = "denied" | "missing" | "busy" | "other" | null;

const NOUN: Record<Kind, string> = { audioinput: "microphone", videoinput: "camera" };

export function cleanLabel(label: string) {
  return label
    .replace(/^(Default|Communications)\s*-\s*/i, "")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The options to show: friendly, deduplicated, "System default" first. */
export function deviceOptions(devices: MediaDeviceInfo[], kind: Kind) {
  const real = devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "communications");
  let n = 0;
  return real.map((d) => {
    const clean = cleanLabel(d.label);
    if (d.deviceId === "default") return { id: d.deviceId, label: clean ? `System default (${clean})` : `Default ${NOUN[kind]}` };
    n += 1;
    return { id: d.deviceId, label: clean || (n === 1 ? `Default ${NOUN[kind]}` : `${NOUN[kind][0].toUpperCase()}${NOUN[kind].slice(1)} ${n}`) };
  });
}

export function explainDeviceError(error: unknown): DeviceError {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDenied") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotFound") return "missing";
  if (name === "NotReadableError" || name === "AbortError" || name === "DeviceInUse") return "busy";
  return "other";
}

export const DEVICE_MESSAGES: Record<Exclude<DeviceError, null>, string> = {
  denied: "Access is blocked. Allow it for this site in your browser's settings, or continue without it.",
  missing: "No device was found. Connect one, or continue without it.",
  busy: "The device is in use by another app. Close it there, or continue without it.",
  other: "The device couldn't start. You can continue without it.",
};

/**
 * One device picker. A native select underneath (keyboard, screen readers
 * and phones handle it best), styled with an icon, a chevron and an
 * ellipsis for long names. When there is nothing to choose it says why.
 */
export function DeviceSelect({
  kind,
  devices,
  value,
  onChange,
  disabled,
  error,
  label,
}: {
  kind: Kind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  error?: DeviceError;
  label?: string;
}) {
  const options = deviceOptions(devices, kind);
  const Icon = kind === "audioinput" ? (error ? MicOff : Mic) : error ? VideoOff : Video;
  const noun = NOUN[kind];
  const selected = options.find((o) => o.id === value) ?? options.find((o) => o.id === "default") ?? options[0];
  const state = error === "denied" ? `${noun[0].toUpperCase()}${noun.slice(1)} blocked` : !options.length ? `Default ${noun}` : null;
  return (
    <label className={`device-select${disabled || state ? " is-disabled" : ""}${error ? " has-error" : ""}`}>
      <span className="device-select-label">{label ?? `${noun[0].toUpperCase()}${noun.slice(1)}`}</span>
      <span className="device-select-control">
        <Icon size={16} aria-hidden="true" />
        {state ? (
          <span className="device-select-static">{state}</span>
        ) : (
          <select
            value={selected?.id ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label ?? `${noun[0].toUpperCase()}${noun.slice(1)}`}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {!state && <ChevronDown size={15} aria-hidden="true" className="device-select-chevron" />}
      </span>
    </label>
  );
}

/**
 * Preview and choice before joining. Starts the camera and microphone only
 * while the person has them switched on, re-reads devices when one is
 * plugged in or removed, falls back to the default if the chosen one
 * disappears, and releases everything on `release()` or unmount.
 */
export function useDeviceSetup(initial: { audio: boolean; video: boolean }, enabled = true) {
  const [audio, setAudio] = useState(initial.audio);
  const [video, setVideo] = useState(initial.video);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState<DeviceError>(null);
  const [camError, setCamError] = useState<DeviceError>(null);
  const [notice, setNotice] = useState("");
  const [level, setLevel] = useState(0);
  const videoEl = useRef<HTMLVideoElement>(null);
  const cam = useRef<MediaStream | null>(null);
  const mic = useRef<MediaStream | null>(null);

  useEffect(() => {
    setAudio(initial.audio);
    setVideo(initial.video);
  }, [initial.audio, initial.video]);

  const refresh = async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {}
  };

  // Plugging in or removing a device.
  useEffect(() => {
    if (!enabled || !navigator.mediaDevices) return;
    void refresh();
    const onChange = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      setDevices(list);
      setMicId((id) => {
        if (id && !list.some((d) => d.deviceId === id)) {
          setNotice("Your microphone was disconnected — using the default one.");
          return "";
        }
        return id;
      });
      setCamId((id) => {
        if (id && !list.some((d) => d.deviceId === id)) {
          setNotice("Your camera was disconnected — using the default one.");
          return "";
        }
        return id;
      });
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !video) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: camId && camId !== "default" ? { deviceId: { exact: camId } } : { facingMode: "user" } })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        cam.current = stream;
        setCamError(null);
        if (videoEl.current) videoEl.current.srcObject = stream;
        void refresh();
      })
      .catch((e) => !cancelled && (setCamError(explainDeviceError(e)), setVideo(false)));
    return () => {
      cancelled = true;
      cam.current?.getTracks().forEach((t) => t.stop());
      cam.current = null;
    };
  }, [enabled, video, camId]);

  useEffect(() => {
    if (!enabled || !audio) return;
    let cancelled = false;
    let frame = 0;
    let context: AudioContext | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ audio: micId && micId !== "default" ? { deviceId: { exact: micId } } : true })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        mic.current = stream;
        setMicError(null);
        void refresh();
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
      .catch((e) => !cancelled && (setMicError(explainDeviceError(e)), setAudio(false)));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      void context?.close().catch(() => {});
      mic.current?.getTracks().forEach((t) => t.stop());
      mic.current = null;
      setLevel(0);
    };
  }, [enabled, audio, micId]);

  const release = () => {
    for (const s of [cam.current, mic.current]) s?.getTracks().forEach((t) => t.stop());
    cam.current = mic.current = null;
  };
  useEffect(() => release, []);

  return {
    audio, video, micId, camId, devices, micError, camError, notice, level, videoEl,
    setAudio: (on: boolean) => (setMicError(null), setAudio(on)),
    setVideo: (on: boolean) => (setCamError(null), setVideo(on)),
    setMicId, setCamId, setNotice, release,
  };
}

export type DeviceSetup = ReturnType<typeof useDeviceSetup>;

/** The preview tile with its mic/camera switches and level meter. */
export function DevicePreview({ setup, voice }: { setup: DeviceSetup; voice: boolean }) {
  return (
    <div className={`meet-preview${setup.video ? "" : " is-off"}`}>
      {setup.video ? (
        <video ref={setup.videoEl} autoPlay playsInline muted aria-label="Your camera preview" />
      ) : (
        <div className="meet-preview-off">
          {voice ? <Phone size={34} aria-hidden="true" /> : <VideoOff size={34} aria-hidden="true" />}
          <span>{voice ? "Voice call — camera off" : "Camera is off"}</span>
        </div>
      )}
      <div className="meet-preview-controls">
        <Button
          className={`meet-round${setup.audio ? "" : " is-off"}`}
          aria-pressed={setup.audio}
          aria-label={setup.audio ? "Turn microphone off" : "Turn microphone on"}
          onClick={() => setup.setAudio(!setup.audio)}
        >
          {setup.audio ? <Mic size={20} /> : <MicOff size={20} />}
        </Button>
        <Button
          className={`meet-round${setup.video ? "" : " is-off"}`}
          aria-pressed={setup.video}
          aria-label={setup.video ? "Turn camera off" : "Turn camera on"}
          onClick={() => setup.setVideo(!setup.video)}
        >
          {setup.video ? <Video size={20} /> : <VideoOff size={20} />}
        </Button>
      </div>
      {setup.audio && (
        <div className="meet-level" aria-hidden="true">
          <span style={{ transform: `scaleX(${setup.level})` }} />
        </div>
      )}
    </div>
  );
}

/** The two pickers and any device messages. */
export function DeviceChoices({ setup }: { setup: DeviceSetup }) {
  const hasMics = setup.devices.some((d) => d.kind === "audioinput" && d.label);
  const hasCams = setup.devices.some((d) => d.kind === "videoinput" && d.label);
  return (
    <>
      <DeviceSelect kind="audioinput" devices={hasMics ? setup.devices : []} value={setup.micId} onChange={setup.setMicId} error={setup.micError} />
      <DeviceSelect kind="videoinput" devices={hasCams ? setup.devices : []} value={setup.camId} onChange={setup.setCamId} error={setup.camError} />
      {setup.micError && <p className="meet-notice" role="alert">Microphone: {DEVICE_MESSAGES[setup.micError]}</p>}
      {setup.camError && <p className="meet-notice" role="alert">Camera: {DEVICE_MESSAGES[setup.camError]}</p>}
      {setup.notice && <p className="meet-notice is-info" role="status">{setup.notice}</p>}
    </>
  );
}
