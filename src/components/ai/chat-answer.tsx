"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Copy, Check, Volume2, Square } from "lucide-react";
import { Button, DialogPresence } from "../ui/controls";
import {
  applySuggestion,
  openReference,
  refLabel,
  type AiResult,
  type Suggestion,
} from "@/lib/ai/client";
import { ReviewSuggestion } from "./ai-answer";

/** Small safe formatting vocabulary: no HTML, embedded images or model links. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .map((s, i) =>
          s.startsWith("**") ? (
            <strong key={i}>{s.slice(2, -2)}</strong>
          ) : s.startsWith("`") ? (
            <code key={i}>{s.slice(1, -1)}</code>
          ) : (
            s
          ),
        )}
    </>
  );
}
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>
            <Inline text={p} />
          </p>
        ))}
    </>
  );
}
export function ChatAnswer({
  result,
  saved = false,
}: {
  result: AiResult;
  saved?: boolean;
}) {
  const [copied, setCopied] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [localVoice, setLocalVoice] = useState<SpeechSynthesisVoice | null>(null),
    [reviewing, setReviewing] = useState<Suggestion | null>(null),
    [applied, setApplied] = useState<string[]>([]);
  const demo = result.tool === "local_demo",
    a = result.answer;
  const summary = a.summary
    .replace(/^Demo answer:\s*/i, "")
    .replace(/\s*No model was contacted\.$/, "");
  const text = [
    summary,
    ...a.points.map((p) => p.text),
    ...a.risks.map((p) => p.text),
    ...a.nextActions.map((p) => p.text),
    a.draft?.body,
  ]
    .filter(Boolean)
    .join("\n\n");
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const voices = () =>
      setLocalVoice(
        window.speechSynthesis
          .getVoices()
          .find((v) => v.localService && v.lang.startsWith("en")) || null,
      );
    voices();
    window.speechSynthesis.addEventListener("voiceschanged", voices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", voices);
      window.speechSynthesis.cancel();
    };
  }, []);
  const bullets = (
    items: { text: string; refs: string[] }[],
    title?: string,
  ): ReactNode =>
    items.length ? (
      <section className="chat-answer-section">
        {title && <h3>{title}</h3>}
        <ul>
          {items.map((p, i) => (
            <li key={i}>
              <Inline text={p.text} />
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  return (
    <div
      className="chat-answer"
      data-demo-answer={demo || undefined}
      role="region"
      aria-label="AI answer"
    >
      {(demo || saved) && (
        <span className="chat-answer-status">
          {demo
            ? "Demo · fictional data"
            : "Saved answer · check current records"}
        </span>
      )}
      <Paragraphs text={summary} />
      {bullets(a.points)}
      {bullets(a.risks, "Watch out for")}
      {bullets(a.nextActions, "What to do next")}
      {!!a.missing.length && (
        <p className="chat-answer-missing">
          I don’t have: {a.missing.join("; ")}.
        </p>
      )}
      {a.draft && (
        <section className="chat-answer-draft">
          <h3>Draft {a.draft.kind}</h3>
          {a.draft.subject && <strong>{a.draft.subject}</strong>}
          <Paragraphs text={a.draft.body} />
          <small>Review before sending. Nothing has been sent.</small>
        </section>
      )}
      {!!result.suggestions.length && !saved && (
        <div className="chat-answer-suggestions">
          {result.suggestions.map((s) => (
            <Button
              key={s.id}
              variant="secondary"
              size="small"
              disabled={applied.includes(s.id)}
              onClick={() => setReviewing(s)}
            >
              {applied.includes(s.id) ? "Applied" : `Review: ${s.label}`}
            </Button>
          ))}
        </div>
      )}
      {(result.references.length > 0 ||
        result.scope ||
        result.figures.length > 0) && (
        <details className="chat-answer-sources">
          <summary>
            {result.references.length
              ? `${result.references.length} ${result.references.length === 1 ? "source" : "sources"}`
              : "Scope & figures"}
          </summary>
          <div>
            {result.references.map((r) => (
              <Button
                key={r.id}
                variant="ghost"
                size="small"
                onClick={() => openReference(r)}
              >
                {refLabel(r)}
              </Button>
            ))}
          </div>
          {result.scope && <p>{result.scope}</p>}
          {!!result.figures.length && (
            <dl>
              {result.figures.map((f, i) => (
                <div key={i}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
      )}
      {!!result.flaggedText && (
        <p className="chat-answer-missing">
          Instructions found in source text were treated as data, not followed.
        </p>
      )}
      <div className="chat-answer-tools">
        <Button
          variant="ghost"
          size="small"
          aria-label="Copy answer"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
        <Button
          variant="ghost"
          size="small"
          aria-label={speaking ? "Stop reading" : "Read answer aloud"}
          disabled={!localVoice}
          title={
            localVoice
              ? "Read using an on-device voice"
              : "No on-device English voice is available in this browser"
          }
          onClick={() => {
            window.speechSynthesis.cancel();
            if (speaking) {
              setSpeaking(false);
              return;
            }
            const speech = new SpeechSynthesisUtterance(text);
            speech.voice = localVoice;
            speech.onend = () => setSpeaking(false);
            speech.onerror = () => setSpeaking(false);
            setSpeaking(true);
            window.speechSynthesis.speak(speech);
          }}
        >
          {speaking ? <Square size={14} /> : <Volume2 size={14} />}
        </Button>
      </div>
      <DialogPresence>
        {reviewing && (
          <ReviewSuggestion
            suggestion={reviewing}
            apply={applySuggestion}
            onClose={() => setReviewing(null)}
            onApplied={() => {
              setApplied((old) => [...old, reviewing.id]);
              setReviewing(null);
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}
