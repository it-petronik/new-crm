"use client";

import { useState } from "react";
import { CalendarPlus, FileText, Video } from "lucide-react";
import { Button, DialogPresence } from "../ui/controls";
import { openMeetingPage, openPrejoin, useAllMeetings } from "@/lib/meeting-client";
import { durationLabel, joinable, statusLabel, type MeetingView } from "@/lib/meetings";
import { businessStamp } from "@/lib/gst";
import MeetingForm from "./meeting-form";

/**
 * Meetings about one CRM record, inside the record's detail: schedule one,
 * start one now (a standalone meeting — never a chat room), and the upcoming
 * and past meetings with their reports.
 *
 * Lists only meetings this person may already reach; seeing the lead gives
 * no way into a private meeting about it.
 */
export default function RecordMeetings({
  record,
  meId,
  canCreate,
}: {
  record: { id: string; title: string; ownerId: string; owner: string };
  meId: string;
  canCreate: boolean;
}) {
  const { meetings, available, loaded, reload } = useAllMeetings(true, record.id);
  const [form, setForm] = useState<"now" | "schedule" | null>(null);
  const upcoming = meetings.filter((m) => m.status === "live" || m.status === "scheduled").sort((a, b) => (a.scheduledAt ?? a.startedAt ?? "").localeCompare(b.scheduledAt ?? b.startedAt ?? ""));
  const past = meetings.filter((m) => m.status === "ended" || m.status === "missed" || m.status === "cancelled").sort((a, b) => (b.startedAt ?? b.scheduledAt ?? "").localeCompare(a.startedAt ?? a.scheduledAt ?? ""));

  return (
    <section className="record-meetings" aria-labelledby={`record-meetings-${record.id}`}>
      <div className="record-meetings-head">
        <h3 id={`record-meetings-${record.id}`}>Meetings</h3>
        {canCreate && available && (
          <span className="record-meetings-actions">
            <Button className="secondary compact" onClick={() => setForm("schedule")}>
              <CalendarPlus size={14} aria-hidden="true" /> Schedule meeting
            </Button>
            <Button className="secondary compact" onClick={() => setForm("now")}>
              <Video size={14} aria-hidden="true" /> Start now
            </Button>
          </span>
        )}
      </div>
      {!loaded ? (
        <p className="muted small">Loading meetings…</p>
      ) : !meetings.length ? (
        <p className="muted small">No meetings about this yet.</p>
      ) : (
        <>
          {upcoming.length > 0 && <MeetingList title="Upcoming" items={upcoming} />}
          {past.length > 0 && <MeetingList title="Past" items={past.slice(0, 5)} />}
        </>
      )}
      <DialogPresence>
        {form && (
          <MeetingForm
            mode={{ kind: "record", record, meId, when: form }}
            onClose={() => setForm(null)}
            onDone={() => reload()}
          />
        )}
      </DialogPresence>
    </section>
  );
}

function MeetingList({ title, items }: { title: string; items: MeetingView[] }) {
  return (
    <div className="record-meetings-group">
      <h4>{title}</h4>
      <ul>
        {items.map((m) => {
          const when = m.startedAt ?? m.scheduledAt;
          const length = m.startedAt && m.endedAt ? durationLabel(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) : null;
          const past = m.status === "ended" || m.status === "missed" || m.status === "cancelled";
          return (
            <li key={m.id}>
              <span className="record-meetings-main">
                <b>{m.title}</b>
                <small>
                  {when ? businessStamp(when) : ""}
                  {length ? ` · ${length}` : ""} · {statusLabel[m.status]}
                  {past && m.attendeeCount ? ` · ${m.attendeeCount} joined` : ""}
                </small>
              </span>
              <span className="record-meetings-row-actions">
                {(m.status === "live" || (m.status === "scheduled" && joinable(m))) && (
                  <Button className="primary compact" onClick={() => openPrejoin(m.id)}>
                    Join
                  </Button>
                )}
                {past && m.status !== "cancelled" ? (
                  <Button className="secondary compact" onClick={() => openMeetingPage(m.id, "report")}>
                    <FileText size={13} aria-hidden="true" /> Report
                  </Button>
                ) : (
                  <Button className="secondary compact" onClick={() => openMeetingPage(m.id, "details")}>
                    Details
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
