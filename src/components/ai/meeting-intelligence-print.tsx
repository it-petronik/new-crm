"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MeetingReportView } from "@/lib/ai/client";
import { businessStamp, businessTime } from "@/lib/gst";
import { durationLabel, type MeetingReport } from "@/lib/meetings";

/**
 * The printable Meeting Intelligence report (browser print → PDF, A4).
 *
 * Built ONLY from what the viewer already has on screen: the meeting report
 * data and the AI report as authorised for them — nothing else is fetched.
 * The related lead appears only if the server included it for this viewer.
 * No full Meeting Chat and no internal reference ids: sources are printed as
 * readable labels ("Meeting Chat · Ahmed (Guest) · 10:33 am").
 */

export const PRINT_DISCLOSURE = "No transcript is available. This report is based on meeting details, attendance, Meeting Chat and meeting notes.";
const COMMERCIAL = new Set(["incoterm", "paymentTerms", "targetPrice", "deliveryTimeline"]);

type Report = NonNullable<MeetingReportView["report"]>;

function sourceLabels(refs: string[], report: Report) {
  const labels = [...new Set(refs.map((r) => report.sources[r]?.label).filter((l): l is string => !!l))];
  return labels.length ? <span className="intel-print-source">Source: {labels.join("; ")}</span> : null;
}

function List({ title, items, report }: { title: string; items: { text: string; refs: string[] }[]; report: Report }) {
  return (
    <section className="intel-print-section">
      <h2>{title}</h2>
      {items.length ? (
        <ul>
          {items.map((i, n) => (
            <li key={n}>
              {i.text} {sourceLabels(i.refs, report)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="intel-print-none">None recorded.</p>
      )}
    </section>
  );
}

function Requirements({ title, rows, report }: { title: string; rows: Report["requirements"]; report: Report }) {
  return (
    <section className="intel-print-section">
      <h2>{title}</h2>
      {rows.length ? (
        <table className="intel-print-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Value</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={n}>
                <td>{r.label}</td>
                <td>{r.value}</td>
                <td>{r.statusLabel}</td>
                <td>{report.sources[r.ref]?.label ?? r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="intel-print-none">None recorded.</p>
      )}
    </section>
  );
}

export function MeetingIntelligencePrint({ meeting, view }: { meeting: MeetingReport; view: MeetingReportView }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.className = "intel-print-root";
    document.body.appendChild(el);
    setHost(el);
    return () => el.remove();
  }, []);
  const report = view.report;
  if (!host || !report) return null;
  const m = meeting.meeting;
  const started = m.startedAt ? new Date(m.startedAt) : null;
  const ended = m.endedAt ? new Date(m.endedAt) : null;
  const requirements = report.requirements.filter((r) => !COMMERCIAL.has(r.field));
  const commercial = report.requirements.filter((r) => COMMERCIAL.has(r.field));

  return createPortal(
    <article className="intel-print" aria-hidden="true">
      <header className="intel-print-head">
        <span className="intel-print-brand">ENERCORE</span>
        <h1>Meeting Intelligence Report</h1>
        <p className="intel-print-title">{m.title}</p>
      </header>

      <section className="intel-print-section">
        <dl className="intel-print-facts">
          <div>
            <dt>Date</dt>
            <dd>{started ? businessStamp(started).split(",")[0] : m.scheduledAt ? businessStamp(m.scheduledAt).split(",")[0] : "—"}</dd>
          </div>
          <div>
            <dt>Time (GST)</dt>
            <dd>{started ? `${businessTime(started)}${ended ? ` – ${businessTime(ended)}` : ""}` : "—"}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{started && ended ? durationLabel(ended.getTime() - started.getTime()) : "—"}</dd>
          </div>
          <div>
            <dt>Organiser</dt>
            <dd>{m.createdBy.name}</dd>
          </div>
          {view.lead && (
            <div>
              <dt>Related lead</dt>
              <dd>{view.lead.title}</dd>
            </div>
          )}
        </dl>
      </section>

      <p className="intel-print-disclosure">
        {PRINT_DISCLOSURE}
        {report.coverage.truncated ? ` The meeting chat was long: only the most recent ${report.coverage.analysedMessages} of ${report.coverage.chatMessages} messages were analysed.` : ""}
      </p>

      <section className="intel-print-section">
        <h2>Participants / attendance</h2>
        {meeting.participants.length ? (
          <ul>
            {meeting.participants.map((p, n) => (
              <li key={n}>
                {p.name}
                {p.kind === "guest" ? " (Guest)" : ""} — {Math.max(1, Math.round(p.totalSeconds / 60))} min
              </li>
            ))}
          </ul>
        ) : (
          <p className="intel-print-none">Nobody joined.</p>
        )}
        {meeting.absent.length > 0 && <p className="intel-print-muted">Invited but did not attend: {meeting.absent.map((a) => a.name).join(", ")}</p>}
      </section>

      <section className="intel-print-section">
        <h2>Executive summary</h2>
        <p>{report.summary}</p>
        <p className="intel-print-muted">{report.edited ? `Edited by ${report.edited.by}` : "AI-generated"}</p>
      </section>

      <List title="Key discussion points" items={report.keyPoints} report={report} />
      <List title="Decisions" items={report.decisions} report={report} />

      <section className="intel-print-section">
        <h2>Action items</h2>
        {report.actionItems.length ? (
          <table className="intel-print-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {report.actionItems.map((a, n) => (
                <tr key={n}>
                  <td>{a.task}</td>
                  <td>{a.owner ?? "Not named"}</td>
                  <td>{a.due ?? "—"}</td>
                  <td>{[...new Set(a.refs.map((r) => report.sources[r]?.label).filter(Boolean))].join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="intel-print-none">None recorded.</p>
        )}
      </section>

      <Requirements title="Customer requirements" rows={requirements} report={report} />
      <Requirements title="Commercial information" rows={commercial} report={report} />
      {report.conflicts.length > 0 && (
        <section className="intel-print-section">
          <h2>Changed during the meeting</h2>
          <ul>
            {report.conflicts.map((c) => (
              <li key={c.field}>
                {c.label}: {c.mentions.map((m) => `${m.value} (${m.statusLabel}, ${report.sources[m.ref]?.label ?? m.source})`).join(" → ")}. Latest: {c.latest.value} — to be reviewed before any CRM update.
              </li>
            ))}
          </ul>
        </section>
      )}

      <List title="Open questions" items={report.openQuestions} report={report} />
      <List title="Next steps" items={report.nextSteps} report={report} />

      <footer className="intel-print-foot">
        Generated {businessStamp(report.generatedAt)} GST by {report.generatedBy} · version {report.version} · {report.edited ? `summary edited by ${report.edited.by}` : "AI-generated"}. Customer requests are not Enercore commitments unless marked agreed or confirmed.
      </footer>
    </article>,
    host,
  );
}
