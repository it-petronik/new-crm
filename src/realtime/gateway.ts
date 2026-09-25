import { roles } from "../lib/domain";
import type { HubEnv } from "./collab-hub";

/**
 * Authenticates a realtime socket before it reaches anyone's hub.
 *
 * Runs in the Worker entry, ahead of Next.js, because a WebSocket upgrade has
 * to be answered by the Worker itself. It applies the same checks as
 * `currentActor`: a session cookie whose hash matches an unexpired session of
 * an active account with a valid role — plus an origin check, since browsers
 * do not apply CORS to WebSockets.
 *
 * The hub is chosen from the authenticated user id, never from anything the
 * client sends, so a socket can only ever join its own owner's hub.
 */

type Namespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T>(): Promise<T | null> };
  };
};

export type GatewayEnv = HubEnv & {
  DB?: D1Like;
  COLLAB_HUB?: Namespace;
  APP_MODE?: string;
  APP_URL?: string;
};

const COOKIE = "enercore_session";

function readCookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function collabSocket(request: Request, env: GatewayEnv): Promise<Response> {
  if (env.APP_MODE === "preview") return new Response("Not found", { status: 404 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("Expected a WebSocket upgrade.", { status: 426 });
  if (!env.APP_URL || request.headers.get("Origin") !== new URL(env.APP_URL).origin)
    return new Response("Forbidden", { status: 403 });
  if (!env.COLLAB_HUB || !env.DB) return new Response("Unavailable", { status: 503 });

  const token = readCookie(request.headers.get("Cookie"), COOKIE);
  if (!token) return new Response("Unauthorized", { status: 401 });
  const session = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s."userId" AS userId, s."expiresAt" AS expiresAt, u."active" AS active, u."role" AS role
       FROM "Session" s JOIN "User" u ON u."id" = s."userId"
      WHERE s."id" = ?`,
  )
    .bind(session)
    .first<{ userId: string; expiresAt: number; active: number; role: string }>();
  if (
    !row ||
    !row.active ||
    Number(row.expiresAt) <= Date.now() ||
    !(roles as readonly string[]).includes(row.role)
  )
    return new Response("Unauthorized", { status: 401 });

  // A fresh request: nothing client-supplied reaches the hub except the
  // upgrade itself.
  const hub = env.COLLAB_HUB.get(env.COLLAB_HUB.idFromName(row.userId));
  return hub.fetch(
    new Request("https://collab-hub/connect", {
      headers: {
        Upgrade: "websocket",
        "X-Collab-User": row.userId,
        "X-Collab-Session": session,
        "X-Collab-Expires": String(row.expiresAt),
      },
    }),
  );
}
