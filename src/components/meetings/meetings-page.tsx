"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, Circle, Link2, Phone, Plus, Users, Video } from "lucide-react";
import { Button, DialogPresence } from "../ui/controls";
import { openPrejoin, useAllMeetings } from "@/lib/meeting-client";
import { durationLabel, joinable, scopeLabel, statusLabel, type MeetingView } from "@/lib/meetings";
import { businessDate, businessTime, businessToday } from "@/lib/gst";
import MeetingForm from "./meeting-form";
import MeetingDetailsView from "./meeting-details";
import MeetingReportView from "./meeting-report";
import { CopyMeetingLink } from "./meeting-link";

/**
 * Collaboration → Meetings: every meeting this person may see — their
 * rooms' and DMs' meetings and the standalone meetings they organise or were
 * invited to — in four plain groups: In progress, Today, Upcoming, Past.
 * Not a calendar; one list, grouped. Details and the report open in place.
 */

type Pane = { view: "list" } | { view: "details"; id: string } | { view: "report"; id: string };

export default function MeetingsPage({
  meId,
  initialDetails,
  initialReport = false,
  onBack,
}: {
  meId: string;
  initialDetails?: string | null;
  initialReport?: boolean;
  onBack: () => void;
}) {
  const { meetings, available, loaded, error, reload } = useAllMeetings();
  const [pane, setPane] = useState<Pane>(
    initialDetails ? { view: initialReport ? "report" : "details", id: initialDetails } : { view: "list" },
  );
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onDetails = (e: Event) => {
      const { meetingId, view } = (e as CustomEvent<{ meetingId: string; view?: "details" | "report" }>).detail;
      setPane({ view: view === "report" ? "report" : "details", id: meetingId });
    };
    window.addEventListener("enercore:meeting-details", onDetails);
    return () => window.removeEventListener("enercore:meeting-details", onDetails);
  }, []);

  if (pane.view === "details")
    return <MeetingDetailsView meetingId={pane.id} meId={meId} onBack={() => (setPane({ view: "list" }), reload())} onReport={() => setPane({ view: "report", id: pane.id })} />;
  if (pane.view === "report") return <MeetingReportView meetingId={pane.id} onBack={() => setPane({ view: "details", id: pane.id })} />;

  const today = businessToday(new Date(now));
  const dayOf = (m: MeetingView) => (m.scheduledAt ? businessToday(new Date(m.scheduledAt)) : null);
  const at = (m: MeetingView) => new Date(m.scheduledAt ?? m.startedAt ?? m.endedAt ?? 0).getTime();
  const live = meetings.filter((m) => m.status === "live");
  const upcoming = meetings.filter((m) => m.status === "scheduled").sort((a, b) => at(a) - at(b));
  const past = meetings.filter((m) => m.status === "ended" || m.status === "cancelled" || m.status === "missed").sort((a, b) => at(b) - at(a));
  const sections: [string, MeetingView[]][] = [
    ["In progress", live],
    ["Today", upcoming.filter((m) => dayOf(m) === today)],
    ["Upcoming", upcoming.filter((m) => dayOf(m) !== today)],
    ["Past", past],
  ];

  const copied = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  return (
    <section className="meet-page" aria-labelledby="meet-page-title">
      <header className="meet-page-head">
        <Button className="icon-button collab-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        <h2 id="meet-page-title">Meetings</h2>
        <Button className="primary compact" onClick={() => setCreating(true)} disabled={!available && loaded}>
          <Plus size={15} aria-hidden="true" /> New meeting
        </Button>
      </header>
      {loaded && !available && <p className="meet-page-note">Meetings aren&apos;t set up yet. Ask your administrator.</p>}
      {error && <p className="form-error" role="alert">Meetings couldn&apos;t be loaded.</p>}
      {toast && (
        <p className="meet-page-toast" role="status">
          {toast}
        </p>
      )}
      <div className="meet-page-body">
        {!loaded ? (
          <p className="muted small">Loading meetings…</p>
        ) : !meetings.length ? (
          <div className="collab-empty">
            <CalendarClock size={26} aria-hidden="true" />
            <p className="collab-empty-title">No meetings yet.</p>
            <p>Start or schedule one — with a room, a colleague, or anyone you invite.</p>
          </div>
        ) : (
          sections
            .filter(([, list]) => list.length)
            .map(([title, list]) => (
              <div className="meet-group" key={title}>
                <h3 className="meet-group-title">{title}</h3>
                <ul className="meet-rows">
                  {list.map((m) => (
                    <MeetingRow
                      key={m.id}
                      m={m}
                      now={now}
                      onJoin={() => openPrejoin(m.id)}
                      onDetails={() => setPane({ view: "details", id: m.id })}
                      onReport={() => setPane({ view: "report", id: m.id })}
                      onCopied={copied}
                    />
                  ))}
                </ul>
              </div>
            ))
        )}
      </div>
      <DialogPresence>{creating && <MeetingForm mode={{ kind: "standalone" }} onClose={() => setCreating(false)} onDone={() => reload()} />}</DialogPresence>
    </section>
  );
}

function MeetingRow({
  m,
  now,
  onJoin,
  onDetails,
  onReport,
  onCopied,
}: {
  m: MeetingView;
  now: number;
  onJoin: () => void;
  onDetails: () => void;
  onReport: () => void;
  onCopied: (message: string) => void;
}) {
  const start = m.startedAt ?? m.scheduledAt;
  const length =
    m.startedAt && m.endedAt
      ? durationLabel(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime())
      : m.status === "live" && m.startedAt
        ? durationLabel(now - new Date(m.startedAt).getTime())
        : m.durationMin
          ? durationLabel(m.durationMin * 60_000)
          : null;
  const Icon = m.media === "voice" ? Phone : Video;
  const past = m.status === "ended" || m.status === "cancelled" || m.status === "missed";
  return (
    <li className={`meet-row is-${m.status}`}>
      <span className="meet-row-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <button type="button" className="meet-row-main" onClick={onDetails}>
        <b>
          {m.title}
          {m.recording.active && (
            <span className="meet-rec-pill">
              <Circle size={8} fill="currentColor" aria-hidden="true" /> Recording
            </span>
          )}
        </b>
        <span className="meet-row-meta">
          {start ? `${businessDate(new Date(start))} · ${businessTime(new Date(start))} GST` : "Not started"}
          {length ? ` · ${length}` : ""}
          {` · ${scopeLabel(m)}`}
          {m.conversationTitle ? ` · ${m.conversationTitle}` : ""}
        </span>
        <span className="meet-row-meta">
          {m.createdBy.name}
          <span className="meet-row-count">
            <Users size={12} aria-hidden="true" /> {past || m.status === "live" ? `${m.attendeeCount} joined` : `${m.inviteeCount} invited`}
          </span>
          {m.guestAccess !== "off" && (
            <span className="meet-row-count">
              <Link2 size={12} aria-hidden="true" /> Guests
            </span>
          )}
          {m.recording.available > 0 && <span className="meet-row-count">Recording saved</span>}
        </span>
      </button>
      <span className={`meet-status-pill is-${m.status}`}>{statusLabel[m.status]}</span>
      <span className="meet-row-actions">
        {(m.status === "live" || (m.status === "scheduled" && joinable(m, now))) && (
          <Button className="primary compact" onClick={onJoin}>
            {m.status === "live" ? "Join" : "Start"}
          </Button>
        )}
        {!past && (
          // The organiser shares the guest link; everyone else the internal one.
          <CopyMeetingLink meetingId={m.id} label={m.canManage && m.scope !== "direct" ? "Copy meeting link" : "Copy internal link"} onCopied={onCopied} />
        )}
        {past ? (
          <Button className="secondary compact" onClick={onReport}>
            Report
          </Button>
        ) : (
          <Button className="secondary compact" onClick={onDetails}>
            Details
          </Button>
        )}
      </span>
    </li>
  );
}
