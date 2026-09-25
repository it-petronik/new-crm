/**
 * CollabHub — one Durable Object per person, holding that person's open
 * realtime sockets (every tab, every device).
 *
 * It is a relay, not a source of truth: it stores no messages, and it has no
 * public surface. It is reachable only from this Worker, in two ways:
 *
 * - `/connect` from the socket gateway, after the gateway has authenticated
 *   the session cookie; the gateway supplies the user id and session hash.
 * - `/publish` from API routes, after they have authorized the event and
 *   chosen its recipients (the conversation's current members).
 *
 * Sockets use the hibernation API, so an idle connection costs nothing, and
 * keep-alive pings are answered by the runtime without waking the object.
 * Clients never send data through the socket; every change goes through the
 * authenticated HTTP API.
 *
 * Written against minimal local types instead of @cloudflare/workers-types,
 * because loading those globally would replace the DOM types the rest of the
 * app compiles against.
 */

type Attachment = { userId: string; session: string; expires: number; checkedAt: number };

type HubSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

type HubState = {
  acceptWebSocket(socket: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
  setWebSocketAutoResponse?(pair: unknown): void;
};

type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
};

export type HubEnv = { DB?: D1Like };

declare const WebSocketPair: { new (): { 0: HubSocket; 1: HubSocket } };
declare const WebSocketRequestResponsePair: { new (request: string, response: string): unknown };

/** How long a socket may go without re-checking that its session is live. */
const REVALIDATE_MS = 60_000;
/** More open sockets than this for one person is a leak; the oldest go. */
const MAX_SOCKETS = 12;
export const SESSION_ENDED = 4401;

export class CollabHub {
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
    return new Response("Not found", { status: 404 });
  }

  private connect(request: Request) {
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
    const attachment: Attachment = { userId, session, expires, checkedAt: Date.now() };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ type: "ready" }));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  private async publish(payload: string) {
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

  // Clients do not send anything meaningful; auto-response handles "ping".
  webSocketMessage() {}

  webSocketClose(socket: HubSocket, code: number, reason: string) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {}
  }

  webSocketError() {}
}
