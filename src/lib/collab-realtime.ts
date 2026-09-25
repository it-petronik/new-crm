import type { CollabEvent } from "./collab";

/**
 * Server-side fan-out to the realtime channel.
 *
 * Each person has one `CollabHub` Durable Object (keyed by user id) holding
 * their open sockets, on every device. Publishing an event means handing it to
 * the hub of each person who may see it — the caller passes exactly the
 * conversation's current members, which is the only authorization the
 * channel needs: a socket only ever receives what its owner was entitled to
 * at the moment it was sent.
 *
 * Delivery is best-effort and happens after the response via waitUntil, so a
 * slow hub never delays a send. When the binding is absent (local `next dev`,
 * or before the Durable Object is deployed) this is a no-op and clients fall
 * back to refreshing when they regain focus.
 */

type HubStub = { fetch: (input: string, init?: RequestInit) => Promise<Response> };
type HubNamespace = { idFromName(name: string): unknown; get(id: unknown): HubStub };

async function hubContext() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    const namespace = (context.env as unknown as { COLLAB_HUB?: HubNamespace }).COLLAB_HUB;
    return namespace ? { namespace, ctx: context.ctx } : null;
  } catch {
    return null;
  }
}

export async function publish(userIds: string[], event: CollabEvent) {
  const recipients = [...new Set(userIds)];
  if (!recipients.length) return;
  const hub = await hubContext();
  if (!hub) return;
  const body = JSON.stringify(event);
  const delivery = Promise.allSettled(
    recipients.map((userId) =>
      hub.namespace
        .get(hub.namespace.idFromName(userId))
        .fetch("https://collab-hub/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
    ),
  );
  if (hub.ctx?.waitUntil) hub.ctx.waitUntil(delivery);
  else await delivery;
}

/**
 * Runs follow-up work (notifications) after the response has been sent, so
 * the person acting never waits on it. Without a Worker context it simply
 * runs inline. Failures are logged, never thrown: a notification must never
 * undo or fail the business change that caused it.
 */
export async function afterResponse(label: string, task: () => Promise<unknown>) {
  const run = task().catch((cause) =>
    console.error(
      JSON.stringify({
        event: "notification_failed",
        label,
        detail: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 200) : "Unknown error",
      }),
    ),
  );
  const hub = await hubContext();
  if (hub?.ctx?.waitUntil) hub.ctx.waitUntil(run);
  else await run;
}

/* -------------------------------------------------------------- presence */

/**
 * The shared presence directory: one CollabHub instance under a reserved
 * name, which each person's own hub updates when their aggregate status
 * changes. The name is not a user id, so no socket can ever connect to it.
 */
// Must match the name the hubs use (src/realtime/collab-hub.ts).
export const PRESENCE_DIRECTORY = "presence-directory";

export type LiveStatus = { status: "online" | "away" | "offline"; at: number };

/** Live status for these people; offline for anyone the directory lacks. */
export async function livePresence(userIds: string[]): Promise<Record<string, LiveStatus>> {
  const hub = await hubContext();
  if (!hub || !userIds.length) return {};
  try {
    const response = await hub.namespace
      .get(hub.namespace.idFromName(PRESENCE_DIRECTORY))
      .fetch("https://collab-hub/directory/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds }),
      });
    return response.ok ? ((await response.json()) as Record<string, LiveStatus>) : {};
  } catch {
    return {};
  }
}

/**
 * Asks the typist's own hub whether this typing event may go out (see
 * CollabHub.typingGate). Without the hub, allow — there is nobody to deliver
 * to anyway.
 */
export async function typingAllowed(userId: string, conversationId: string, state: "start" | "stop") {
  const hub = await hubContext();
  if (!hub) return true;
  try {
    const response = await hub.namespace
      .get(hub.namespace.idFromName(userId))
      .fetch("https://collab-hub/typing-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, state }),
      });
    return response.ok ? ((await response.json()) as { allow: boolean }).allow : true;
  } catch {
    return true;
  }
}
