"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Copy, Check, FileText, MessageSquare, NotebookPen, RotateCcw, Sparkles, CalendarPlus, Phone, ArrowRight } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence, Textarea, Input } from "../ui/controls";
import {
  applySuggestion,
  refLabel,
  sales,
  saveDraftAsNote,
  openReference,
  type DraftView,
  type LeadSignalsView,
  type NextActionView,
  type ProfileView,
  type QuotePrepView,
  type Reference,
  type SalesPriorityView,
  type SalesResult,
  type Suggestion,
  type TodayView,
  type PriorityNotes,
} from "@/lib/ai/client";
import { SECTION_TITLES, type SectionKey } from "@/lib/sales/sections";
import { NEXT_ACTION_LABELS, type NextAction } from "@/lib/sales/signals";
import type { Actor } from "@/lib/domain";
import { AiLoading, RefChips, ReviewSuggestion, useAiStatus } from "./ai-answer";

/**
 * Sales Copilot UI. Deterministic facts (signals, next best action, missing
 * information) render first without any model call; the AI runs only when
 * the person asks, and everything it proposes is reviewed before the
 * ordinary records API applies it.
 */

/* ---------------------------------------------------------------- shared */

const stamp = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

function Generated({ at, cached }: { at: string; cached?: boolean }) {
  return (
    <p className="ai-fineprint">
      AI-generated at {stamp(at)} GST{cached ? " (unchanged data — reused)" : ""} from what you can see in Enercore. Figures come from Enercore. Check before relying on it.
    </p>
  );
}

function useOnce() {
  const running = useRef(false);
  return async <T,>(fn: () => Promise<T>) => {
    if (running.current) return undefined;
    running.current = true;
    try {
      return await fn();
    } finally {
      running.current = false;
    }
  };
}

export function NextActionCard({ next }: { next: NextActionView }) {
  if (!next) return null;
  return (
    <div className="copilot-next">
      <span className="copilot-eyebrow">Suggested next action</span>
      <b>{next.label}</b>
      <p>
        <span className="muted">Why: </span>
        {next.why}
      </p>
    </div>
  );
}

/** Sections, questions and next action of a SalesResult, with readable references. */
export function SectionsView({ result }: { result: SalesResult }) {
  const refs = new Map(result.references.map((r) => [r.id, r]));
  const a = result.answer;
  return (
    <div className="ai-answer copilot-answer">
      {result.scope && <p className="ai-scope">{result.scope}</p>}
      {a.summary && <p className="ai-summary">{a.summary}</p>}
      {result.nextAction && <NextActionCard next={result.nextAction} />}
      {a.sections.map((s) => (
        <div className="ai-section" key={s.key}>
          <h4>{SECTION_TITLES[s.key as SectionKey] ?? s.key}</h4>
          <ul>
            {s.items.map((i, n) => (
              <li key={n}>
                {i.text} <RefChips ids={i.refs} refs={refs} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {a.questions.length > 0 && (
        <div className="ai-section">
          <h4>Questions to ask</h4>
          <ul>
            {a.questions.map((q, n) => (
              <li key={n}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {a.missing.length > 0 && (
        <div className="ai-section ai-missing">
          <h4>Not in Enercore</h4>
          <ul>
            {a.missing.map((m, n) => (
              <li key={n}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {result.flaggedText ? (
        <p className="ai-flag" role="note">
          <AlertTriangle size={14} aria-hidden="true" /> Some text in these records looked like instructions to the AI. It was treated as plain data.
        </p>
      ) : null}
      <Generated at={result.generatedAt} cached={result.cached} />
    </div>
  );
}

const SETTLED = new Set(["recorded", "confirmed", "agreed"]);
type EntryView = ProfileView["entries"][number];

/** One requirement's value(s): value, source, and whether it is confirmed — uncertainty is never hidden. */
function EntryValue({ e, refs }: { e: EntryView; refs: Map<string, Reference> }) {
  if (e.status === "missing") return <span className="muted">Unknown</span>;
  const one = (v: EntryView["values"][number], n: number) => (
    <span className="copilot-value" key={n}>
      <span>{v.value}</span>
      <small className="copilot-source">
        {v.ref && refs.get(v.ref) ? <RefChips ids={[v.ref]} refs={refs} /> : null} {v.source} · <span className={SETTLED.has(v.claim) ? "copilot-claim is-settled" : "copilot-claim is-open"}>{v.claimLabel}</span>
      </small>
    </span>
  );
  if (e.status === "conflict")
    return (
      <>
        <span className="copilot-conflict">
          <AlertTriangle size={13} aria-hidden="true" /> Conflicting information
        </span>
        <ul>{e.values.map((v, n) => <li key={n}>{one(v, n)}</li>)}</ul>
      </>
    );
  return <>{e.values.map(one)}</>;
}

/** Quotation readiness in four buckets: confirmed, requested/discussed, missing, conflicting. */
function Readiness({ confirmed, requested, missing, conflicting, onDraftMissing }: { confirmed: string[]; requested: string[]; missing: string[]; conflicting: string[]; onDraftMissing?: () => void }) {
  const group = (title: string, items: string[], cls: string, icon: React.ReactNode) =>
    items.length ? (
      <div className={`copilot-bucket ${cls}`}>
        <span className="copilot-eyebrow">{title}</span>
        <ul>
          {items.map((i) => (
            <li key={i}>
              {icon} {i}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="copilot-readiness">
      {group("Known / confirmed", confirmed, "is-ready", <CheckCircle2 size={14} aria-hidden="true" />)}
      {group("Requested / discussed — not confirmed", requested, "is-open", <Circle size={14} aria-hidden="true" />)}
      {group("Missing", missing, "is-missing", <Circle size={14} aria-hidden="true" />)}
      {group("Conflicting", conflicting, "is-conflict", <AlertTriangle size={14} aria-hidden="true" />)}
      {(missing.length > 0 || requested.length > 0) && onDraftMissing && (
        <Button className="secondary compact" onClick={onDraftMissing}>
          <MessageSquare size={14} aria-hidden="true" /> Draft request for missing information
        </Button>
      )}
    </div>
  );
}

const QUOTE_FIELDS = ["product", "quantity", "destination", "incoterm", "packaging", "paymentTerms", "deliveryTimeline"];

/** The requirement profile: value, source, conflicts, and what a quotation still needs. */
export function RequirementProfile({ profile, references, onDraftMissing }: { profile: ProfileView; references: Reference[]; onDraftMissing?: () => void }) {
  const refs = new Map(references.map((r) => [r.id, r]));
  const shown = profile.entries.filter((e) => e.status !== "missing" || profile.missingForQuote.includes(e.field));
  const label = (f: string) => profile.entries.find((e) => e.field === f)?.label ?? f;
  const req = profile.entries.filter((e) => QUOTE_FIELDS.includes(e.field));
  return (
    <div className="copilot-profile">
      <h4>Commercial requirement</h4>
      <dl className="copilot-profile-list">
        {shown.map((e) => (
          <div key={e.field} className={`is-${e.status}`}>
            <dt>{e.label}</dt>
            <dd>
              <EntryValue e={e} refs={refs} />
            </dd>
          </div>
        ))}
      </dl>
      <Readiness
        confirmed={req.filter((e) => e.status === "confirmed").map((e) => e.label)}
        requested={profile.unconfirmedForQuote.map(label)}
        missing={profile.missingForQuote.map(label)}
        conflicting={req.filter((e) => e.status === "conflict").map((e) => e.label)}
        onDraftMissing={onDraftMissing}
      />
    </div>
  );
}

/** Reviewable suggestions: a checklist, applied only when the person says so. */
export function SuggestionChecklist({ suggestions, onApply, onApplied }: { suggestions: Suggestion[]; onApply?: (s: Suggestion) => Promise<void>; onApplied?: () => void }) {
  const [selected, setSelected] = useState<string[]>(suggestions.filter((s) => s.defaultSelected !== false && s.type !== "change_status").map((s) => s.id));
  const [done, setDone] = useState<Record<string, "applied" | string>>({});
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<Suggestion | null>(null);
  const apply = onApply ?? applySuggestion;
  // Requirement edits first (they carry the version they were suggested against), notes last.
  const order = (s: Suggestion) => ({ update_profile: 0, change_status: 1, set_follow_up: 2, add_note: 3 })[s.type];
  const applySelected = async () => {
    setBusy(true);
    for (const s of [...suggestions].filter((x) => selected.includes(x.id) && done[x.id] !== "applied").sort((a, b) => order(a) - order(b))) {
      try {
        await apply(s);
        setDone((d) => ({ ...d, [s.id]: "applied" }));
      } catch (e) {
        setDone((d) => ({ ...d, [s.id]: e instanceof Error ? e.message : "Couldn't apply." }));
      }
    }
    setBusy(false);
    onApplied?.();
  };
  if (!suggestions.length) return null;
  return (
    <div className="ai-section copilot-checklist">
      <h4>Suggested CRM updates</h4>
      <ul>
        {suggestions.map((s) => (
          <li key={s.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                disabled={busy || done[s.id] === "applied"}
                onChange={(e) => setSelected((list) => (e.target.checked ? [...list, s.id] : list.filter((x) => x !== s.id)))}
              />
              <span>
                {s.label}
                <small>{s.reason}</small>
                {done[s.id] === "applied" ? (
                  <small className="ai-applied">
                    <Check size={13} aria-hidden="true" /> Applied
                  </small>
                ) : done[s.id] ? (
                  <small className="form-error">{done[s.id]}</small>
                ) : null}
              </span>
            </label>
            <Button className="secondary compact" disabled={busy} onClick={() => setReviewing(s)}>
              Details
            </Button>
          </li>
        ))}
      </ul>
      <div className="copilot-actions">
        <Button className="primary" disabled={busy || !selected.some((id) => done[id] !== "applied")} onClick={() => void applySelected()}>
          {busy ? "Applying…" : "Apply selected"}
        </Button>
      </div>
      <p className="ai-fineprint">Nothing changes until you apply. Each change is saved as yours, with the usual checks and audit trail.</p>
      <DialogPresence>
        {reviewing && (
          <ReviewSuggestion
            suggestion={reviewing}
            apply={apply}
            onClose={() => setReviewing(null)}
            onApplied={() => {
              setDone((d) => ({ ...d, [reviewing.id]: "applied" }));
              setReviewing(null);
              onApplied?.();
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

/* ---------------------------------------------------------------- drafts */

const CHANNELS = [
  ["email", "Email"],
  ["whatsapp", "WhatsApp"],
  ["message", "Message"],
] as const;
const TONES = [
  ["professional", "Professional"],
  ["concise", "Concise"],
  ["warm", "Warm"],
] as const;

export function DraftDialog({ record, purpose, canNote, onClose, onSaved }: { record: { id: string; title: string }; purpose: "follow_up" | "missing_info" | "quotation_follow_up" | "meeting_follow_up"; canNote: boolean; onClose: () => void; onSaved?: () => void }) {
  const [channel, setChannel] = useState<"email" | "whatsapp" | "message">("email");
  const [tone, setTone] = useState<"professional" | "concise" | "warm">("professional");
  const [result, setResult] = useState<DraftView | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const once = useOnce();
  const generate = () =>
    once(async () => {
      setBusy(true);
      setError("");
      try {
        const r = await sales.draft({ id: record.id, channel, tone, purpose });
        setResult(r);
        setSubject(r.draft.subject);
        setBody(r.draft.body);
        setSaved(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The draft couldn't be made.");
      } finally {
        setBusy(false);
      }
    });
  const full = `${channel === "email" && subject ? `Subject: ${subject}\n\n` : ""}${body}`;
  const title = { follow_up: "Draft follow-up", missing_info: "Draft request for missing information", quotation_follow_up: "Draft quotation follow-up", meeting_follow_up: "Draft meeting follow-up" }[purpose];
  return (
    <Dialog title={`${title} · ${record.title}`} onClose={onClose} className="copilot-draft-dialog" dismissOnOutside={!busy}>
      <div className="copilot-draft">
        <div className="copilot-segment" role="radiogroup" aria-label="Channel">
          {CHANNELS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={channel === v} className={channel === v ? "is-on" : ""} onClick={() => setChannel(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="copilot-segment" role="radiogroup" aria-label="Tone">
          {TONES.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={tone === v} className={tone === v ? "is-on" : ""} onClick={() => setTone(v)}>
              {label}
            </button>
          ))}
        </div>
        {busy && <AiLoading label="Drafting from the CRM…" />}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {result && !busy && (
          <>
            {channel === "email" && (
              <label className="copilot-field">
                Subject
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
              </label>
            )}
            <label className="copilot-field">
              Draft
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "email" ? 9 : 5} maxLength={3000} />
            </label>
            {result.removed.length > 0 && (
              <ul className="copilot-removed" aria-label="Removed for safety">
                {result.removed.map((r, i) => (
                  <li key={i}>
                    <AlertTriangle size={13} aria-hidden="true" /> {r}
                  </li>
                ))}
              </ul>
            )}
            <p className="ai-fineprint">This is a draft. Nothing is sent — review it, then copy it into your email or WhatsApp yourself.</p>
          </>
        )}
      </div>
      <DialogActions
        pending={busy}
        start={
          result && !busy ? (
            <>
              <Button
                className="secondary"
                onClick={() =>
                  void navigator.clipboard?.writeText(full).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  })
                }
              >
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
              </Button>
              {canNote && (
                <Button
                  className="secondary"
                  disabled={saved || !body.trim()}
                  onClick={() =>
                    void saveDraftAsNote(record.id, channel, full)
                      .then(() => {
                        setSaved(true);
                        onSaved?.();
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't save the note."))
                  }
                >
                  <NotebookPen size={15} aria-hidden="true" /> {saved ? "Saved as note" : "Use as note"}
                </Button>
              )}
            </>
          ) : undefined
        }
        primary={{ label: result ? "Redraft" : "Draft", pendingLabel: "Drafting…", pending: busy, icon: result ? <RotateCcw size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />, onClick: generate }}
      />
    </Dialog>
  );
}

/* --------------------------------------------------------- quotation prep */

export function QuotePrepPanel({ prep, onDraftMissing }: { prep: QuotePrepView; onDraftMissing: () => void }) {
  const refs = new Map(prep.references.map((r) => [r.id, r]));
  return (
    <div className="copilot-quote">
      <h4>Quotation preparation</h4>
      <dl className="copilot-profile-list">
        <div className="is-confirmed">
          <dt>Customer</dt>
          <dd>{prep.customer}</dd>
        </div>
        {prep.entries.map((e) => (
          <div key={e.field} className={`is-${e.status}`}>
            <dt>{e.label}</dt>
            <dd>
              <EntryValue e={e} refs={refs} />
            </dd>
          </div>
        ))}
      </dl>
      <Readiness {...prep.readiness} onDraftMissing={onDraftMissing} />
      <p className="copilot-setbyyou">
        <b>Set by you on the quotation:</b> {prep.setByYou.join(", ")}. Enercore AI never proposes prices, freight, availability or validity, and never treats a customer&apos;s request (price, payment terms, Incoterm, delivery) as agreed.
      </p>
      <div className="copilot-actions">
        <Button
          className="primary compact"
          disabled={!prep.canCreate}
          title={prep.blockedBecause ?? undefined}
          onClick={() => prep.prefill && window.dispatchEvent(new CustomEvent("enercore:quote-draft", { detail: prep.prefill }))}
        >
          <FileText size={14} aria-hidden="true" /> Create quotation draft
        </Button>
      </div>
      {prep.blockedBecause && <p className="ai-fineprint">{prep.blockedBecause}</p>}
      <p className="ai-fineprint">The draft opens in the normal quotation form with only known values filled in (requested payment terms and Incoterm are left blank); you review, price and save it. It is not approved or sent.</p>
    </div>
  );
}

/* --------------------------------------------------------------- lead panel */

type Mode = "brief" | "quote" | "prep" | null;

export function LeadCopilot({ recordId, onLog, auto, onApply, onChanged }: { recordId: string; onLog?: () => void; auto?: "brief" | "draft"; onApply?: (s: Suggestion) => Promise<void>; onChanged?: () => void }) {
  const status = useAiStatus();
  const [base, setBase] = useState<LeadSignalsView | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [brief, setBrief] = useState<SalesResult | null>(null);
  const [quote, setQuote] = useState<QuotePrepView | null>(null);
  const [prep, setPrep] = useState<SalesResult | null>(null);
  const [busy, setBusy] = useState<Mode>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<null | "follow_up" | "missing_info">(null);
  const once = useOnce();
  const ready = !!status?.available && status.features.lead;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    sales.lead(recordId).then((b) => live && setBase(b), () => live && setBase(null));
    return () => {
      live = false;
    };
  }, [ready, recordId]);
  const run = (m: Exclude<Mode, null>) =>
    once(async () => {
      setMode(m);
      setBusy(m);
      setError("");
      try {
        if (m === "brief") setBrief(await sales.leadBrief(recordId));
        if (m === "quote") setQuote(await sales.quotePrep(recordId));
        if (m === "prep") setPrep(await sales.meetingPrep(recordId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enercore AI couldn't answer right now.");
      } finally {
        setBusy(null);
      }
    });
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !auto || started.current) return;
    started.current = true;
    if (auto === "brief") void run("brief");
    else setDraft("follow_up");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, auto]);
  if (!ready) return null;
  const closed = base && ["Won", "Lost"].includes(base.record.status);
  const next = brief?.nextAction ?? base?.nextAction ?? null;
  return (
    <section className="ai-panel copilot-panel" aria-label="Enercore AI">
      <header className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={15} aria-hidden="true" /> Enercore AI
        </span>
      </header>
      {base && (
        <>
          {base.signals.length > 0 && (
            <ul className="copilot-signals" aria-label="Signals">
              {base.signals.map((s) => (
                <li key={s.type + (s.meetingId ?? "")}>{s.label}</li>
              ))}
            </ul>
          )}
          {!brief && <NextActionCard next={next} />}
        </>
      )}
      <div className="copilot-actions">
        <Button className="secondary compact" disabled={!!busy} onClick={() => void run("brief")}>
          <Sparkles size={14} aria-hidden="true" /> {brief ? "Refresh brief" : "Brief me"}
        </Button>
        <Button className="secondary compact" onClick={() => setDraft("follow_up")}>
          <MessageSquare size={14} aria-hidden="true" /> Draft follow-up
        </Button>
        {base?.canQuote && !closed && (
          <Button className="secondary compact" disabled={!!busy} onClick={() => void run("quote")}>
            <FileText size={14} aria-hidden="true" /> Prepare quotation
          </Button>
        )}
        {!closed && (
          <Button className="secondary compact" disabled={!!busy} onClick={() => void run("prep")}>
            <CalendarPlus size={14} aria-hidden="true" /> Prepare meeting
          </Button>
        )}
        {onLog && base?.canWrite && (
          <Button className="secondary compact" onClick={onLog}>
            <Phone size={14} aria-hidden="true" /> Add follow-up
          </Button>
        )}
      </div>
      {busy && <AiLoading label={busy === "brief" ? "Reading the lead, notes and meetings…" : busy === "quote" ? "Checking what a quotation needs…" : "Preparing the meeting…"} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!busy && mode === "brief" && brief && (
        <>
          <SectionsView result={brief} />
          {brief.profile && <RequirementProfile profile={brief.profile} references={brief.references} onDraftMissing={() => setDraft("missing_info")} />}
          {brief.suggestions && brief.suggestions.length > 0 && <SuggestionChecklist suggestions={brief.suggestions} onApply={onApply} onApplied={onChanged} />}
        </>
      )}
      {!busy && mode === "quote" && quote && <QuotePrepPanel prep={quote} onDraftMissing={() => setDraft("missing_info")} />}
      {!busy && mode === "prep" && prep && <SectionsView result={prep} />}
      {!brief && base && base.profile.missingForQuote.length > 0 && mode === null && (
        <p className="ai-fineprint">
          From the CRM fields, a quotation still needs: {base.profile.missingForQuote.map((f) => base.profile.entries.find((e) => e.field === f)?.label.toLowerCase()).join(", ")}. "Brief me" also reads the notes and meeting chat.
        </p>
      )}
      <DialogPresence>
        {draft && base && <DraftDialog record={{ id: recordId, title: base.record.title }} purpose={draft} canNote={base.canWrite} onClose={() => setDraft(null)} onSaved={onChanged} />}
      </DialogPresence>
    </section>
  );
}

/* ----------------------------------------------------------- customer panel */

export function CustomerCopilot({ recordId, title, canNote, auto }: { recordId: string; title: string; canNote: boolean; auto?: "brief" }) {
  const status = useAiStatus();
  const [result, setResult] = useState<SalesResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(false);
  const once = useOnce();
  const ready = !!status?.available && status.features.customer;
  const started = useRef(false);
  useEffect(() => {
    if (!ready || auto !== "brief" || started.current) return;
    started.current = true;
    void run("brief");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, auto]);
  if (!ready) return null;
  const run = (task: "360" | "brief" | "prep") =>
    once(async () => {
      setBusy(task);
      setError("");
      try {
        setResult(task === "360" ? await sales.customer360(recordId) : task === "brief" ? await sales.customerBrief(recordId) : await sales.meetingPrep(recordId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enercore AI couldn't answer right now.");
      } finally {
        setBusy(null);
      }
    });
  return (
    <section className="ai-panel copilot-panel" aria-label="Enercore AI">
      <header className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={15} aria-hidden="true" /> Enercore AI
        </span>
      </header>
      <div className="copilot-actions">
        <Button className="secondary compact" disabled={!!busy} onClick={() => void run("brief")}>
          <Phone size={14} aria-hidden="true" /> Prepare me for this customer
        </Button>
        <Button className="secondary compact" disabled={!!busy} onClick={() => void run("360")}>
          <Sparkles size={14} aria-hidden="true" /> Customer 360
        </Button>
        <Button className="secondary compact" disabled={!!busy} onClick={() => void run("prep")}>
          <CalendarPlus size={14} aria-hidden="true" /> Prepare meeting
        </Button>
        <Button className="secondary compact" onClick={() => setDraft(true)}>
          <MessageSquare size={14} aria-hidden="true" /> Draft message
        </Button>
      </div>
      {busy && <AiLoading label="Reading this customer's records…" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!busy && result && <SectionsView result={result} />}
      <DialogPresence>{draft && <DraftDialog record={{ id: recordId, title }} purpose="follow_up" canNote={canNote} onClose={() => setDraft(false)} />}</DialogPresence>
    </section>
  );
}

/* ------------------------------------------------------ post-meeting review */

export function MeetingOutcome({ meetingId }: { meetingId: string }) {
  const status = useAiStatus();
  const [result, setResult] = useState<SalesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const once = useOnce();
  if (!status?.available || !status.features.sales) return null;
  const run = () =>
    once(async () => {
      setBusy(true);
      setError("");
      try {
        setResult(await sales.meetingReview(meetingId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enercore AI couldn't answer right now.");
      } finally {
        setBusy(false);
      }
    });
  return (
    <section className="ai-panel copilot-panel" aria-label="Meeting outcome">
      <header className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={15} aria-hidden="true" /> Meeting completed
        </span>
        <Button className="secondary compact" disabled={busy} onClick={() => void run()}>
          {result ? "Review again" : "Review outcome"}
        </Button>
      </header>
      {busy && <AiLoading label="Reading the meeting and its chat…" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!busy && result && (
        <>
          <SectionsView result={result} />
          {result.requirements && result.requirements.length > 0 && (
            <div className="ai-section">
              <h4>Requirements stated in the chat</h4>
              <ul>
                {result.requirements.map((r, i) => (
                  <li key={i}>
                    {r.label}: {r.value}{" "}
                    <small className="muted">
                      — {r.source} · <span className={SETTLED.has(r.claim) ? "copilot-claim is-settled" : "copilot-claim is-open"}>{r.claimLabel}</span>
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.suggestions && <SuggestionChecklist suggestions={result.suggestions} />}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- Sales Copilot home */

const greeting = () => {
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Dubai" }));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

const openRecord = (kind: string, id: string, ai?: "brief") => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id, ai } }));
const openMeetingReport = (meetingId: string) => window.dispatchEvent(new CustomEvent("enercore:open-meeting-page", { detail: { meetingId, view: "report" } }));

function PriorityCard({ p, note, onDraft }: { p: SalesPriorityView; note?: PriorityNotes["notes"][number]; onDraft: (p: SalesPriorityView) => void }) {
  const action = (note?.action ?? p.action) as NextAction;
  return (
    <li className="copilot-card">
      <div className="copilot-card-head">
        <b>{p.record.title}</b>
        <span className="copilot-kind">
          {p.record.kind === "leads" ? "Lead" : "Quotation"} · {p.record.status}
          {p.record.value ? ` · ${p.record.value}` : ""}
        </span>
      </div>
      <ul className="copilot-card-signals">
        {p.signals.map((s) => (
          <li key={s.type + (s.meetingId ?? "")}>{s.label}</li>
        ))}
        {p.daysIdle !== null && !p.signals.some((s) => s.type === "LEAD_GONE_QUIET" || s.type === "QUOTATION_WAITING") && <li className="muted">Last activity: {p.daysIdle === 0 ? "today" : `${p.daysIdle} day${p.daysIdle === 1 ? "" : "s"} ago`}</li>}
      </ul>
      <p className="copilot-card-action">
        <span className="copilot-eyebrow">Suggested</span> {NEXT_ACTION_LABELS[action] ?? p.action}
        {note && (
          <span className="copilot-card-why">
            <Sparkles size={12} aria-hidden="true" /> {note.why}
          </span>
        )}
      </p>
      <div className="copilot-actions">
        <Button className="secondary compact" onClick={() => openRecord(p.record.kind, p.record.id)}>
          Open {p.record.kind === "leads" ? "lead" : "quotation"}
        </Button>
        {p.record.kind === "leads" && (
          <Button className="secondary compact" onClick={() => openRecord("leads", p.record.id, "brief")}>
            Brief me
          </Button>
        )}
        {p.meetingId && p.signals.some((s) => s.type === "MEETING_OUTCOME_MISSING") ? (
          <Button className="secondary compact" onClick={() => openMeetingReport(p.meetingId!)}>
            Review meeting
          </Button>
        ) : (
          <Button className="secondary compact" onClick={() => onDraft(p)}>
            <MessageSquare size={14} aria-hidden="true" /> Draft follow-up
          </Button>
        )}
      </div>
    </li>
  );
}

export function SalesHome({ actor }: { actor: Actor }) {
  const status = useAiStatus();
  const team = actor.role !== "Sales Executive";
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [today, setToday] = useState<TodayView | null>(null);
  const [notes, setNotes] = useState<PriorityNotes | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SalesPriorityView | null>(null);
  const once = useOnce();
  const ready = !!status?.available && status.features.sales;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setToday(null);
    setNotes(null);
    sales.today(scope).then(
      (t) => live && setToday(t),
      (e) => live && setError(e instanceof Error ? e.message : "Couldn't load today's priorities."),
    );
    return () => {
      live = false;
    };
  }, [ready, scope]);
  if (!ready) return null;
  const explain = () =>
    once(async () => {
      setBusy(true);
      setError("");
      try {
        setNotes(await sales.explainToday(scope));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Enercore AI couldn't answer right now.");
      } finally {
        setBusy(false);
      }
    });
  const noteFor = (id: string) => notes?.notes.find((n) => n.recordId === id);
  return (
    <section className="panel copilot-home" aria-labelledby="copilot-home-title">
      <div className="copilot-home-head">
        <div>
          <span className="eyebrow">SALES COPILOT</span>
          <h2 id="copilot-home-title">
            {greeting()}, {actor.name.split(" ")[0]}
          </h2>
          <p className="muted">
            {today ? (today.priorities.length ? `${today.total} item${today.total === 1 ? "" : "s"} need${today.total === 1 ? "s" : ""} attention — here are the top ${today.priorities.length}.` : "Nothing needs attention right now.") : "Checking your pipeline…"}
          </p>
        </div>
        {team && (
          <div className="copilot-segment" role="radiogroup" aria-label="Whose priorities">
            {(["mine", "team"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scope === s} className={scope === s ? "is-on" : ""} onClick={() => setScope(s)}>
                {s === "mine" ? "Mine" : "Team"}
              </button>
            ))}
          </div>
        )}
      </div>
      {today && today.priorities.length > 0 && (
        <Button className="primary copilot-explain" disabled={busy} onClick={() => void explain()}>
          <Sparkles size={15} aria-hidden="true" /> {busy ? "Working it out…" : notes ? "Explain again" : "What should I work on today?"}
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {today && (
        <>
          <span className="copilot-eyebrow">TODAY</span>
          <ol className="copilot-list">
            {today.priorities.map((p) => (
              <PriorityCard key={p.record.id} p={p} note={noteFor(p.record.id)} onDraft={setDraft} />
            ))}
          </ol>
          <p className="ai-fineprint">Priorities are ranked by Enercore from follow-ups, activity, quotations and meetings — not by AI.{notes ? ` Explanations: AI-generated at ${stamp(notes.generatedAt)} GST.` : ""}</p>
        </>
      )}
      <DialogPresence>
        {draft && <DraftDialog record={{ id: draft.record.id, title: draft.record.title }} purpose={draft.record.kind === "quotations" ? "quotation_follow_up" : "follow_up"} canNote onClose={() => setDraft(null)} />}
      </DialogPresence>
    </section>
  );
}

/* --------------------------------------------------------- My Day suggestions */

/**
 * A few high-value suggestions for My Day — deterministic signals, one light
 * request, no model call until the person drafts. Items My Day already lists
 * (overdue / due today) are left out.
 */
export function MyDaySuggestions({ onReview }: { onReview: () => void }) {
  const status = useAiStatus();
  const [today, setToday] = useState<TodayView | null>(null);
  const [draft, setDraft] = useState<SalesPriorityView | null>(null);
  const ready = !!status?.available && status.features.sales;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    sales.today("mine").then((t) => live && setToday(t), () => undefined);
    return () => {
      live = false;
    };
  }, [ready]);
  if (!ready || !today) return null;
  const items = today.priorities.filter((p) => !p.signals.every((s) => s.type === "FOLLOW_UP_OVERDUE" || s.type === "FOLLOW_UP_TODAY")).slice(0, 3);
  if (!items.length) return null;
  return (
    <section className="panel copilot-myday" aria-labelledby="copilot-myday-title">
      <div className="panel-heading">
        <h2 id="copilot-myday-title">
          <Sparkles size={16} aria-hidden="true" /> AI suggestions
        </h2>
        <Button className="secondary compact" onClick={onReview}>
          Review priorities <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
      <ul className="copilot-myday-list">
        {items.map((p) => (
          <li key={p.record.id}>
            <button type="button" className="record-link" onClick={() => openRecord(p.record.kind, p.record.id)}>
              <span className="my-day-title">{p.record.title}</span>
              <small>
                {p.signals[0].label} · Suggested: {NEXT_ACTION_LABELS[p.action as NextAction]}
              </small>
            </button>
            <Button className="secondary compact" onClick={() => setDraft(p)}>
              <MessageSquare size={14} aria-hidden="true" /> Draft message
            </Button>
          </li>
        ))}
      </ul>
      <DialogPresence>
        {draft && <DraftDialog record={{ id: draft.record.id, title: draft.record.title }} purpose={draft.record.kind === "quotations" ? "quotation_follow_up" : "follow_up"} canNote onClose={() => setDraft(null)} />}
      </DialogPresence>
    </section>
  );
}

export { refLabel, openReference };
