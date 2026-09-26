"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalAudioTrack, createLocalVideoTrack, type LocalAudioTrack, type LocalVideoTrack } from "livekit-client";
import { ChevronDown, Loader2, Mic, MicOff, Phone, Video, VideoOff } from "lucide-react";
import { Button } from "../ui/controls";
import {
  QUALITY_LABELS,
  QUALITY_PRESETS,
  classifyMediaError,
  fallbackDevice,
  loadPrefs,
  mediaMessage,
  noteMedia,
  savePrefs,
  type MediaHandoff,
  type MediaProblem,
  type QualityMode,
} from "@/lib/meeting-media";

/**
 * Camera and microphone before joining — shared by the employee pre-join
 * screen and the guest page, so both get exactly the same media.
 *
 * The preview uses real LiveKit tracks. On Join those SAME tracks are handed
 * to the meeting and published directly — the clean camera and microphone,
 * nothing in between. The devices are never released and re-opened, so
 * there is no race for the camera and no black gap.
 *
 * Only friendly device names are shown; ids are values, never text.
 */

type Kind = "audioinput" | "videoinput";
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
  blocked,
  label,
}: {
  kind: Kind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  blocked?: boolean;
  label?: string;
}) {
  const options = deviceOptions(devices, kind);
  const Icon = kind === "audioinput" ? (blocked ? MicOff : Mic) : blocked ? VideoOff : Video;
  const noun = NOUN[kind];
  const Noun = `${noun[0].toUpperCase()}${noun.slice(1)}`;
  const selected = options.find((o) => o.id === value) ?? options.find((o) => o.id === "default") ?? options[0];
  const state = blocked ? `${Noun} blocked` : !options.length ? `Default ${noun}` : null;
  return (
    <label className={`device-select${disabled || state ? " is-disabled" : ""}${blocked ? " has-error" : ""}`}>
      <span className="device-select-label">{label ?? Noun}</span>
      <span className="device-select-control">
        <Icon size={16} aria-hidden="true" />
        {state ? (
          <span className="device-select-static">{state}</span>
        ) : (
          <select value={selected?.id ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label ?? Noun}>
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
 * Preview and choice before joining. Opens the camera and microphone only
 * while switched on; re-reads devices when one is plugged in or removed and
 * falls back to the default if the chosen one disappears. `handOff()` gives
 * the live tracks to the meeting; `release()` (closing) stops them.
 */
export function useDeviceSetup(initial: { audio: boolean; video: boolean }, enabled = true, options: { guest?: boolean } = {}) {
  const guest = !!options.guest;
  const [audio, setAudio] = useState(initial.audio);
  const [video, setVideo] = useState(initial.video);
  const [micId, setMicId] = useState("");
  const [camId, setCamId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState<MediaProblem | null>(null);
  const [camError, setCamError] = useState<MediaProblem | null>(null);
  const [notice, setNotice] = useState("");
  const [level, setLevel] = useState(0);
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack>();
  const [audioTrack, setAudioTrack] = useState<LocalAudioTrack>();
  const [starting, setStarting] = useState(false);
  const [prefs, setPrefs] = useState(() => loadPrefs(guest));
  const videoEl = useRef<HTMLVideoElement>(null);
  const handedOff = useRef(false);

  useEffect(() => {
    setAudio(initial.audio);
    setVideo(initial.video);
  }, [initial.audio, initial.video]);

  const setQuality = (quality: QualityMode) => setPrefs((p) => (savePrefs(guest, { ...p, quality }), { ...p, quality }));

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
        if (fallbackDevice(list.filter((d) => d.kind === "audioinput"), id)) {
          noteMedia("device_fallback", "microphone");
          setNotice("Your selected microphone was disconnected. Switched to the default microphone.");
          return "";
        }
        return id;
      });
      setCamId((id) => {
        if (fallbackDevice(list.filter((d) => d.kind === "videoinput"), id)) {
          noteMedia("device_fallback", "camera");
          setNotice("Your selected camera was disconnected. Switched to the default camera.");
          return "";
        }
        return id;
      });
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [enabled]);

  // The camera: a LiveKit track at the chosen quality.
  useEffect(() => {
    if (!enabled || !video) return;
    let cancelled = false;
    let track: LocalVideoTrack | undefined;
    setStarting(true);
    const capture = QUALITY_PRESETS[prefs.quality].capture;
    createLocalVideoTrack({
      ...(camId && camId !== "default" ? { deviceId: { exact: camId } } : { facingMode: "user" }),
      resolution: { width: capture.width, height: capture.height, frameRate: capture.frameRate },
    })
      .then((t) => {
        if (cancelled) return t.stop();
        track = t;
        setCamError(null);
        setVideoTrack(t);
        void refresh();
      })
      .catch((e) => {
        if (cancelled) return;
        noteMedia("camera_start_failed", (e as { name?: string })?.name);
        setCamError(classifyMediaError(e));
        setVideo(false);
      })
      .finally(() => !cancelled && setStarting(false));
    return () => {
      cancelled = true;
      setVideoTrack(undefined);
      if (track && !handedOff.current) track.stop();
    };
  }, [enabled, video, camId, prefs.quality]);

  // Show the (processed) camera in the preview.
  useEffect(() => {
    const el = videoEl.current;
    if (!videoTrack || !el) return;
    videoTrack.attach(el);
    el.muted = true;
    void el.play().catch(() => {});
    return () => void videoTrack.detach(el);
  }, [videoTrack]);

  // The microphone, with a level meter so people can see it works.
  useEffect(() => {
    if (!enabled || !audio) return;
    let cancelled = false;
    let track: LocalAudioTrack | undefined;
    let frame = 0;
    let context: AudioContext | null = null;
    createLocalAudioTrack({ ...(micId && micId !== "default" ? { deviceId: { exact: micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      .then((t) => {
        if (cancelled) return t.stop();
        track = t;
        setMicError(null);
        setAudioTrack(t);
        void refresh();
        try {
          context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          context.createMediaStreamSource(new MediaStream([t.mediaStreamTrack])).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(data);
            setLevel(Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 90));
            frame = requestAnimationFrame(tick);
          };
          tick();
        } catch {}
      })
      .catch((e) => {
        if (cancelled) return;
        noteMedia("microphone_start_failed", (e as { name?: string })?.name);
        setMicError(classifyMediaError(e));
        setAudio(false);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      void context?.close().catch(() => {});
      setAudioTrack(undefined);
      setLevel(0);
      if (track && !handedOff.current) track.stop();
    };
  }, [enabled, audio, micId]);

  /** Stops everything (closing without joining). */
  const release = useCallback(() => {
    if (handedOff.current) return;
    videoTrack?.stop();
    audioTrack?.stop();
  }, [videoTrack, audioTrack]);
  const releaseRef = useRef(release);
  releaseRef.current = release;
  useEffect(() => () => releaseRef.current(), []);

  /** Gives the live tracks to the meeting; this screen no longer owns them. */
  const handOff = (): MediaHandoff => {
    handedOff.current = true;
    if (videoEl.current && videoTrack) videoTrack.detach(videoEl.current);
    return { video: video ? videoTrack : undefined, audio: audio ? audioTrack : undefined, quality: prefs.quality };
  };

  return {
    audio, video, micId, camId, devices, micError, camError, notice, level, videoEl, videoTrack, audioTrack, starting,
    quality: prefs.quality,
    setAudio: (on: boolean) => (setMicError(null), setAudio(on)),
    setVideo: (on: boolean) => (setCamError(null), setVideo(on)),
    setMicId, setCamId, setNotice, setQuality, release, handOff,
  };
}

export type DeviceSetup = ReturnType<typeof useDeviceSetup>;

/** The preview tile with its mic/camera switches and level meter. */
export function DevicePreview({ setup, voice }: { setup: DeviceSetup; voice: boolean }) {
  const showVideo = setup.video && !!setup.videoTrack;
  return (
    <div className={`meet-preview${showVideo ? "" : " is-off"}`}>
      <video ref={setup.videoEl} autoPlay playsInline muted aria-label="Your camera preview" hidden={!showVideo} />
      {!showVideo && (
        <div className="meet-preview-off">
          {setup.video && setup.starting ? (
            <>
              <Loader2 size={30} className="meet-spin" aria-hidden="true" />
              <span>Starting camera…</span>
            </>
          ) : voice ? (
            <>
              <Phone size={34} aria-hidden="true" />
              <span>Voice call — camera off</span>
            </>
          ) : (
            <>
              <VideoOff size={34} aria-hidden="true" />
              <span>{setup.camError ? "Camera unavailable" : "Camera is off"}</span>
            </>
          )}
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
          disabled={setup.starting}
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

/** The device pickers, video quality, and any device messages. */
export function DeviceChoices({ setup, voice = false }: { setup: DeviceSetup; voice?: boolean }) {
  const hasMics = setup.devices.some((d) => d.kind === "audioinput" && d.label);
  const hasCams = setup.devices.some((d) => d.kind === "videoinput" && d.label);
  return (
    <>
      <DeviceSelect kind="audioinput" devices={hasMics ? setup.devices : []} value={setup.micId} onChange={setup.setMicId} blocked={setup.micError === "blocked"} />
      <DeviceSelect kind="videoinput" devices={hasCams ? setup.devices : []} value={setup.camId} onChange={setup.setCamId} blocked={setup.camError === "blocked"} />
      {!voice && (
        <label className="device-select">
          <span className="device-select-label">Video quality</span>
          <span className="device-select-control">
            <Video size={16} aria-hidden="true" />
            <select value={setup.quality} onChange={(e) => setup.setQuality(e.target.value as QualityMode)} aria-label="Video quality">
              {(Object.keys(QUALITY_LABELS) as QualityMode[]).map((q) => (
                <option key={q} value={q}>
                  {QUALITY_LABELS[q].label}
                  {q === "auto" ? " (recommended)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" className="device-select-chevron" />
          </span>
        </label>
      )}
      {setup.micError && <p className="meet-notice" role="alert">{mediaMessage("microphone", setup.micError)}</p>}
      {setup.camError && <p className="meet-notice" role="alert">{mediaMessage("camera", setup.camError)}</p>}
      {setup.notice && <p className="meet-notice is-info" role="status">{setup.notice}</p>}
    </>
  );
}
