"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Archive,
  CornerUpLeft,
  Maximize2,
  Minimize2,
  PanelRight,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type {
  AttachmentView,
  ConversationMemberView,
  ConversationSummary,
  MessagePage,
  MessageView,
  ReactionView,
  ReplyPreview,
} from "@/lib/collab";
import { excerpt } from "@/lib/collab";
import { businessDateTimeLong } from "@/lib/gst";
import type { Actor } from "@/lib/domain";
import { clientKey, collabFetch, presenceLabel, useCollabEvents, usePresence, type LiveState } from "@/lib/collab-client";
import { Button, Dialog, DialogActions, DialogPresence } from "../ui/controls";
import { Skeleton } from "../ui/skeleton";
import { Avatar } from "../avatar";
import Composer, { type ComposerHandle } from "./composer";
import { Lightbox, MessageAttachments, PdfPreview, type LightboxItem } from "./attachments";
import { ReactionChips, ReactionPicker } from "./reactions";
import { PersonAvatar, ProfilePopover } from "./presence";
import { RoomAvatar } from "./room-avatar";
import { MessageText, dayKey, dayLabel, timeOf } from "./message-text";

type Local = MessageView & { pending?: "sending" | "failed"; mentionIds?: string[] };

/** A typing indicator lasts this long without a fresh "start". */
const TYPING_TTL_MS = 6000;

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
  focus,
  onToggleFocus,
  onMessagePerson,
  onManageAccess,
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
  /** Expanded (focus) layout, owned by the hub. */
  focus: boolean;
  onToggleFocus: () => void;
  onMessagePerson: (userId: string) => void;
  onManageAccess?: () => void;
}) {
  const composer = useRef<ComposerHandle>(null);
  const [typers, setTypers] = useState<Map<string, { name: string; until: number }>>(new Map());
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [pdf, setPdf] = useState<AttachmentView | null>(null);
  const [dragging, setDragging] = useState(false);
  const presenceOf = usePresence([
    ...members.map((m) => m.id),
    ...(conversation.counterpart ? [conversation.counterpart.id] : []),
  ]);
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
      if (event.type === "typing") {
        setTypers((current) => {
          const next = new Map(current);
          if (event.state === "start") next.set(event.userId, { name: event.name, until: Date.now() + TYPING_TTL_MS });
          else next.delete(event.userId);
          return next;
        });
        return;
      }
      if (event.type === "reaction") {
        setItems((current) => current.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m)));
        return;
      }
      if (event.type === "message.created") {
        // Their message arrived: they are no longer typing it.
        setTypers((current) => {
          if (!current.has(event.message.author.id)) return current;
          const next = new Map(current);
          next.delete(event.message.author.id);
          return next;
        });
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
              ? { ...m, body: "", deleted: true, mentions: [], attachments: [], reactions: [] }
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

  const send = async (body: string, mentionIds: string[], attachments: AttachmentView[] = [], key = clientKey()) => {
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
      attachments,
      reactions: [],
    };
    const replyToId = replyTo?.id ?? null;
    if (hasNewer) await load(null);
    intent.current = { kind: "bottom" };
    setItems((current) => [...current.filter((m) => m.clientKey !== key), optimistic]);
    setReplyTo(null);
    try {
      const { message } = await collabFetch<{ message: MessageView }>(
        `/conversations/${conversationId}/messages`,
        { method: "POST", body: { body, replyToId, mentionIds, clientKey: key, attachmentIds: attachments.map((a) => a.id) } },
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
    void send(m.body, m.mentionIds ?? [], m.attachments, m.clientKey ?? undefined);
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
        current.map((x) => (x.id === m.id ? { ...x, body: "", deleted: true, mentions: [], attachments: [], reactions: [] } : x)),
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

  /* ---------------------------------------------------------- reactions */
  const toggleReaction = async (m: Local, emoji: string, on: boolean) => {
    const apply = (list: ReactionView[]) => {
      const next = list.map((r) => ({ ...r, userIds: r.userIds.filter((id) => id !== actor.id || (on && r.emoji !== emoji)) }));
      const target = next.find((r) => r.emoji === emoji);
      if (on) {
        if (target) target.userIds = [...target.userIds.filter((id) => id !== actor.id), actor.id];
        else next.push({ emoji, userIds: [actor.id] });
      }
      return next.filter((r) => r.userIds.length);
    };
    // Optimistic; the server's answer (and the realtime event) is final.
    setItems((current) => current.map((x) => (x.id === m.id ? { ...x, reactions: apply(x.reactions) } : x)));
    try {
      const { reactions } = await collabFetch<{ reactions: ReactionView[] }>(`/messages/${m.id}/reactions`, {
        method: "POST",
        body: { emoji, on },
      });
      setItems((current) => current.map((x) => (x.id === m.id ? { ...x, reactions } : x)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't update the reaction.");
      setItems((current) => current.map((x) => (x.id === m.id ? { ...x, reactions: m.reactions } : x)));
    }
  };
  const nameOf = (id: string) => members.find((x) => x.id === id)?.name ?? "Someone";

  /* ------------------------------------------------------------- media */
  const openImage = (attachmentId: string) => {
    const images: LightboxItem[] = items.flatMap((m) =>
      m.deleted
        ? []
        : m.attachments
            .filter((a) => a.kind === "image")
            .map((a) => ({ attachment: a, authorName: m.author.name, createdAt: m.createdAt })),
    );
    const index = images.findIndex((i) => i.attachment.id === attachmentId);
    if (index >= 0) setLightbox({ items: images, index });
  };

  /* ------------------------------------------------------------ typing */
  useEffect(() => {
    if (!typers.size) return;
    const timer = setInterval(() => {
      setTypers((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, t]) => t.until > now));
        return next.size === current.size ? current : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typers.size]);
  const typingNames = [...typers.values()].map((t) => t.name.split(" ")[0]);
  const typingLine =
    typingNames.length === 0
      ? ""
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing…`
          : "Several people are typing…";
  const sendTyping = (state: "start" | "stop") =>
    void collabFetch(`/conversations/${conversationId}/typing`, { method: "POST", body: { state } }).catch(() => {});

  const counterpartPresence = conversation.counterpart ? presenceOf(conversation.counterpart.id) : undefined;
  const onlineMembers = direct ? 0 : members.filter((m) => presenceOf(m.id)?.status === "online").length;
  const memberFor = (id: string) => members.find((x) => x.id === id);

  return (
    <section
      className={`collab-thread${dragging ? " is-dragging" : ""}`}
      aria-label={`Conversation: ${conversation.title}`}
      onDragOver={(e) => {
        if (!conversation.canPost || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!conversation.canPost) return;
        e.preventDefault();
        setDragging(false);
        composer.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="collab-drop" aria-hidden="true">
          <span>Drop files to attach</span>
        </div>
      )}
      <header className="collab-thread-head">
        <Button className="icon-button collab-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        {direct && conversation.counterpart ? (
          <ProfilePopover
            person={{ ...conversation.counterpart, companies: [] }}
            presence={counterpartPresence}
            meId={actor.id}
            onManageAccess={onManageAccess}
          >
            <button type="button" className="collab-avatar-button" aria-label={`Profile of ${conversation.title}`}>
              <PersonAvatar name={conversation.title} size={36} presence={counterpartPresence} />
            </button>
          </ProfilePopover>
        ) : (
          <RoomAvatar room={conversation} size={36} />
        )}
        <div className="collab-thread-title">
          <h2>{conversation.title}</h2>
          <p>
            {direct
              ? [
                  conversation.counterpart?.active === false ? "Inactive" : presenceLabel(counterpartPresence),
                  conversation.counterpart?.role,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : [
                  `${conversation.memberCount} ${conversation.memberCount === 1 ? "member" : "members"}`,
                  onlineMembers ? `${onlineMembers} online` : null,
                  conversation.visibility === "private" ? "Private" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        {/* Header actions. Future call controls ([voice call] [video
            meeting]) slot in at the start of this group without changing
            the layout; see docs in collaboration-hub.tsx. */}
        <div className="collab-thread-actions">
          <span className={`collab-live is-${live}`} role="img" title={liveLabel(live)} aria-label={liveLabel(live)} />
          <Button
            className="icon-button collab-focus-toggle"
            aria-label={focus ? "Exit focus mode" : "Focus mode"}
            aria-pressed={focus}
            title={focus ? "Exit focus mode (Alt+Shift+F)" : "Focus mode (Alt+Shift+F)"}
            onClick={onToggleFocus}
          >
            {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </Button>
          <Button
            className={`icon-button${detailsOpen ? " is-active" : ""}`}
            aria-label={detailsOpen ? "Hide details" : "Show details"}
            aria-pressed={detailsOpen}
            onClick={onToggleDetails}
          >
            <PanelRight size={18} />
          </Button>
        </div>
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
                      <ProfilePopover
                        person={{ ...(memberFor(m.author.id) ?? m.author), active: memberFor(m.author.id)?.active }}
                        presence={presenceOf(m.author.id)}
                        meId={actor.id}
                        onMessage={direct ? undefined : onMessagePerson}
                        onManageAccess={onManageAccess}
                      >
                        <button type="button" className="collab-avatar-button collab-msg-avatar" aria-label={`Profile of ${m.author.name}`}>
                          <Avatar name={m.author.name} size={32} />
                        </button>
                      </ProfilePopover>
                    )}
                    <div className="collab-msg-main">
                      {!grouped && (
                        <div className="collab-msg-head">
                          <ProfilePopover
                            person={{ ...(memberFor(m.author.id) ?? m.author), active: memberFor(m.author.id)?.active }}
                            presence={presenceOf(m.author.id)}
                            meId={actor.id}
                            onMessage={direct ? undefined : onMessagePerson}
                            onManageAccess={onManageAccess}
                          >
                            <button type="button" className="collab-author">
                              {m.author.name}
                            </button>
                          </ProfilePopover>
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
                        <>
                          {m.body && (
                            <p className="collab-msg-body">
                              <MessageText body={m.body} mentions={m.mentions} meId={actor.id} />
                              {m.editedAt && <span className="collab-edited">(edited)</span>}
                            </p>
                          )}
                          <MessageAttachments attachments={m.attachments} onOpenImage={openImage} onOpenPdf={setPdf} />
                          <ReactionChips
                            reactions={m.reactions}
                            meId={actor.id}
                            nameOf={nameOf}
                            disabled={!conversation.canPost || !!m.pending}
                            onToggle={(emoji, on) => void toggleReaction(m, emoji, on)}
                          />
                        </>
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
                          <ReactionPicker
                            onPick={(emoji) =>
                              void toggleReaction(m, emoji, !m.reactions.some((r) => r.emoji === emoji && r.userIds.includes(actor.id)))
                            }
                          />
                        )}
                        {conversation.canPost && (
                          <Button
                            className="icon-button"
                            aria-label="Reply"
                            title="Reply"
                            onClick={() =>
                              setReplyTo({
                                id: m.id,
                                authorName: m.author.name,
                                excerpt: excerpt(m.body, 140) || (m.attachments[0] ? `📎 ${m.attachments[0].name}` : ""),
                                deleted: false,
                              })
                            }
                          >
                            <CornerUpLeft size={15} />
                          </Button>
                        )}
                        {mine && conversation.canPost && !!m.body && (
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

      <p className="collab-typing" aria-live="polite">
        {typingLine && (
          <>
            <span className="collab-typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typingLine}
          </>
        )}
      </p>
      <Composer
        ref={composer}
        key={conversationId}
        conversationId={conversationId}
        onTyping={sendTyping}
        draftKey={conversationId}
        members={members}
        meId={actor.id}
        placeholder={direct ? `Message ${conversation.title}` : `Message ${conversation.title}`}
        disabled={!conversation.canPost}
        disabledReason={disabledReason}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSubmit={(body, mentionIds, attachments) => send(body, mentionIds, attachments)}
      />

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
          onClose={() => setLightbox(null)}
        />
      )}
      <DialogPresence>{pdf && <PdfPreview attachment={pdf} onClose={() => setPdf(null)} />}</DialogPresence>
      <DialogPresence>
        {confirmDelete && (
          <Dialog title="Delete message?" onClose={() => setConfirmDelete(null)} className="dialog-compact collab-dialog">
            <p className="collab-dialog-text">
              The message is removed for everyone in this conversation. This can&apos;t be undone.
            </p>
            <DialogActions primary={{ label: "Delete", tone: "danger", onClick: () => remove(confirmDelete) }} />
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

/**
 * Message groups as they will appear — an opening line with avatar, name and
 * time, then shorter follow-on lines — anchored to the bottom, where a
 * conversation opens, so the real messages replace it without a jump.
 */
function ThreadSkeleton() {
  const groups = [
    [58, 34],
    [72],
    [46, 64, 28],
    [52],
  ];
  return (
    <div className="collab-thread-skeleton" aria-busy="true" aria-label="Loading messages">
      {groups.map((lines, g) => (
        <div key={g} className="collab-skel-group">
          {lines.map((w, i) => (
            <div key={i} className="collab-msg collab-skel-msg">
              {i === 0 ? <Skeleton w={32} h={32} r={999} /> : <span />}
              <div className="collab-skel-lines">
                {i === 0 && <Skeleton w={120} h={11} />}
                <Skeleton w={`${w}%`} h={12} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
