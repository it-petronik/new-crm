"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  isTrackReference,
  useConnectionState,
  useIsRecording,
  useIsSpeaking,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useRoomInfo,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, ScreenSharePresets, Track, VideoPreset, type Participant, type RoomOptions } from "livekit-client";
import {
  Circle,
  ClipboardCopy,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreHorizontal,
  PhoneOff,
  RefreshCw,
  SignalLow,
  Sparkles,
  Square,
  SwitchCamera,
  UserMinus,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { Avatar } from "../avatar";
import { useCollabEvents } from "@/lib/collab-client";
import { decideGuest, endMeetingForAll, hostAction, recordingAction, waitingGuestsOf, type JoinChoices } from "@/lib/meeting-client";
import { durationLabel, type RoomSession } from "@/lib/meetings";
import { QUALITY_LABELS, QUALITY_PRESETS, effectLabel, loadPrefs, type QualityMode } from "@/lib/meeting-media";
import MeetingChat from "./meeting-chat";
import { DeviceSelect } from "./device-setup";
import { MeetingShare, useDismiss } from "./meeting-info";
import { MediaTile, metaOf, useParticipantTick } from "./media-tile";
import { BackgroundPicker } from "./media-effects";
import { useLocalMedia } from "./use-local-media";

/**
 * Room settings: adaptive stream (each tile gets the size it shows),
 * dynacast (layers nobody watches aren't sent), simulcast layers from the
 * chosen quality, screens encoded for reading, and speech-friendly audio.
 */
function optionsFor(quality: QualityMode): RoomOptions {
  const preset = QUALITY_PRESETS[quality];
  return {
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
    videoCaptureDefaults: { resolution: preset.capture },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: {
      simulcast: true,
      videoEncoding: preset.encoding,
      videoSimulcastLayers: preset.layers.map((l) => new VideoPreset(l.width, l.height, l.maxBitrate, l.maxFramerate)),
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      dtx: true,
      red: true,
    },
  };
}

/**
 * The meeting itself, for employees and guests alike. The provider (LiveKit)
 * carries audio, video and screens; this is the Enercore interface around
 * it: stage and grid, controls, participants, the conversation's chat,
 * host controls (via the server), the guest waiting room, recording, and
 * every failure state in plain words.
 *
 * Guests get the meeting only: no CRM chat, no moderation, no Collaboration
 * connection. Recording is announced to everyone, guests included, by the
 * provider itself — it can never run unseen.
 */

type Ending = { title: string; detail: string; rejoin?: boolean };

export default function MeetingRoom({
  session,
  choices,
  onLeave,
  onRejoin,
  closeLabel = "Back to Enercore",
}: {
  session: RoomSession;
  choices: JoinChoices;
  /** Called after leaving or when the person closes an ended/removed screen. */
  onLeave: () => void;
  /** A fresh session (re-checks access), or an error message to show. */
  onRejoin: () => Promise<RoomSession | { error: string; final: boolean }>;
  closeLabel?: string;
}) {
  const [current, setCurrent] = useState(session);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [notice, setNotice] = useState("");
  const [rejoining, setRejoining] = useState(false);
  // Adaptive stream + dynacast + simulcast, at this device's chosen quality —
  // the same for employees and guests. Fixed for the room's lifetime.
  const [roomOptions] = useState(() => optionsFor(choices.media?.quality ?? loadPrefs(session.guest).quality));

  // Employees hear the meeting end or their access go through Collaboration.
  useCollabEvents(!current.guest, (event) => {
    if (event.type === "meeting.ended" && event.meeting.id === current.meetingId) setEnding({ title: "The meeting has ended", detail: "Everyone has been disconnected." });
    if (event.type === "conversation.removed" && current.conversationId && event.conversationId === current.conversationId)
      setEnding({ title: "You no longer have access", detail: "You were removed from this conversation, so you have left its meeting." });
  });

  const onDisconnected = (reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) return onLeave();
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED)
      setEnding({ title: "The meeting has ended", detail: "Everyone has been disconnected." });
    else if (reason === DisconnectReason.PARTICIPANT_REMOVED)
      setEnding({ title: "You were removed from the meeting", detail: current.guest ? "The host removed you from this meeting." : "The organiser removed you, or your access to this meeting changed." });
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY)
      setEnding({ title: "You joined somewhere else", detail: "This meeting is now open in another tab or on another device." });
    else setEnding({ title: "Connection lost", detail: "The connection to the meeting dropped and could not be restored.", rejoin: true });
  };

  async function rejoin() {
    setRejoining(true);
    const result = await onRejoin();
    setRejoining(false);
    if ("error" in result) setEnding({ title: result.final ? "You can't rejoin" : "Couldn't rejoin", detail: result.error, rejoin: !result.final });
    else {
      setEnding(null);
      setCurrent(result);
    }
  }

  if (ending)
    return (
      <div className="meet-room meet-ended" role="dialog" aria-modal="true" aria-labelledby="meet-ended-title">
        <div className="meet-ended-card">
          <h1 id="meet-ended-title">{ending.title}</h1>
          <p>{ending.detail}</p>
          <div className="meet-ended-actions">
            {ending.rejoin && (
              <Button className="primary" disabled={rejoining} onClick={() => void rejoin()}>
                <RefreshCw size={16} aria-hidden="true" /> {rejoining ? "Rejoining…" : "Rejoin"}
              </Button>
            )}
            <Button className="secondary" onClick={onLeave}>
              {closeLabel}
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <LiveKitRoom
      key={current.token}
      className="meet-room"
      serverUrl={current.serverUrl}
      token={current.token}
      connect
      // Devices are published by the meeting itself (see useLocalMedia): the
      // pre-join tracks as they are, never opened twice.
      audio={false}
      video={false}
      options={roomOptions}
      onDisconnected={onDisconnected}
      onError={() => setNotice("Something went wrong with the meeting connection.")}
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
    >
      <RoomAudioRenderer />
      <Stage session={current} choices={current === session ? choices : { ...choices, media: undefined }} notice={notice} setNotice={setNotice} />
    </LiveKitRoom>
  );
}

/* --------------------------------------------------------------- inside */

function Stage({ session, choices, notice, setNotice }: { session: RoomSession; choices: JoinChoices; notice: string; setNotice: (s: string) => void }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const media = useLocalMedia({ guest: session.guest, media: choices.media, wantAudio: choices.audio, wantVideo: choices.video });
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const [panel, setPanel] = useState<"people" | "chat" | "effects" | null>(null);
  const [more, setMore] = useState(false);
  // The More menu closes on Escape or a click anywhere outside it.
  const moreRef = useRef<HTMLDivElement>(null);
  const closeMore = useCallback(() => setMore(false), []);
  useDismiss(more, moreRef, closeMore);
  const [confirm, setConfirm] = useState<"end" | "record" | null>(null);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<"gallery" | "speaker">("gallery");
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [howTo, setHowTo] = useState(false);
  const cameras = useMediaDeviceSelect({ kind: "videoinput", room });
  const mics = useMediaDeviceSelect({ kind: "audioinput", room });
  const moderator = session.host && !session.guest;
  // Notices from either source, one toast.
  const toast = media.notice || notice;
  const clearToast = () => (media.setNotice(""), setNotice(""));

  /* ----------------------------------------------------- recording state */
  const info = useRoomInfo();
  const providerRecording = useIsRecording();
  const recordingBy = useMemo(() => {
    try {
      return (JSON.parse(info.metadata || "{}") as { recording?: { by?: string } | null }).recording?.by ?? null;
    } catch {
      return null;
    }
  }, [info.metadata]);
  const recording = providerRecording || !!recordingBy;
  const [recordingSeen, setRecordingSeen] = useState(false);
  useEffect(() => {
    if (recording && !recordingSeen) {
      setRecordingSeen(true);
      setNotice(recordingBy ? `Recording started by ${recordingBy}.` : "This meeting is being recorded.");
    } else if (!recording && recordingSeen) {
      setRecordingSeen(false);
      setNotice("Recording stopped.");
    }
  }, [recording, recordingBy, recordingSeen, setNotice]);

  /* ------------------------------------------------------- waiting room */
  const [waiting, setWaiting] = useState<{ id: string; name: string }[]>([]);
  const loadWaiting = useCallback(() => {
    if (!moderator) return;
    void waitingGuestsOf(session.meetingId)
      .then((r) => setWaiting(r.guests))
      .catch(() => {});
  }, [moderator, session.meetingId]);
  useEffect(loadWaiting, [loadWaiting]);
  useCollabEvents(moderator, (event) => {
    if (event.type === "meeting.guest_waiting" && event.meetingId === session.meetingId)
      setWaiting((w) => (w.some((g) => g.id === event.guest.id) ? w : [...w, event.guest]));
    if (event.type === "meeting.guest_decided" && event.meetingId === session.meetingId) setWaiting((w) => w.filter((g) => g.id !== event.guestId));
  }, loadWaiting);
  const decide = (guestId: string, decision: "admit" | "decline") => {
    setWaiting((w) => w.filter((g) => g.id !== guestId));
    void decideGuest(session.meetingId, guestId, decision).catch((e) => {
      setNotice(e instanceof Error ? e.message : "That didn't work.");
      loadWaiting();
    });
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const loudest = speaking.find((p) => !p.isLocal) ?? speaking[0];
    if (loudest) setLastSpeaker(loudest.identity);
  }, [speaking]);

  // One screen share leads the stage: the most recent one.
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const screen = screens[screens.length - 1] ?? null;
  const cams = tracks.filter((t) => t.source === Track.Source.Camera);
  const sharer = screen?.participant ?? null;
  const featured = useMemo(() => {
    if (screen) return screen;
    if (layout !== "speaker") return null;
    // The active speaker leads — with their avatar if their camera is off.
    return cams.find((t) => t.participant.identity === lastSpeaker && !t.participant.isLocal) ?? cams.find((t) => !t.participant.isLocal) ?? cams[0] ?? null;
  }, [screen, layout, cams, lastSpeaker]);
  const strip = featured ? cams.filter((t) => t !== featured) : cams;

  const canShare = !session.guest && typeof navigator !== "undefined" && !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices;
  const otherSharing = !!sharer && !sharer.isLocal;
  const started = session.startedAt ? new Date(session.startedAt).getTime() : now;
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const connecting = state === ConnectionState.Connecting;
  const touch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  const hostCall = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
      setConfirm(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : fallback);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    const snapshot = (window as unknown as { __enercoreMeetingDiagnostics?: () => unknown }).__enercoreMeetingDiagnostics?.();
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 1));
      setNotice("Diagnostics copied — they contain no device ids, images or audio.");
    } catch {
      setNotice("Copying isn't available here.");
    }
  };

  const micBusy = !!media.pending.microphone;
  const camBusy = !!media.pending.camera;
  const tileProps = { meId: session.identity, starting: media.pending.camera === "on", applying: media.effectApplying, onBlocked: () => void 0 };

  return (
    <div className={`meet-shell${panel ? " has-panel" : ""}`}>
      <header className="meet-top">
        <div className="meet-title">
          <h1>{session.title}</h1>
          <span>
            {durationLabel(now - started)} · {participants.length} {participants.length === 1 ? "person" : "people"}
          </span>
        </div>
        <MeetingShare session={session} onNotice={setNotice} />
        <div className="meet-top-status">
          {recording && (
            <span className="meet-recording" role="status" aria-live="polite">
              <Circle size={10} fill="currentColor" aria-hidden="true" /> Recording
            </span>
          )}
          {(reconnecting || connecting) && (
            <span className="meet-status" role="status">
              {connecting ? "Connecting…" : "Reconnecting…"}
            </span>
          )}
        </div>
      </header>

      {waiting.length > 0 && (
        <div className="meet-waiting" role="region" aria-label="Guests waiting">
          {waiting.slice(0, 3).map((g) => (
            <div className="meet-waiting-row" key={g.id}>
              <span>
                <b>{g.name}</b> is waiting
              </span>
              <Button className="secondary compact" onClick={() => decide(g.id, "decline")}>
                Decline
              </Button>
              <Button className="primary compact" onClick={() => decide(g.id, "admit")}>
                Admit
              </Button>
            </div>
          ))}
          {waiting.length > 3 && <small>and {waiting.length - 3} more — see People.</small>}
        </div>
      )}

      <div className="meet-notices">
      {!media.canPlayAudio && (
        <div className="meet-banner-bar" role="alert">
          <Volume2 size={16} aria-hidden="true" />
          <span>Your browser paused the meeting&apos;s sound.</span>
          <Button className="primary compact" onClick={() => void media.unlockPlayback()}>
            Tap to enable meeting audio
          </Button>
        </div>
      )}

      {media.unstable && !reconnecting && (
        <p className="meet-banner-bar is-subtle" role="status">
          <SignalLow size={14} aria-hidden="true" /> Your connection is unstable. Video quality may be reduced.
        </p>
      )}


      {media.issue && (
        <div className="meet-toast is-issue" role="alert">
          <span>{media.issue.message}</span>
          {media.issue.problem === "blocked" ? (
            <Button className="secondary compact" onClick={() => setHowTo(!howTo)}>
              How to allow
            </Button>
          ) : media.issue.kind === "microphone" && media.issue.problem !== "publish" ? (
            <Button className="secondary compact" onClick={() => (media.clearIssue(), void media.setDevice("audioinput", "default").then(() => media.setMicrophone(true)))}>
              Use default microphone
            </Button>
          ) : (
            <Button className="secondary compact" onClick={() => (media.clearIssue(), void (media.issue!.kind === "camera" ? media.setCamera(true) : media.setMicrophone(true)))}>
              Try again
            </Button>
          )}
          <Button className="icon-button" aria-label="Dismiss" onClick={() => (media.clearIssue(), setHowTo(false))}>
            <X size={14} />
          </Button>
          {howTo && (
            <p className="meet-howto">
              Click the camera or lock icon next to the address bar, set Camera and Microphone to Allow, then reload this page. On a phone, check the browser&apos;s site settings.
            </p>
          )}
        </div>
      )}

      {media.silent && (
        <div className="meet-toast" role="status">
          <span>Your microphone is on, but no audio is being detected. Check it isn&apos;t muted on the device, or choose another under More.</span>
          <Button className="icon-button" aria-label="Dismiss" onClick={media.dismissSilent}>
            <X size={14} />
          </Button>
        </div>
      )}

      {toast && (
        <div className="meet-toast" role="alert">
          <span>{toast}</span>
          <Button className="icon-button" aria-label="Dismiss" onClick={clearToast}>
            <X size={14} />
          </Button>
        </div>
      )}

      </div>

      <main className={`meet-stage${featured ? " has-featured" : ""}`} aria-label="Meeting">
        {featured && (
          <div className="meet-featured">
            <MediaTile trackRef={featured} featured {...tileProps} />
          </div>
        )}
        <div className={`meet-grid count-${Math.min(strip.length, 9)}${featured ? " is-strip" : ""}`}>
          {strip.map((t) => (
            <MediaTile key={`${t.participant.identity}-${t.source}`} trackRef={t} {...tileProps} />
          ))}
        </div>
      </main>

      {panel && (
        <aside className="meet-panel" aria-label={panel === "people" ? "Participants" : panel === "effects" ? "Background effects" : "Chat"}>
          <div className="meet-panel-head">
            <h2>{panel === "people" ? `People (${participants.length})` : panel === "effects" ? "Background effects" : "Chat"}</h2>
            <Button className="icon-button" aria-label="Close panel" onClick={() => setPanel(null)}>
              <X size={16} />
            </Button>
          </div>
          {panel === "people" ? (
            <ul className="meet-people">
              {moderator &&
                waiting.map((g) => (
                  <li className="meet-person is-waiting" key={g.id}>
                    <Avatar name={g.name} size={32} />
                    <span className="meet-person-name">
                      <b>{g.name}</b>
                      <small>Guest · waiting</small>
                    </span>
                    <span className="meet-person-actions">
                      <Button className="secondary compact" onClick={() => decide(g.id, "decline")}>Decline</Button>
                      <Button className="primary compact" onClick={() => decide(g.id, "admit")}>Admit</Button>
                    </span>
                  </li>
                ))}
              {participants.map((p) => (
                <PersonRow key={p.identity} p={p} meId={session.identity} canModerate={moderator} meetingId={session.meetingId} onError={setNotice} />
              ))}
            </ul>
          ) : panel === "effects" ? (
            <div className="meet-panel-body">
              {!media.cameraOn && <p className="meet-panel-note">Turn your camera on to see the effect. Your choice is kept.</p>}
              <BackgroundPicker
                value={media.effect}
                onChange={media.setEffect}
                customUrl={media.customUrl}
                onCustomFile={media.custom.choose}
                customError={media.custom.error}
                applying={media.effectApplying}
              />
            </div>
          ) : session.conversationId ? (
            <MeetingChat conversationId={session.conversationId} meId={session.identity} />
          ) : (
            <p className="meet-chat-empty meet-panel-note">This meeting has no chat room. Share notes in Collaboration after the meeting.</p>
          )}
        </aside>
      )}

      <nav className="meet-controls" aria-label="Meeting controls">
        <Button
          className={`meet-control${media.microphoneOn ? "" : " is-off"}`}
          aria-pressed={media.microphoneOn}
          aria-busy={micBusy || undefined}
          disabled={micBusy}
          aria-label={micBusy ? (media.pending.microphone === "on" ? "Starting microphone" : "Muting microphone") : media.microphoneOn ? "Mute microphone" : "Unmute microphone"}
          onClick={() => void media.setMicrophone(!media.microphoneOn)}
        >
          {micBusy ? <Loader2 size={20} className="meet-spin" /> : media.microphoneOn ? <Mic size={20} /> : <MicOff size={20} />}
          <span>{micBusy ? "Starting…" : media.microphoneOn ? "Mute" : "Unmute"}</span>
        </Button>
        <Button
          className={`meet-control${media.cameraOn ? "" : " is-off"}`}
          aria-pressed={media.cameraOn}
          aria-busy={camBusy || undefined}
          disabled={camBusy}
          aria-label={camBusy ? (media.pending.camera === "on" ? "Starting camera" : "Turning camera off") : media.cameraOn ? "Turn camera off" : "Turn camera on"}
          onClick={() => void media.setCamera(!media.cameraOn)}
        >
          {camBusy ? <Loader2 size={20} className="meet-spin" /> : media.cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
          <span>{camBusy ? (media.pending.camera === "on" ? "Starting…" : "Stopping…") : media.cameraOn ? "Camera on" : "Camera off"}</span>
        </Button>
        {touch && cameras.devices.length > 1 && media.cameraOn && (
          <Button className="meet-control meet-only-touch" aria-label="Switch camera" onClick={() => void media.flipCamera()}>
            <SwitchCamera size={20} />
            <span>Flip</span>
          </Button>
        )}
        {canShare && (
          <Button
            className={`meet-control${media.screenOn ? " is-active" : ""}`}
            aria-pressed={media.screenOn}
            disabled={otherSharing}
            title={otherSharing ? `${sharer?.name || "Someone"} is sharing` : undefined}
            aria-label={media.screenOn ? "Stop sharing" : "Share screen"}
            onClick={() => void media.setScreen(!media.screenOn)}
          >
            {media.screenOn ? <MonitorX size={20} /> : <MonitorUp size={20} />}
            <span>{media.screenOn ? "Stop" : "Share"}</span>
          </Button>
        )}
        <Button
          className={`meet-control${panel === "people" ? " is-active" : ""}`}
          aria-pressed={panel === "people"}
          aria-label="Participants"
          onClick={() => setPanel(panel === "people" ? null : "people")}
        >
          <Users size={20} />
          <span>People{moderator && waiting.length ? ` (${waiting.length})` : ""}</span>
        </Button>
        {!session.guest && (
          <Button
            className={`meet-control${panel === "chat" ? " is-active" : ""}`}
            aria-pressed={panel === "chat"}
            aria-label="Chat"
            onClick={() => setPanel(panel === "chat" ? null : "chat")}
          >
            <MessageSquare size={20} />
            <span>Chat</span>
          </Button>
        )}
        <div className="meet-more" ref={moreRef}>
          <Button className={`meet-control${more ? " is-active" : ""}`} aria-expanded={more} aria-haspopup="dialog" aria-label="More options" onClick={() => setMore(!more)}>
            <MoreHorizontal size={20} />
            <span>More</span>
          </Button>
          {more && (
            <div className="meet-menu" role="dialog" aria-label="More options">
              <section aria-labelledby="more-devices">
                <h3 id="more-devices">Devices</h3>
                <div className="meet-menu-devices">
                  <DeviceSelect kind="audioinput" devices={mics.devices} value={mics.activeDeviceId} onChange={(id) => void media.setDevice("audioinput", id)} />
                  <DeviceSelect kind="videoinput" devices={cameras.devices} value={cameras.activeDeviceId} onChange={(id) => void media.setDevice("videoinput", id)} />
                </div>
              </section>
              <section aria-labelledby="more-effects">
                <h3 id="more-effects">Background effects</h3>
                <button type="button" className="meet-menu-item" onClick={() => (setMore(false), setPanel("effects"))}>
                  <Sparkles size={16} aria-hidden="true" /> <span>{effectLabel(media.effect)}</span> <small>Change</small>
                </button>
              </section>
              <section aria-labelledby="more-quality">
                <h3 id="more-quality">Video quality</h3>
                <div className="meet-quality" role="radiogroup" aria-labelledby="more-quality">
                  {(Object.keys(QUALITY_LABELS) as QualityMode[]).map((q) => (
                    <button key={q} type="button" role="radio" aria-checked={media.quality === q} className={media.quality === q ? "is-selected" : ""} onClick={() => void media.setQuality(q)}>
                      <b>{QUALITY_LABELS[q].label}</b>
                      <small>{QUALITY_LABELS[q].hint}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section aria-labelledby="more-layout">
                <h3 id="more-layout">Layout</h3>
                <button type="button" className="meet-menu-item" onClick={() => (setLayout(layout === "gallery" ? "speaker" : "gallery"), setMore(false))}>
                  <LayoutGrid size={16} aria-hidden="true" /> <span>{layout === "gallery" ? "Speaker view" : "Gallery view"}</span>
                </button>
              </section>
              {moderator && (
                <section aria-labelledby="more-recording">
                  <h3 id="more-recording">Recording</h3>
                  {session.canRecord || recording ? (
                    <button type="button" className="meet-menu-item" onClick={() => (setMore(false), setConfirm("record"))}>
                      <Circle size={16} aria-hidden="true" /> <span>{recording ? "Stop recording" : "Record meeting"}</span>
                    </button>
                  ) : (
                    // Plainly unavailable until cloud recording storage is set up.
                    <button type="button" className="meet-menu-item" disabled aria-disabled="true" title="Cloud recording isn't set up for this workspace.">
                      <Circle size={16} aria-hidden="true" /> <span>Recording isn&apos;t set up</span>
                    </button>
                  )}
                </section>
              )}
              <section aria-labelledby="more-help">
                <h3 id="more-help">Troubleshooting</h3>
                <button type="button" className="meet-menu-item" onClick={() => void copyDiagnostics()}>
                  <ClipboardCopy size={16} aria-hidden="true" /> <span>Copy diagnostics</span>
                </button>
              </section>
            </div>
          )}
        </div>
        <div className="meet-exit">
        {/* Leave: only me — the meeting goes on. */}
        <Button className={`meet-control meet-leave${moderator ? " is-host" : ""}`} aria-label="Leave meeting" onClick={() => void room.disconnect()}>
          <PhoneOff size={20} />
          <span>Leave</span>
        </Button>
        {/* End: the host ends it for everyone (the server checks this too). */}
        {moderator && (
          <Button className="meet-control meet-end" aria-label="End meeting" onClick={() => (setMore(false), setConfirm("end"))}>
            <Square size={18} aria-hidden="true" />
            <span>End</span>
          </Button>
        )}
        </div>
      </nav>

      <DialogPresence>
        {confirm === "end" && (
          <Dialog title="End meeting?" onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact meet-dialog">
            <p>Everyone will be disconnected and the meeting will be marked as ended.</p>
            <DialogActions
              cancel="Keep meeting"
              onCancel={() => setConfirm(null)}
              primary={{ label: "End meeting", pendingLabel: "Ending…", tone: "danger", pending: busy, onClick: () => void hostCall(() => endMeetingForAll(session.meetingId), "Couldn't end the meeting.") }}
            />
          </Dialog>
        )}
        {confirm === "record" && (
          <Dialog title={recording ? "Stop recording?" : "Record this meeting?"} onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact meet-dialog">
            <p>
              {recording
                ? "The recording will be saved to the meeting's details for people who can open this meeting."
                : "Everyone in the meeting, including guests, will see that it's being recorded and who started it. The recording is kept privately for people who can open this meeting."}
            </p>
            <DialogActions
              onCancel={() => setConfirm(null)}
              primary={{
                label: recording ? "Stop recording" : "Start recording",
                pendingLabel: recording ? "Stopping…" : "Starting…",
                pending: busy,
                onClick: () => void hostCall(() => recordingAction(session.meetingId, recording ? "stop" : "start"), "The recording couldn't be changed."),
              }}
            />
          </Dialog>
        )}
      </DialogPresence>
    </div>
  );
}

function PersonRow({ p, meId, canModerate, meetingId, onError }: { p: Participant; meId: string; canModerate: boolean; meetingId: string; onError: (s: string) => void }) {
  useParticipantTick(p);
  const speaking = useIsSpeaking(p);
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const micOn = !!mic && !mic.isMuted;
  const cam = p.getTrackPublication(Track.Source.Camera);
  const camOn = !!cam && !cam.isMuted;
  const me = p.identity === meId;
  const meta = metaOf(p);
  const act = (body: Parameters<typeof hostAction>[1]) =>
    void hostAction(meetingId, body).catch((e) => onError(e instanceof Error ? e.message : "That didn't work."));
  return (
    <li className={`meet-person${speaking ? " is-speaking" : ""}`}>
      <Avatar name={p.name || "Guest"} size={32} />
      <span className="meet-person-name">
        <b>{me ? `${p.name} (you)` : p.name || "Guest"}</b>
        {(meta.host || meta.guest) && <small>{meta.host ? "Organiser" : "Guest"}</small>}
      </span>
      <span className="meet-person-state">
        {micOn ? <Mic size={15} aria-label="Microphone on" /> : <MicOff size={15} aria-label="Microphone off" />}
        {camOn ? <Video size={15} aria-label="Camera on" /> : <VideoOff size={15} aria-label="Camera off" />}
      </span>
      {canModerate && !me && (
        <span className="meet-person-actions">
          {micOn && mic?.trackSid && (
            <Button className="icon-button" aria-label={`Mute ${p.name}`} title="Mute" onClick={() => act({ action: "mute", identity: p.identity, trackSid: mic.trackSid })}>
              <MicOff size={15} />
            </Button>
          )}
          <Button className="icon-button is-danger" aria-label={`Remove ${p.name} from the meeting`} title="Remove" onClick={() => act({ action: "remove", identity: p.identity })}>
            <UserMinus size={15} />
          </Button>
        </span>
      )}
    </li>
  );
}
