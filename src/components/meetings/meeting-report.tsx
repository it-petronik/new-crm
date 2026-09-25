"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button } from "../ui/controls";
import { meetingReport } from "@/lib/meeting-client";
import { RELATED_NOUN, durationLabel, scopeLabel, statusLabel, type MeetingReport } from "@/lib/meetings";
import { businessStamp, businessStampShort } from "@/lib/gst";
import { downloadCsv, toCsv } from "@/lib/export";

/**
 * The meeting report: built only from what Enercore recorded — attendance
 * sessions (summed per person, so reconnecting never double-counts), who
 * was invited and who came, and the activity log. No transcript or summary
 * is invented. Download as CSV (formula-safe) or print / save as PDF.
 */

const ACTIVITY: Record<string, string> = {
  started: "Meeting started",
  ended: "Meeting ended",
  joined: "Joined",
  left: "Left",
  screen_share_started: "Started sharing their screen",
  screen_share_stopped: "Stopped sharing their screen",
  recording_started: "Recording started",
  recording_stopped: "Recording stopped",
};

const minutes = (seconds: number) => (seconds < 60 ? `${seconds} s` : durationLabel(seconds * 1000));

export default function MeetingReportView({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const [report, setReport] = useState<MeetingReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    meetingReport(meetingId)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "The report couldn't be loaded."));
  }, [meetingId]);

  const exportCsv = () => {
    if (!report) return;
    const m = report.meeting;
    const rows: unknown[][] = [
      ["Meeting", m.title],
      ["Type", scopeLabel(m)],
      ["Organiser", m.createdBy.name],
      ["Scheduled (GST)", m.scheduledAt ? businessStamp(m.scheduledAt) : ""],
      ["Started (GST)", m.startedAt ? businessStamp(m.startedAt) : ""],
      ["Ended (GST)", m.endedAt ? businessStamp(m.endedAt) : ""],
      [],
      ["Name", "Participant", "First joined (GST)", "Last left (GST)", "Connections", "Total minutes"],
      ...report.participants.map((p) => [
        p.name,
        p.kind === "guest" ? "Guest" : "Internal",
        businessStamp(p.firstJoined),
        p.lastLeft ? businessStamp(p.lastLeft) : "Still connected",
        p.sessions,
        Math.round(p.totalSeconds / 60),
      ]),
      [],
      ["Invited but did not attend"],
      ...report.absent.map((p) => [p.name, p.role]),
    ];
    const safeTitle = m.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "meeting";
    downloadCsv(`meeting-report-${safeTitle}.csv`, toCsv(rows));
  };

  const print = () => {
    const root = document.documentElement;
    root.dataset.printReport = "true";
    const done = () => {
      delete root.dataset.printReport;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };

  return (
    <section className="meet-page meet-report" aria-labelledby="meet-report-title">
      <header className="meet-page-head">
        <Button className="icon-button meet-no-print" aria-label="Back to the meeting" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        <h2 id="meet-report-title">Meeting report</h2>
        <span className="meet-report-actions meet-no-print">
          <Button className="secondary compact" disabled={!report} onClick={exportCsv}>
            <Download size={14} aria-hidden="true" /> CSV
          </Button>
          <Button className="secondary compact" disabled={!report} onClick={print}>
            <Printer size={14} aria-hidden="true" /> Print / PDF
          </Button>
        </span>
      </header>
      <div className="meet-page-body">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!report && !error && <p className="muted small">Loading the report…</p>}
        {report && <ReportBody report={report} />}
      </div>
    </section>
  );
}

function ReportBody({ report }: { report: MeetingReport }) {
  const m = report.meeting;
  const actual = m.startedAt && m.endedAt ? durationLabel(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) : null;
  return (
    <>
      <h3 className="meet-report-title">{m.title}</h3>
      <dl className="meet-facts">
        {(
          [
            ["Status", statusLabel[m.status]],
            ["Type", scopeLabel(m)],
            ["Organiser", m.createdBy.name],
            ...(m.conversationTitle ? [[m.scope === "direct" ? "With" : "Room", m.conversationTitle]] : []),
            ...(m.related ? [[`Related ${RELATED_NOUN[m.related.kind].toLowerCase()}`, m.related.title]] : []),
            ["Scheduled", m.scheduledAt ? businessStamp(m.scheduledAt) : "Started instantly"],
            ["Actual start", m.startedAt ? businessStamp(m.startedAt) : "—"],
            ["Actual end", m.endedAt ? businessStamp(m.endedAt) : m.status === "live" ? "In progress" : "—"],
            ["Duration", actual ?? "—"],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section className="meet-card" aria-labelledby="report-participants">
        <h3 id="report-participants">Participants ({report.participants.length})</h3>
        {report.participants.length ? (
          <>
            <table className="meet-report-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Participant</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Left</th>
                  <th scope="col">Attended</th>
                </tr>
              </thead>
              <tbody>
                {report.participants.map((p) => (
                  <tr key={p.identity}>
                    <td>{p.name}</td>
                    <td>{p.kind === "guest" ? "Guest" : "Internal"}</td>
                    <td>{businessStampShort(p.firstJoined)}</td>
                    <td>{p.lastLeft ? businessStampShort(p.lastLeft) : "Still connected"}</td>
                    <td>
                      {minutes(p.totalSeconds)}
                      {p.sessions > 1 ? ` · ${p.sessions} connections` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phones: the same data as cards. */}
            <ul className="meet-report-cards">
              {report.participants.map((p) => (
                <li key={p.identity}>
                  <b>{p.name}</b>
                  <small>{p.kind === "guest" ? "Guest" : "Internal"}</small>
                  <span>
                    {businessStampShort(p.firstJoined)} → {p.lastLeft ? businessStampShort(p.lastLeft) : "still connected"}
                  </span>
                  <span>
                    {minutes(p.totalSeconds)}
                    {p.sessions > 1 ? ` · ${p.sessions} connections` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="meet-card-note">Nobody joined.</p>
        )}
      </section>

      <section className="meet-card" aria-labelledby="report-invited">
        <h3 id="report-invited">Invited ({report.invited.length})</h3>
        <p className="meet-card-note">
          {report.invited.length - report.absent.length} attended · {report.absent.length} didn&apos;t
        </p>
        {report.absent.length > 0 && (
          <ul className="meet-people-list">
            {report.absent.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>
                <small>{p.role} · didn&apos;t attend</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.recordings.length > 0 && (
        <section className="meet-card" aria-labelledby="report-recordings">
          <h3 id="report-recordings">Recordings</h3>
          <ul className="meet-people-list">
            {report.recordings.map((r) => (
              <li key={r.id}>
                <b>
                  {businessStamp(r.startedAt)} → {r.stoppedAt ? businessStamp(r.stoppedAt) : "running"}
                </b>
                <small>
                  Started by {r.startedBy} · {r.status === "saved" ? "Saved" : r.status === "failed" ? "Failed" : r.status === "processing" ? "Processing" : "Recording"}
                  {r.durationSeconds ? ` · ${minutes(r.durationSeconds)}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="meet-card" aria-labelledby="report-activity">
        <h3 id="report-activity">Activity</h3>
        <ol className="meet-activity">
          {report.activity.map((a, i) => (
            <li key={i}>
              <time dateTime={a.at}>{businessStampShort(a.at)}</time>
              <span>
                {a.actorName && !["started", "ended"].includes(a.type) ? `${a.actorName} — ` : ""}
                {ACTIVITY[a.type] ?? a.type}
                {a.actorName && ["started", "ended"].includes(a.type) ? ` by ${a.actorName}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
