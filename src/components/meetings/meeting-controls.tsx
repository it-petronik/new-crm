"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarPlus, ChevronDown, Phone, Video, CalendarClock, History, Info, Users, X } from "lucide-react";
import { Button, DialogPresence } from "../ui/controls";
import MeetingForm from "./meeting-form";
import type { ConversationSummary } from "@/lib/collab";
import {
  canManageMeeting,
  cancelMeeting,
  liveOf,
  openMeetingDetails,
  openPrejoin,
  startMeeting,
} from "@/lib/meeting-client";
import { durationLabel, joinable, type MeetingMedia, type MeetingView } from "@/lib/meetings";
import { businessStamp, businessTime } from "@/lib/gst";

/**
 * Meeting entry points inside Collaboration: the header's call / meeting
 * actions, the "meeting in progress" banner, the schedule dialog and the
 * Meetings section of the details panel. None of them touch a camera or
 * microphone; every path leads to the pre-join screen first.
 */

/* ------------------------------------------------------------ header */

export function MeetingActions({ conversation, meetings }: { conversation: ConversationSummary; meetings: MeetingView[] }) {
  const [menu, setMenu] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = liveOf(meetings);
  const direct = conversation.kind === "direct";

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);

  async function start(media: MeetingMedia) {
    setMenu(false);
    // One meeting at a time per conversation: join the running one.
    if (live) return openPrejoin(live.id);
    setBusy(true);
    try {
      const { meeting } = await startMeeting(conversation.id, media);
      openPrejoin(meeting.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The meeting couldn't be started.");
    } finally {
      setBusy(false);
    }
  }

  if (!conversation.canPost && !live) return null;
  return (
    <div className="meet-actions">
      {direct ? (
        <>
          <Button className="icon-button" aria-label="Voice call" title="Voice call" disabled={busy} onClick={() => void start("voice")}>
            <Phone size={17} />
          </Button>
          <Button className="icon-button" aria-label="Video call" title="Video call" disabled={busy} onClick={() => void start("video")}>
            <Video size={18} />
          </Button>
        </>
      ) : live ? (
        <Button className="primary compact meet-join-pill" onClick={() => openPrejoin(live.id)}>
          <Video size={15} aria-hidden="true" /> Join
        </Button>
      ) : (
        // A popover: closes on an outside click, Escape, or choosing an item.
        <Popover.Root open={menu} onOpenChange={setMenu}>
          <Popover.Trigger asChild>
            <Button className="secondary compact" aria-haspopup="menu" disabled={busy}>
              <Video size={15} aria-hidden="true" /> Start meeting <ChevronDown size={14} aria-hidden="true" />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="meet-start-menu" role="menu" align="end" sideOffset={6}>
              <button type="button" role="menuitem" onClick={() => void start("video")}>
                <Video size={16} aria-hidden="true" /> Video meeting
              </button>
              <button type="button" role="menuitem" onClick={() => void start("voice")}>
                <Phone size={16} aria-hidden="true" /> Voice meeting
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), setScheduling(true))}>
                <CalendarPlus size={16} aria-hidden="true" /> Schedule a meeting…
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {error && (
        <p className="meet-action-error" role="alert">
          {error}
        </p>
      )}
      <DialogPresence>
        {scheduling && <MeetingForm mode={{ kind: "room", conversation }} onClose={() => setScheduling(false)} />}
      </DialogPresence>
    </div>
  );
}

/* ------------------------------------------------------------ banner */

/** Live meeting in progress, or one about to start: one line, one Join. */
export function MeetingBanner({ meetings }: { meetings: MeetingView[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const live = liveOf(meetings);
  const soon = live ? null : meetings.find((m) => m.status === "scheduled" && joinable(m, now));
  // Otherwise the next upcoming one, so a scheduled meeting is visible in
  // its room from the moment it is scheduled, not just before it starts.
  const next = live || soon ? null : meetings
    .filter((m) => m.status === "scheduled" && m.scheduledAt && new Date(m.scheduledAt).getTime() > now)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];
  if (next)
    return (
      <div className="meet-banner is-upcoming" role="status">
        <CalendarClock size={15} aria-hidden="true" />
        <span className="meet-banner-text">
          <b>{next.title}</b> · {businessStamp(next.scheduledAt!)}
        </span>
        <Button className="secondary compact" onClick={() => openMeetingDetails(next.id)}>
          Details
        </Button>
      </div>
    );
  const m = live ?? soon;
  if (!m) return null;
  const inCall = m.participants.length;
  return (
    <div className={`meet-banner${live ? " is-live" : ""}`} role="status">
      <span className="meet-banner-dot" aria-hidden="true" />
      <span className="meet-banner-text">
        {live ? (
          <>
            <b>{m.media === "voice" ? "Voice meeting" : "Meeting"} in progress</b> · started by {m.createdBy.name}
            {m.startedAt && ` · ${durationLabel(now - new Date(m.startedAt).getTime())}`}
            {inCall > 0 && ` · ${inCall} joined`}
          </>
        ) : (
          <>
            <b>{m.title}</b> · starts {m.scheduledAt ? businessTime(new Date(m.scheduledAt)) : "soon"} GST
          </>
        )}
      </span>
      <Button className="primary compact" onClick={() => openPrejoin(m.id)}>
        Join
      </Button>
    </div>
  );
}

/* ------------------------------------------------- details: meetings */

/** Upcoming and recent meetings for the details panel. */
export function MeetingsSection({
  meetings,
  conversation,
  meId,
}: {
  meetings: MeetingView[];
  conversation: ConversationSummary;
  meId: string;
}) {
  const [error, setError] = useState("");
  const upcoming = meetings.filter((m) => m.status === "scheduled" || m.status === "live");
  const past = meetings.filter((m) => m.status === "ended" || m.status === "missed").slice(0, 5);
  if (!upcoming.length && !past.length) return null;
  return (
    <section className="collab-details-section meet-section">
      <div className="collab-details-subhead">
        <h4>Meetings</h4>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {upcoming.length > 0 && (
        <ul className="meet-list">
          {upcoming.map((m) => (
            <li key={m.id}>
              <CalendarClock size={15} aria-hidden="true" />
              <span className="meet-list-main">
                <b>{m.title}</b>
                <small>{m.status === "live" ? "In progress" : m.scheduledAt ? businessStamp(m.scheduledAt) : ""}</small>
              </span>
              {(m.status === "live" || joinable(m)) && (
                <Button className="secondary compact" onClick={() => openPrejoin(m.id)}>
                  Join
                </Button>
              )}
              <Button className="icon-button" aria-label={`Details of ${m.title}`} title="Details" onClick={() => openMeetingDetails(m.id)}>
                <Info size={15} />
              </Button>
              {m.status === "scheduled" && canManageMeeting(m, meId, conversation) && (
                <Button
                  className="icon-button"
                  aria-label={`Cancel ${m.title}`}
                  title="Cancel meeting"
                  onClick={() => void cancelMeeting(m.id).catch((e) => setError(e instanceof Error ? e.message : "Couldn't cancel."))}
                >
                  <X size={15} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <ul className="meet-list is-history" aria-label="Meeting history">
          {past.map((m) => (
            <li key={m.id}>
              <History size={15} aria-hidden="true" />
              <button type="button" className="meet-list-main meet-list-link" onClick={() => openMeetingDetails(m.id)} aria-label={`Details of ${m.title}`}>
                <b>{m.title}</b>
                <small>
                  {m.startedAt ? businessStamp(m.startedAt) : ""}
                  {m.startedAt && m.endedAt ? ` · ${durationLabel(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime())}` : ""}
                </small>
                {m.participants.length > 0 && (
                  <small className="meet-list-people">
                    <Users size={12} aria-hidden="true" /> {m.participants.map((p) => p.name).join(", ")}
                  </small>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
