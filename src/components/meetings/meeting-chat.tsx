"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "../ui/controls";
import { clientKey, collabFetch, useCollabEvents } from "@/lib/collab-client";
import { businessTime } from "@/lib/gst";
import type { MessagePage, MessageView } from "@/lib/collab";

/**
 * The meeting's chat IS the linked conversation: it reads and posts through
 * the same Collaboration API and live events, so everything said here stays
 * in the room or DM afterwards, with the same access rules. There is no
 * separate meeting chat store.
 */
export default function MeetingChat({ conversationId, meId }: { conversationId: string; meId: string }) {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);

  const load = useCallback(() => {
    collabFetch<MessagePage>(`/conversations/${conversationId}/messages`)
      .then((page) => setMessages(page.messages))
      .catch(() => setError("Messages couldn't be loaded."));
  }, [conversationId]);
  useEffect(load, [load]);

  useCollabEvents(
    true,
    (event) => {
      if (event.conversationId !== conversationId) return;
      if (event.type === "message.created")
        setMessages((m) => (m.some((x) => x.id === event.message.id || (x.clientKey && x.clientKey === event.message.clientKey)) ? m : [...m, event.message]));
      else if (event.type === "message.updated")
        setMessages((m) => m.map((x) => (x.id === event.message.id ? event.message : x)));
      else if (event.type === "message.deleted")
        setMessages((m) => m.map((x) => (x.id === event.messageId ? { ...x, deleted: true, body: "" } : x)));
    },
    load,
  );

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } = await collabFetch<{ message: MessageView }>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: { body, clientKey: clientKey() },
      });
      setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="meet-chat">
      <ol className="meet-chat-list" ref={list} aria-live="polite">
        {messages.map((m) => (
          <li key={m.id} className={m.author.id === meId ? "is-mine" : ""}>
            <span className="meet-chat-meta">
              <b>{m.author.id === meId ? "You" : m.author.name}</b>
              <time dateTime={m.createdAt}>{businessTime(new Date(m.createdAt))}</time>
            </span>
            <p>{m.deleted ? <em>Message deleted</em> : m.body || (m.attachments.length ? "📎 Attachment" : "")}</p>
          </li>
        ))}
        {!messages.length && !error && <li className="meet-chat-empty">Messages you send here stay in the conversation.</li>}
      </ol>
      {error && <p className="meet-notice" role="alert">{error}</p>}
      <form
        className="meet-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message"
          rows={1}
          maxLength={4000}
          value={draft}
          placeholder="Send a message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" className="icon-button primary" aria-label="Send message" disabled={!draft.trim() || sending}>
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
