"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText, RotateCcw, Sparkles } from "lucide-react";
import { Button, DialogPresence, Textarea } from "../ui/controls";
import { meetingIntelligence, sales, type MeetingReportView, type QuotePrepView } from "@/lib/ai/client";
import { businessTime } from "@/lib/gst";
import { AiLoading, useAiStatus } from "./ai-answer";
import { DraftDialog, QuotePrepPanel, SuggestionChecklist } from "./sales-copilot";

/**
 * AI Meeting Intelligence on the meeting report — zero-cost mode: built from
 * the written record only (meeting details, attendance, Meeting Chat, meeting
 * notes), generated only when an employee asks, stored, and shown again with
 * no AI call. Suggestions for the related lead appear only for someone who
 * may read it, and change nothing until applied.
 */

type Report = NonNullable<MeetingReportView["report"]>;

/** A source chip: jumps to the chat message or note on this page. */
function Sources({ refs, report }: { refs: string[]; report: Report }) {
  if (!refs.length) return null;
  return (
    <span className="ai-refs">
      {refs.map((r) => {
        const s = report.sources[r];
        if (!s) return null;
        const anchor = `${s.kind}-${s.id}`;
        return (
          <button
            key={r}
            type="button"
            className="ai-ref"
            title={s.label}
            onClick={() => {
              const el = document.getElementById(anchor);
              if (!el) return;
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("is-cited");
              setTimeout(() => el.classList.remove("is-cited"), 2000);
            }}
          >
            {s.kind === "note" ? "Note" : "Chat"} · {s.speaker ?? "—"}
            {s.guest ? " (Guest)" : ""}
            {s.at ? ` · ${businessTime(new Date(s.at))}` : ""}
          </button>
        );
      })}
    </span>
  );
}

function Section({ title, items, report }: { title: string; items: { text: string; refs: string[] }[]; report: Report }) {
  if (!items.length) return null;
  return (
    <div className="ai-section">
      <h4>{title}</h4>
      <ul>
        {items.map((i, n) => (
          <li key={n}>
            {i.text} <Sources refs={i.refs} report={report} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MeetingIntelligence({ meetingId }: { meetingId: string }) {
  const status = useAiStatus();
  const [view, setView] = useState<MeetingReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuotePrepView | null>(null);
  const [draftMissing, setDraftMissing] = useState(false);
  const ready = !!status?.available;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    meetingIntelligence.get(meetingId).then(
      (v) => live && setView(v),
      (e) => live && setError(e instanceof Error ? e.message : "Couldn't load the meeting report."),
    );
    return () => {
      live = false;
    };
  }, [ready, meetingId]);

  if (!ready) return null;
  const run = async (fn: () => Promise<MeetingReportView>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setView(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI meeting notes couldn't be generated.");
    } finally {
      setBusy(false);
    }
  };
  const report = view?.report ?? null;

  return (
    <section className="ai-panel copilot-panel meet-intel" aria-label="AI meeting notes">
      <header className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={15} aria-hidden="true" /> AI meeting notes
        </span>
        {report && (
          <Button className="secondary compact" disabled={busy} onClick={() => void run(() => meetingIntelligence.generate(meetingId, true))}>
            <RotateCcw size={14} aria-hidden="true" /> Regenerate
          </Button>
        )}
      </header>
      {!view && !error && <p className="muted small">Loading…</p>}
      {view && !report && (
        <div className="meet-intel-empty">
          <p className="ai-scope">No transcript is available. An AI report would use meeting details, attendance, Meeting Chat ({view.coverage.chatMessages} message{view.coverage.chatMessages === 1 ? "" : "s"}) and meeting notes ({view.coverage.notes}).</p>
          <Button className="primary" disabled={busy || !view.canGenerate} onClick={() => void run(() => meetingIntelligence.generate(meetingId))}>
            <Sparkles size={15} aria-hidden="true" /> {busy ? "Generating…" : "Generate AI report"}
          </Button>
          {!view.canGenerate && <p className="ai-fineprint">Available once the meeting has ended.</p>}
        </div>
      )}
      {busy && <AiLoading label="Reading the meeting chat and notes…" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {report && !busy && (
        <div className="ai-answer copilot-answer">
          {report.stale && (
            <p className="ai-flag" role="note">
              <AlertTriangle size={14} aria-hidden="true" /> The meeting chat or notes changed after this report was generated. Regenerate to include them.
            </p>
          )}
          <p className="ai-scope">{report.scope}</p>
          <div className="ai-section">
            <h4>
              Executive summary
              {view!.canEdit && editing === null && (
                <Button className="secondary compact" onClick={() => setEditing(report.summary)}>
                  Edit
                </Button>
              )}
            </h4>
            {editing !== null ? (
              <div className="meet-intel-edit">
                <Textarea aria-label="Executive summary" value={editing} rows={4} maxLength={3000} onChange={(e) => setEditing(e.target.value)} />
                <div className="copilot-actions">
                  <Button className="secondary compact" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button className="primary compact" disabled={busy} onClick={() => void run(() => meetingIntelligence.edit(meetingId, editing)).then(() => setEditing(null))}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="ai-summary">{report.summary}</p>
            )}
            <small className="muted">{report.edited ? `Edited by ${report.edited.by}` : "AI-generated"}</small>
          </div>
          <Section title="Key discussion points (from the written record)" items={report.keyPoints} report={report} />
          <Section title="Decisions" items={report.decisions} report={report} />
          {report.actionItems.length > 0 && (
            <div className="ai-section">
              <h4>Action items</h4>
              <ul>
                {report.actionItems.map((a, n) => (
                  <li key={n}>
                    {a.task}
                    <small className="muted">
                      {" "}
                      · Owner: {a.owner ?? "not named"}
                      {a.due ? ` · Due ${a.due}` : ""}
                    </small>{" "}
                    <Sources refs={a.refs} report={report} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.requirements.length > 0 && (
            <div className="ai-section">
              <h4>Customer requirements</h4>
              <ul>
                {report.requirements.map((r, n) => (
                  <li key={n}>
                    <b>{r.label}:</b> {r.value}{" "}
                    <span className={["Recorded in CRM", "Confirmed", "Agreed"].includes(r.statusLabel) ? "copilot-claim is-settled" : "copilot-claim is-open"}>{r.statusLabel}</span> <Sources refs={[r.ref]} report={report} />
                  </li>
                ))}
              </ul>
              {report.conflicts.map((c) => (
                <div key={c.field} className="meet-intel-conflict" role="note">
                  <b>
                    <AlertTriangle size={13} aria-hidden="true" /> {c.label} changed during the meeting
                  </b>
                  <ul>
                    {c.mentions.map((m, n) => (
                      <li key={n}>
                        {n === 0 ? "Earlier" : n === c.mentions.length - 1 ? "Later" : "Then"}: {m.value} <small className="muted">({m.statusLabel})</small> <Sources refs={[m.ref]} report={report} />
                      </li>
                    ))}
                  </ul>
                  <small>Potential current requirement: {c.latest.value} — still to be reviewed before any CRM update.</small>
                </div>
              ))}
            </div>
          )}
          <Section title="Open questions" items={report.openQuestions} report={report} />
          <Section title="Next steps" items={report.nextSteps} report={report} />
          <p className="ai-fineprint">
            Generated {businessTime(new Date(report.generatedAt))} GST by {report.generatedBy} · version {report.version} · {report.models}. From the written record only — check before relying on it.
          </p>
        </div>
      )}
      {report && !busy && view!.lead && (
        <div className="meet-intel-lead">
          <h4>Related lead · {view!.lead.title}</h4>
          {view!.lead.suggestions.length > 0 ? (
            <SuggestionChecklist suggestions={view!.lead.suggestions} onApplied={() => void meetingIntelligence.get(meetingId).then(setView)} />
          ) : (
            <p className="muted small">{view!.lead.canWrite ? "No CRM updates suggested from this meeting." : "You can view this lead but not change it."}</p>
          )}
          <div className="copilot-actions">
            <Button className="secondary compact" onClick={() => void sales.quotePrep(view!.lead!.id).then(setQuote, (e) => setError(e instanceof Error ? e.message : "Couldn't prepare the quotation."))}>
              <FileText size={14} aria-hidden="true" /> Prepare quotation
            </Button>
          </div>
          {quote && <QuotePrepPanel prep={quote} onDraftMissing={() => setDraftMissing(true)} />}
          <DialogPresence>
            {draftMissing && view!.lead && <DraftDialog record={{ id: view!.lead.id, title: view!.lead.title }} purpose="missing_info" canNote={view!.lead.canWrite} onClose={() => setDraftMissing(false)} />}
          </DialogPresence>
        </div>
      )}
    </section>
  );
}
