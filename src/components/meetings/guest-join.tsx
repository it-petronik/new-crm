"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clock, ShieldCheck } from "lucide-react";
import { Button } from "../ui/controls";
import { businessStamp } from "@/lib/gst";
import { GUEST_NAME_MAX, type GuestGrant, type GuestMeetingInfo, type RoomSession } from "@/lib/meetings";
import type { JoinChoices } from "@/lib/meeting-client";
import { DeviceChoices, DevicePreview, useDeviceSetup } from "./device-setup";

const MeetingRoom = dynamic(() => import("./meeting-room"), { ssr: false });

/**
 * The guest experience: name, camera and microphone, Join — then, if the
 * host admits guests, a waiting screen until they do. A guest only ever
 * talks to /api/meet/* with the link token and then their own secret; no
 * CRM session exists, and nothing about the organisation is shown beyond
 * this meeting's title, time and organiser's first name.
 */

type Phase =
  | { at: "loading" }
  | { at: "invalid"; message: string }
  | { at: "setup" }
  | { at: "not_started"; scheduledAt: string | null }
  | { at: "waiting" }
  | { at: "declined" }
  | { at: "room"; session: RoomSession; choices: JoinChoices }
  | { at: "left"; ended: boolean };

async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const response = await fetch(`/api/meet/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, status: response.status, data };
}

const toSession = (grant: GuestGrant): RoomSession => ({
  meetingId: "",
  conversationId: null,
  title: grant.title,
  startedAt: null,
  serverUrl: grant.serverUrl,
  token: grant.token,
  identity: grant.identity,
  host: false,
  guest: true,
});

export default function GuestJoin({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [info, setInfo] = useState<GuestMeetingInfo | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const secret = useRef<string | null>(null);
  const choices = useRef<JoinChoices>({ audio: true, video: true });
  const setup = useDeviceSetup({ audio: true, video: true }, phase.at === "setup" || phase.at === "not_started" || phase.at === "waiting");

  // The dark meeting surface, and dialogs above it.
  useEffect(() => {
    document.documentElement.dataset.meeting = "guest";
    return () => void delete document.documentElement.dataset.meeting;
  }, []);

  useEffect(() => {
    void post<GuestMeetingInfo>("lookup", { token }).then(({ ok, data }) => {
      if (!ok) return setPhase({ at: "invalid", message: data.error ?? "This meeting link isn't valid." });
      setInfo(data);
      setPhase({ at: "setup" });
    });
  }, [token]);

  const enter = useCallback(
    (grant: GuestGrant) => {
      setup.release();
      setPhase({ at: "room", session: toSession(grant), choices: choices.current });
    },
    [setup],
  );
  // The device preview re-renders many times a second (the mic level), and
  // `setup` with it: the waiting poll must not restart on every render, or
  // its interval never fires. It reads the latest `enter` through a ref.
  const enterRef = useRef(enter);
  useEffect(() => {
    enterRef.current = enter;
  }, [enter]);

  async function join() {
    const clean = name.trim();
    if (!clean) return setError("Enter your name so others know who you are.");
    setBusy(true);
    setError("");
    choices.current = { audio: setup.audio, video: setup.video, audioDeviceId: setup.micId || undefined, videoDeviceId: setup.camId || undefined };
    const { ok, data } = await post<{ state: string; secret?: string; grant?: GuestGrant; scheduledAt?: string | null }>("join", { token, name: clean });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Couldn't join. Try again.");
    if (data.secret) secret.current = data.secret;
    if (data.state === "not_started") return setPhase({ at: "not_started", scheduledAt: data.scheduledAt ?? null });
    if (data.state === "waiting") return setPhase({ at: "waiting" });
    if (data.state === "admitted" && data.grant) enter(data.grant);
  }

  // Waiting for the host: ask for this guest's own status every few seconds.
  useEffect(() => {
    if (phase.at !== "waiting") return;
    const t = setInterval(async () => {
      if (!secret.current) return;
      const { ok, data } = await post<{ state: string; grant?: GuestGrant }>("status", { secret: secret.current });
      if (!ok) return setPhase({ at: "invalid", message: data.error ?? "This meeting link isn't valid anymore." });
      if (data.state === "admitted" && data.grant) enterRef.current(data.grant);
      else if (data.state === "declined") setPhase({ at: "declined" });
      else if (data.state === "ended") setPhase({ at: "left", ended: true });
    }, 3000);
    return () => clearInterval(t);
  }, [phase.at]);

  // Not started yet: try again every 15 seconds, joining as soon as it opens.
  useEffect(() => {
    if (phase.at !== "not_started") return;
    const t = setInterval(() => void join(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.at]);

  const leave = (ended = false) => {
    if (secret.current) void post("leave", { secret: secret.current });
    setPhase({ at: "left", ended });
  };

  if (phase.at === "room")
    return (
      <MeetingRoom
        session={phase.session}
        choices={phase.choices}
        closeLabel="Close"
        onLeave={() => leave(false)}
        onRejoin={async () => {
          if (!secret.current) return { error: "Open the meeting link again to rejoin.", final: true };
          const { ok, data } = await post<{ state: string; grant?: GuestGrant }>("status", { secret: secret.current });
          if (ok && data.state === "admitted" && data.grant) return toSession(data.grant);
          return { error: data.state === "ended" ? "The meeting has ended." : (data.error ?? "You can't rejoin this meeting."), final: true };
        }}
      />
    );

  return (
    <div className="meet-prejoin meet-guest" role="main">
      <header className="meet-prejoin-head">
        <div>
          <p className="meet-guest-brand">Enercore Meeting</p>
          <h1>{info?.title ?? "Meeting"}</h1>
          {info && (
            <p>
              Organised by {info.organiser}
              {info.scheduledAt ? ` · ${businessStamp(info.scheduledAt)}` : ""}
            </p>
          )}
        </div>
      </header>

      {phase.at === "loading" && <p className="meet-guest-state">Checking your link…</p>}
      {phase.at === "invalid" && (
        <div className="meet-guest-state" role="alert">
          <h2>This link can&apos;t be used</h2>
          <p>{phase.message}</p>
        </div>
      )}
      {phase.at === "declined" && (
        <div className="meet-guest-state" role="alert">
          <h2>The host didn&apos;t let you in</h2>
          <p>If you think this is a mistake, contact the person who invited you.</p>
        </div>
      )}
      {phase.at === "left" && (
        <div className="meet-guest-state" role="status">
          <h2>{phase.ended ? "The meeting has ended" : "You left the meeting"}</h2>
          <p>You can close this page.</p>
        </div>
      )}
      {(phase.at === "setup" || phase.at === "not_started" || phase.at === "waiting") && (
        <div className="meet-prejoin-body">
          <DevicePreview setup={setup} voice={false} />
          <div className="meet-prejoin-side">
            {phase.at === "waiting" ? (
              <div className="meet-guest-wait" role="status" aria-live="polite">
                <Clock size={22} aria-hidden="true" />
                <p>
                  <b>Waiting for the host to let you in.</b>
                  <br />
                  Keep this page open.
                </p>
                <Button className="secondary" onClick={() => leave(false)}>
                  Leave
                </Button>
              </div>
            ) : phase.at === "not_started" ? (
              <div className="meet-guest-wait" role="status" aria-live="polite">
                <Clock size={22} aria-hidden="true" />
                <p>
                  <b>The meeting hasn&apos;t started yet.</b>
                  <br />
                  {phase.scheduledAt ? `It's scheduled for ${businessStamp(phase.scheduledAt)}. ` : ""}This page will let you in when it starts.
                </p>
              </div>
            ) : (
              <>
                <label className="ui-field meet-guest-name">
                  <span className="ui-field-label">Your name</span>
                  <input
                    className="ui-input"
                    value={name}
                    maxLength={GUEST_NAME_MAX}
                    autoComplete="name"
                    autoFocus
                    onChange={(e) => (setName(e.target.value), setError(""))}
                    onKeyDown={(e) => e.key === "Enter" && void join()}
                  />
                </label>
                <DeviceChoices setup={setup} />
                {error && <p className="meet-notice" role="alert">{error}</p>}
                <Button className="primary meet-join" disabled={busy} onClick={() => void join()}>
                  {busy ? "Joining…" : "Join meeting"}
                </Button>
                <p className="meet-fineprint">
                  <ShieldCheck size={13} aria-hidden="true" /> You join this meeting only. {info?.admission === "admit" ? "The host lets guests in." : ""}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
