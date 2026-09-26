"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Smile } from "lucide-react";
import { Button } from "../ui/controls";
import { clientKey } from "@/lib/collab-client";
import { EMOJI_SET, MESSAGE_MAX } from "@/lib/collab";
import { businessTime } from "@/lib/gst";
import type { MeetingMessageView } from "@/lib/meetings";

/**
 * The meeting's own chat — one panel for employees and admitted guests. It
 * only knows a transport: employees go through their Enercore session,
 * guests through their admission; the server decides who may read or post.
 *
 * New messages are announced (an id, never the text) through the meeting's
 * live channels; each announcement — the `signal` — fetches just what's
 * new with the reader's own access. Nothing polls.
 */

export type ChatTransport = {
  list: (after: number | null) => Promise<MeetingMessageView[]>;
  send: (body: string, clientKey: string) => Promise<MeetingMessageView>;
};

export default function MeetingMessages({
  transport,
  signal,
  canPost,
  className = "",
  endedNote = "The meeting has ended. The chat is read-only now.",
  heading,
  hideEmpty = false,
}: {
  transport: ChatTransport;
  /** Bumped when a new message is announced (or the connection came back). */
  signal: number;
  canPost: boolean;
  className?: string;
  endedNote?: string;
  /** Shown above the messages (e.g. a section title on the details page). */
  heading?: React.ReactNode;
  /** Render nothing at all when there are no messages. */
  hideEmpty?: boolean;
}) {
  const [messages, setMessages] = useState<MeetingMessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const last = useRef<number | null>(null);
  const loading = useRef(false);
  const again = useRef(false);
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const merge = (incoming: MeetingMessageView[]) =>
    setMessages((m) => {
      const known = new Set(m.map((x) => x.id));
      const next = [...m, ...incoming.filter((x) => !known.has(x.id))].sort((a, b) => a.seq - b.seq);
      last.current = next.at(-1)?.seq ?? last.current;
      return next;
    });

  // One fetch at a time; an announcement during a fetch triggers one more.
  const load = useCallback(async () => {
    if (loading.current) return void (again.current = true);
    loading.current = true;
    try {
      merge(await transportRef.current.list(last.current));
      setError("");
    } catch {
      setError("Messages couldn't be loaded. They'll appear when the connection is back.");
    } finally {
      loading.current = false;
      setLoaded(true);
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, signal]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  // Phones: the on-screen keyboard must never cover the composer. The part
  // of the screen it takes is exposed as --meet-keyboard; the sheet sits on it.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--meet-keyboard", `${Math.round(covered)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--meet-keyboard");
    };
  }, []);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      merge([await transport.send(body, clientKey())]);
      setDraft("");
      setEmoji(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent. Try again.");
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  const insert = (value: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + value + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  if (hideEmpty && (!loaded || (!messages.length && !error))) return null;

  return (
    <div className={`meet-chat ${className}`}>
      {heading}
      <ol className="meet-chat-list" ref={list} aria-live="polite" aria-label="Meeting chat messages">
        {messages.map((m) => (
          <li key={m.id} className={m.mine ? "is-mine" : ""}>
            <span className="meet-chat-meta">
              <b>{m.mine ? "You" : m.sender.name}</b>
              {m.sender.guest && !m.mine && <small className="meet-guest-tag">Guest</small>}
              <time dateTime={m.createdAt}>{businessTime(new Date(m.createdAt))}</time>
            </span>
            {/* Plain text only: rendered as text, never as HTML. */}
            <p>{m.deleted ? <em>Message deleted</em> : m.body}</p>
          </li>
        ))}
        {loaded && !messages.length && !error && (
          <li className="meet-chat-empty">
            <b>No messages yet</b>
            <span>Messages sent here are visible to everyone in this meeting.</span>
          </li>
        )}
      </ol>
      {error && (
        <p className="meet-notice" role="alert">
          {error}
        </p>
      )}
      {canPost ? (
        <form
          className="meet-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {emoji && (
            <div className="meet-chat-emoji" role="group" aria-label="Emoji">
              {EMOJI_SET.map((e) => (
                <button key={e} type="button" aria-label={`Insert ${e}`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => insert(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          <Button type="button" className="icon-button" aria-label="Insert emoji" aria-expanded={emoji} onMouseDown={(e) => e.preventDefault()} onClick={() => setEmoji(!emoji)}>
            <Smile size={18} />
          </Button>
          <textarea
            ref={input}
            aria-label="Message everyone"
            rows={1}
            maxLength={MESSAGE_MAX}
            value={draft}
            placeholder="Message everyone…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
              if (e.key === "Escape" && emoji) setEmoji(false);
            }}
          />
          <Button type="submit" className="icon-button primary" aria-label="Send message" disabled={!draft.trim() || sending}>
            <Send size={16} />
          </Button>
        </form>
      ) : (
        <p className="meet-chat-readonly">{endedNote}</p>
      )}
    </div>
  );
}
