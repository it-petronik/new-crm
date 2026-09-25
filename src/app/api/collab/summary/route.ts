import { inRoomScope, type CollabSummary } from "@/lib/collab";
import { collabContext, handle, json } from "@/lib/collab-auth";
import { listMemberships } from "@/lib/collab-data";

/**
 * GET: the caller's unread and unread-mention totals, for the sidebar badge.
 * Computed from the server-side read cursors, so it agrees across devices.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const rows = (await listMemberships(db, actor.id)).filter((r) =>
      r.conversation.kind === "direct"
        ? actor.companies.includes(r.conversation.company)
        : inRoomScope(actor, r.conversation),
    );
    const summary: CollabSummary = {
      unread: rows.reduce((n, r) => n + r.unread, 0),
      mentions: rows.reduce((n, r) => n + r.mentions, 0),
    };
    return json(summary);
  });
}
