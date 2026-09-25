/**
 * CollabHub — one Durable Object per person, holding that person's open
 * realtime sockets (every tab, every device), and the authority for that
 * person's presence.
 *
 * It is a relay, not a source of truth for content: it stores no messages,
 * and it has no public surface. It is reachable only from this Worker:
 *
 * - `/connect` from the socket gateway, after the gateway has authenticated
 *   the session cookie; the gateway supplies the user id and session hash.
 * - `/publish` from API routes (and other hubs, for presence), after they
 *   have authorised the event and chosen its recipients.
 * - `/directory/*` on the single instance named PRESENCE_DIRECTORY, which
 *   holds everyone's current status for lookups.
 *
 * The only thing a client may say over its socket is its own activity
 * ("active" / "idle"), which can change nothing but its owner's presence.
 * Every other change goes through the authenticated HTTP API; a client can
 * never make a hub broadcast a payload of its choosing.
 *
 * Presence (online / away / offline) is derived from the sockets: online if
 * any socket is active, away if all are idle, offline when none remain — so
 * closing one tab never marks someone offline while another device is open.
 * Only CHANGES are announced, to the people who share a conversation and a
 * company with the person, and last-seen is written to D1 once, when the
 * final connection closes.
 *
 * Written against minimal local types instead of @cloudflare/workers-types,
 * because loading those globally would replace the DOM types the rest of the
 * app compiles against.
 */

type Activity = "active" | "idle";
type Attachment = {
  userId: string;
  session: string;
  expires: number;
  checkedAt: number;
  activity?: Activity;
  /** When this socket connected, and last spoke (activity reports). */
  connectedAt?: number;
  lastMessageAt?: number;
};
type Status = "online" | "away" | "offline";

type HubSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

type Storage = {
  get<T>(key: string): Promise<T | undefined>;
  get<T>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  setAlarm?(time: number): Promise<void>;
  deleteAlarm?(): Promise<void>;
};

type HubState = {
  acceptWebSocket(socket: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
  setWebSocketAutoResponse?(pair: unknown): void;
  /** When the runtime last auto-answered this socket's "ping". */
  getWebSocketAutoResponseTimestamp?(socket: HubSocket): Date | null;
  storage: Storage;
};

type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

type Namespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
};

export type HubEnv = {
  DB?: D1Like;
  COLLAB_HUB?: Namespace;
  // Presence timings. Production uses the defaults below; the local test
  // server shortens them so expiry can be exercised in seconds.
  COLLAB_PRESENCE_HEARTBEAT_MS?: string;
  COLLAB_PRESENCE_STALE_MS?: string;
  COLLAB_PRESENCE_TTL_MS?: string;
};

type DirectoryEntry = { status: Status; at: number; expiresAt?: number | null };

declare const WebSocketPair: { new (): { 0: HubSocket; 1: HubSocket } };
declare const WebSocketRequestResponsePair: { new (request: string, response: string): unknown };

/** How long a socket may go without re-checking that its session is live. */
const REVALIDATE_MS = 60_000;
/** More open sockets than this for one person is a leak; the oldest go. */
const MAX_SOCKETS = 12;
/** Repeated typing events for the same person and state are dropped. */
const TYPING_REPEAT_MS = 1500;
/** A sender may start typing in one conversation at most this often. */
const TYPING_SEND_MS = 2000;
/** Presence goes only to this many contacts; enough for any real team. */
const MAX_CONTACTS = 500;
/**
 * Presence expiry, so nobody stays "online" after an abnormal disconnect:
 *
 * - Clients ping every 45s (answered by the runtime without waking us). A
 *   socket that has not pinged or spoken for STALE_MS is dead and is closed;
 *   one dead tab never takes a live device offline.
 * - While a person has sockets, their hub wakes every HEARTBEAT_MS (a DO
 *   alarm) to prune dead sockets and re-confirm their directory entry.
 * - Directory entries expire after TTL_MS. If a hub disappears without a
 *   clean close, nothing re-confirms the entry and lookups report the person
 *   offline, last seen at the final heartbeat.
 *
 * None of this touches D1: last-seen is still written once, on the actual
 * transition to offline.
 */
const HEARTBEAT_MS = 60_000;
const STALE_MS = 150_000;
const TTL_MS = 180_000;
export const SESSION_ENDED = 4401;
export const PRESENCE_DIRECTORY = "presence-directory";

export class CollabHub {
  private typingSeen = new Map<string, number>();

  constructor(
    private state: HubState,
    private env: HubEnv,
  ) {
    try {
      state.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair("ping", "pong"));
    } catch {
      // Older runtimes: pings then wake the object, which is harmless.
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.connect(request);
    if (url.pathname === "/publish" && request.method === "POST") return this.publish(await request.text());
    if (url.pathname === "/directory/set" && request.method === "POST") return this.directorySet(await request.json());
    if (url.pathname === "/directory/get" && request.method === "POST") return this.directoryGet(await request.json());
    if (url.pathname === "/typing-gate" && request.method === "POST") return this.typingGate(await request.json());
    return new Response("Not found", { status: 404 });
  }

  /* ---------------------------------------------------------- sockets */

  private async connect(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    const userId = request.headers.get("X-Collab-User");
    const session = request.headers.get("X-Collab-Session");
    const expires = Number(request.headers.get("X-Collab-Expires"));
    if (!userId || !session || !Number.isFinite(expires))
      return new Response("Unauthorized", { status: 401 });

    const open = this.state.getWebSockets();
    for (const stale of open.slice(0, Math.max(0, open.length - MAX_SOCKETS + 1)))
      try {
        stale.close(1008, "Too many connections");
      } catch {}

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    const now = Date.now();
    const attachment: Attachment = { userId, session, expires, checkedAt: now, activity: "active", connectedAt: now };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ type: "ready" }));
    await this.state.storage.put("userId", userId);
    await this.refreshPresence();
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  private async publish(payload: string) {
    // Typing floods are cut here, at every recipient, whatever a sender does.
    if (payload.includes('"type":"typing"')) {
      try {
        const event = JSON.parse(payload) as { conversationId: string; userId: string; state: string };
        const key = `${event.conversationId}:${event.userId}:${event.state}`;
        const now = Date.now();
        if (now - (this.typingSeen.get(key) ?? 0) < TYPING_REPEAT_MS) return new Response(null, { status: 204 });
        this.typingSeen.set(key, now);
        if (this.typingSeen.size > 500) this.typingSeen.clear();
      } catch {
        return new Response(null, { status: 204 });
      }
    }
    await Promise.all(
      this.state.getWebSockets().map(async (socket) => {
        const attachment = socket.deserializeAttachment() as Attachment | null;
        if (!attachment || !(await this.stillValid(socket, attachment))) {
          try {
            socket.close(SESSION_ENDED, "Session ended");
          } catch {}
          return;
        }
        try {
          socket.send(payload);
        } catch {
          // A socket closing concurrently; the runtime cleans it up.
        }
      }),
    );
    return new Response(null, { status: 204 });
  }

  /**
   * A socket outlives the request that opened it, so before delivering it is
   * re-checked: past its session's expiry it is closed, and at most once a
   * minute the session and account are re-read, so signing out or being
   * deactivated also ends live delivery.
   */
  private async stillValid(socket: HubSocket, a: Attachment) {
    const now = Date.now();
    if (a.expires <= now) return false;
    if (now - a.checkedAt < REVALIDATE_MS || !this.env.DB) return true;
    const row = await this.env.DB.prepare(
      `SELECT s."expiresAt" AS expiresAt, u."active" AS active
         FROM "Session" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."id" = ? AND s."userId" = ?`,
    )
      .bind(a.session, a.userId)
      .first<{ expiresAt: number; active: number }>();
    if (!row || !row.active || Number(row.expiresAt) <= now) return false;
    socket.serializeAttachment({ ...a, expires: Number(row.expiresAt), checkedAt: now });
    return true;
  }

  /** The one client message: this tab's own activity. Nothing else is read. */
  async webSocketMessage(socket: HubSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 100) return;
    let parsed: { type?: string; state?: string };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed.type !== "activity" || (parsed.state !== "active" && parsed.state !== "idle")) return;
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    // Any report counts as a sign of life, even when the state is unchanged.
    socket.serializeAttachment({ ...attachment, activity: parsed.state, lastMessageAt: Date.now() });
    if (attachment.activity !== parsed.state) await this.refreshPresence();
  }

  async webSocketClose(socket: HubSocket, code: number, reason: string) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {}
    await this.refreshPresence(socket);
  }

  async webSocketError(socket: HubSocket) {
    await this.refreshPresence(socket);
  }

  /* --------------------------------------------------------- presence */

  private timing(name: "COLLAB_PRESENCE_HEARTBEAT_MS" | "COLLAB_PRESENCE_STALE_MS" | "COLLAB_PRESENCE_TTL_MS", fallback: number) {
    const value = Number(this.env[name]);
    return Number.isFinite(value) && value >= 500 ? value : fallback;
  }

  /** The last time a socket showed it was alive. */
  private liveness(socket: HubSocket, a: Attachment) {
    const pinged = this.state.getWebSocketAutoResponseTimestamp?.(socket)?.getTime() ?? 0;
    return Math.max(a.connectedAt ?? 0, a.lastMessageAt ?? 0, pinged);
  }

  /** The heartbeat: prune dead sockets and re-confirm presence. */
  async alarm() {
    await this.refreshPresence(undefined, true);
  }

  /**
   * Recomputes this person's status from their live sockets. A change is
   * recorded, announced and (when offline) written to D1 once; a heartbeat
   * only re-confirms the directory entry so it does not expire.
   */
  private async refreshPresence(closing?: HubSocket, heartbeat = false) {
    const now = Date.now();
    const staleAfter = this.timing("COLLAB_PRESENCE_STALE_MS", STALE_MS);
    let lastActivity = 0;
    const live: Attachment[] = [];
    for (const socket of this.state.getWebSockets()) {
      if (socket === closing) continue;
      const a = socket.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      const seen = this.liveness(socket, a);
      lastActivity = Math.max(lastActivity, seen);
      if (a.expires <= now) continue;
      if (now - seen > staleAfter) {
        // A tab that stopped pinging is gone; close it rather than let it
        // hold its owner "online".
        try {
          socket.close(1001, "Presence timeout");
        } catch {}
        continue;
      }
      live.push(a);
    }
    const userId = live[0]?.userId ?? (await this.state.storage.get<string>("userId"));
    if (!userId) return;
    const status: Status = !live.length ? "offline" : live.some((a) => a.activity !== "idle") ? "online" : "away";
    const previous = await this.state.storage.get<Status>("status");
    const changed = previous !== status;

    // Keep beating while anyone is connected; stop when nobody is.
    const heartbeatEvery = this.timing("COLLAB_PRESENCE_HEARTBEAT_MS", HEARTBEAT_MS);
    if (live.length) await this.state.storage.setAlarm?.(now + heartbeatEvery);
    else await this.state.storage.deleteAlarm?.();

    if (!changed && !heartbeat) return;
    if (changed) await this.state.storage.put("status", status);

    // A clean close is "now"; a pruned dead tab was last seen when it last
    // pinged.
    const at = status === "offline" ? (closing ? now : Math.max(lastActivity, 0) || now) : now;
    const hubs = this.env.COLLAB_HUB;
    const tasks: Promise<unknown>[] = [];
    if (hubs)
      tasks.push(
        hubs.get(hubs.idFromName(PRESENCE_DIRECTORY)).fetch("https://collab-hub/directory/set", {
          method: "POST",
          body: JSON.stringify({
            userId,
            status,
            at,
            expiresAt: status === "offline" ? null : now + this.timing("COLLAB_PRESENCE_TTL_MS", TTL_MS),
          }),
        }),
      );
    // Last seen: one write per session end, never per heartbeat.
    if (changed && status === "offline" && this.env.DB)
      tasks.push(
        this.env.DB.prepare(
          `INSERT INTO "CollabPresence" ("userId", "lastSeenAt") VALUES (?, ?)
           ON CONFLICT("userId") DO UPDATE SET "lastSeenAt" = excluded."lastSeenAt"`,
        )
          .bind(userId, at)
          .run(),
      );
    await Promise.allSettled(tasks);

    if (!changed || !hubs) return;
    const event = JSON.stringify({
      type: "presence",
      conversationId: "",
      userId,
      status,
      lastSeenAt: status === "offline" ? new Date(at).toISOString() : null,
    });
    const contacts = await this.contacts(userId);
    await Promise.allSettled(
      contacts.map((id) =>
        hubs.get(hubs.idFromName(id)).fetch("https://collab-hub/publish", { method: "POST", body: event }),
      ),
    );
  }

  /**
   * Who is told about this person's presence: active people who share at
   * least one conversation AND one company with them — the same people who
   * could look it up through the presence API.
   */
  private async contacts(userId: string) {
    const db = this.env.DB;
    if (!db) return [];
    const self = await db.prepare(`SELECT "companies" AS companies FROM "User" WHERE "id" = ?`).bind(userId).first<{ companies: string }>();
    const mine = parseList(self?.companies);
    const { results } = await db
      .prepare(
        `SELECT DISTINCT u."id" AS id, u."companies" AS companies
           FROM "ConversationMember" a
           JOIN "ConversationMember" b ON b."conversationId" = a."conversationId"
           JOIN "User" u ON u."id" = b."userId"
          WHERE a."userId" = ? AND b."userId" <> ? AND u."active" = 1
          LIMIT ${MAX_CONTACTS}`,
      )
      .bind(userId, userId)
      .all<{ id: string; companies: string }>();
    return results.filter((r) => parseList(r.companies).some((c) => mine.includes(c))).map((r) => r.id);
  }

  /**
   * Sender-side typing throttle, kept in the typist's own hub: at most one
   * "start" per conversation every TYPING_SEND_MS, however often a client
   * asks. "stop" always passes (it ends state). In memory only — typing is
   * never stored.
   */
  private typingSent = new Map<string, number>();
  private typingGate(body: { conversationId?: unknown; state?: unknown }) {
    if (typeof body.conversationId !== "string") return new Response("Bad request", { status: 400 });
    if (body.state === "stop") return Response.json({ allow: true });
    const now = Date.now();
    const last = this.typingSent.get(body.conversationId) ?? 0;
    if (now - last < TYPING_SEND_MS) return Response.json({ allow: false });
    this.typingSent.set(body.conversationId, now);
    if (this.typingSent.size > 200) this.typingSent.clear();
    return Response.json({ allow: true });
  }

  /* -------------------------------------------------------- directory */

  private async directorySet(body: { userId?: unknown; status?: unknown; at?: unknown; expiresAt?: unknown }) {
    if (typeof body.userId !== "string" || !["online", "away", "offline"].includes(String(body.status)))
      return new Response("Bad request", { status: 400 });
    const entry: DirectoryEntry = {
      status: body.status as Status,
      at: Number(body.at) || Date.now(),
      expiresAt: body.status === "offline" ? null : Number(body.expiresAt) || Date.now() + TTL_MS,
    };
    await this.state.storage.put(`p:${body.userId}`, entry);
    return new Response(null, { status: 204 });
  }

  /**
   * Current statuses. An online/away entry past its expiry means its hub
   * stopped confirming it (an abnormal disconnect): it reads as offline,
   * last seen at its final heartbeat.
   */
  private async directoryGet(body: { userIds?: unknown }) {
    const ids = Array.isArray(body.userIds) ? body.userIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    const now = Date.now();
    const out: Record<string, { status: Status; at: number }> = {};
    for (let i = 0; i < ids.length; i += 128) {
      const found = await this.state.storage.get<DirectoryEntry>(ids.slice(i, i + 128).map((id) => `p:${id}`));
      for (const [key, entry] of found) {
        const expired = entry.status !== "offline" && !!entry.expiresAt && entry.expiresAt < now;
        out[key.slice(2)] = { status: expired ? "offline" : entry.status, at: entry.at };
      }
    }
    return Response.json(out);
  }
}

function parseList(value: string | undefined | null) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
