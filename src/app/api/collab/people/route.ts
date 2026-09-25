import { inRoomScope, sharedCompany, type Person } from "@/lib/collab";
import { CollabError, collabContext, handle, json, requireAdmin } from "@/lib/collab-auth";
import { listActivePeople, listMembers } from "@/lib/collab-data";

const LIMIT = 20;

/**
 * GET: colleagues the caller may bring into a conversation. Only active
 * accounts, only names and roles (never emails), and only within scope:
 *
 * - ?conversationId=  people who may be added to that room (caller must be a
 *   room admin) — in the room's company/branch and not already members;
 * - ?company=&branch= people who may join a new room in that scope;
 * - otherwise         people sharing at least one company, for a new DM.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const search = new URL(request.url).searchParams;
    const q = (search.get("q") ?? "").trim().toLowerCase().slice(0, 80);
    const conversationId = search.get("conversationId");
    const company = search.get("company");
    const branch = search.get("branch") || null;

    let eligible: (p: { id: string; companies: string[]; branches: string[] }) => boolean;
    if (conversationId) {
      const { conversation } = await requireAdmin(db, actor, conversationId);
      const current = new Set((await listMembers(db, conversation.id)).map((m) => m.id));
      eligible = (p) => !current.has(p.id) && inRoomScope(p, conversation);
    } else if (company) {
      if (!actor.companies.includes(company)) throw new CollabError(403, "Choose one of your companies.");
      eligible = (p) => inRoomScope(p, { company, branch });
    } else {
      eligible = (p) => !!sharedCompany(actor, p);
    }

    const people: Person[] = (await listActivePeople(db))
      .filter((p) => p.id !== actor.id && eligible(p))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
      .slice(0, LIMIT)
      .map((p) => ({ id: p.id, name: p.name, role: p.role }));
    return json({ people });
  });
}
