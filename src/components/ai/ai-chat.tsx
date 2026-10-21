"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUp,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  MessageSquare,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ScanEye,
} from "lucide-react";
import { Button, Form, Dialog, DialogActions } from "../ui/controls";
import { SkeletonPage, SkeletonText } from "../ui/skeleton";
import { useAiStatus } from "./ai-answer";
import { ChatAnswer } from "./chat-answer";
import { askQuestion } from "@/lib/ai/client";
import { demoAnswer } from "@/lib/ai/demo-answer";
import {
  chatHistoryKey,
  readChatHistory,
  writeChatHistory,
  type LocalChat,
  type ChatTurn,
} from "@/lib/ai/chat-history";
import { pageAiActions } from "@/lib/ai/page-actions";
import {
  labels,
  canRead,
  type Actor,
  type Module,
  type RecordItem,
} from "@/lib/domain";
import { friendlyError } from "@/lib/client-request";
import { pageGuide, type AiPageContext } from "@/lib/ai/page-context";
import styles from "./ai-chat.module.css";

export default function AiChat({
  actor,
  preview,
  records = [],
  company = "All companies",
  module = "overview",
  record,
  compact = false,
  view,
}: {
  actor: Actor;
  preview: boolean;
  records?: RecordItem[];
  company?: string;
  module?: Module;
  record?: RecordItem;
  compact?: boolean;
  view?: AiPageContext["view"];
}) {
  const status = useAiStatus(!preview),
    key = chatHistoryKey(actor, company, preview);
  const [chats, setChats] = useState<LocalChat[]>([]),
    [active, setActive] = useState(""),
    [loadedKey, setLoadedKey] = useState(""),
    [question, setQuestion] = useState(""),
    [pending, setPending] = useState(false),
    [historyOpen, setHistoryOpen] = useState(true),
    [removing, setRemoving] = useState<LocalChat | null>(null),
    [storageError, setStorageError] = useState(false),
    [usePage, setUsePage] = useState(false);
  const controller = useRef<AbortController | null>(null),
    historyClose = useRef<HTMLButtonElement>(null),
    historyToggle = useRef<HTMLButtonElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    end = useRef<HTMLDivElement>(null),
    restored = useRef(new Set<string>());
  const historyId = useId();
  function toggleHistory(open: boolean) {
    setHistoryOpen(open);
    requestAnimationFrame(() =>
      (open ? historyClose : historyToggle).current?.focus({
        preventScroll: true,
      }),
    );
  }
  const chat = chats.find((c) => c.id === active),
    turns = chat?.turns || [],
    available = preview || !!(status?.available && status.features.ask),
    suggestions = pageAiActions(actor, module, record).slice(0, 3);
  const safeRecord =
    record &&
    !record.deletedAt &&
    canRead(actor, record) &&
    !["hr", "leave"].includes(record.kind)
      ? record
      : undefined;
  const page: AiPageContext = {
    module,
    company: company === "All companies" ? null : company,
    ...(safeRecord && !view ? { recordId: safeRecord.id } : {}),
    ...(view ? { view } : {}),
  };
  const pageLabel = `${pageGuide(page).title}${safeRecord && !view ? ` · ${safeRecord.title}` : ""}`;
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setQuestion("");
    setUsePage(false);
    let saved: LocalChat[] = [];
    try {
      saved = readChatHistory(localStorage.getItem(key));
    } catch {
      setStorageError(true);
    }
    restored.current = new Set(saved.flatMap((c) => c.turns.map((t) => t.id)));
    setChats(saved);
    setActive(saved[0]?.id || "");
    setLoadedKey(key);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try {
      localStorage.setItem(key, writeChatHistory(chats, preview));
    } catch {
      setStorageError(true);
    }
  }, [chats, key, loadedKey, preview]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [turns.length, pending, active]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(140, Math.max(44, composer.current.scrollHeight))}px`;
    }
  }, [question]);
  function updateTurn(
    chatId: string,
    turnId: string,
    patch: Partial<ChatTurn>,
  ) {
    setChats((old) =>
      old.map((c) =>
        c.id === chatId
          ? {
              ...c,
              turns: c.turns.map((t) =>
                t.id === turnId ? { ...t, ...patch } : t,
              ),
            }
          : c,
      ),
    );
  }
  function newChat() {
    if (pending) return;
    setActive("");
    setQuestion("");
    composer.current?.focus();
  }
  async function send() {
    const text = question.trim();
    if (text.length < 2 || pending || controller.current || !available) return;
    const abort = new AbortController();
    controller.current = abort;
    const chatId = chat?.id || crypto.randomUUID(),
      turnId = crypto.randomUUID();
    const turn: ChatTurn = {
      id: turnId,
      question: text,
      ...(usePage ? { pageLabel } : {}),
    };
    const previous = turns.slice(-4).map((t) => t.question);
    const current: LocalChat = {
      id: chatId,
      title: chat?.title || text.slice(0, 60),
      updatedAt: Date.now(),
      turns: [...turns, turn].slice(-20),
    };
    setChats((old) =>
      [current, ...old.filter((c) => c.id !== chatId)].slice(0, 20),
    );
    setActive(chatId);
    setQuestion("");
    setPending(true);
    try {
      const scoped = records.filter(
        (r) =>
          !r.deletedAt &&
          canRead(actor, r) &&
          (company === "All companies" || r.company === company),
      );
      const result = preview
        ? demoAnswer(text, actor, scoped, usePage ? page : undefined)
        : await askQuestion(text, abort.signal, {
            history: previous,
            ...(usePage ? { page } : {}),
          });
      if (!abort.signal.aborted) updateTurn(chatId, turnId, { result });
    } catch (e) {
      if (!abort.signal.aborted)
        updateTurn(chatId, turnId, { error: friendlyError(e) });
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setPending(false);
      }
    }
  }
  function stop() {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setChats((old) =>
      old.map((c) => ({
        ...c,
        turns: c.turns.map((t) =>
          !t.result && !t.error
            ? {
                ...t,
                error: "Response stopped. Send your message again when ready.",
              }
            : t,
        ),
      })),
    );
  }
  if (loadedKey !== key) return <SkeletonPage variant="chat" />;
  return (
    <section
      className={`${styles.page}${compact ? ` ${styles.compact}` : ""}${!historyOpen ? ` ${styles.historyClosed}` : ""}`}
      aria-label="Enercore AI chat"
      data-history-open={!compact && historyOpen}
    >
      {!compact && (
        <aside
          id={historyId}
          className={styles.history}
          aria-label="Chat history"
          aria-hidden={!historyOpen}
          inert={!historyOpen}
        >
          <div className={styles.historyInner}>
            <div className={styles.historyTop}>
              <strong>
                <Sparkles size={17} />
                Enercore AI
              </strong>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Hide chat history"
                ref={historyClose}
                aria-controls={historyId}
                aria-expanded={historyOpen}
                onClick={() => toggleHistory(false)}
              >
                <PanelLeftClose size={16} />
              </Button>
            </div>
            <Button
              className={styles.newChat}
              variant="secondary"
              disabled={pending}
              onClick={newChat}
            >
              <Plus size={15} />
              New chat
            </Button>
            <p className={styles.historyLabel}>Recent conversations</p>
            <div className={styles.historyList}>
              {chats
                .filter((c) => c.turns.length)
                .map((c) => (
                  <div
                    key={c.id}
                    className={styles.historyItem}
                    data-active={c.id === active}
                  >
                    <button
                      type="button"
                      disabled={pending}
                      aria-current={c.id === active ? "true" : undefined}
                      onClick={() => {
                        setActive(c.id);
                        setQuestion("");
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>{c.title}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={`Delete chat: ${c.title}`}
                      onClick={() => setRemoving(c)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
              {!chats.some((c) => c.turns.length) && (
                <p className={styles.historyEmpty}>
                  Your conversations will appear here.
                </p>
              )}
            </div>
            <small>
              {storageError
                ? "Chat history could not be saved in this browser."
                : preview
                  ? "Saved on this device · 7 days\nOnly this role and company scope"
                  : "Questions saved here · 7 days\nCRM answers stay in this session"}
            </small>
          </div>
        </aside>
      )}
      <div className={styles.content}>
        <header className={styles.heading}>
          <div>
            {!compact && !historyOpen && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Show chat history"
                ref={historyToggle}
                aria-controls={historyId}
                aria-expanded={historyOpen}
                onClick={() => toggleHistory(true)}
              >
                <PanelLeftOpen size={16} />
              </Button>
            )}
            <h1>
              {compact ? "Page assistant" : chat?.title || "New conversation"}
            </h1>
            <span className={styles.state}>
              {preview
                ? "Demo"
                : status?.available
                  ? "Connected"
                  : "Not connected"}
            </span>
          </div>
          {compact && (
            <Button
              variant="ghost"
              size="small"
              disabled={pending}
              onClick={newChat}
            >
              <Plus size={14} />
              New chat
            </Button>
          )}
        </header>
        <div
          className={styles.conversation}
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {!turns.length ? (
            <div className={styles.welcome}>
              <span className={styles.orb}>
                <Sparkles size={27} />
              </span>
              <h2>
                {compact
                  ? "What can I help with here?"
                  : `How can I help, ${actor.name.split(" ")[0]}?`}
              </h2>
              <p>
                {compact
                  ? `Ask about ${pageGuide(page).title.toLowerCase()} or switch on “Use this page” for context.`
                  : "Ask about your work, understand a record, or plan your next step."}
              </p>
              <div className={styles.suggestions}>
                {[
                  ...(compact
                    ? [
                        {
                          label: "Explain this page",
                          question:
                            "Explain this page and what I should do next.",
                        },
                      ]
                    : []),
                  ...suggestions,
                ]
                  .slice(0, 3)
                  .map((s) => (
                    <Button
                      key={s.label}
                      variant="secondary"
                      onClick={() => {
                        setQuestion(s.question);
                        if (compact && s.label === "Explain this page")
                          setUsePage(true);
                        composer.current?.focus();
                      }}
                    >
                      {s.label}
                    </Button>
                  ))}
              </div>
            </div>
          ) : (
            <ol className={styles.turns}>
              {turns.map((t) => (
                <li key={t.id}>
                  <div className={styles.userMessage}>
                    <span className="sr-only">You: </span>
                    {t.question}
                    {t.pageLabel && (
                      <small>
                        <ScanEye size={11} />
                        {t.pageLabel}
                      </small>
                    )}
                  </div>
                  <div className={styles.answer}>
                    <span className={styles.answerMark}>
                      <Sparkles size={16} />
                    </span>
                    <div>
                      {t.result ? (
                        <ChatAnswer
                          result={t.result}
                          saved={restored.current.has(t.id)}
                        />
                      ) : t.error ? (
                        <p role="alert" className={styles.error}>
                          {t.error}
                        </p>
                      ) : (
                        <div
                          className={styles.thinking}
                          role="status"
                          aria-label="Preparing an answer"
                        >
                          <SkeletonText
                            lines={3}
                            width={["95%", "82%", "60%"]}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div ref={end} />
        </div>
        <div className={styles.composerArea}>
          {!available && (
            <div className={styles.notice} role="status">
              {status === undefined ? (
                <SkeletonText lines={1} />
              ) : (
                "Groq is not connected. You can still use the CRM normally."
              )}
            </div>
          )}
          <Form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={composer}
              aria-label="Message Enercore AI"
              placeholder={
                compact ? "Ask about this page…" : "Message Enercore AI…"
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={600}
              disabled={!available}
              rows={1}
            />
            <div className={styles.composerBottom}>
              <label className={styles.pageSwitch}>
                <input
                  type="checkbox"
                  aria-label="Use current page context"
                  checked={usePage}
                  onChange={(e) => setUsePage(e.target.checked)}
                />
                <ScanEye size={14} />
                Use this page
              </label>
              {pending ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Stop response"
                  onClick={stop}
                >
                  <Square size={14} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  size="icon"
                  aria-label="Send message"
                  disabled={!available || question.trim().length < 2}
                >
                  <ArrowUp size={17} />
                </Button>
              )}
            </div>
            {usePage && (
              <p className={styles.contextNote}>
                Shares {pageGuide(page).title}, company and the selected non-HR
                record with your message. No screen image, unsaved form fields
                or files.
              </p>
            )}
          </Form>
          <p className={styles.note}>
            <ShieldCheck size={11} />
            {preview
              ? "Demo · fictional data, no model calls"
              : "Sent only when you press Send. Check important answers."}
          </p>
        </div>
      </div>
      {removing && (
        <Dialog title="Delete this chat?" onClose={() => setRemoving(null)}>
          <p>{removing.title}</p>
          <p>
            This removes the saved conversation from this browser. CRM records
            are unchanged.
          </p>
          <DialogActions
            onCancel={() => setRemoving(null)}
            primary={{
              label: "Delete chat",
              tone: "danger",
              onClick: () => {
                setChats((old) => old.filter((c) => c.id !== removing.id));
                if (active === removing.id) setActive("");
                setRemoving(null);
              },
            }}
          />
        </Dialog>
      )}
    </section>
  );
}
