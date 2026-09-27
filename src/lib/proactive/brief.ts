import type { Database } from "../d1";
import type { Actor } from "../domain";
import { AiContext } from "../ai/context";
import { respond } from "../ai/route";
import { actionCenter, changesSince } from "./service";

/**
 * On-demand AI briefs over DETERMINISTIC facts — never generated on a
 * schedule. One fast-model call per brief (cached by the Phase 2 fingerprint:
 * same facts → same answer, no new call). The model explains the counts; it
 * never computes, ranks or judges anyone.
 */
export async function proactiveBrief(db: Database, actor: Actor, kind: "today" | "changes" | "week") {
  const ctx = new AiContext(kind === "today" ? `${actor.name.split(" ")[0]}'s day` : kind === "changes" ? "What changed since yesterday" : "This week");
  let instructions: string;
  if (kind === "today") {
    const ac = await actionCenter(db, actor, { scope: "team", group: "all" });
    const all = [...ac.sections.needs_action, ...ac.sections.today, ...ac.sections.waiting];
    ctx.fact("Needs action", ac.sections.needs_action.length);
    ctx.fact("Today", ac.sections.today.length);
    ctx.fact("Waiting on others", ac.sections.waiting.length);
    ctx.fact("Records with missing details", ac.sections.data.length);
    for (const t of ac.summary?.tiles ?? []) ctx.fact(t.label, `${t.count}${t.detail ? ` (${t.detail})` : ""}`);
    for (const s of all.slice(0, 10)) {
      const ref = s.entity.type === "meeting" ? ctx.ref(`Meeting: ${s.entity.title}`, { type: "meeting", id: s.entity.id, view: "details" }) : ctx.ref(`${s.entity.type}: ${s.entity.title} (${s.entity.id})`, { type: "record", kind: s.entity.type, id: s.entity.id });
      ctx.fact(`${s.entity.title}`, `${s.label}${s.entity.value ? `; ${s.entity.value}` : ""}; ${s.severity}`, ref);
    }
    instructions = `Write a short morning brief from the FACTS: what needs action first and why, in 2–3 sentences, then the key items as points (cite them). Proposals only; never judge people.`;
  } else {
    const c = await changesSince(db, actor, kind === "changes" ? 1 : 7);
    for (const f of c.facts) ctx.fact(f.label, f.count);
    for (const n of c.notable) ctx.fact(`${n.title}`, `${n.change}${n.value ? `; ${n.value}` : ""}; by ${n.by}`, ctx.ref(`${n.kind}: ${n.title} (${n.recordId})`, { type: "record", kind: n.kind, id: n.recordId }));
    instructions = `Summarise ${kind === "changes" ? "what changed since yesterday" : "this week"} from the FACTS only: the meaningful movements first, in 2–3 sentences, then the notable items as points (cite them). Quote counts exactly; no forecasts; never judge people.`;
  }
  return respond(db, actor, "proactive", ctx, instructions, undefined, undefined, "fast");
}
