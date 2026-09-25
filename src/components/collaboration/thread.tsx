"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Archive,
  CornerUpLeft,
  Hash,
  Lock,
  PanelRight,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  ConversationMemberView,
  ConversationSummary,
  MessagePage,
  MessageView,
  ReplyPreview,
} from "@/lib/collab";
import { excerpt } from "@/lib/collab";
import { businessDateTimeLong } from "@/lib/gst";
import type { Actor } from "@/lib/domain";
import { clientKey, collabFetch, useCollabEvents, type LiveState } from "@/lib/collab-client";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { Skeleton } from "../ui/skeleton";
import { Avatar } from "../avatar";
import Composer from "./composer";
import { MessageText, dayKey, dayLabel, timeOf } from "./message-text";

type Local = MessageView & { pending?: "sending" | "failed"; mentionIds?: string[] };

type ScrollIntent = { kind: "bottom" } | { kind: "message"; id: string } | { kind: "keep"; height: number; top: number };

const GROUP_WINDOW_MS = 5 * 60_000;

export default function Thread({
  conversation,
  members,
  actor,
  jumpTo,
  live,
  detailsOpen,
  onBack,
  onToggleDetails,
  onRead,
}: {
  conversation: ConversationSummary;
  members: ConversationMemberView[];
  actor: Actor;
  jumpTo: string | null;
  live: LiveState;
  detailsOpen: boolean;
  onBack: () => void;
  onToggleDetails: () => void;
  onRead: (conversationId: string, messageId: string) => void;
}) {
  const [items, setItems] = useState<Local[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Local | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [notice, setNotice] = useState("");

  const scroller = useRef<HTMLDivElement>(null);
  const intent = useRef<ScrollIntent | null>(null);
  const atBottom = useRef(true);
  const itemsRef = useRef<Local[]>([]);
  const hasNewerRef = useRef(false);
  // The read position when the conversation was opened; the "New" divider
  // stays where it was even as the cursor moves on.
  const unreadFrom = useRef(conversation.lastReadMessageId);
  const conversationId = conversation.id;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);

  const apply = (page: MessagePage, next: ScrollIntent) => {
    intent.current = next;
    setItems(page.messages);
    setHasOlder(page.hasOlder);
    setHasNewer(page.hasNewer);
  };

  const load = useCallback(
    async (target: string | null) => {
      setStatus("loading");
      try {
        const page = await collabFetch<MessagePage>(
          `/conversations/${conversationId}/messages${target ? `?around=${encodeURIComponent(target)}` : ""}`,
        );
        apply(page, target ? { kind: "message", id: target } : { kind: "bottom" });
        setStatus("ready");
        if (target) setFlash(target);
      } catch {
        setStatus("error");
      }
    },
    [conversationId],
  );

  useEffect(() => {
    unreadFrom.current = conversation.lastReadMessageId;
    setReplyTo(null);
    setEditing(null);
    setNewBelow(0);
    void load(jumpTo);
    // Only a new conversation or a new jump target reloads; summary updates
    // (unread counts etc.) must not, so the summary is read, not depended on.
  }, [conversationId, jumpTo, load]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);

  /* ----------------------------------------------------------- scrolling */

  useLayoutEffect(() => {
    const el = scroller.current;
    const next = intent.current;
    if (!el || !next) return;
    intent.current = null;
    if (next.kind === "bottom") {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    } else if (next.kind === "keep") {
      el.scrollTop = el.scrollHeight - next.height + next.top;
    } else {
      document.getElementById(`msg-${next.id}`)?.scrollIntoView({ block: "center" });
    }
  }, [items]);

  const markRead = useCallback(() => {
    if (hasNewerRef.current || document.visibilityState !== "visible") return;
    const newest = [...itemsRef.current].reverse().find((m) => !m.pending);
    if (newest) onRead(conversationId, newest.id);
  }, [conversationId, onRead]);

  // Opening (or loading the latest page of) a conversation reads it.
  useEffect(() => {
    if (status === "ready" && atBottom.current) markRead();
  }, [status, markRead]);

  const loadOlder = async () => {
    const el = scroller.current;
    const first = items.find((m) => !m.pending);
    if (!el || !first || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const page = await collabFetch<MessagePage>(
        `/conversations/${conversationId}/messages?before=${encodeURIComponent(first.id)}`,
      );
      intent.current = { kind: "keep", height: el.scrollHeight, top: el.scrollTop };
      setItems((current) => [...page.messages.filter((m) => !current.some((c) => c.id === m.id)), ...current]);
      setHasOlder(page.hasOlder);
    } catch {
      setNotice("Couldn't load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const loadingNewer = useRef(false);
  const loadNewer = async () => {
    const last = [...itemsRef.current].reverse().find((m) => !m.pending);
    if (!last || loadingNewer.current) return;
    loadingNewer.current = true;
    try {
      const page = await collabFetch<MessagePage>(
        `/conversations/${conversationId}/messages?after=${encodeURIComponent(last.id)}`,
      );
      setItems((current) => [...current, ...page.messages.filter((m) => !current.some((c) => c.id === m.id))]);
      setHasNewer(page.hasNewer);
    } catch {
      setNotice("Couldn't load newer messages.");
    } finally {
      loadingNewer.current = false;
    }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = bottom;
    if (bottom && newBelow) {
      setNewBelow(0);
      markRead();
    }
    if (bottom && hasNewer) void loadNewer();
    if (el.scrollTop < 160 && hasOlder && !loadingOlder) void loadOlder();
  };

  const jumpToLatest = () => {
    setNewBelow(0);
    if (hasNewer) void load(null);
    else {
      intent.current = { kind: "bottom" };
      setItems((c) => [...c]);
      markRead();
    }
  };

  const locate = (id: string) => {
    if (document.getElementById(`msg-${id}`)) {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(id);
    } else void load(id);
  };

  /* -------------------------------------------------------------- realtime */

  useCollabEvents(
    true,
    (event) => {
      if (event.conversationId !== conversationId) return;
      if (event.type === "message.created") {
        if (hasNewerRef.current) {
          setNewBelow((n) => n + 1);
          return;
        }
        const message = event.message;
        const mine = message.author.id === actor.id;
        const stick = mine || atBottom.current;
        if (stick) intent.current = { kind: "bottom" };
        setItems((current) => {
          if (current.some((m) => m.id === message.id)) return current;
          const optimistic = message.clientKey
            ? current.findIndex((m) => m.pending && m.clientKey === message.clientKey)
            : -1;
          if (optimistic >= 0) return current.map((m, i) => (i === optimistic ? message : m));
          return [...current, message];
        });
        if (!mine) {
          if (stick) setTimeout(markRead, 0);
          else setNewBelow((n) => n + 1);
        }
      } else if (event.type === "message.updated") {
        const message = event.message;
        setItems((current) =>
          current.map((m) =>
            m.id === message.id
              ? message
              : m.replyTo?.id === message.id
                ? { ...m, replyTo: { ...m.replyTo, excerpt: excerpt(message.body, 140) } }
                : m,
          ),
        );
      } else if (event.type === "message.deleted") {
        setItems((current) =>
          current.map((m) =>
            m.id === event.messageId
              ? { ...m, body: "", deleted: true, mentions: [] }
              : m.replyTo?.id === event.messageId
                ? { ...m, replyTo: { ...m.replyTo, excerpt: "", deleted: true } }
                : m,
          ),
        );
      }
    },
    // After a reconnect or focus, pick up anything missed.
    () => {
      if (!hasNewerRef.current && itemsRef.current.length) void loadNewer();
      else if (!itemsRef.current.length) void load(null);
    },
  );

  /* ------------------------------------------------------------- actions */

  const send = async (body: string, mentionIds: string[], key = clientKey()) => {
    const optimistic: Local = {
      id: `~${key}`,
      conversationId,
      author: { id: actor.id, name: actor.name, role: actor.role },
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      replyTo,
      mentions: members.filter((m) => mentionIds.includes(m.id)).map((m) => ({ id: m.id, name: m.name })),
      mentionIds,
      clientKey: key,
      pending: "sending",
    };
    const replyToId = replyTo?.id ?? null;
    if (hasNewer) await load(null);
    intent.current = { kind: "bottom" };
    setItems((current) => [...current.filter((m) => m.clientKey !== key), optimistic]);
    setReplyTo(null);
    try {
      const { message } = await collabFetch<{ message: MessageView }>(
        `/conversations/${conversationId}/messages`,
        { method: "POST", body: { body, replyToId, mentionIds, clientKey: key } },
      );
      setItems((current) =>
        current.some((m) => m.id === message.id)
          ? current.filter((m) => m.clientKey !== key || m.id === message.id)
          : current.map((m) => (m.clientKey === key ? message : m)),
      );
    } catch (error) {
      setItems((current) => current.map((m) => (m.clientKey === key ? { ...m, pending: "failed" } : m)));
      setNotice(error instanceof Error ? error.message : "Message not sent.");
    }
    return true;
  };

  const retry = (m: Local) => {
    setItems((current) => current.filter((x) => x.clientKey !== m.clientKey));
    void send(m.body, m.mentionIds ?? [], m.clientKey ?? undefined);
  };

  const saveEdit = async (m: Local, body: string, mentionIds: string[]) => {
    try {
      const { message } = await collabFetch<{ message: MessageView }>(`/messages/${m.id}`, {
        method: "PATCH",
        body: { body, mentionIds },
      });
      setItems((current) => current.map((x) => (x.id === message.id ? message : x)));
      setEditing(null);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save the change.");
      return false;
    }
  };

  const remove = async (m: Local) => {
    setConfirmDelete(null);
    try {
      await collabFetch(`/messages/${m.id}`, { method: "DELETE" });
      setItems((current) =>
        current.map((x) => (x.id === m.id ? { ...x, body: "", deleted: true, mentions: [] } : x)),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't delete the message.");
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* -------------------------------------------------------------- render */

  const direct = conversation.kind === "direct";
  const firstUnread = items.find(
    (m) => !m.pending && m.author.id !== actor.id && (!unreadFrom.current || m.id > unreadFrom.current),
  )?.id;

  const disabledReason = conversation.archived
    ? "This room is archived. Messages are read-only."
    : direct && conversation.counterpart && !conversation.counterpart.active
      ? `${conversation.counterpart.name}'s account is inactive.`
      : "You can't send messages in this conversation.";

  return (
    <section className="collab-thread" aria-label={`Conversation: ${conversation.title}`}>
      <header className="collab-thread-head">
        <Button className="icon-button collab-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        {direct ? (
          <Avatar name={conversation.title} size={34} />
        ) : (
          <span className="collab-room-icon" aria-hidden="true">
            {conversation.visibility === "private" ? <Lock size={15} /> : <Hash size={16} />}
          </span>
        )}
        <div className="collab-thread-title">
          <h2>{conversation.title}</h2>
          <p>
            {direct
              ? [conversation.counterpart?.role, conversation.counterpart?.active === false ? "Inactive" : null]
                  .filter(Boolean)
                  .join(" · ")
              : [
                  `${conversation.memberCount} ${conversation.memberCount === 1 ? "member" : "members"}`,
                  conversation.visibility === "private" ? "Private" : "Workspace",
                  conversation.branch ? `${conversation.company} · ${conversation.branch}` : conversation.company,
                ].join(" · ")}
          </p>
        </div>
        <span className={`collab-live is-${live}`} role="img" title={liveLabel(live)} aria-label={liveLabel(live)} />
        <Button
          className={`icon-button${detailsOpen ? " is-active" : ""}`}
          aria-label={detailsOpen ? "Hide details" : "Show details"}
          aria-pressed={detailsOpen}
          onClick={onToggleDetails}
        >
          <PanelRight size={18} />
        </Button>
      </header>

      {conversation.archived && (
        <div className="collab-banner" role="status">
          <Archive size={14} aria-hidden="true" /> This room is archived.
        </div>
      )}

      <div className="collab-scroll" ref={scroller} onScroll={onScroll}>
        {status === "loading" ? (
          <ThreadSkeleton />
        ) : status === "error" ? (
          <div className="collab-empty">
            <p>Couldn&apos;t load messages.</p>
            <Button className="secondary compact" onClick={() => void load(jumpTo)}>
              <RotateCcw size={14} /> Try again
            </Button>
          </div>
        ) : !items.length ? (
          <div className="collab-empty is-thread">
            <p className="collab-empty-title">No messages yet.</p>
            <p>{direct ? `Say hello to ${conversation.title}.` : "Start the conversation."}</p>
          </div>
        ) : (
          <ol className="collab-messages">
            {hasOlder ? (
              <li className="collab-older">
                <Button className="secondary compact" loading={loadingOlder} onClick={() => void loadOlder()}>
                  Load earlier messages
                </Button>
              </li>
            ) : (
              <li className="collab-start">Beginning of the conversation</li>
            )}
            {items.map((m, i) => {
              const prev = items[i - 1];
              const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
              const grouped =
                !!prev &&
                !newDay &&
                m.id !== firstUnread &&
                prev.author.id === m.author.id &&
                !m.replyTo &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
              const mine = m.author.id === actor.id;
              return (
                <Fragment key={m.clientKey && m.pending ? `~${m.clientKey}` : m.id}>
                  {newDay && (
                    <li className="collab-day" role="separator">
                      <span>{dayLabel(m.createdAt)}</span>
                    </li>
                  )}
                  {m.id === firstUnread && (
                    <li className="collab-unread-divider" role="separator">
                      <span>New</span>
                    </li>
                  )}
                  <li
                    id={`msg-${m.id}`}
                    className={[
                      "collab-msg",
                      grouped ? "is-grouped" : "",
                      mine ? "is-mine" : "",
                      flash === m.id ? "is-flash" : "",
                      m.pending ? `is-${m.pending}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {grouped ? (
                      <span className="collab-msg-gutter">
                        <time dateTime={m.createdAt} title={`${businessDateTimeLong(m.createdAt)} GST`}>
                          {timeOf(m.createdAt)}
                        </time>
                      </span>
                    ) : (
                      <Avatar name={m.author.name} size={32} className="collab-msg-avatar" />
                    )}
                    <div className="collab-msg-main">
                      {!grouped && (
                        <div className="collab-msg-head">
                          <b>{m.author.name}</b>
                          <time dateTime={m.createdAt} title={`${businessDateTimeLong(m.createdAt)} GST`}>
                            {timeOf(m.createdAt)}
                          </time>
                        </div>
                      )}
                      {m.replyTo && (
                        <button type="button" className="collab-quote" onClick={() => locate(m.replyTo!.id)}>
                          <CornerUpLeft size={12} aria-hidden="true" />
                          {m.replyTo.deleted ? (
                            <em>Original message was deleted</em>
                          ) : (
                            <>
                              <b>{m.replyTo.authorName}</b>
                              <span>{m.replyTo.excerpt}</span>
                            </>
                          )}
                        </button>
                      )}
                      {editing === m.id ? (
                        <Composer
                          mode="edit"
                          members={members}
                          meId={actor.id}
                          initialText={m.body}
                          initialMentions={m.mentions}
                          placeholder="Edit message"
                          autoFocus
                          onCancel={() => setEditing(null)}
                          onSubmit={(body, mentionIds) => saveEdit(m, body, mentionIds)}
                        />
                      ) : m.deleted ? (
                        <p className="collab-msg-deleted">This message was deleted.</p>
                      ) : (
                        <p className="collab-msg-body">
                          <MessageText body={m.body} mentions={m.mentions} meId={actor.id} />
                          {m.editedAt && <span className="collab-edited"> (edited)</span>}
                        </p>
                      )}
                      {m.pending === "sending" && <span className="collab-msg-state">Sending…</span>}
                      {m.pending === "failed" && (
                        <span className="collab-msg-state is-failed">
                          Not sent.
                          <button type="button" onClick={() => retry(m)}>Retry</button>
                          <button
                            type="button"
                            onClick={() => setItems((c) => c.filter((x) => x.clientKey !== m.clientKey))}
                          >
                            Discard
                          </button>
                        </span>
                      )}
                    </div>
                    {!m.deleted && !m.pending && editing !== m.id && (
                      <div className="collab-msg-actions" role="toolbar" aria-label="Message actions">
                        {conversation.canPost && (
                          <Button
                            className="icon-button"
                            aria-label="Reply"
                            title="Reply"
                            onClick={() =>
                              setReplyTo({
                                id: m.id,
                                authorName: m.author.name,
                                excerpt: excerpt(m.body, 140),
                                deleted: false,
                              })
                            }
                          >
                            <CornerUpLeft size={15} />
                          </Button>
                        )}
                        {mine && conversation.canPost && (
                          <Button className="icon-button" aria-label="Edit" title="Edit" onClick={() => setEditing(m.id)}>
                            <Pencil size={14} />
                          </Button>
                        )}
                        {mine && (
                          <Button
                            className="icon-button is-danger"
                            aria-label="Delete"
                            title="Delete"
                            onClick={() => setConfirmDelete(m)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>

      {(newBelow > 0 || hasNewer) && status === "ready" && (
        <Button className="collab-jump" onClick={jumpToLatest}>
          <ArrowDown size={14} />
          {newBelow > 0 ? `${newBelow} new ${newBelow === 1 ? "message" : "messages"}` : "Jump to latest"}
        </Button>
      )}
      {notice && (
        <p className="collab-notice" role="alert">
          {notice}
        </p>
      )}

      <Composer
        key={conversationId}
        draftKey={conversationId}
        members={members}
        meId={actor.id}
        placeholder={direct ? `Message ${conversation.title}` : `Message ${conversation.title}`}
        disabled={!conversation.canPost}
        disabledReason={disabledReason}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSubmit={(body, mentionIds) => send(body, mentionIds)}
      />

      <DialogPresence>
        {confirmDelete && (
          <Dialog title="Delete message?" onClose={() => setConfirmDelete(null)} className="dialog-compact collab-dialog">
            <p className="collab-dialog-text">
              The message is removed for everyone in this conversation. This can&apos;t be undone.
            </p>
            <DialogActions>
              <Button className="danger-button" onClick={() => void remove(confirmDelete)}>
                Delete
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </DialogPresence>
    </section>
  );
}

function liveLabel(state: LiveState) {
  return state === "live"
    ? "Live"
    : state === "connecting"
      ? "Connecting…"
      : state === "unavailable"
        ? "Live updates unavailable. Messages refresh when you return to this tab."
        : "Reconnecting…";
}

function ThreadSkeleton() {
  return (
    <div className="collab-thread-skeleton" aria-busy="true" aria-label="Loading messages">
      {[62, 40, 78, 52, 30].map((w, i) => (
        <div key={i} className="collab-skel-msg">
          <Skeleton w={32} h={32} r={999} />
          <div>
            <Skeleton w={110} h={11} />
            <Skeleton w={`${w}%`} h={13} />
          </div>
        </div>
      ))}
    </div>
  );
}
