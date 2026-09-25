import { PRESENCE_DIRECTORY, type HubEnv } from "./collab-hub";
import { sessionActor, type D1Like } from "./session";

/**
 * Authenticates a realtime socket before it reaches anyone's hub.
 *
 * Runs in the Worker entry, ahead of Next.js, because a WebSocket upgrade has
 * to be answered by the Worker itself. It applies the same checks as
 * `currentActor` (see session.ts) plus an origin check, since browsers do not
 * apply CORS to WebSockets.
 *
 * The hub is chosen from the authenticated user id, never from anything the
 * client sends, so a socket can only ever join its own owner's hub.
 */

export type GatewayEnv = HubEnv & {
  DB?: D1Like;
  APP_MODE?: string;
  APP_URL?: string;
};

export async function collabSocket(request: Request, env: GatewayEnv): Promise<Response> {
  if (env.APP_MODE === "preview") return new Response("Not found", { status: 404 });
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return new Response("Expected a WebSocket upgrade.", { status: 426 });
  if (!env.APP_URL || request.headers.get("Origin") !== new URL(env.APP_URL).origin)
    return new Response("Forbidden", { status: 403 });
  if (!env.COLLAB_HUB || !env.DB) return new Response("Unavailable", { status: 503 });

  const found = await sessionActor(request, env.DB);
  // The presence directory is a hub under a reserved name; no person's
  // session may ever be routed to it.
  if (!found || found.actor.id === PRESENCE_DIRECTORY) return new Response("Unauthorized", { status: 401 });

  // A fresh request: nothing client-supplied reaches the hub except the
  // upgrade itself.
  const hub = env.COLLAB_HUB.get(env.COLLAB_HUB.idFromName(found.actor.id));
  return hub.fetch("https://collab-hub/connect", {
    headers: {
      Upgrade: "websocket",
      "X-Collab-User": found.actor.id,
      "X-Collab-Session": found.session,
      "X-Collab-Expires": String(found.expiresAt),
    },
  });
}
