"use client";
import { useState, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowUpRight, Send, Sparkles, X } from "lucide-react";
import { Button, Textarea } from "../ui/controls";
import { askQuestion, type AiResult } from "@/lib/ai/client";
import { friendlyError } from "@/lib/client-request";
import { AiAnswerView, AiLoading, useAiStatus } from "./ai-answer";

/** On-demand only. No automatic prompts, page scraping or unattended actions. */
export function AiCompanion({ onOpen }: { onOpen: () => void }) {
  const status = useAiStatus(),
    [open, setOpen] = useState(false),
    [question, setQuestion] = useState(""),
    [pending, setPending] = useState(false),
    [result, setResult] = useState<AiResult | null>(null),
    [error, setError] = useState("");
  const running = useRef(false);
  async function ask() {
    if (running.current || question.trim().length < 2) return;
    running.current = true;
    setPending(true);
    setResult(null);
    setError("");
    try {
      setResult(await askQuestion(question.trim()));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          className="ai-companion-trigger"
          aria-label="Open Enercore assistant"
        >
          <span className="ai-companion-face" aria-hidden="true">
            <i />
            <i />
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ai-companion-panel"
          side="top"
          align="end"
          sideOffset={12}
          aria-label="Enercore assistant"
        >
          <header>
            <span>
              <Sparkles size={17} />
              Enercore assistant
            </span>
            <Popover.Close asChild>
              <Button size="icon" aria-label="Close assistant">
                <X size={17} />
              </Button>
            </Popover.Close>
          </header>
          <p>
            Quick help with your workspace. Answers only use records you’re
            allowed to see; nothing changes automatically.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            Open full assistant
            <ArrowUpRight size={15} />
          </Button>
          {status === undefined ? (
            <p role="status">Checking assistant availability…</p>
          ) : !status?.available ? (
            <p>
              AI isn’t available right now. Your normal workspace is still
              available.
            </p>
          ) : !status.features.ask ? (
            <p>
              Your role doesn’t include workspace question tools. Open a meeting
              or conversation to use its AI features.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <label htmlFor="companion-question" className="sr-only">
                Ask the assistant
              </label>
              <Textarea
                id="companion-question"
                placeholder="What needs my attention?"
                rows={2}
                maxLength={600}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={pending}
              />
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                disabled={pending || question.trim().length < 2}
              >
                <Send size={15} />
                Ask
              </Button>
            </form>
          )}
          {pending ? (
            <AiLoading label="Checking your workspace…" />
          ) : error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : result ? (
            <AiAnswerView result={result} />
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
