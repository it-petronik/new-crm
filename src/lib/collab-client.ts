"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollabEvent, CollabSummary } from "./collab";

/* ------------------------------------------------------------------ http */

export class CollabRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON request to the collaboration API; throws with the server's message. */
export async function collabFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/collab${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new CollabRequestError(
      response.status,
      (data as { error?: string }).error || "Something went wrong. Try again.",
    );
  return data as T;
}

/** A random idempotency key for a send, so a retried request never doubles. */
export const clientKey = () => crypto.randomUUID();

/* ---------------------------------------------------------------- socket */

export type LiveState = "connecting" | "live" | "offline" | "unavailable";

type Listener = (event: CollabEvent) => void;

/**
 * One socket per tab, shared by the sidebar badge and the hub.
 *
 * Reconnects with exponential backoff (1s → 60s) and never polls. If the
 * socket cannot be established at all (local dev, or the Durable Object not
 * yet deployed) it gives up after a few attempts and reports "unavailable";
 * a later focus or network change triggers one fresh attempt. Consumers
 * refresh their data on reconnect and on focus, so nothing is missed while a
 * socket was down.
 */
class LiveChannel {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: LiveState) => void>();
  private reconnectListeners = new Set<() => void>();
  private attempts = 0;
  private everOpened = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  state: LiveState = "offline";

  private setState(next: LiveState) {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.stateListeners) l(next);
  }

  private connect() {
    if (this.socket || this.stopped || typeof window === "undefined") return;
    this.setState("connecting");
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/collab/socket`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      const reconnected = this.everOpened;
      this.everOpened = true;
      this.attempts = 0;
      this.setState("live");
      this.ping = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 45_000);
      if (reconnected) for (const l of this.reconnectListeners) l();
    };
    socket.onmessage = (message) => {
      if (typeof message.data !== "string" || message.data === "pong") return;
      let event: CollabEvent | { type: "ready" };
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (event.type === "ready") return;
      for (const l of this.listeners) l(event);
    };
    socket.onclose = (closed) => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      this.socket = null;
      // Session ended: stop until the page is reloaded after signing in.
      if (closed.code === 4401) {
        this.stopped = true;
        this.setState("unavailable");
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.timer || this.stopped || !this.listeners.size) return;
    this.attempts += 1;
    // Never connected after several tries: the environment has no realtime.
    if (!this.everOpened && this.attempts >= 4) {
      this.setState("unavailable");
      return;
    }
    this.setState("offline");
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.attempts - 1, 6));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay + Math.random() * 500);
  }

  /** A nudge from focus/online: try once now if we are not connected. */
  wake() {
    if (this.stopped || this.socket || !this.listeners.size) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.state === "unavailable") this.attempts = 0;
    this.connect();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    this.connect();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.socket?.close(1000);
        this.socket = null;
      }
    };
  }

  onState(listener: (s: LiveState) => void) {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }

  onReconnect(listener: () => void) {
    this.reconnectListeners.add(listener);
    return () => void this.reconnectListeners.delete(listener);
  }
}

let channel: LiveChannel | null = null;
const live = () => (channel ??= new LiveChannel());

/**
 * Subscribes to realtime events. `onResync` runs whenever data may have been
 * missed — after a reconnect, and when the tab regains focus or the network
 * returns — so callers refetch then instead of polling.
 */
export function useCollabEvents(
  enabled: boolean,
  onEvent: (event: CollabEvent) => void,
  onResync?: () => void,
) {
  const handler = useRef(onEvent);
  const resync = useRef(onResync);
  useEffect(() => {
    handler.current = onEvent;
    resync.current = onResync;
  });
  useEffect(() => {
    if (!enabled) return;
    const channel = live();
    const unsubscribe = channel.subscribe((e) => handler.current(e));
    const offReconnect = channel.onReconnect(() => resync.current?.());
    let last = 0;
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      channel.wake();
      // Coalesce focus + visibilitychange, which often fire together.
      if (Date.now() - last > 2000) {
        last = Date.now();
        resync.current?.();
      }
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      unsubscribe();
      offReconnect();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [enabled]);
}

export function useLiveState(enabled: boolean) {
  const [state, setState] = useState<LiveState>("offline");
  useEffect(() => {
    if (!enabled) return;
    const channel = live();
    setState(channel.state);
    return channel.onState(setState);
  }, [enabled]);
  return state;
}

/**
 * Unread and mention totals for the sidebar badge. Fetched once, then
 * refreshed only when an event says something changed (coalesced) or on
 * resync — never on a timer.
 */
export function useCollabSummary(enabled: boolean) {
  const [summary, setSummary] = useState<CollabSummary>({ unread: 0, mentions: 0 });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      collabFetch<CollabSummary>("/summary")
        .then(setSummary)
        .catch(() => {});
    }, 400);
  }, []);
  useEffect(() => {
    if (enabled) refresh();
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [enabled, refresh]);
  useCollabEvents(enabled, refresh, refresh);
  return { summary, refresh };
}
