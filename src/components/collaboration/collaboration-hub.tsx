"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Compass, Hash, Lock, MessageSquarePlus, Plus, RotateCcw, Search } from "lucide-react";
import type {
  CollabEvent,
  ConversationDetail,
  ConversationSummary,
  DiscoverableRoom,
  MentionItem,
} from "@/lib/collab";
import { excerpt, UNREAD_CAP } from "@/lib/collab";
import type { Actor } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
import { collabFetch, CollabRequestError, useCollabEvents, useLiveState } from "@/lib/collab-client";
import { Button, DialogPresence, Input } from "../ui/controls";
import { SkeletonListRow } from "../ui/skeleton";
import { Avatar } from "../avatar";
import Thread from "./thread";
import Details from "./details";
import { BrowseRoomsDialog, NewDirectDialog, NewRoomDialog } from "./dialogs";
import { MessageText, listStamp } from "./message-text";

type Filter = "all" | "direct" | "rooms" | "unread" | "mentions";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All chats" },
  { id: "direct", label: "Direct messages" },
  { id: "rooms", label: "Rooms" },
  { id: "unread", label: "Unread" },
  { id: "mentions", label: "Mentions" },
];

const countLabel = (n: number) => (n > UNREAD_CAP ? `${UNREAD_CAP}+` : String(n));

function selectedFromUrl() {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("c");
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

function writeSelection(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  window.history.replaceState(window.history.state, "", url);
}

/**
 * Collaboration Hub: conversation list | thread | optional details on
 * desktop; list → full-screen thread on mobile. Loaded on demand, so none of
 * this reaches people who never open it.
 */
export default function CollaborationHub({ actor, preview }: { actor: Actor; preview: boolean }) {
  const enabled = !preview;
  const live = useLiveState(enabled);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [joinable, setJoinable] = useState<DiscoverableRoom | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dialog, setDialog] = useState<"direct" | "room" | "browse" | null>(null);
  const [mentions, setMentions] = useState<{ items: MentionItem[]; nextBefore: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState(false);

  const selectedRef = useRef<string | null>(null);
  const readSent = useRef(new Map<string, string>());
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listRef = useRef<ConversationSummary[] | null>(null);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    listRef.current = conversations;
  }, [conversations]);

  /* --------------------------------------------------------------- data */

  const loadList = useCallback(async () => {
    try {
      const { conversations } = await collabFetch<{ conversations: ConversationSummary[] }>("/conversations");
      setConversations(conversations);
      setListError(false);
      return conversations;
    } catch {
      setListError(true);
      setConversations((c) => c ?? []);
      return null;
    }
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void loadList(), 300);
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await collabFetch<ConversationDetail | { preview: DiscoverableRoom }>(`/conversations/${id}`);
      if (selectedRef.current !== id) return;
      if ("preview" in data) {
        setDetail(null);
        setJoinable(data.preview);
      } else {
        setDetail(data);
        setJoinable(null);
        // Keep the list entry in step with what the server just said.
        setConversations((list) =>
          list?.some((c) => c.id === id)
            ? list.map((c) => (c.id === id ? { ...data.conversation, unread: c.unread, mentions: c.mentions } : c))
            : list
              ? [data.conversation, ...list]
              : list,
        );
      }
    } catch (error) {
      if (selectedRef.current !== id) return;
      if (error instanceof CollabRequestError && error.status === 404) {
        setNotice("That conversation isn't available.");
        setSelectedId(null);
        writeSelection(null);
      }
    }
  }, []);

  const loadMentions = useCallback(async (before?: string | null) => {
    try {
      const page = await collabFetch<{ items: MentionItem[]; nextBefore: string | null }>(
        `/mentions${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      );
      setMentions((current) =>
        before && current ? { items: [...current.items, ...page.items], nextBefore: page.nextBefore } : page,
      );
    } catch {
      setMentions((current) => current ?? { items: [], nextBefore: null });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadList();
    const initial = selectedFromUrl();
    if (initial) setSelectedId(initial);
  }, [enabled, loadList]);

  useEffect(() => {
    setDetail(null);
    setJoinable(null);
    if (selectedId && enabled) void loadDetail(selectedId);
  }, [selectedId, enabled, loadDetail]);

  useEffect(() => {
    if (filter === "mentions" && enabled) void loadMentions();
  }, [filter, enabled, loadMentions]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      for (const t of readTimers.current.values()) clearTimeout(t);
    },
    [],
  );

  /* ----------------------------------------------------------- realtime */

  const onEvent = useCallback(
    (event: CollabEvent) => {
      const id = event.conversationId;
      if (event.type === "message.created") {
        const m = event.message;
        const mine = m.author.id === actor.id;
        const viewing = selectedRef.current === id && document.visibilityState === "visible";
        const mentionsMe = m.mentions.some((x) => x.id === actor.id);
        // A conversation not in the list yet (a new DM, a room someone just
        // added us to) is fetched rather than guessed at.
        if (!listRef.current?.some((c) => c.id === id)) {
          scheduleRefetch();
          if (mentionsMe && filter === "mentions") void loadMentions();
          return;
        }
        setConversations((list) => {
          const found = list?.find((c) => c.id === id);
          if (!list || !found) return list;
          const updated: ConversationSummary = {
            ...found,
            lastMessageAt: m.createdAt,
            lastMessage: { authorName: m.author.name, excerpt: excerpt(m.body, 90), mine },
            unread: mine || viewing ? found.unread : found.unread + 1,
            mentions: mentionsMe && !viewing ? found.mentions + 1 : found.mentions,
          };
          return [updated, ...list.filter((c) => c.id !== id)];
        });
        if (mentionsMe && filter === "mentions") void loadMentions();
        return;
      }
      if (event.type === "conversation.removed") {
        setConversations((list) => list?.filter((c) => c.id !== id) ?? list);
        if (selectedRef.current === id) {
          setSelectedId(null);
          writeSelection(null);
          setNotice("You're no longer a member of that room.");
        }
        return;
      }
      if (event.type === "read") {
        setConversations((list) =>
          list?.map((c) =>
            c.id === id && (!c.lastReadMessageId || event.lastReadMessageId > c.lastReadMessageId)
              ? { ...c, lastReadMessageId: event.lastReadMessageId }
              : c,
          ) ?? list,
        );
      }
      scheduleRefetch();
      if (event.type === "conversation.changed" && selectedRef.current === id) void loadDetail(id);
    },
    [actor.id, filter, loadDetail, loadMentions, scheduleRefetch],
  );

  useCollabEvents(enabled, onEvent, () => {
    void loadList();
    if (selectedRef.current) void loadDetail(selectedRef.current);
  });

  /* ------------------------------------------------------------ actions */

  const open = (id: string, messageId: string | null = null) => {
    setSelectedId(id);
    setJumpTo(messageId);
    writeSelection(id);
  };

  const onOpened = (conversation: ConversationSummary) => {
    setDialog(null);
    setConversations((list) => (list ? [conversation, ...list.filter((c) => c.id !== conversation.id)] : [conversation]));
    open(conversation.id);
  };

  /**
   * Marks read up to `messageId`, coalesced per conversation and never
   * backwards. The badge clears immediately; the server write follows.
   */
  const onRead = useCallback((conversationId: string, messageId: string) => {
    setConversations((list) =>
      list?.map((c) =>
        c.id === conversationId ? { ...c, unread: 0, mentions: 0, lastReadMessageId: messageId } : c,
      ) ?? list,
    );
    const sent = readSent.current.get(conversationId);
    if (sent && sent >= messageId) return;
    const timers = readTimers.current;
    const existing = timers.get(conversationId);
    if (existing) clearTimeout(existing);
    timers.set(
      conversationId,
      setTimeout(() => {
        timers.delete(conversationId);
        readSent.current.set(conversationId, messageId);
        collabFetch(`/conversations/${conversationId}/read`, { method: "POST", body: { messageId } }).catch(() =>
          readSent.current.delete(conversationId),
        );
      }, 500),
    );
  }, []);

  const messagePerson = async (userId: string) => {
    try {
      const { conversation } = await collabFetch<{ conversation: ConversationSummary }>("/conversations", {
        method: "POST",
        body: { kind: "direct", userId },
      });
      onOpened(conversation);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const join = async (id: string) => {
    setJoining(true);
    try {
      await collabFetch(`/conversations/${id}/members`, { method: "POST", body: { join: true } });
      await loadList();
      await loadDetail(id);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setJoining(false);
    }
  };

  /* ------------------------------------------------------------- derive */

  const counts = useMemo(() => {
    const list = conversations ?? [];
    return {
      unread: list.filter((c) => c.unread > 0).length,
      mentions: list.reduce((n, c) => n + c.mentions, 0),
    };
  }, [conversations]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (conversations ?? [])
      .filter((c) =>
        filter === "direct"
          ? c.kind === "direct"
          : filter === "rooms"
            ? c.kind === "room"
            : filter === "unread"
              ? c.unread > 0
              : true,
      )
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      // Archived rooms sink to the end but stay reachable.
      .sort((a, b) => Number(a.archived) - Number(b.archived));
  }, [conversations, filter, query]);

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  /* ------------------------------------------------------------- render */

  if (preview)
    return (
      <div className="collab collab-unavailable">
        <div className="collab-empty">
          <p className="collab-empty-title">Collaboration is part of the live workspace.</p>
          <p>The preview uses fictional data in your browser, so there is no one to talk to here.</p>
        </div>
      </div>
    );

  return (
    <div
      className={[
        "collab",
        selectedId ? "has-selection" : "",
        detailsOpen && selectedId ? "has-details" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <aside className="collab-sidebar" aria-label="Conversations">
        <div className="collab-sidebar-head">
          <h1>Collaboration</h1>
          <div className="collab-sidebar-actions">
            <Button className="icon-button" aria-label="Browse rooms" title="Browse rooms" onClick={() => setDialog("browse")}>
              <Compass size={17} />
            </Button>
            <Button className="icon-button" aria-label="New room" title="New room" onClick={() => setDialog("room")}>
              <Plus size={18} />
            </Button>
            <Button className="icon-button" aria-label="New message" title="New message" onClick={() => setDialog("direct")}>
              <MessageSquarePlus size={17} />
            </Button>
          </div>
        </div>
        <div className="collab-search">
          <Search size={15} aria-hidden="true" />
          <Input
            aria-label="Filter conversations"
            placeholder="Find a conversation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="collab-filters" role="tablist" aria-label="Show">
          {filters.map((f) => {
            const n = f.id === "unread" ? counts.unread : f.id === "mentions" ? counts.mentions : 0;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={filter === f.id ? "is-active" : ""}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {n > 0 && <span className="collab-count">{countLabel(n)}</span>}
              </button>
            );
          })}
        </div>

        <div className="collab-list" role={filter === "mentions" ? undefined : "list"}>
          {filter === "mentions" ? (
            <MentionsList
              data={mentions}
              meId={actor.id}
              loadingMore={loadingMore}
              onOpen={(item) => open(item.conversation.id, item.message.id)}
              onMore={async () => {
                setLoadingMore(true);
                await loadMentions(mentions?.nextBefore);
                setLoadingMore(false);
              }}
            />
          ) : conversations === null ? (
            <div aria-busy="true" aria-label="Loading conversations">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonListRow key={i} />
              ))}
            </div>
          ) : listError && !conversations.length ? (
            <div className="collab-empty">
              <p>Couldn&apos;t load conversations.</p>
              <Button className="secondary compact" onClick={() => void loadList()}>
                <RotateCcw size={14} /> Try again
              </Button>
            </div>
          ) : !visible.length ? (
            <ListEmpty
              filter={filter}
              searching={!!query.trim()}
              onDirect={() => setDialog("direct")}
              onRoom={() => setDialog("room")}
              onBrowse={() => setDialog("browse")}
            />
          ) : (
            visible.map((c) => (
              <ConversationRow key={c.id} c={c} active={c.id === selectedId} onOpen={() => open(c.id)} />
            ))
          )}
        </div>
      </aside>

      <main className="collab-main">
        {selected ? (
          <Thread
            key={selected.id}
            conversation={selected}
            members={detail?.members ?? []}
            actor={actor}
            jumpTo={jumpTo}
            live={live}
            detailsOpen={detailsOpen}
            onBack={() => {
              setSelectedId(null);
              writeSelection(null);
            }}
            onToggleDetails={() => setDetailsOpen((o) => !o)}
            onRead={onRead}
          />
        ) : joinable ? (
          <div className="collab-empty collab-join">
            <span className="collab-room-icon is-large" aria-hidden="true">
              <Hash size={22} />
            </span>
            <p className="collab-empty-title">{joinable.title}</p>
            {joinable.description && <p>{joinable.description}</p>}
            <p className="collab-join-meta">
              {joinable.memberCount} {joinable.memberCount === 1 ? "member" : "members"} ·{" "}
              {joinable.branch ? `${companyName(joinable.company)} · ${joinable.branch}` : companyName(joinable.company)}
            </p>
            <Button className="primary" loading={joining} onClick={() => void join(joinable.id)}>
              Join room
            </Button>
          </div>
        ) : selectedId && conversations === null ? null : (
          <div className="collab-empty collab-placeholder">
            <p className="collab-empty-title">
              {conversations?.length ? "Select a conversation" : "No conversations yet."}
            </p>
            <p>
              {conversations?.length
                ? "Pick a chat on the left, or start a new one."
                : "Start a conversation with your team."}
            </p>
            <div className="collab-empty-actions">
              <Button className="primary" onClick={() => setDialog("direct")}>
                <MessageSquarePlus size={15} /> New message
              </Button>
              <Button className="secondary" onClick={() => setDialog("room")}>
                <Plus size={15} /> New room
              </Button>
            </div>
          </div>
        )}
      </main>

      {selected && detailsOpen && (
        <Details
          detail={detail}
          actor={actor}
          onClose={() => setDetailsOpen(false)}
          onChanged={() => {
            void loadDetail(selected.id);
            scheduleRefetch();
          }}
          onLeft={() => {
            setConversations((list) => list?.filter((c) => c.id !== selected.id) ?? list);
            setSelectedId(null);
            setDetailsOpen(false);
            writeSelection(null);
          }}
          onMessage={(userId) => void messagePerson(userId)}
        />
      )}

      {notice && (
        <p className="collab-toast" role="status">
          {notice}
        </p>
      )}

      <DialogPresence>
        {dialog === "direct" && <NewDirectDialog onClose={() => setDialog(null)} onOpened={onOpened} />}
        {dialog === "room" && <NewRoomDialog actor={actor} onClose={() => setDialog(null)} onCreated={onOpened} />}
        {dialog === "browse" && (
          <BrowseRoomsDialog
            onClose={() => setDialog(null)}
            onJoined={async (id) => {
              setDialog(null);
              await loadList();
              open(id);
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function ConversationRow({ c, active, onOpen }: { c: ConversationSummary; active: boolean; onOpen: () => void }) {
  const unread = c.unread > 0;
  const preview = c.lastMessage
    ? `${c.lastMessage.mine ? "You" : c.kind === "room" ? c.lastMessage.authorName.split(" ")[0] : ""}${
        c.lastMessage.mine || c.kind === "room" ? ": " : ""
      }${c.lastMessage.excerpt}`
    : c.kind === "room"
      ? c.description || "No messages yet"
      : "No messages yet";
  return (
    <button
      type="button"
      role="listitem"
      className={[
        "collab-row",
        active ? "is-active" : "",
        unread ? "is-unread" : "",
        c.archived ? "is-archived" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
    >
      {c.kind === "direct" ? (
        <Avatar name={c.title} size={34} />
      ) : (
        <span className="collab-room-icon" aria-hidden="true">
          {c.visibility === "private" ? <Lock size={14} /> : <Hash size={15} />}
        </span>
      )}
      <span className="collab-row-main">
        <span className="collab-row-top">
          <b>{c.title}</b>
          <time>{listStamp(c.lastMessageAt ?? c.createdAt)}</time>
        </span>
        <span className="collab-row-bottom">
          <span className="collab-row-preview">{c.archived ? `Archived · ${preview}` : preview}</span>
          {c.mentions > 0 && (
            <span className="collab-count is-mention" aria-label={`${c.mentions} mentions`}>
              @
            </span>
          )}
          {unread && (
            <span className="collab-count" aria-label={`${c.unread} unread`}>
              {countLabel(c.unread)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function ListEmpty({
  filter,
  searching,
  onDirect,
  onRoom,
  onBrowse,
}: {
  filter: Filter;
  searching: boolean;
  onDirect: () => void;
  onRoom: () => void;
  onBrowse: () => void;
}) {
  if (searching)
    return (
      <div className="collab-empty is-compact">
        <p>No conversations match that search.</p>
      </div>
    );
  if (filter === "unread")
    return (
      <div className="collab-empty is-compact">
        <p className="collab-empty-title">No unread messages.</p>
        <p>You&apos;re all caught up.</p>
      </div>
    );
  if (filter === "direct")
    return (
      <div className="collab-empty is-compact">
        <p className="collab-empty-title">No direct messages yet.</p>
        <Button className="secondary compact" onClick={onDirect}>
          <MessageSquarePlus size={14} /> New message
        </Button>
      </div>
    );
  if (filter === "rooms")
    return (
      <div className="collab-empty is-compact">
        <p className="collab-empty-title">No rooms yet.</p>
        <div className="collab-empty-actions">
          <Button className="secondary compact" onClick={onRoom}>
            <Plus size={14} /> New room
          </Button>
          <Button className="secondary compact" onClick={onBrowse}>
            <Compass size={14} /> Browse
          </Button>
        </div>
      </div>
    );
  return (
    <div className="collab-empty is-compact">
      <p className="collab-empty-title">No conversations yet.</p>
      <p>Start a conversation with your team.</p>
      <div className="collab-empty-actions">
        <Button className="secondary compact" onClick={onDirect}>
          <MessageSquarePlus size={14} /> New message
        </Button>
        <Button className="secondary compact" onClick={onRoom}>
          <Plus size={14} /> New room
        </Button>
      </div>
    </div>
  );
}

function MentionsList({
  data,
  meId,
  loadingMore,
  onOpen,
  onMore,
}: {
  data: { items: MentionItem[]; nextBefore: string | null } | null;
  meId: string;
  loadingMore: boolean;
  onOpen: (item: MentionItem) => void;
  onMore: () => void;
}) {
  if (!data)
    return (
      <div aria-busy="true" aria-label="Loading mentions">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonListRow key={i} />
        ))}
      </div>
    );
  if (!data.items.length)
    return (
      <div className="collab-empty is-compact">
        <AtSign size={20} aria-hidden="true" />
        <p className="collab-empty-title">No mentions yet.</p>
        <p>When someone @mentions you, it shows up here.</p>
      </div>
    );
  return (
    <ul className="collab-mentions">
      {data.items.map((item) => (
        <li key={item.message.id}>
          <button type="button" className={item.unread ? "is-unread" : ""} onClick={() => onOpen(item)}>
            <span className="collab-mention-where">
              {item.conversation.kind === "room" ? <Hash size={12} aria-hidden="true" /> : null}
              {item.conversation.title}
              <time>{listStamp(item.message.createdAt)}</time>
            </span>
            <span className="collab-mention-who">
              <Avatar name={item.message.author.name} size={22} />
              <b>{item.message.author.name}</b>
            </span>
            <span className="collab-mention-text">
              <MessageText body={excerpt(item.message.body, 220)} mentions={item.message.mentions} meId={meId} />
            </span>
          </button>
        </li>
      ))}
      {data.nextBefore && (
        <li className="collab-older">
          <Button className="secondary compact" loading={loadingMore} onClick={onMore}>
            Load more
          </Button>
        </li>
      )}
    </ul>
  );
}
