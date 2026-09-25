"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCollabEvents } from "./collab-client";
import {
  DEFAULT_PREFERENCES,
  type NotificationInbox,
  type NotificationPreferences,
  type NotificationView,
} from "./notification-types";

/**
 * The browser side of the notification inbox.
 *
 * The server is authoritative: the inbox and unread count come from
 * /api/notifications, and live changes arrive on the person's existing
 * realtime channel (the Collaboration socket, which every signed-in page
 * already holds). Nothing is derived or stored in the browser beyond what is
 * on screen. On reconnect or focus the first page is fetched again, so
 * anything missed while offline appears without polling.
 */

async function call<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(`/api/notifications${path}`, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: init ? { "Content-Type": "application/json" } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string }).error || "Notifications are unavailable.");
  return result as T;
}

export type InboxState = {
  items: NotificationView[];
  unread: number;
  nextBefore: string | null;
  preferences: NotificationPreferences;
  loaded: boolean;
  error: boolean;
};

const EMPTY: InboxState = {
  items: [],
  unread: 0,
  nextBefore: null,
  preferences: DEFAULT_PREFERENCES,
  loaded: false,
  error: false,
};

/** Keeps the fresh first page, then any older items already loaded below it. */
function merge(fresh: NotificationView[], current: NotificationView[]) {
  const last = fresh[fresh.length - 1]?.id;
  const older = last ? current.filter((n) => n.id < last) : [];
  return [...fresh, ...older];
}

export function useNotifications(enabled: boolean, onArrive?: (n: NotificationView, prefs: NotificationPreferences) => void) {
  const [state, setState] = useState<InboxState>(EMPTY);
  // Ids already known to this tab, so a replayed event never alerts twice.
  const seen = useRef(new Set<string>());
  const arrive = useRef(onArrive);
  const prefs = useRef(state.preferences);
  useEffect(() => {
    arrive.current = onArrive;
    prefs.current = state.preferences;
  });

  const refresh = useCallback(async () => {
    try {
      const inbox = await call<NotificationInbox>("");
      for (const n of inbox.items) seen.current.add(n.id);
      setState((s) => ({
        items: merge(inbox.items, s.items),
        unread: inbox.unread,
        nextBefore: s.items.length > inbox.items.length ? s.nextBefore : inbox.nextBefore,
        preferences: inbox.preferences,
        loaded: true,
        error: false,
      }));
    } catch {
      setState((s) => ({ ...s, loaded: true, error: true }));
    }
  }, []);

  // Read-state events adjust what is on screen at once; the count is then
  // re-read from the server, which knows about items not loaded here.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void refresh(), 400);
  }, [refresh]);

  useEffect(() => {
    if (enabled) void refresh();
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [enabled, refresh]);

  useCollabEvents(
    enabled,
    (event) => {
      if (event.type === "notification.created") {
        const n = event.notification;
        if (seen.current.has(n.id)) return;
        seen.current.add(n.id);
        setState((s) =>
          s.items.some((x) => x.id === n.id)
            ? s
            : { ...s, items: [n, ...s.items], unread: s.unread + (n.readAt ? 0 : 1) },
        );
        arrive.current?.(n, prefs.current);
      } else if (event.type === "notification.read") {
        const ids = new Set(event.ids);
        const at = event.read ? new Date().toISOString() : null;
        setState((s) => ({
          ...s,
          items: s.items.map((n) => (ids.has(n.id) ? { ...n, readAt: at, needsAction: at ? false : n.needsAction } : n)),
        }));
        refreshSoon();
      } else if (event.type === "notification.read_all") {
        const at = new Date().toISOString();
        setState((s) => ({
          ...s,
          items: s.items.map((n) => (n.id <= event.upTo && !n.readAt ? { ...n, readAt: at, needsAction: false } : n)),
        }));
        refreshSoon();
      }
    },
    () => void refresh(),
  );

  const loadMore = useCallback(async () => {
    const before = state.nextBefore;
    if (!before) return;
    const page = await call<NotificationInbox>(`?before=${encodeURIComponent(before)}`);
    for (const n of page.items) seen.current.add(n.id);
    setState((s) => ({
      ...s,
      items: [...s.items, ...page.items.filter((n) => !s.items.some((x) => x.id === n.id))],
      nextBefore: page.nextBefore,
    }));
  }, [state.nextBefore]);

  /** Optimistic; the server's events and a refresh settle the real state. */
  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      const at = read ? new Date().toISOString() : null;
      setState((s) => {
        const changed = s.items.filter((n) => ids.includes(n.id) && !!n.readAt !== read).length;
        return {
          ...s,
          unread: Math.max(0, s.unread + (read ? -changed : changed)),
          items: s.items.map((n) => (ids.includes(n.id) ? { ...n, readAt: at } : n)),
        };
      });
      try {
        await call("", { method: "PATCH", body: { action: read ? "read" : "unread", ids } });
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const readAll = useCallback(async () => {
    const upTo = state.items[0]?.id;
    if (!upTo) return;
    const at = new Date().toISOString();
    setState((s) => ({ ...s, unread: 0, items: s.items.map((n) => (n.readAt ? n : { ...n, readAt: at, needsAction: false })) }));
    try {
      await call("", { method: "PATCH", body: { action: "read_all", upTo } });
    } catch {
      void refresh();
    }
  }, [state.items, refresh]);

  const savePreferences = useCallback(async (next: NotificationPreferences) => {
    setState((s) => ({ ...s, preferences: next }));
    try {
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).then((r) => {
        if (!r.ok) throw new Error();
      });
    } catch {
      void refresh();
      throw new Error("Preferences could not be saved.");
    }
  }, [refresh]);

  return { ...state, refresh, loadMore, setRead, readAll, savePreferences };
}

/* ------------------------------------------------------ multi-tab alerts */

/**
 * One alert per notification across every open Enercore tab.
 *
 * Each tab receives the same realtime event. A visible tab claims it at once
 * (it shows the in-app toast); hidden tabs wait a moment, and only the first
 * one still unclaimed shows the desktop alert. Claims are shared over
 * BroadcastChannel; where that is unavailable the desktop alert's `tag`
 * (the notification id) still makes the system replace rather than repeat.
 */
const claimed = new Set<string>();
let channel: BroadcastChannel | null = null;
function alertChannel(userId: string) {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(`enercore-alerts-${userId}`);
  channel.onmessage = (e: MessageEvent<{ claimed?: string }>) => {
    if (typeof e.data?.claimed === "string") claimed.add(e.data.claimed);
  };
  return channel;
}

export async function claimAlert(userId: string, id: string) {
  const bus = alertChannel(userId);
  const visible = document.visibilityState === "visible";
  if (!visible) await new Promise((r) => setTimeout(r, 250 + Math.random() * 300));
  if (claimed.has(id)) return false;
  // Two tabs can reach this point together (two visible windows); a lock
  // held briefly by the winner makes the choice atomic across tabs.
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    if (claimed.size > 500) claimed.clear();
    return new Promise<boolean>((resolve) => {
      void locks
        .request(`enercore-alert-${userId}-${id}`, { ifAvailable: true }, async (lock) => {
          if (!lock || claimed.has(id)) return resolve(false);
          claimed.add(id);
          bus?.postMessage({ claimed: id });
          resolve(true);
          // Held past the hidden tabs' wait, so none can take it after us.
          await new Promise((r) => setTimeout(r, 1500));
        })
        .catch(() => resolve(false));
    });
  }
  claimed.add(id);
  if (claimed.size > 500) claimed.clear();
  bus?.postMessage({ claimed: id });
  return true;
}

export const desktopSupported = () => typeof window !== "undefined" && "Notification" in window;
export const desktopPermission = (): NotificationPermission | "unsupported" =>
  desktopSupported() ? Notification.permission : "unsupported";

/**
 * A system notification, only when this tab is hidden, the person turned
 * desktop alerts on, and the browser already granted permission — it is
 * never requested from here. Clicking focuses Enercore and opens the item.
 */
export function showDesktop(n: NotificationView, prefs: NotificationPreferences, open: () => void) {
  if (!prefs.desktop || !desktopSupported() || Notification.permission !== "granted") return false;
  if (document.visibilityState === "visible") return false;
  const hideText = n.category === "collaboration" && !prefs.preview;
  try {
    const alert = new Notification(n.title, {
      body: hideText ? "New message" : n.body,
      tag: n.id,
      icon: "/icon.svg",
    });
    alert.onclick = () => {
      window.focus();
      open();
      alert.close();
    };
    return true;
  } catch {
    return false;
  }
}
