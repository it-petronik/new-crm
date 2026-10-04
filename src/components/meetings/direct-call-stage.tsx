"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useConnectionState, useIsRecording, useMediaDeviceSelect, useParticipants, useRoomContext, useRoomInfo, useTracks } from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { Circle, LoaderCircle, Mic, MicOff, Phone, PhoneOff, Settings2, ShieldCheck, Square, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { Avatar } from "../avatar";
import { Button, Dialog, DialogActions } from "../ui/controls";
import { callDuration, type RoomSession } from "@/lib/meetings";
import { endMeetingForAll, recordingAction, type JoinChoices } from "@/lib/meeting-client";
import { useLocalMedia } from "./use-local-media";
import { MediaTile } from "./media-tile";
import { DeviceSelect } from "./device-setup";
import { CALL_RING_MS } from "@/lib/call-audio";
import { useCallTone } from "./use-call-tone";
import styles from "./direct-call.module.css";

/** A generous hit target, with a separate circular surface and readable label. */
function CallControl({ icon, label, className = "", ...props }: Omit<ComponentProps<typeof Button>, "children"> & { icon: ReactNode; label: string }) {
  return <Button type="button" className={`${styles.control} ${className}`} {...props}><span className={styles.controlIcon} aria-hidden="true">{icon}</span><span className={styles.controlLabel}>{label}</span></Button>;
}

/** The same permission-checked media transport, without meeting chrome. */
export default function DirectCallStage({ session, choices, notice, onEnded }: { session: RoomSession; choices: JoinChoices; notice: string; onEnded: () => void }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const people = useParticipants();
  const peer = people.find(p => !p.isLocal);
  const media = useLocalMedia({ guest: false, media: choices.media, wantAudio: choices.audio, wantVideo: choices.video });
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const remote = tracks.find(t => !t.participant.isLocal);
  const local = tracks.find(t => t.participant.isLocal);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [settings, setSettings] = useState(false);
  const [recordDialog, setRecordDialog] = useState<"start" | "stop" | "unavailable" | null>(null);
  const [consent, setConsent] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [recordNotice, setRecordNotice] = useState("");
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState("");
  const info = useRoomInfo();
  const providerRecording = useIsRecording();
  let recordingBy: string | null = null;
  try {
    const by = JSON.parse(info.metadata || "{}").recording?.by;
    if (typeof by === "string" && by.trim()) recordingBy = by;
  } catch { /* Provider metadata can also contain unrelated information. */ }
  // Provider state, not a local toggle: everyone sees the same notice.
  const recording = providerRecording || !!recordingBy;
  const sawRecording = useRef(false);
  useEffect(() => {
    if (recording) { sawRecording.current = true; setRecordNotice(""); }
    else if (sawRecording.current) { sawRecording.current = false; setRecordNotice("Recording stopped. The file will appear in the call details when processing finishes."); }
  }, [recording]);
  const mics = useMediaDeviceSelect({ kind: "audioinput" });
  const cameras = useMediaDeviceSelect({ kind: "videoinput" });
  const hadPeer = useRef(false);
  const [ringUntil] = useState(() => (session.startedAt ? Date.parse(session.startedAt) : Date.now()) + CALL_RING_MS);
  const [ringMuted, setRingMuted] = useState(false);
  const waiting = !!session.outgoingCall && !peer && !hadPeer.current && !ending && state === ConnectionState.Connected;
  const tone = useCallTone(waiting && !ringMuted ? "outgoing" : null, ringUntil);
  const end = useRef(onEnded); end.current = onEnded;
  useEffect(() => {
    if (peer) { hadPeer.current = true; setStarted(t => t ?? Date.now()); }
  }, [peer]);
  useEffect(() => {
    const left = () => { if (hadPeer.current && room.remoteParticipants.size === 0) end.current(); };
    room.on(RoomEvent.ParticipantDisconnected, left);
    return () => { room.off(RoomEvent.ParticipantDisconnected, left); };
  }, [room]);
  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [started]);
  const video = media.cameraOn || !!peer?.isCameraEnabled;
  const name = peer?.name || session.callName || session.title;
  const status = state === ConnectionState.Reconnecting ? "Reconnecting…" : state !== ConnectionState.Connected ? "Connecting…" : peer ? callDuration(elapsed) : `Waiting for ${name}…`;
  const problem = media.issue?.message || media.notice || notice;

  function openRecording() {
    setConsent(false); setRecordError("");
    setRecordDialog(!session.host || (!session.canRecord && !recording) ? "unavailable" : recording ? "stop" : "start");
  }
  async function changeRecording() {
    if (recordBusy || (recordDialog !== "start" && recordDialog !== "stop") || (recordDialog === "start" && (!consent || !peer))) return;
    setRecordBusy(true); setRecordError("");
    try {
      await recordingAction(session.meetingId, recordDialog);
      setRecordDialog(null);
      setRecordNotice(recordDialog === "stop" ? "Recording is stopping. The file will appear in the call details when processing finishes." : "Recording requested. Waiting for confirmation from the call service…");
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "The recording couldn't be changed. Please try again.");
    } finally { setRecordBusy(false); }
  }
  async function hangUp() {
    if (ending) return;
    setEnding(true); setEndError("");
    try {
      // Either person can end a direct call. This also finalises an active
      // recording instead of leaving the provider room recording unattended.
      await endMeetingForAll(session.meetingId);
      onEnded();
    } catch {
      setEndError("Couldn't close the call for everyone. Try End call again, or leave on this device.");
      setEnding(false);
    }
  }
  return <div className={styles.call} data-call-layout="direct" data-ringback={tone.state}>
    <header className={styles.head}><span><Phone size={15} />Private {video ? "video" : "voice"} call</span><span role="status">{status}</span></header>
    <div className={styles.stage}>
      {video && remote ? <div className={styles.remote}><MediaTile trackRef={remote} meId={session.identity} featured onBlocked={() => void media.unlockPlayback()} /></div> : <div className={styles.identity}><Avatar name={name} size={96}/><h1>{name}</h1><p>{peer ? "Connected" : "They can join from your conversation."}</p></div>}
      {video && local && <div className={styles.self}><MediaTile trackRef={local} meId={session.identity} starting={media.pending.camera === "on"} /></div>}
    </div>
    <div className={styles.bottom}>
      {problem && <p className={styles.notice} role="alert">{problem}</p>}
      {waiting && tone.state === "blocked" && <Button variant="secondary" size="small" onClick={tone.enable}><Volume2 size={15}/>Enable ringing sound</Button>}
      {waiting && tone.state === "playing" && <Button variant="ghost" size="small" onClick={() => setRingMuted(true)}><VolumeX size={15}/>Silence ringback</Button>}
      {waiting && tone.state === "unavailable" && <p className={styles.notice}>Ringing audio isn’t available in this browser. The call invitation is still active.</p>}
      {!media.canPlayAudio && <Button className="secondary" onClick={() => void media.unlockPlayback()}><Volume2 size={16}/>Tap to hear the call</Button>}
      {(media.unstable || media.silent) && <p className={styles.notice}>{media.unstable ? "Weak connection. Video may pause to protect audio." : "No microphone sound detected. Check your selected microphone."}</p>}
      <div className={styles.recordStatus} role="status" aria-live="polite" aria-atomic="true">
        {recording ? <span className={styles.recordBadge}><span className={styles.recordDot}/><span>Recording{recordingBy ? ` · Started by ${recordingBy}` : " · Everyone can see this notice"}</span></span> : recordNotice ? <span>{recordNotice}</span> : <span><ShieldCheck size={14}/>Only people in this conversation can join</span>}
      </div>
      {endError && <div className={styles.notice} role="alert"><p>{endError}</p><Button variant="secondary" onClick={() => void room.disconnect()}>Leave on this device</Button></div>}
      {settings && <div className={styles.settings}>
        <DeviceSelect kind="audioinput" devices={mics.devices} value={mics.activeDeviceId} onChange={id => void media.setDevice("audioinput", id)} label="Call microphone" />
        <DeviceSelect kind="videoinput" devices={cameras.devices} value={cameras.activeDeviceId} onChange={id => void media.setDevice("videoinput", id)} label="Call camera" />
      </div>}
      <div className={styles.controls} role="group" aria-label="Call controls">
        <CallControl aria-label={media.microphoneOn ? "Turn microphone off" : "Turn microphone on"} aria-pressed={media.microphoneOn} disabled={!!media.pending.microphone} onClick={() => void media.setMicrophone(!media.microphoneOn)} icon={media.microphoneOn ? <Mic/> : <MicOff/>} label={media.microphoneOn ? "Mute" : "Unmute"}/>
        <CallControl aria-label={media.cameraOn ? "Turn camera off" : "Turn camera on"} aria-pressed={media.cameraOn} disabled={!!media.pending.camera} onClick={() => void media.setCamera(!media.cameraOn)} icon={media.cameraOn ? <Video/> : <VideoOff/>} label="Camera"/>
        <CallControl className={styles.recordControl} aria-label={recording ? "Stop call recording" : "Record call"} data-recording={recording} disabled={recordBusy || ending} onClick={openRecording} icon={recording ? <Square size={20} fill="currentColor"/> : <Circle/>} label={recording ? "Stop recording" : "Record"}/>
        <CallControl className={styles.deviceControl} aria-label="Call settings" aria-expanded={settings} onClick={() => setSettings(v => !v)} icon={<Settings2/>} label="Devices"/>
        <CallControl className={styles.hangup} aria-label="End call" disabled={ending} onClick={() => void hangUp()} icon={ending ? <LoaderCircle className="ui-spinner"/> : <PhoneOff/>} label={ending ? "Ending…" : "End call"}/>
      </div>
    </div>
    {recordDialog && <Dialog title={recordDialog === "unavailable" ? "Call recording" : recordDialog === "stop" ? "Stop recording?" : "Record this call?"} onClose={() => !recordBusy && setRecordDialog(null)} dismissOnOutside={!recordBusy} className={`dialog-compact meet-dialog ${styles.recordDialog}`}>
      <div className={styles.recordExplanation}>
        <span className={styles.recordIllustration} aria-hidden="true"><Circle size={24}/></span>
        {recordDialog === "unavailable" ? <><h3>{session.host ? "Recording needs setup" : "Recording is managed by the call organiser"}</h3><p>{session.host ? "Your administrator needs to connect the recording service and private storage before you can record. This call is not being recorded by Enercore." : "Ask the organiser to start or stop recording. Everyone will see a notice while recording is active."}</p></> : <><h3>{recordDialog === "stop" ? "Keep talking after you stop" : "Let the other person know first"}</h3><p>{recordDialog === "stop" ? "Your call will continue. Once processed, the recording will be available from the call details to people with access." : "Audio and any shared camera video are captured. Both people will see who started recording. The file is stored privately with the call details."}</p></>}
      </div>
      {recordDialog === "start" && <><label className={styles.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={recordBusy}/><span>I’ve told the other person and they agree to be recorded.</span></label>{!peer && <p className={styles.notice}>Wait for the other person to join before recording.</p>}</>}
      {recordError && <p className={styles.notice} role="alert">{recordError}</p>}
      <DialogActions pending={recordBusy} primary={recordDialog === "unavailable" ? undefined : { label: recordDialog === "stop" ? "Stop recording" : "Start recording", pendingLabel: recordDialog === "stop" ? "Stopping…" : "Starting…", pending: recordBusy, disabled: recordDialog === "start" && (!consent || !peer || state !== ConnectionState.Connected), onClick: () => void changeRecording() }}/>
    </Dialog>}
  </div>;
}
