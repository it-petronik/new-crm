"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useIsMuted,
  useIsRecording,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useRoomInfo,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, MediaDeviceFailure, Track, type Participant } from "livekit-client";
import {
  Circle,
  Crown,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreHorizontal,
  PhoneOff,
  RefreshCw,
  Square,
  SwitchCamera,
  UserMinus,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { Avatar } from "../avatar";
import { useCollabEvents } from "@/lib/collab-client";
import { decideGuest, endMeetingForAll, hostAction, recordingAction, waitingGuestsOf, type JoinChoices } from "@/lib/meeting-client";
import { durationLabel, type RoomSession } from "@/lib/meetings";
import MeetingChat from "./meeting-chat";
import { DeviceSelect } from "./device-setup";
import { MeetingShare, useDismiss } from "./meeting-info";

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

const metaOf = (p: Participant) => {
  try {
    return JSON.parse(p.metadata || "{}") as { host?: boolean; guest?: boolean };
  } catch {
    return {};
  }
};

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
      audio={choices.audio ? { deviceId: choices.audioDeviceId } : false}
      video={choices.video ? { deviceId: choices.videoDeviceId } : false}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onDisconnected}
      onError={() => setNotice("Something went wrong with the meeting connection.")}
      onMediaDeviceFailure={(failure, kind) => {
        const what = kind === "videoinput" ? "Camera" : kind === "audioinput" ? "Microphone" : "Device";
        setNotice(
          failure === MediaDeviceFailure.PermissionDenied
            ? `${what} access is blocked. Allow it in your browser's site settings.`
            : failure === MediaDeviceFailure.NotFound
              ? `No ${what.toLowerCase()} found. It may have been disconnected.`
              : failure === MediaDeviceFailure.DeviceInUse
                ? `${what} is in use by another app.`
                : `${what} couldn't start.`,
        );
      }}
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
    >
      <RoomAudioRenderer />
      <Stage session={current} notice={notice} setNotice={setNotice} />
    </LiveKitRoom>
  );
}

/* --------------------------------------------------------------- inside */

function Stage({ session, notice, setNotice }: { session: RoomSession; notice: string; setNotice: (s: string) => void }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const [panel, setPanel] = useState<"people" | "chat" | null>(null);
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
  const cameras = useMediaDeviceSelect({ kind: "videoinput", room });
  const mics = useMediaDeviceSelect({ kind: "audioinput", room });
  const moderator = session.host && !session.guest;

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
    return cams.find((t) => t.participant.identity === lastSpeaker && !t.participant.isLocal) ?? cams.find((t) => !t.participant.isLocal) ?? cams[0] ?? null;
  }, [screen, layout, cams, lastSpeaker]);
  const strip = featured ? cams.filter((t) => t !== featured) : cams;

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      setNotice("");
      await action();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      // Closing the browser's screen picker is a choice, not an error.
      if (label === "screen" && name === "NotAllowedError") return;
      setNotice(
        name === "NotAllowedError"
          ? `${label === "camera" ? "Camera" : label === "screen" ? "Screen sharing" : "Microphone"} access is blocked in your browser's site settings.`
          : name === "NotFoundError"
            ? `No ${label === "camera" ? "camera" : "microphone"} found.`
            : label === "screen"
              ? "Screen sharing isn't available in this browser."
              : `The ${label} couldn't start.`,
      );
    }
  };

  const canShare = !session.guest && typeof navigator !== "undefined" && !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices;
  const otherSharing = !!sharer && !sharer.isLocal;
  const started = session.startedAt ? new Date(session.startedAt).getTime() : now;
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const connecting = state === ConnectionState.Connecting;

  const switchCamera = async () => {
    const list = cameras.devices;
    if (list.length < 2) return;
    const index = list.findIndex((d) => d.deviceId === cameras.activeDeviceId);
    await run("camera", () => cameras.setActiveMediaDevice(list[(index + 1) % list.length].deviceId));
  };

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

      {notice && (
        <div className="meet-toast" role="alert">
          <span>{notice}</span>
          <Button className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}>
            <X size={14} />
          </Button>
        </div>
      )}

      <main className={`meet-stage${featured ? " has-featured" : ""}`} aria-label="Meeting">
        {featured && (
          <div className="meet-featured">
            <Tile trackRef={featured} meId={session.identity} featured />
          </div>
        )}
        <div className={`meet-grid count-${Math.min(strip.length, 9)}${featured ? " is-strip" : ""}`}>
          {strip.map((t) => (
            <Tile key={`${t.participant.identity}-${t.source}`} trackRef={t} meId={session.identity} />
          ))}
        </div>
      </main>

      {panel && (
        <aside className="meet-panel" aria-label={panel === "people" ? "Participants" : "Chat"}>
          <div className="meet-panel-head">
            <h2>{panel === "people" ? `People (${participants.length})` : "Chat"}</h2>
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
          ) : session.conversationId ? (
            <MeetingChat conversationId={session.conversationId} meId={session.identity} />
          ) : (
            <p className="meet-chat-empty meet-panel-note">This meeting has no chat room. Share notes in Collaboration after the meeting.</p>
          )}
        </aside>
      )}

      <nav className="meet-controls" aria-label="Meeting controls">
        <Button
          className={`meet-control${isMicrophoneEnabled ? "" : " is-off"}`}
          aria-pressed={isMicrophoneEnabled}
          aria-label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          onClick={() => void run("microphone", () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))}
        >
          {isMicrophoneEnabled ? <Mic size={20} /> : <MicOff size={20} />}
          <span>{isMicrophoneEnabled ? "Mute" : "Unmute"}</span>
        </Button>
        <Button
          className={`meet-control${isCameraEnabled ? "" : " is-off"}`}
          aria-pressed={isCameraEnabled}
          aria-label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          onClick={() => void run("camera", () => localParticipant.setCameraEnabled(!isCameraEnabled))}
        >
          {isCameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          <span>Camera</span>
        </Button>
        {cameras.devices.length > 1 && isCameraEnabled && (
          <Button className="meet-control meet-only-touch" aria-label="Switch camera" onClick={() => void switchCamera()}>
            <SwitchCamera size={20} />
            <span>Flip</span>
          </Button>
        )}
        {canShare && (
          <Button
            className={`meet-control${isScreenShareEnabled ? " is-active" : ""}`}
            aria-pressed={isScreenShareEnabled}
            disabled={otherSharing}
            title={otherSharing ? `${sharer?.name || "Someone"} is sharing` : undefined}
            aria-label={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
            onClick={() => void run("screen", () => localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true }))}
          >
            {isScreenShareEnabled ? <MonitorX size={20} /> : <MonitorUp size={20} />}
            <span>{isScreenShareEnabled ? "Stop" : "Share"}</span>
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
          <Button className={`meet-control${more ? " is-active" : ""}`} aria-expanded={more} aria-label="More options" onClick={() => setMore(!more)}>
            <MoreHorizontal size={20} />
            <span>More</span>
          </Button>
          {more && (
            <div className="meet-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => (setLayout(layout === "gallery" ? "speaker" : "gallery"), setMore(false))}>
                <LayoutGrid size={16} aria-hidden="true" /> {layout === "gallery" ? "Speaker view" : "Gallery view"}
              </button>
              <div className="meet-menu-devices">
                <DeviceSelect
                  kind="audioinput"
                  devices={mics.devices}
                  value={mics.activeDeviceId}
                  onChange={(id) => void run("microphone", () => mics.setActiveMediaDevice(id))}
                />
                <DeviceSelect
                  kind="videoinput"
                  devices={cameras.devices}
                  value={cameras.activeDeviceId}
                  onChange={(id) => void run("camera", () => cameras.setActiveMediaDevice(id))}
                />
              </div>
              {moderator &&
                (session.canRecord || recording ? (
                  <button type="button" role="menuitem" onClick={() => (setMore(false), setConfirm("record"))}>
                    <Circle size={16} aria-hidden="true" /> {recording ? "Stop recording" : "Record meeting"}
                  </button>
                ) : (
                  // Plainly unavailable until cloud recording storage is set up.
                  <button type="button" role="menuitem" disabled aria-disabled="true" title="Cloud recording isn't set up for this workspace.">
                    <Circle size={16} aria-hidden="true" /> Recording isn&apos;t set up
                  </button>
                ))}
              {moderator && (
                <button type="button" role="menuitem" className="is-danger" onClick={() => (setMore(false), setConfirm("end"))}>
                  <Square size={16} aria-hidden="true" /> End meeting for everyone
                </button>
              )}
            </div>
          )}
        </div>
        <Button className="meet-control meet-leave" aria-label="Leave meeting" onClick={() => void room.disconnect()}>
          <PhoneOff size={20} />
          <span>Leave</span>
        </Button>
      </nav>

      <DialogPresence>
        {confirm === "end" && (
          <Dialog title="End the meeting for everyone?" onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact meet-dialog">
            <p>Everyone, including guests, will be disconnected. The meeting's history and report are kept.</p>
            <DialogActions
              cancel="Keep meeting"
              onCancel={() => setConfirm(null)}
              primary={{ label: "End for everyone", pendingLabel: "Ending…", tone: "danger", pending: busy, onClick: () => void hostCall(() => endMeetingForAll(session.meetingId), "Couldn't end the meeting.") }}
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

function Tile({ trackRef, meId, featured = false }: { trackRef: TrackReferenceOrPlaceholder; meId: string; featured?: boolean }) {
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const camMuted = useIsMuted(trackRef);
  const screen = trackRef.source === Track.Source.ScreenShare;
  const showVideo = isTrackReference(trackRef) && !camMuted;
  const name = p.identity === meId ? "You" : p.name || "Guest";
  const meta = metaOf(p);
  return (
    <figure className={`meet-tile${speaking && !screen ? " is-speaking" : ""}${featured ? " is-featured" : ""}${screen ? " is-screen" : ""}`}>
      {showVideo ? (
        <VideoTrack trackRef={trackRef} className={p.isLocal && !screen ? "is-mirrored" : undefined} />
      ) : (
        <div className="meet-tile-avatar">
          <Avatar name={p.name || "Guest"} size={featured ? 96 : 64} />
        </div>
      )}
      <figcaption>
        {!screen && micMuted && <MicOff size={13} aria-label="Muted" />}
        {meta.host && !screen && <Crown size={12} aria-label="Organiser" />}
        <span>{screen ? `${name === "You" ? "Your" : `${name}'s`} screen` : name}</span>
      </figcaption>
    </figure>
  );
}

function PersonRow({ p, meId, canModerate, meetingId, onError }: { p: Participant; meId: string; canModerate: boolean; meetingId: string; onError: (s: string) => void }) {
  const speaking = useIsSpeaking(p);
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const micOn = !!mic && !mic.isMuted;
  const camOn = p.isCameraEnabled;
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
