import { inRoomScope, isId, MENTION_PAGE, type MentionItem } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { counterparts, hydrateMessages, listMentionRows } from "@/lib/collab-data";

/**
 * GET: messages that mention the caller, newest first, from conversations
 * they still belong to and still have scope for. `before` is a message-id
 * cursor.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const before = new URL(request.url).searchParams.get("before") ?? undefined;
    if (before !== undefined && !isId(before)) throw new CollabError(400, "Invalid cursor.");
    const rows = await listMentionRows(db, actor.id, before);
    const hasMore = rows.length > MENTION_PAGE;
    const visible = rows
      .slice(0, MENTION_PAGE)
      .filter((r) =>
        r.conversation.kind === "direct"
          ? actor.companies.includes(r.conversation.company)
          : inRoomScope(actor, r.conversation),
      );
    const directIds = [...new Set(visible.filter((r) => r.conversation.kind === "direct").map((r) => r.conversation.id))];
    const [views, others] = await Promise.all([
      hydrateMessages(db, visible.map((r) => r.message)),
      counterparts(db, directIds, actor.id),
    ]);
    const items: MentionItem[] = visible.map((r, i) => ({
      message: views[i],
      conversation: {
        id: r.conversation.id,
        kind: r.conversation.kind,
        title:
          r.conversation.kind === "direct"
            ? (others.get(r.conversation.id)?.name ?? "Direct message")
            : (r.conversation.name ?? "Untitled room"),
      },
      unread: !r.lastRead || r.message.id > r.lastRead,
    }));
    return json({
      items,
      // The cursor is the last row examined, not the last one shown, so rows
      // dropped for scope are never fetched again.
      nextBefore: hasMore ? rows[MENTION_PAGE - 1].message.id : null,
    });
  });
}
