"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, MediaDeviceFailure, Track, type Participant } from "livekit-client";
import {
  LayoutGrid,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreHorizontal,
  MessageSquare,
  PhoneOff,
  RefreshCw,
  SwitchCamera,
  Users,
  Video,
  VideoOff,
  X,
  Crown,
  UserMinus,
  Square,
} from "lucide-react";
import { Button } from "../ui/controls";
import { Avatar } from "../avatar";
import { CollabRequestError, useCollabEvents } from "@/lib/collab-client";
import { closeMeeting, endMeetingForAll, enterRoom, hostAction, reportLeft, requestJoin, type JoinChoices } from "@/lib/meeting-client";
import { durationLabel, type JoinGrant } from "@/lib/meetings";
import MeetingChat from "./meeting-chat";

/**
 * The meeting itself. The provider (LiveKit) carries audio, video and
 * screens; this is the Enercore interface around it: stage and grid,
 * controls, participants, the conversation's chat, host controls (via the
 * server) and every failure state in plain words.
 *
 * Full-viewport: the CRM sidebar and header are covered while in a call;
 * leaving returns to the exact page underneath.
 */

type Ending = { title: string; detail: string; rejoin?: boolean };

const isHost = (p: Participant) => {
  try {
    return !!JSON.parse(p.metadata || "{}").host;
  } catch {
    return false;
  }
};

export default function MeetingRoom({ meetingId, grant, choices, meId }: { meetingId: string; grant: JoinGrant; choices: JoinChoices; meId: string }) {
  const [ending, setEnding] = useState<Ending | null>(null);
  const [notice, setNotice] = useState("");
  const [rejoining, setRejoining] = useState(false);
  const meeting = grant.meeting;

  const leave = () => {
    void reportLeft(meetingId);
    closeMeeting();
  };

  // The meeting ended elsewhere, or this person lost the conversation.
  useCollabEvents(true, (event) => {
    if (event.type === "meeting.ended" && event.meeting.id === meetingId)
      setEnding({ title: "The meeting has ended", detail: "Everyone has been disconnected." });
    if (event.type === "conversation.removed" && event.conversationId === meeting.conversationId)
      setEnding({ title: "You no longer have access", detail: "You were removed from this conversation, so you have left its meeting." });
  });

  const onDisconnected = (reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) return leave();
    void reportLeft(meetingId);
    if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED)
      setEnding({ title: "The meeting has ended", detail: "Everyone has been disconnected." });
    else if (reason === DisconnectReason.PARTICIPANT_REMOVED)
      setEnding({ title: "You were removed from the meeting", detail: "The organiser removed you, or your access to this conversation changed." });
    else if (reason === DisconnectReason.DUPLICATE_IDENTITY)
      setEnding({ title: "You joined somewhere else", detail: "This meeting is now open in another tab or on another device." });
    else setEnding({ title: "Connection lost", detail: "The connection to the meeting dropped and could not be restored.", rejoin: true });
  };

  // Rejoin asks for a fresh token, which re-checks access from scratch.
  async function rejoin() {
    setRejoining(true);
    try {
      const fresh = await requestJoin(meetingId);
      setEnding(null);
      enterRoom(meetingId, fresh, choices);
    } catch (e) {
      const status = e instanceof CollabRequestError ? e.status : 0;
      setEnding({
        title: status === 404 ? "You no longer have access" : status === 410 ? "The meeting has ended" : "Couldn't rejoin",
        detail: e instanceof Error ? e.message : "Check your connection and try again.",
        rejoin: status !== 404 && status !== 410,
      });
    } finally {
      setRejoining(false);
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
            <Button className="secondary" onClick={closeMeeting}>
              Back to Enercore
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <LiveKitRoom
      key={grant.token}
      className="meet-room"
      serverUrl={grant.serverUrl}
      token={grant.token}
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
      aria-label={meeting.title}
    >
      <RoomAudioRenderer />
      <Stage meeting={grant} meId={meId} notice={notice} setNotice={setNotice} />
    </LiveKitRoom>
  );
}

/* --------------------------------------------------------------- inside */

function Stage({ meeting: grant, meId, notice, setNotice }: { meeting: JoinGrant; meId: string; notice: string; setNotice: (s: string) => void }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const meeting = grant.meeting;
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
  const [layout, setLayout] = useState<"gallery" | "speaker">("gallery");
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const cameras = useMediaDeviceSelect({ kind: "videoinput", room });
  const mics = useMediaDeviceSelect({ kind: "audioinput", room });

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

  const canShare = !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices;
  const otherSharing = !!sharer && !sharer.isLocal;
  const started = meeting.startedAt ? new Date(meeting.startedAt).getTime() : now;
  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const connecting = state === ConnectionState.Connecting;

  const switchCamera = async () => {
    const list = cameras.devices;
    if (list.length < 2) return;
    const index = list.findIndex((d) => d.deviceId === cameras.activeDeviceId);
    await run("camera", () => cameras.setActiveMediaDevice(list[(index + 1) % list.length].deviceId));
  };

  return (
    <div className={`meet-shell${panel ? " has-panel" : ""}`}>
      <header className="meet-top">
        <div className="meet-title">
          <h1>{meeting.title}</h1>
          <span>
            {durationLabel(now - started)} · {participants.length} {participants.length === 1 ? "person" : "people"}
          </span>
        </div>
        {(reconnecting || connecting) && (
          <span className="meet-status" role="status">
            {connecting ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </header>

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
            <Tile trackRef={featured} meId={meId} featured />
          </div>
        )}
        <div className={`meet-grid count-${Math.min(strip.length, 9)}${featured ? " is-strip" : ""}`}>
          {strip.map((t) => (
            <Tile key={`${t.participant.identity}-${t.source}`} trackRef={t} meId={meId} />
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
              {participants.map((p) => (
                <PersonRow key={p.identity} p={p} meId={meId} canModerate={grant.host} meetingId={meeting.id} onError={setNotice} />
              ))}
            </ul>
          ) : (
            <MeetingChat conversationId={meeting.conversationId} meId={meId} />
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
          <span>People</span>
        </Button>
        <Button
          className={`meet-control${panel === "chat" ? " is-active" : ""}`}
          aria-pressed={panel === "chat"}
          aria-label="Chat"
          onClick={() => setPanel(panel === "chat" ? null : "chat")}
        >
          <MessageSquare size={20} />
          <span>Chat</span>
        </Button>
        <div className="meet-more">
          <Button className={`meet-control${more ? " is-active" : ""}`} aria-expanded={more} aria-label="More options" onClick={() => setMore(!more)}>
            <MoreHorizontal size={20} />
            <span>More</span>
          </Button>
          {more && (
            <div className="meet-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => (setLayout(layout === "gallery" ? "speaker" : "gallery"), setMore(false))}>
                <LayoutGrid size={16} aria-hidden="true" /> {layout === "gallery" ? "Speaker view" : "Gallery view"}
              </button>
              {mics.devices.length > 0 && (
                <label className="meet-menu-select">
                  <span>Microphone</span>
                  <select value={mics.activeDeviceId} onChange={(e) => void run("microphone", () => mics.setActiveMediaDevice(e.target.value))}>
                    {mics.devices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {cameras.devices.length > 0 && (
                <label className="meet-menu-select">
                  <span>Camera</span>
                  <select value={cameras.activeDeviceId} onChange={(e) => void run("camera", () => cameras.setActiveMediaDevice(e.target.value))}>
                    {cameras.devices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {grant.host && (
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMore(false);
                    void endMeetingForAll(meeting.id).catch((e) => setNotice(e instanceof Error ? e.message : "Couldn't end the meeting."));
                  }}
                >
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
        {isHost(p) && !screen && <Crown size={12} aria-label="Organiser" />}
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
  const act = (body: Parameters<typeof hostAction>[1]) =>
    void hostAction(meetingId, body).catch((e) => onError(e instanceof Error ? e.message : "That didn't work."));
  return (
    <li className={`meet-person${speaking ? " is-speaking" : ""}`}>
      <Avatar name={p.name || "Guest"} size={32} />
      <span className="meet-person-name">
        <b>{me ? `${p.name} (you)` : p.name || "Guest"}</b>
        {isHost(p) && <small>Organiser</small>}
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
