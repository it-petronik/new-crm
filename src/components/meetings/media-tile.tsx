"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { useIsSpeaking } from "@livekit/components-react";
import {
  ConnectionQuality,
  ParticipantEvent,
  Track,
  type Participant,
  type RemoteTrackPublication,
  type TrackPublication,
  type VideoTrack,
} from "livekit-client";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Crown, Loader2, MicOff, SignalLow, VideoOff, WifiOff } from "lucide-react";
import { Avatar } from "../avatar";
import { noteMedia } from "@/lib/meeting-media";

/**
 * A participant's tile, with every state spelled out — never a featureless
 * black rectangle:
 *
 *   video        the camera, playing (frames are checked, not assumed)
 *   off          camera off — avatar, name, camera-off icon
 *   starting     your camera is starting
 *   connecting   their video is on its way (subscribing)
 *   paused       paused by the network to protect the call
 *   recovering   frames stopped — recovering automatically
 *   unavailable  couldn't recover (or your camera stopped)
 *   reconnecting the participant's connection is recovering
 *
 * State comes from LiveKit (publications, subscriptions, stream state,
 * connection quality) and from the video element's actual frames.
 */

const META_EVENTS = [
  ParticipantEvent.TrackMuted,
  ParticipantEvent.TrackUnmuted,
  ParticipantEvent.TrackPublished,
  ParticipantEvent.TrackUnpublished,
  ParticipantEvent.TrackSubscribed,
  ParticipantEvent.TrackUnsubscribed,
  ParticipantEvent.TrackStreamStateChanged,
  ParticipantEvent.TrackSubscriptionStatusChanged,
  ParticipantEvent.ConnectionQualityChanged,
  ParticipantEvent.LocalTrackPublished,
  ParticipantEvent.LocalTrackUnpublished,
  ParticipantEvent.ParticipantMetadataChanged,
] as const;

/** Re-renders when anything about this participant's media changes. */
export function useParticipantTick(p: Participant) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const on = p.on.bind(p) as unknown as (e: string, f: () => void) => void;
    const off = p.off.bind(p) as unknown as (e: string, f: () => void) => void;
    const handler = () => bump();
    for (const e of META_EVENTS) on(e, handler);
    return () => {
      for (const e of META_EVENTS) off(e, handler);
    };
  }, [p]);
}

export const metaOf = (p: Participant) => {
  try {
    return JSON.parse(p.metadata || "{}") as { host?: boolean; guest?: boolean };
  } catch {
    return {};
  }
};

export type TileState = "video" | "off" | "starting" | "connecting" | "paused" | "recovering" | "unavailable" | "reconnecting";

/** What a camera or screen tile should show, from LiveKit's own state. */
export function tileState(p: Participant, pub: TrackPublication | undefined, opts: { starting?: boolean; screen?: boolean }): TileState {
  if (!p.isLocal && p.connectionQuality === ConnectionQuality.Lost) return "reconnecting";
  if (p.isLocal && opts.starting) return "starting";
  if (!pub || pub.isMuted) return opts.screen ? "connecting" : "off";
  if (p.isLocal) {
    const track = pub.track;
    if (!track) return "starting";
    return track.mediaStreamTrack?.readyState === "ended" ? "unavailable" : "video";
  }
  const remote = pub as RemoteTrackPublication;
  if (!remote.isSubscribed || !remote.track) return "connecting";
  if (remote.track.streamState === Track.StreamState.Paused) return "paused";
  return "video";
}

const LABELS: Partial<Record<TileState, string>> = {
  starting: "Starting camera…",
  connecting: "Connecting video…",
  paused: "Video paused — weak connection",
  recovering: "Reconnecting video…",
  unavailable: "Video unavailable",
  reconnecting: "Reconnecting…",
};

/**
 * A video element that is attached, played and watched. It re-attaches when
 * the track changes, retries play() (reporting when the browser insists on
 * a tap first), and reports whether frames are actually arriving.
 */
export function ReliableVideo({
  track,
  mirrored = false,
  contain = false,
  watch = true,
  onHealth,
  onBlocked,
}: {
  track: VideoTrack;
  mirrored?: boolean;
  contain?: boolean;
  watch?: boolean;
  onHealth?: (flowing: boolean) => void;
  onBlocked?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const health = useRef({ onHealth, onBlocked });
  health.current = { onHealth, onBlocked };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true; // audio plays through the room's audio renderer
    el.playsInline = true;
    el.autoplay = true;
    track.attach(el);
    const play = () =>
      el.play().catch((e: { name?: string }) => {
        if (e?.name === "NotAllowedError") health.current.onBlocked?.();
      });
    void play();
    let last = performance.now();
    let handle = 0;
    const video = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
    const onFrame = () => {
      last = performance.now();
      if (video.requestVideoFrameCallback) handle = video.requestVideoFrameCallback(onFrame);
    };
    if (video.requestVideoFrameCallback) handle = video.requestVideoFrameCallback(onFrame);
    else el.addEventListener("timeupdate", onFrame);
    el.addEventListener("loadeddata", onFrame);
    // A hidden page presents no frames: that isn't a stall.
    const onVisible = () => {
      last = performance.now();
      if (el.paused) void play();
    };
    document.addEventListener("visibilitychange", onVisible);
    let flowing: boolean | null = null;
    const mountedAt = performance.now();
    const timer = watch
      ? setInterval(() => {
          if (document.hidden) return;
          const now = el.videoWidth > 0 && performance.now() - last < 4000;
          // Starting up takes a moment: only a stall after that counts.
          if (!now && flowing === null && performance.now() - mountedAt < 4000) return;
          if (now !== flowing) {
            flowing = now;
            health.current.onHealth?.(now);
          }
          if (el.paused && !el.ended) void play();
        }, 1000)
      : undefined;
    return () => {
      if (timer) clearInterval(timer);
      if (video.cancelVideoFrameCallback && handle) video.cancelVideoFrameCallback(handle);
      el.removeEventListener("timeupdate", onFrame);
      el.removeEventListener("loadeddata", onFrame);
      document.removeEventListener("visibilitychange", onVisible);
      track.detach(el);
    };
    // A restarted device (new underlying track) re-attaches and re-checks.
  }, [track, watch, track.mediaStreamTrack?.id]);
  return <video ref={ref} className={`${mirrored ? "is-mirrored" : ""}${contain ? " is-contain" : ""}`} playsInline muted autoPlay />;
}

/**
 * Stall handling for one tile: after 4 s without frames, try once to
 * recover someone else's video (resubscribe); if frames still don't come
 * within 10 s more, say the video is unavailable. Frames returning clears
 * everything. Your own camera is never restarted from here — a device that
 * really fails is handled by LiveKit's "ended" path — so a slow moment (an
 * effect loading) can't knock it over.
 */
function useVideoRecovery(pub: TrackPublication | undefined, local: boolean, enabled: boolean) {
  const [phase, setPhase] = useState<"ok" | "recovering" | "unavailable">("ok");
  const attempt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tried = useRef(false);
  useEffect(() => {
    setPhase("ok");
    tried.current = false;
    return () => {
      if (attempt.current) clearTimeout(attempt.current);
    };
  }, [pub?.trackSid, enabled]);
  const onHealth = (flowing: boolean) => {
    if (!enabled) return;
    if (flowing) {
      if (attempt.current) clearTimeout(attempt.current);
      attempt.current = null;
      setPhase((was) => {
        if (was !== "ok") noteMedia("video_recovered");
        return "ok";
      });
      tried.current = false;
      return;
    }
    if (tried.current) return;
    tried.current = true;
    noteMedia("video_stalled", local ? "local" : "remote");
    setPhase("recovering");
    try {
      if (!local) {
        const remote = pub as RemoteTrackPublication | undefined;
        remote?.setSubscribed(false);
        setTimeout(() => remote?.setSubscribed(true), 400);
      }
    } catch {}
    attempt.current = setTimeout(() => {
      noteMedia("video_unavailable");
      setPhase("unavailable");
    }, 10_000);
  };
  return { phase, onHealth };
}

export function MediaTile({
  trackRef,
  meId,
  featured = false,
  starting = false,
  applying = false,
  onBlocked,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  meId: string;
  featured?: boolean;
  /** Your camera is being switched on. */
  starting?: boolean;
  /** Your background effect is being applied. */
  applying?: boolean;
  onBlocked?: () => void;
}) {
  const p = trackRef.participant;
  useParticipantTick(p);
  const speaking = useIsSpeaking(p);
  const screen = trackRef.source === Track.Source.ScreenShare;
  const pub = trackRef.publication ?? p.getTrackPublication(trackRef.source);
  const base = tileState(p, pub, { starting, screen });
  const video = base === "video" || base === "paused" ? (pub?.track as VideoTrack | undefined) : undefined;
  // Screens can legitimately go still (a static slide): no stall watch there.
  // …nor while your background effect is being applied (frames pause briefly).
  const recovery = useVideoRecovery(pub, p.isLocal, base === "video" && !screen && !(p.isLocal && applying));
  // "video" only once real frames have arrived for this track; until then the
  // video is attached underneath a "starting"/"connecting" state.
  const [framesFor, setFramesFor] = useState<string | null>(null);
  const trackKey = video ? `${pub?.trackSid}:${video.mediaStreamTrack?.id}` : null;
  const firstFrames = !!trackKey && framesFor === trackKey;
  // The element goes when the camera goes off: a new one must see frames again.
  useEffect(() => {
    if (!trackKey) setFramesFor(null);
  }, [trackKey]);
  const onHealth = (flowing: boolean) => {
    if (flowing && trackKey) setFramesFor(trackKey);
    recovery.onHealth(flowing);
  };
  const state: TileState =
    base === "video" && recovery.phase !== "ok" ? recovery.phase : base === "video" && !firstFrames && !screen ? (p.isLocal ? "starting" : "connecting") : base;
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const micMuted = !mic || mic.isMuted;
  const me = p.identity === meId;
  const meta = metaOf(p);
  // Guests' names arrive as "Name (Guest)": show the name, and a Guest tag.
  const plain = (p.name || "Guest").replace(/ \(Guest\)$/, "");
  const name = me ? "You" : plain;
  const poor = !p.isLocal && p.connectionQuality === ConnectionQuality.Poor;
  const label = LABELS[state];
  return (
    <figure
      className={`meet-tile${speaking && !screen ? " is-speaking" : ""}${featured ? " is-featured" : ""}${screen ? " is-screen" : ""} state-${state}`}
      data-state={state}
      data-name={p.name || "Guest"}
      data-source={screen ? "screen" : "camera"}
      aria-label={screen ? `${name === "You" ? "Your" : `${name}'s`} screen` : `${name}${speaking && !screen ? ", speaking" : ""}`}
    >
      {video && <ReliableVideo track={video} mirrored={p.isLocal && !screen} contain={screen} watch={!screen} onHealth={onHealth} onBlocked={onBlocked} />}
      {state !== "video" && (
        <div className={`meet-tile-avatar${video ? " is-over-video" : ""}`}>
          {!screen && <Avatar name={plain} size={featured ? 96 : 64} />}
          {label && (
            <span className="meet-tile-state" role="status">
              {(state === "starting" || state === "connecting" || state === "recovering" || state === "reconnecting") && <Loader2 size={14} className="meet-spin" aria-hidden="true" />}
              {state === "reconnecting" && <WifiOff size={14} aria-hidden="true" />}
              {label}
            </span>
          )}
        </div>
      )}
      {state === "video" && applying && (
        <span className="meet-tile-badge" role="status">
          Applying background…
        </span>
      )}
      <figcaption>
        {!screen && micMuted && <MicOff size={13} aria-label="Microphone off" />}
        {!screen && state === "off" && <VideoOff size={13} aria-label="Camera off" />}
        {meta.host && !screen && <Crown size={12} aria-label="Organiser" />}
        {poor && <SignalLow size={13} aria-label="Weak connection" />}
        <span>{screen ? `${name === "You" ? "Your" : `${name}'s`} screen` : name}</span>
        {(meta.guest || plain !== (p.name || "Guest")) && !screen && !me && <small className="meet-guest-tag">Guest</small>}
      </figcaption>
    </figure>
  );
}
