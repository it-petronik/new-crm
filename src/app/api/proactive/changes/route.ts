import { aiEndpoint } from "@/lib/ai/route";
import { changesSince } from "@/lib/proactive/service";

/** GET: what changed in the last day (or ?days=7) — deterministic, from the audit trail. */
export function GET(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => changesSince(db, actor, new URL(request.url).searchParams.get("days") === "7" ? 7 : 1), { spend: false });
}
