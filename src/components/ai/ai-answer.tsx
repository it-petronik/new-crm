"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { SkeletonText } from "../ui/skeleton";
import {
  aiStatus,
  applySuggestion,
  askAi,
  openReference,
  refLabel,
  type AiResult,
  type AiStatus,
  type Reference,
  type Suggestion,
} from "@/lib/ai/client";

/**
 * How Enercore AI answers are shown everywhere: the answer, its references
 * (each opens the record / meeting / message it came from), a draft to copy,
 * and suggestions that change nothing until the person reviews and applies
 * each one — through the ordinary records API.
 */

/** Whether AI is on here (null while checking). Preview never has AI. */
export function useAiStatus(enabled = true) {
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void aiStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? status : null;
}

export function RefChips({ ids, refs }: { ids: string[]; refs: Map<string, Reference> }) {
  const known = [...new Set(ids)].map((id) => refs.get(id)).filter((r): r is Reference => !!r);
  if (!known.length) return null;
  return (
    <span className="ai-refs">
      {known.map((r) => (
        <button key={r.id} type="button" className="ai-ref" title={r.label} onClick={() => openReference(r)}>
          {refLabel(r)}
        </button>
      ))}
    </span>
  );
}

function Items({
  title,
  items,
  refs,
  tone,
  children,
}: {
  title: string;
  items: { text: string; refs: string[] }[];
  refs: Map<string, Reference>;
  tone?: "facts" | "risks" | "next";
  children?: React.ReactNode;
}) {
  if (!items.length && !children) return null;
  return (
    <div className={`ai-section${tone ? ` is-${tone}` : ""}`}>
      <h4>{title}</h4>
      {items.length > 0 && (
        <ul>
          {items.map((p, i) => (
            <li key={i}>
              {p.text} <RefChips ids={p.refs} refs={refs} />
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

function Draft({ draft }: { draft: NonNullable<AiResult["answer"]["draft"]> }) {
  const [copied, setCopied] = useState(false);
  const text = `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}`;
  return (
    <div className="ai-section ai-draft">
      <h4>
        Draft {draft.kind}
        <Button
          className="secondary compact"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
        </Button>
      </h4>
      {draft.subject && <p className="ai-draft-subject">{draft.subject}</p>}
      <p className="ai-draft-body">{draft.body}</p>
      <p className="ai-fineprint">Nothing is sent. Review and send it yourself.</p>
    </div>
  );
}

export function ReviewSuggestion({ suggestion, onClose, onApplied, apply }: { suggestion: Suggestion; onClose: () => void; onApplied: () => void; apply: (s: Suggestion) => Promise<void> }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const a = suggestion.apply;
  return (
    <Dialog title="Review suggested change" onClose={() => !pending && onClose()} dismissOnOutside={!pending}>
      <div className="ai-review">
        <p>
          <b>{suggestion.label}</b>
        </p>
        <dl className="ai-review-facts">
          <div>
            <dt>Record</dt>
            <dd>
              {suggestion.record.title} · {suggestion.record.id}
            </dd>
          </div>
          {a.action === "status" ? (
            <div>
              <dt>Status</dt>
              <dd>
                {suggestion.record.status} → <b>{a.status}</b>
              </dd>
            </div>
          ) : a.action === "edit" ? (
            (suggestion.changes ?? []).map((c) => (
              <div key={c.field}>
                <dt>{c.field}</dt>
                <dd>
                  {c.from} → <b>{c.to}</b> <small className="muted">({c.source})</small>
                </dd>
              </div>
            ))
          ) : (
            <>
              {a.due && (
                <div>
                  <dt>Next follow-up</dt>
                  <dd>
                    {suggestion.record.due || "not set"} → <b>{a.due}</b>
                  </dd>
                </div>
              )}
              <div>
                <dt>Note to add</dt>
                <dd className="ai-review-note">{a.text}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Why</dt>
            <dd>{suggestion.reason}</dd>
          </div>
        </dl>
        <p className="ai-fineprint">This is saved as your change, with the usual checks and audit trail. Nothing happens unless you apply it.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogActions
        pending={pending}
        primary={{
          label: "Apply change",
          pendingLabel: "Applying…",
          pending,
          onClick: async () => {
            setPending(true);
            setError("");
            try {
              await apply(suggestion);
              onApplied();
            } catch (e) {
              setError(e instanceof Error ? e.message : "The change couldn't be applied.");
            } finally {
              setPending(false);
            }
          },
        }}
      />
    </Dialog>
  );
}

export function AiAnswerView({ result, onApply }: { result: AiResult; onApply?: (s: Suggestion) => Promise<void> }) {
  const refs = new Map(result.references.map((r) => [r.id, r]));
  const [reviewing, setReviewing] = useState<Suggestion | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const { answer } = result;
  return (
    <div className="ai-answer" role="region" aria-label="AI result" tabIndex={0}>
      <AiResultHeading confidence={answer.confidence} />
      {result.scope && <p className="ai-scope">{result.scope}</p>}
      <p className="ai-summary">{answer.summary}</p>
      {/* Summary first, then what is known, what is missing or at risk, and
          what to do — each a short list, side by side where there is room. */}
      <div className="ai-answer-grid">
        <Items title="Key facts" items={answer.points} refs={refs} tone="facts">
          {result.figures.length > 0 && (
            <details className="ai-figures" open={result.feature === "ask"}>
              <summary>Figures from Enercore ({result.figures.length})</summary>
              <dl>
                {result.figures.map((f, i) => (
                  <div key={i}>
                    <dt>{f.label}</dt>
                    <dd>
                      {f.value} {f.ref && <RefChips ids={[f.ref]} refs={refs} />}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </Items>
        <Items title="Gaps and risks" items={answer.risks} refs={refs} tone="risks">
          {answer.missing.length > 0 && (
            <div className="ai-missing">
              <p className="ai-subhead">Not in Enercore</p>
              <ul>
                {answer.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Items>
        <Items title="Next actions" items={answer.nextActions} refs={refs} tone="next">
          {result.suggestions.length > 0 && (
            <div className="ai-suggestions-block">
              <p className="ai-subhead">Suggested changes</p>
              <ul className="ai-suggestions">
                {result.suggestions.map((s) => (
                  <li key={s.id}>
                    <span>
                      {s.label}
                      <small>{s.reason}</small>
                    </span>
                    {applied.includes(s.id) ? (
                      <span className="ai-applied">
                        <Check size={14} aria-hidden="true" /> Applied
                      </span>
                    ) : (
                      <Button className="secondary compact" onClick={() => setReviewing(s)}>
                        Review
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Items>
      </div>
      {answer.draft && <Draft draft={answer.draft} />}
      <footer className="ai-answer-foot">
        {result.references.length > 0 && (
          <details className="ai-sources">
            <summary>Sources ({result.references.length})</summary>
            <ul>
              {result.references.map((r) => (
                <li key={r.id}>
                  <button type="button" className="ai-ref" title={r.label} onClick={() => openReference(r)}>
                    {refLabel(r)}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {result.flaggedText > 0 && (
          <p className="ai-flag" role="note">
            <ShieldAlert size={14} aria-hidden="true" /> Some text in these records looked like instructions to the AI. It was treated as plain data.
          </p>
        )}
        <p className="ai-fineprint">
          AI-generated from what you can see in Enercore · confidence {answer.confidence}. Figures are calculated by Enercore, not the AI. Check before relying on it.
        </p>
      </footer>
      <DialogPresence>
        {reviewing && (
          <ReviewSuggestion
            suggestion={reviewing}
            apply={onApply ?? applySuggestion}
            onClose={() => setReviewing(null)}
            onApplied={() => {
              setApplied((a) => [...a, reviewing.id]);
              setReviewing(null);
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

/** One visual entry point for answers across records, conversations and reports. */
export function AiResultHeading({ confidence }: { confidence?: string }) {
  return <div className="ai-result-heading"><span><Sparkles size={16} aria-hidden="true"/>AI insight</span><small>{confidence ? `Confidence: ${confidence} · Review before use` : "Review before use"}</small></div>;
}

export function AiLoading({ label }: { label: string }) {
  return (
    <div className="ai-loading" role="status" aria-live="polite">
      <span className="ai-loading-label">
        <Sparkles size={14} aria-hidden="true" /> {label}
      </span>
      <SkeletonText lines={4} width={["96%", "88%", "72%", "54%"]} />
    </div>
  );
}

/**
 * A button that asks Enercore AI about one thing (a lead, a customer, a
 * meeting, a conversation) and shows the answer in place. Hidden when AI
 * isn't available here or this person may not use it.
 */
export function AiPanel({
  feature,
  id,
  label,
  loadingLabel = "Enercore AI is reading…",
  onApply,
  autoRun = false,
}: {
  feature: "deal" | "lead" | "customer" | "meeting" | "conversation";
  id: string;
  label: string;
  loadingLabel?: string;
  onApply?: (s: Suggestion) => Promise<void>;
  autoRun?: boolean;
}) {
  const status = useAiStatus();
  const [state, setState] = useState<{ phase: "idle" | "loading" | "done" | "error"; result?: AiResult; error?: string }>({ phase: "idle" });
  // One request at a time, whatever the clicking.
  const running = useRef(false);
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setState({ phase: "loading" });
    try {
      setState({ phase: "done", result: await askAi(feature, id) });
    } catch (e) {
      setState({ phase: "error", error: e instanceof Error ? e.message : "Enercore AI couldn't answer right now." });
    } finally {
      running.current = false;
    }
  };
  const ready = !!status?.available && status.features[feature];
  useEffect(() => {
    if (ready && autoRun) void run();
    // run once per subject
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoRun, feature, id]);
  if (!ready) return null;
  return (
    <section className="ai-panel" aria-label="Enercore AI">
      <header className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={15} aria-hidden="true" /> Enercore AI
        </span>
        {state.phase === "idle" ? (
          <Button className="secondary compact" onClick={() => void run()}>
            {label}
          </Button>
        ) : (
          state.phase !== "loading" && (
            <Button className="secondary compact" onClick={() => void run()}>
              <RotateCcw size={14} aria-hidden="true" /> Regenerate
            </Button>
          )
        )}
      </header>
      {state.phase === "loading" && <AiLoading label={loadingLabel} />}
      {state.phase === "error" && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.phase === "done" && state.result && <AiAnswerView result={state.result} onApply={onApply} />}
    </section>
  );
}

/** An icon button that opens an Enercore AI summary in a dialog (e.g. a conversation header). */
export function AiDialogButton({ feature, id, title, label }: { feature: "meeting" | "conversation"; id: string; title: string; label: string }) {
  const status = useAiStatus();
  const [open, setOpen] = useState(false);
  if (!status?.available || !status.features[feature]) return null;
  return (
    <>
      <Button className="icon-button ai-trigger" aria-label={label} title={label} onClick={() => setOpen(true)}>
        <Sparkles size={17} />
      </Button>
      <DialogPresence>
        {open && (
          <Dialog title={title} onClose={() => setOpen(false)} className="ai-dialog">
            <AiPanel feature={feature} id={id} label={label} autoRun />
          </Dialog>
        )}
      </DialogPresence>
    </>
  );
}
