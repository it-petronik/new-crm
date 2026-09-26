import type { Database } from "../../d1";
import { allowedModules, money, outstanding, stages, type Actor, type Kind as AnyKind, type RecordItem } from "../../domain";

/** Business record kinds (each is also a module). */
type Kind = Exclude<AnyKind, "leave">;
import { AiContext, daysBetween, gstToday } from "../context";
import { formatTotals, isOpen, mayBeTruncated, readableRecords, sumByCurrency } from "../records";
import type { Route } from "../schema";

/**
 * Management questions. The model only ROUTES a question to one of these
 * fixed tools (and a company/kind filter); the tool computes the answer's
 * figures here, over records the person may read, and the model then
 * explains them. It never counts, sums or dates anything itself.
 */

export type ManagementTool = Exclude<Route["tool"], "none">;

export const TOOL_CATALOGUE: Record<ManagementTool, { needs: Kind[]; description: string }> = {
  pipeline_summary: { needs: ["leads"], description: "Open sales pipeline: value and count by stage, plus recent wins and losses." },
  overdue_followups: { needs: ["leads"], description: "Leads and quotations whose follow-up date has passed and that are still open." },
  status_breakdown: { needs: [], description: "How many records of one kind (leads, quotations, orders, logistics, accounts, customers) are in each status." },
  top_open_deals: { needs: ["leads"], description: "The largest open leads and quotations by value." },
  receivables: { needs: ["accounts"], description: "Money owed by customers: outstanding and overdue invoices." },
};

/** Record kinds a status breakdown can cover. */
export const BREAKDOWN_KINDS = ["leads", "quotations", "orders", "logistics", "accounts", "customers"] as const;

/** Tools this person may use at all (module access). */
export const toolsFor = (actor: Actor) =>
  (Object.keys(TOOL_CATALOGUE) as ManagementTool[]).filter(
    (t) =>
      TOOL_CATALOGUE[t].needs.every((k) => allowedModules(actor).includes(k)) &&
      (t !== "status_breakdown" || BREAKDOWN_KINDS.some((k) => allowedModules(actor).includes(k))),
  );

const scopeLabel = (company: string | null) => (company ? company : "all companies you can see");

export async function managementContext(db: Database, actor: Actor, route: Route) {
  const tool = route.tool as ManagementTool;
  if (!toolsFor(actor).includes(tool)) return null;
  // Filters from the model are only honoured inside the person's own scope.
  const company = route.company && actor.companies.includes(route.company) ? route.company : null;
  const today = gstToday();
  const ctx = new AiContext(TOOL_CATALOGUE[tool].description);
  ctx.fact("Scope", scopeLabel(company));
  const pick = async (kinds: Kind[]) => {
    const all = await readableRecords(db, actor, kinds.filter((k) => allowedModules(actor).includes(k)));
    if (mayBeTruncated(all.length)) ctx.fact("Coverage", "only the most recent 1,000 records you can see were counted");
    return company ? all.filter((r) => r.company === company) : all;
  };
  const cite = (r: RecordItem) => ctx.ref(`${r.kind === "leads" ? "Lead" : r.kind === "quotations" ? "Quotation" : r.kind === "accounts" ? "Invoice" : r.kind}: ${r.title} (${r.id})`, { type: "record", kind: r.kind, id: r.id });

  if (tool === "pipeline_summary") {
    const leads = await pick(["leads"]);
    const open = leads.filter(isOpen);
    ctx.fact("Open leads", open.length);
    ctx.fact("Open pipeline value", formatTotals(sumByCurrency(open)));
    for (const stage of stages.leads.filter((s) => !["Won", "Lost"].includes(s))) {
      const at = open.filter((l) => l.status === stage);
      if (at.length) ctx.fact(`At "${stage}"`, `${at.length} lead(s), ${formatTotals(sumByCurrency(at))}`);
    }
    for (const days of [30, 90]) {
      const since = (s: string) => (daysBetween(s, today) ?? 9999) <= days;
      const won = leads.filter((l) => l.status === "Won" && since(l.updatedAt));
      const lost = leads.filter((l) => l.status === "Lost" && since(l.updatedAt));
      ctx.fact(`Won in the last ${days} days`, `${won.length} (${formatTotals(sumByCurrency(won))})`);
      ctx.fact(`Lost in the last ${days} days`, `${lost.length}`);
    }
    for (const l of open.sort((a, b) => b.amount - a.amount).slice(0, 8)) cite(l);
  } else if (tool === "overdue_followups") {
    const items = (await pick(["leads", "quotations"])).filter((r) => isOpen(r) && r.due && r.due < today);
    ctx.fact("Overdue follow-ups", items.length);
    const byOwner = new Map<string, number>();
    for (const r of items) byOwner.set(r.owner || "Unassigned", (byOwner.get(r.owner || "Unassigned") ?? 0) + 1);
    if (byOwner.size) ctx.fact("By owner", [...byOwner.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o}: ${n}`).join(", "));
    for (const r of items.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 12)) {
      const ref = cite(r);
      ctx.fact(`${r.title} (${r.status})`, `due ${r.due}, ${daysBetween(r.due, today)} day(s) overdue, owner ${r.owner}`, ref);
    }
  } else if (tool === "status_breakdown") {
    const kind = route.kind && allowedModules(actor).includes(route.kind) ? route.kind : null;
    if (!kind) return null;
    const items = await pick([kind]);
    ctx.fact("Record type", kind);
    ctx.fact("Total", items.length);
    for (const status of stages[kind]) {
      const n = items.filter((r) => r.status === status);
      ctx.fact(status, `${n.length}${n.some((r) => r.amount) ? ` (${formatTotals(sumByCurrency(n))})` : ""}`);
    }
  } else if (tool === "top_open_deals") {
    const items = (await pick(["leads", "quotations"])).filter(isOpen).sort((a, b) => b.amount - a.amount).slice(0, 10);
    ctx.fact("Deals listed", items.length);
    for (const r of items) ctx.fact(`${r.title} (${r.kind === "leads" ? "lead" : "quotation"}, ${r.status})`, `${money(r.amount, r.currency)}, owner ${r.owner}${r.due ? `, next ${r.due}` : ""}`, cite(r));
  } else if (tool === "receivables") {
    const invoices = (await pick(["accounts"])).filter((r) => r.status !== "Cancelled" && outstanding(r) > 0);
    const overdue = invoices.filter((r) => r.status === "Overdue" || (!!r.due && r.due < today));
    ctx.fact("Invoices with a balance", invoices.length);
    ctx.fact("Outstanding", formatTotals(sumByCurrency(invoices.map((r) => ({ amount: outstanding(r), currency: r.currency })))));
    ctx.fact("Overdue", `${overdue.length} (${formatTotals(sumByCurrency(overdue.map((r) => ({ amount: outstanding(r), currency: r.currency }))))})`);
    for (const r of overdue.sort((a, b) => outstanding(b) - outstanding(a)).slice(0, 10))
      ctx.fact(`${r.title} (${r.id})`, `${money(outstanding(r), r.currency)} outstanding, due ${r.due || "—"}`, cite(r));
  }
  return {
    context: ctx,
    instructions: `Answer the employee's QUESTION using the FACTS, quoting figures exactly as given (never add, convert or estimate amounts; different currencies stay separate). Start with a direct answer in "summary". Use "points" for the key figures and the notable items (cite their references). Add risks and next actions a manager would care about. No suggestions and no draft unless the question asks for a message.`,
  };
}

/** A simple keyword route, used if the model's routing fails. */
export function keywordRoute(question: string, actor: Actor): Route {
  const q = question.toLowerCase();
  const company = actor.companies.find((c) => q.includes(c.toLowerCase())) ?? null;
  const allowed = toolsFor(actor);
  const choose = (tool: ManagementTool): Route => (allowed.includes(tool) ? { tool, company, kind: null, because: "keywords" } : { tool: "none", company: null, kind: null, because: "no access" });
  if (/overdue|late|follow[- ]?up|chase/.test(q)) return /invoice|payment|receivable|owe/.test(q) ? choose("receivables") : choose("overdue_followups");
  if (/receivable|owe|outstanding|unpaid|invoice|collection/.test(q)) return choose("receivables");
  if (/biggest|largest|top|best deal|highest/.test(q)) return choose("top_open_deals");
  if (/pipeline|forecast|won|lost|win rate|funnel/.test(q)) return choose("pipeline_summary");
  const kind = BREAKDOWN_KINDS.find((k) => q.includes(k.slice(0, -1)));
  if (kind && /status|how many|breakdown|count/.test(q)) return allowedModules(actor).includes(kind) ? { tool: "status_breakdown", company, kind, because: "keywords" } : { tool: "none", company: null, kind: null, because: "no access" };
  return { tool: "none", company: null, kind: null, because: "no match" };
}
