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
