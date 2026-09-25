"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, ChevronDown, Phone, Video, CalendarClock, History, Users, X } from "lucide-react";
import { Button, DatePicker, Dialog, DialogActions, DialogPresence, Field, Input, Select } from "../ui/controls";
import type { ConversationSummary } from "@/lib/collab";
import {
  canManageMeeting,
  cancelMeeting,
  liveOf,
  openPrejoin,
  scheduleMeeting,
  startMeeting,
} from "@/lib/meeting-client";
import { DURATIONS, MEETING_TITLE_MAX, durationLabel, joinable, type MeetingMedia, type MeetingView } from "@/lib/meetings";
import { businessClock, businessInstant, businessStamp, businessTime, businessToday } from "@/lib/gst";

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
        <div className="meet-start">
          <Button className="secondary compact" aria-expanded={menu} aria-haspopup="menu" disabled={busy} onClick={() => setMenu(!menu)}>
            <Video size={15} aria-hidden="true" /> Start meeting <ChevronDown size={14} aria-hidden="true" />
          </Button>
          {menu && (
            <div className="meet-start-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
              <button type="button" role="menuitem" onClick={() => void start("video")}>
                <Video size={16} aria-hidden="true" /> Video meeting
              </button>
              <button type="button" role="menuitem" onClick={() => void start("voice")}>
                <Phone size={16} aria-hidden="true" /> Voice meeting
              </button>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), setScheduling(true))}>
                <CalendarPlus size={16} aria-hidden="true" /> Schedule a meeting…
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="meet-action-error" role="alert">
          {error}
        </p>
      )}
      <DialogPresence>
        {scheduling && <ScheduleDialog conversation={conversation} onClose={() => setScheduling(false)} />}
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

/* -------------------------------------------------------- scheduling */

function ScheduleDialog({ conversation, onClose }: { conversation: ConversationSummary; onClose: () => void }) {
  const [title, setTitle] = useState(`${conversation.title} meeting`.slice(0, MEETING_TITLE_MAX));
  const [date, setDate] = useState(businessToday());
  // The next half hour, Dubai time.
  const [time, setTime] = useState(() => {
    const at = new Date(Math.ceil((Date.now() + 5 * 60_000) / (30 * 60_000)) * 30 * 60_000);
    return businessClock(at);
  });
  const [duration, setDuration] = useState("30");
  const [media, setMedia] = useState<MeetingMedia>("video");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const at = businessInstant(date, time);
    if (!title.trim()) return setError("Give the meeting a title.");
    if (!at) return setError("Choose a valid date and time.");
    if (at.getTime() < Date.now() - 60_000) return setError("Choose a time in the future.");
    setBusy(true);
    setError("");
    try {
      await scheduleMeeting(conversation.id, {
        title: title.trim(),
        media,
        scheduledAt: at.toISOString(),
        durationMin: duration ? Number(duration) : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The meeting couldn't be scheduled.");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Schedule a meeting" onClose={() => !busy && onClose()} className="dialog-compact meet-schedule-dialog">
      <form
        className="ui-form-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field>
          Title
          <Input value={title} maxLength={MEETING_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </Field>
        <div className="meet-schedule-row">
          <Field>
            Date
            <DatePicker value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field hint="Gulf Standard Time (GST)">
            Time
            <Input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        </div>
        <div className="meet-schedule-row">
          <Field>
            Duration
            <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
              {DURATIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {durationLabel(d * 60_000)}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            Type
            <Select value={media} onChange={(e) => setMedia(e.target.value as MeetingMedia)}>
              <option value="video">Video meeting</option>
              <option value="voice">Voice meeting</option>
            </Select>
          </Field>
        </div>
        <p className="small muted">
          Everyone in {conversation.kind === "direct" ? "this conversation" : "this room"} can see and join it, and will get a reminder 10 minutes before.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onClose}
          primary={{ type: "submit", label: "Schedule meeting", pendingLabel: "Scheduling…", pending: busy, icon: <CalendarPlus size={16} aria-hidden="true" /> }}
        />
      </form>
    </Dialog>
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
  const past = meetings.filter((m) => m.status === "ended").slice(0, 5);
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
              <span className="meet-list-main">
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
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
