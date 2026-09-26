"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext, useConnectionState } from "@livekit/components-react";
import {
  ConnectionQuality,
  ConnectionState,
  ParticipantEvent,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  VideoQuality,
  type LocalAudioTrack,
  type LocalTrack,
  type LocalVideoTrack,
  type RemoteParticipant,
} from "livekit-client";
import {
  QUALITY_PRESETS,
  classifyMediaError,
  diagnosticsLog,
  environmentSummary,
  fallbackDevice,
  loadPrefs,
  mediaMessage,
  noteMedia,
  savePrefs,
  type MediaHandoff,
  type MediaKind,
  type MediaProblem,
  type QualityMode,
} from "@/lib/meeting-media";

/**
 * Your camera, microphone and screen in the meeting — one state machine for
 * employees and guests. What the controls show comes from LiveKit (a live,
 * unmuted publication), never from what was last clicked:
 *
 * - Turning a device on waits for LiveKit to publish it; until then the
 *   button is busy ("Starting…"); if it fails it stays off and says why.
 * - The pre-join tracks are published once, as they are.
 * - A device that stops (unplugged, taken by another app, a phone call) is
 *   restarted by LiveKit or marked off — and you're told.
 * - After a reconnect, waking up or returning to the tab, everything is
 *   re-checked against the actual tracks.
 * - A chosen device that disappears falls back to the system default.
 */

export type MediaIssue = { kind: MediaKind; problem: MediaProblem; message: string };

const liveTrack = (t?: LocalTrack) => !!t && t.mediaStreamTrack?.readyState === "live";

export function useLocalMedia({ guest, media, wantAudio, wantVideo }: { guest: boolean; media?: MediaHandoff; wantAudio: boolean; wantVideo: boolean }) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isScreenShareEnabled } = useLocalParticipant();
  const [pending, setPending] = useState<{ camera?: "on" | "off"; microphone?: "on" | "off" }>({});
  const [issue, setIssue] = useState<MediaIssue | null>(null);
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);
  const [quality, setQualityState] = useState<QualityMode>(media?.quality ?? loadPrefs(guest).quality);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");

  const camPub = localParticipant.getTrackPublication(Track.Source.Camera);
  const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
  const camTrack = camPub?.track as LocalVideoTrack | undefined;
  const micTrack = micPub?.track as LocalAudioTrack | undefined;
  // ON only when LiveKit has a live, unmuted publication.
  const cameraOn = !!camPub && !camPub.isMuted && liveTrack(camTrack);
  const microphoneOn = !!micPub && !micPub.isMuted && liveTrack(micTrack) && isMicrophoneEnabled;

  const fail = useCallback((kind: MediaKind, e: unknown, event: "start" | "publish") => {
    const problem = event === "publish" ? "publish" : classifyMediaError(e);
    noteMedia(`${kind}_${event === "publish" ? "publish" : "start"}_failed` as never, (e as { name?: string })?.name);
    setIssue({ kind, problem, message: mediaMessage(kind, problem) });
  }, []);

  /* ------------------------------------------------------- handed-off tracks */
  const published = useRef(false);
  useEffect(() => {
    if (connection !== ConnectionState.Connected || published.current) return;
    published.current = true;
    void (async () => {
      const handed = media;
      // Microphone.
      if (handed?.audio && liveTrack(handed.audio)) {
        try {
          await localParticipant.publishTrack(handed.audio, { source: Track.Source.Microphone });
        } catch (e) {
          handed.audio.stop();
          fail("microphone", e, "publish");
        }
      } else if (wantAudio) await setMicrophone(true);
      // Camera — the clean device track, published directly.
      if (handed?.video && liveTrack(handed.video)) {
        try {
          await localParticipant.publishTrack(handed.video, { source: Track.Source.Camera });
          if (quality === "saver") handed.video.setPublishingQuality(VideoQuality.MEDIUM);
        } catch (e) {
          handed.video.stop();
          fail("camera", e, "publish");
        }
      } else if (wantVideo) await setCamera(true);
      setTick((n) => n + 1);
    })();
    // once, on the first connection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  /* ------------------------------------------------------------- toggles */
  async function setCamera(on: boolean) {
    if (pending.camera) return;
    setPending((p) => ({ ...p, camera: on ? "on" : "off" }));
    if (on) setIssue((i) => (i?.kind === "camera" ? null : i));
    try {
      const capture = QUALITY_PRESETS[quality].capture;
      const pub = await localParticipant.setCameraEnabled(on, { resolution: capture, ...(facing === "environment" ? { facingMode: "environment" } : {}) });
      if (on && (!pub || pub.isMuted || !liveTrack(pub.track as LocalTrack | undefined))) throw Object.assign(new Error("not published"), { name: "PublishError" });
    } catch (e) {
      fail("camera", e, (e as { name?: string })?.name === "PublishError" ? "publish" : "start");
    } finally {
      setPending((p) => ({ ...p, camera: undefined }));
      setTick((n) => n + 1);
    }
  }

  async function setMicrophone(on: boolean) {
    if (pending.microphone) return;
    setPending((p) => ({ ...p, microphone: on ? "on" : "off" }));
    if (on) setIssue((i) => (i?.kind === "microphone" ? null : i));
    try {
      const pub = await localParticipant.setMicrophoneEnabled(on, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (on && (!pub || pub.isMuted || !liveTrack(pub.track as LocalTrack | undefined))) throw Object.assign(new Error("not published"), { name: "PublishError" });
    } catch (e) {
      fail("microphone", e, (e as { name?: string })?.name === "PublishError" ? "publish" : "start");
    } finally {
      setPending((p) => ({ ...p, microphone: undefined }));
      setTick((n) => n + 1);
    }
  }

  async function setScreen(on: boolean) {
    try {
      setNotice("");
      // Screens are published as captured: never processed, sized for reading.
      await localParticipant.setScreenShareEnabled(on, { audio: true, contentHint: "detail", resolution: { width: 1920, height: 1080, frameRate: 15 } });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError") return; // closing the picker is a choice
      setNotice("Screen sharing isn't available in this browser.");
    }
  }

  /* ------------------------------------------------ devices and switching */
  const lastActive = useRef<Record<string, string | undefined>>({});

  async function setDevice(kind: "audioinput" | "videoinput", deviceId: string) {
    const noun = kind === "audioinput" ? "microphone" : "camera";
    try {
      lastActive.current[kind] = deviceId;
      const ok = await room.switchActiveDevice(kind, deviceId);
      const track = kind === "audioinput" ? micTrack : camTrack;
      const actual = track ? await track.getDeviceId(false) : undefined;
      if (!ok || (deviceId !== "default" && track && actual && actual !== deviceId)) throw Object.assign(new Error("switch"), { name: "NotReadableError" });
      setIssue((i) => (i?.kind === noun ? null : i));
    } catch (e) {
      fail(noun, e, "start");
    } finally {
      setTick((n) => n + 1);
    }
  }

  /** Phones: front ↔ back camera, replacing the track in place. */
  async function flipCamera() {
    if (!camTrack) return;
    const next = facing === "user" ? "environment" : "user";
    try {
      await camTrack.restartTrack({ facingMode: next, resolution: QUALITY_PRESETS[quality].capture });
      setFacing(next);
    } catch (e) {
      fail("camera", e, "start");
    } finally {
      setTick((n) => n + 1);
    }
  }

  // A chosen device unplugged: fall back to the default, and say so. The
  // last device the person was using is remembered, because LiveKit may
  // already have moved to the default by the time we hear about the change.
  useEffect(() => {
    // LiveKit's own fallback announces "default" before the device-list
    // change arrives; only real device choices are remembered here.
    const remember = (kind: MediaDeviceKind, id: string) => {
      if (id !== "default") lastActive.current[kind] = id;
    };
    for (const kind of ["audioinput", "videoinput"] as const) lastActive.current[kind] ??= room.getActiveDevice(kind);
    const onDevices = async () => {
      for (const kind of ["audioinput", "videoinput"] as const) {
        const list = await Room.getLocalDevices(kind, false).catch(() => [] as MediaDeviceInfo[]);
        if (fallbackDevice(list, lastActive.current[kind])) {
          const noun = kind === "audioinput" ? "microphone" : "camera";
          noteMedia("device_fallback", noun);
          if (room.getActiveDevice(kind) !== "default") await room.switchActiveDevice(kind, "default").catch(() => {});
          lastActive.current[kind] = "default";
          setNotice(`Your selected ${noun} was disconnected. Switched to the default ${noun}.`);
        }
      }
      setTick((n) => n + 1);
    };
    room.on(RoomEvent.MediaDevicesChanged, onDevices);
    room.on(RoomEvent.ActiveDeviceChanged, remember);
    return () => {
      room.off(RoomEvent.MediaDevicesChanged, onDevices);
      room.off(RoomEvent.ActiveDeviceChanged, remember);
    };
  }, [room]);

  /* ------------------------------------------ a device that stops working */
  useEffect(() => {
    const tracks: [MediaKind, LocalTrack | undefined][] = [
      ["camera", camTrack],
      ["microphone", micTrack],
    ];
    const offs = tracks.map(([kind, track]) => {
      if (!track) return () => {};
      const onEnded = () => {
        noteMedia("track_ended", kind);
        setNotice(`Your ${kind} stopped. Trying to restart it…`);
        // LiveKit restarts the device (or mutes it if it can't); check after.
        setTimeout(() => {
          setTick((n) => n + 1);
          if (liveTrack(track) && !track.isMuted) {
            noteMedia("track_recovered", kind);
            setNotice("");
          } else {
            noteMedia("track_recovery_failed", kind);
            setNotice("");
            setIssue({ kind, problem: "interrupted", message: mediaMessage(kind, "interrupted") });
          }
        }, 2500);
      };
      track.on(TrackEvent.Ended, onEnded);
      return () => void track.off(TrackEvent.Ended, onEnded);
    });
    return () => offs.forEach((off) => off());
  }, [camTrack, micTrack]);

  /* ------------------------------- reconnect, wake-up, back to the tab */
  const reconcile = useCallback(async () => {
    for (const [kind, pub] of [
      ["camera", localParticipant.getTrackPublication(Track.Source.Camera)],
      ["microphone", localParticipant.getTrackPublication(Track.Source.Microphone)],
    ] as const) {
      const track = pub?.track as LocalTrack | undefined;
      // Meant to be on, but the browser ended the device (sleep, a call, the OS).
      if (pub && !pub.isMuted && track && track.mediaStreamTrack?.readyState === "ended") {
        try {
          await (track as LocalVideoTrack).restartTrack();
          noteMedia("track_recovered", kind);
        } catch {
          noteMedia("track_recovery_failed", kind);
          await track.mute().catch(() => {});
          setIssue({ kind, problem: "interrupted", message: mediaMessage(kind, "interrupted") });
        }
      }
    }
    setTick((n) => n + 1);
  }, [localParticipant]);

  useEffect(() => {
    const onReconnecting = () => noteMedia("reconnecting");
    const onReconnected = () => {
      noteMedia("reconnected");
      void reconcile();
    };
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    const onVisible = () => document.visibilityState === "visible" && void reconcile();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("orientationchange", onVisible);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("orientationchange", onVisible);
    };
  }, [room, reconcile]);

  /* ---------------------------------------------------- audio unlock */
  useEffect(() => {
    const update = () => {
      const ok = room.canPlaybackAudio && room.canPlaybackVideo;
      if (!ok) noteMedia("audio_blocked");
      setCanPlayAudio(ok);
    };
    update();
    room.on(RoomEvent.AudioPlaybackStatusChanged, update);
    room.on(RoomEvent.VideoPlaybackStatusChanged, update);
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, update);
      room.off(RoomEvent.VideoPlaybackStatusChanged, update);
    };
  }, [room]);
  /** One tap unlocks every participant's audio and video. */
  const unlockPlayback = async () => {
    await room.startAudio().catch(() => {});
    await room.startVideo().catch(() => {});
    setCanPlayAudio(room.canPlaybackAudio && room.canPlaybackVideo);
  };

  /* ----------------------------------------------- mic on but silent */
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    setSilent(false);
    if (!microphoneOn || !micTrack) return;
    let context: AudioContext | null = null;
    let timer = 0;
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(new MediaStream([micTrack.mediaStreamTrack])).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let silentSince = performance.now();
      // Digital silence (exactly zero), not a quiet room: a working microphone
      // always carries some noise. Only after 12 seconds, and only once.
      timer = window.setInterval(() => {
        if (context?.state === "suspended") void context.resume().catch(() => {});
        analyser.getFloatTimeDomainData(data);
        const peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        if (peak > 0) {
          silentSince = performance.now();
          setSilent(false);
        } else if (performance.now() - silentSince > 12_000) {
          setSilent((was) => {
            if (!was) noteMedia("mic_silent");
            return true;
          });
        }
      }, 500);
    } catch {}
    return () => {
      clearInterval(timer);
      void context?.close().catch(() => {});
    };
  }, [microphoneOn, micTrack]);

  /* ------------------------------------------------------------ quality */
  async function setQuality(next: QualityMode) {
    setQualityState(next);
    savePrefs(guest, { quality: next });
    if (!camTrack) return;
    try {
      const deviceId = await camTrack.getDeviceId(false);
      await camTrack.restartTrack({ ...(deviceId ? { deviceId } : {}), resolution: QUALITY_PRESETS[next].capture });
      camTrack.setPublishingQuality(next === "saver" ? VideoQuality.MEDIUM : VideoQuality.HIGH);
    } catch (e) {
      fail("camera", e, "start");
    }
  }

  /* ------------------------------------------------------ connection */
  const [myQuality, setMyQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  useEffect(() => {
    const update = () => setMyQuality(localParticipant.connectionQuality);
    localParticipant.on(ParticipantEvent.ConnectionQualityChanged, update);
    return () => void localParticipant.off(ParticipantEvent.ConnectionQualityChanged, update);
  }, [localParticipant]);

  /* ----------------------------------------------------- diagnostics */
  useEffect(() => {
    const pubState = (p: { getTrackPublication: (s: Track.Source) => unknown }, source: Track.Source) => {
      const pub = p.getTrackPublication(source) as
        | { isMuted: boolean; track?: { mediaStreamTrack?: MediaStreamTrack; streamState?: string }; isSubscribed?: boolean; trackSid?: string }
        | undefined;
      return pub
        ? {
            published: true,
            muted: pub.isMuted,
            live: pub.track?.mediaStreamTrack?.readyState === "live",
            ...(pub.isSubscribed !== undefined ? { subscribed: pub.isSubscribed, streamState: pub.track?.streamState ?? "none" } : {}),
            sid: pub.trackSid,
          }
        : { published: false };
    };
    const snapshot = () => ({
      environment: environmentSummary(),
      connection: room.state,
      connectionQuality: localParticipant.connectionQuality,
      quality,
      // The camera is published as captured: no processor in between.
      cameraProcessed: !!camTrack?.getProcessor(),
      cameraTrackId: camTrack?.mediaStreamTrack?.id ?? null,
      canPlaybackAudio: room.canPlaybackAudio,
      local: {
        camera: { ...pubState(localParticipant, Track.Source.Camera), on: cameraOn },
        microphone: { ...pubState(localParticipant, Track.Source.Microphone), on: microphoneOn },
        screen: pubState(localParticipant, Track.Source.ScreenShare),
      },
      remote: [...room.remoteParticipants.values()].map((r: RemoteParticipant) => ({
        name: r.name,
        guest: /"guest":true/.test(r.metadata ?? ""),
        connectionQuality: r.connectionQuality,
        camera: pubState(r, Track.Source.Camera),
        microphone: pubState(r, Track.Source.Microphone),
        screen: pubState(r, Track.Source.ScreenShare),
      })),
      log: diagnosticsLog(),
    });
    (window as unknown as { __enercoreMeetingDiagnostics?: () => unknown }).__enercoreMeetingDiagnostics = snapshot;
    return () => void delete (window as unknown as { __enercoreMeetingDiagnostics?: unknown }).__enercoreMeetingDiagnostics;
  });

  return {
    tick,
    cameraOn,
    microphoneOn,
    screenOn: isScreenShareEnabled,
    pending,
    issue,
    clearIssue: () => setIssue(null),
    notice,
    setNotice,
    setCamera,
    setMicrophone,
    setScreen,
    setDevice,
    flipCamera,
    quality,
    setQuality,
    canPlayAudio,
    unlockPlayback,
    silent,
    dismissSilent: () => setSilent(false),
    unstable: myQuality === ConnectionQuality.Poor || myQuality === ConnectionQuality.Lost,
    camTrack,
  };
}
