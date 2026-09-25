import { isId, sharedCompany, type PresenceView } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { findPeople, lastSeen } from "@/lib/collab-data";
import { livePresence } from "@/lib/collab-realtime";

/**
 * GET ?ids=a,b,c: presence for up to 200 people. Only people the caller
 * could message — active accounts sharing at least one company — are
 * answered; anyone else is simply omitted, exactly as if unknown. Live state
 * comes from the Durable Objects, last-seen from D1.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const raw = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (raw.length > 200 || raw.some((id) => !isId(id))) throw new CollabError(400, "Invalid people.");
    const people = (await findPeople(db, raw)).filter(
      (p) => p.id === actor.id || (p.active && !!sharedCompany(actor, p)),
    );
    const ids = people.map((p) => p.id);
    const [live, seen] = await Promise.all([livePresence(ids), lastSeen(db, ids)]);
    const presence: Record<string, PresenceView> = {};
    for (const id of ids) {
      const status = live[id]?.status ?? "offline";
      // Offline: the later of the recorded last-seen and the directory's
      // final heartbeat (which is newer when a session ended abnormally).
      const recorded = seen.get(id)?.getTime() ?? 0;
      const heartbeat = status === "offline" ? (live[id]?.at ?? 0) : 0;
      const at = Math.max(recorded, heartbeat);
      presence[id] = { status, lastSeenAt: status === "offline" && at ? new Date(at).toISOString() : null };
    }
    return json({ presence });
  });
}
