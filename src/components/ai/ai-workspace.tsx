"use client";

import { useRef, useState } from "react";
import { Send, ShieldCheck, Sparkles } from "lucide-react";
import { Button, Textarea } from "../ui/controls";
import { askQuestion, type AiResult } from "@/lib/ai/client";
import type { Actor } from "@/lib/domain";
import { AiAnswerView, AiLoading, useAiStatus } from "./ai-answer";

/**
 * The Enercore AI workspace: ask a management question in plain words.
 * The question is routed to one fixed, permission-checked tool; the figures
 * come from Enercore; the AI explains them. History lives only in this tab.
 */

type Turn = { id: number; question: string; result?: AiResult; error?: string };

export default function AiWorkspace({ actor, preview }: { actor: Actor; preview: boolean }) {
  const status = useAiStatus(!preview);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const next = useRef(1);
  const running = useRef(false);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 2 || running.current) return;
    running.current = true;
    const id = next.current++;
    setTurns((t) => [{ id, question: q }, ...t].slice(0, 20));
    setQuestion("");
    setPending(true);
    try {
      const result = await askQuestion(q);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : "Enercore AI couldn't answer right now." } : x)));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <div className="ai-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Enercore AI</h1>
          <p>Ask about your pipeline, follow-ups and receivables — answered from the records you can see.</p>
        </div>
      </div>

      {preview || status === null ? (
        <section className="panel ai-unavailable">
          <p>
            <Sparkles size={16} aria-hidden="true" /> Enercore AI isn&apos;t available {preview ? "in the preview" : "here yet"}.
          </p>
        </section>
      ) : status === undefined ? (
        <AiLoading label="Checking Enercore AI…" />
      ) : !status.available ? (
        <section className="panel ai-unavailable">
          <p>
            <Sparkles size={16} aria-hidden="true" /> Enercore AI isn&apos;t switched on for this workspace yet.
          </p>
        </section>
      ) : (
        <>
          <form
            className="panel ai-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="ai-question" className="sr-only">
              Your question
            </label>
            <Textarea
              id="ai-question"
              rows={2}
              maxLength={600}
              value={question}
              placeholder={status.features.ask ? "e.g. Which follow-ups are overdue this week?" : "Your role doesn't include sales or accounts questions."}
              disabled={!status.features.ask}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
            />
            <Button type="submit" className="primary" disabled={pending || question.trim().length < 2 || !status.features.ask}>
              <Send size={15} aria-hidden="true" /> Ask
            </Button>
            {status.examples.length > 0 && (
              <div className="ai-examples" aria-label="Example questions">
                {status.examples.map((q) => (
                  <button key={q} type="button" className="ai-example" disabled={pending} onClick={() => void ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </form>

          {turns.length === 0 ? (
            <section className="panel ai-about">
              <h2>
                <ShieldCheck size={16} aria-hidden="true" /> How Enercore AI works
              </h2>
              <ul>
                <li>It only sees records, meetings and conversations {actor.name.split(" ")[0]} can already open — checked on every question.</li>
                <li>Totals, counts and dates are calculated by Enercore. The AI explains them; it doesn&apos;t work them out.</li>
                <li>It never changes anything. Suggested changes are applied only when you review and confirm them.</li>
                <li>Every answer lists its sources — select one to open it.</li>
                <li>For a single lead, customer, meeting or conversation, use the Enercore AI button there.</li>
              </ul>
            </section>
          ) : (
            <ol className="ai-history">
              {turns.map((t) => (
                <li key={t.id} className="panel ai-turn">
                  <p className="ai-question">{t.question}</p>
                  {t.result ? (
                    <AiAnswerView result={t.result} />
                  ) : t.error ? (
                    <p className="form-error" role="alert">
                      {t.error}
                    </p>
                  ) : (
                    <AiLoading label="Working it out from your records…" />
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
