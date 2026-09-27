import type { Database } from "../../d1";
import { allowedModules, money, outstanding, stages, type Actor, type Kind as AnyKind, type RecordItem } from "../../domain";

/** Business record kinds (each is also a module). */
type Kind = Exclude<AnyKind, "leave">;
import { AiContext, daysBetween, gstToday } from "../context";
import { formatTotals, isOpen, mayBeTruncated, readableRecords, sumByCurrency } from "../records";
import { visibleMeetings } from "../../meeting-data";
import { SALES_THRESHOLDS, isHighValue, recordSignals, salesPriorities } from "../../sales/signals";

const KIND_NOUN: Record<string, string> = { leads: "lead", quotations: "quotation", customers: "customer", orders: "order" };
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
  leads_attention: { needs: ["leads"], description: "Leads and quotations that need attention now (overdue follow-ups, quiet leads, quotations waiting, meetings without an outcome), with owners." },
  quotations_waiting: { needs: ["quotations"], description: "Quotations sent and awaiting a response, expiring soon, or past their validity." },
  high_value_no_next_action: { needs: ["leads"], description: "High-value open opportunities with no next follow-up, or with the follow-up overdue." },
  search: { needs: [], description: "Find leads, quotations and customers by product, grade, destination, port or name." },
};

/** Kinds a sales search covers. */
const SEARCH_KINDS = ["leads", "quotations", "customers", "orders"] as const;
/** Words that mean the same thing in this trade. */
const SYNONYMS: string[][] = [["asphalt", "bitumen"], ["base oil", "baseoil"], ["grease", "greases"], ["lubricant", "lube", "lubricants"]];

/** Record kinds a status breakdown can cover. */
export const BREAKDOWN_KINDS = ["leads", "quotations", "orders", "logistics", "accounts", "customers"] as const;

/** Tools this person may use at all (module access). */
export const toolsFor = (actor: Actor) =>
  (Object.keys(TOOL_CATALOGUE) as ManagementTool[]).filter(
    (t) =>
      TOOL_CATALOGUE[t].needs.every((k) => allowedModules(actor).includes(k)) &&
      (t !== "status_breakdown" || BREAKDOWN_KINDS.some((k) => allowedModules(actor).includes(k))) &&
      (t !== "search" || ["leads", "quotations", "customers"].some((k) => allowedModules(actor).includes(k as Kind))),
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
    // Where action is needed (deterministic signals; no forecast).
    const signals = open.flatMap((l) => recordSignals(l, today));
    const count = (t: string) => new Set(signals.filter((s) => s.type === t).map((s) => s.recordId)).size;
    ctx.fact(`Gone quiet (${SALES_THRESHOLDS.goneQuietDays}+ days without activity)`, count("LEAD_GONE_QUIET"));
    ctx.fact(`Negotiations idle ${SALES_THRESHOLDS.negotiationStalledDays}+ days`, count("NEGOTIATION_STALLED"));
    ctx.fact("Open leads with no next follow-up date", open.filter((l) => !l.due).length);
    if (allowedModules(actor).includes("quotations")) {
      const quotes = (await pick(["quotations"])).flatMap((q) => recordSignals(q, today));
      ctx.fact("Quotations awaiting a response", new Set(quotes.filter((s) => s.type === "QUOTATION_WAITING").map((s) => s.recordId)).size);
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
  else if (tool === "leads_attention") {
    const deals = await pick(["leads", "quotations"]);
    const meetings = (await visibleMeetings(db, actor)).map((m) => ({ id: m.id, title: m.title, status: m.status, scheduledAt: m.scheduledAt?.toISOString() ?? null, endedAt: m.endedAt?.toISOString() ?? null, relatedRecordId: m.relatedRecordId ?? null }));
    const all = deals.flatMap((r) => recordSignals(r, today, meetings));
    const priorities = salesPriorities(deals, today, meetings, 12);
    ctx.fact("Items needing attention", new Set(all.map((s) => s.recordId)).size);
    for (const t of [...new Set(all.map((s) => s.type))]) ctx.fact(`Signal ${t.toLowerCase().replace(/_/g, " ")}`, new Set(all.filter((s) => s.type === t).map((s) => s.recordId)).size);
    const owners = new Map<string, number>();
    for (const id of new Set(all.map((s) => s.recordId))) {
      const o = deals.find((d) => d.id === id)?.owner || "Unassigned";
      owners.set(o, (owners.get(o) ?? 0) + 1);
    }
    if (owners.size) ctx.fact("Items needing attention, by owner", [...owners.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([o, n]) => `${o}: ${n}`).join(", "));
    for (const p of priorities) {
      const r = deals.find((d) => d.id === p.record.id)!;
      ctx.fact(`${r.title} (${r.kind === "leads" ? "lead" : "quotation"}, ${r.status})`, `${p.signals.map((s) => s.label).join("; ")}; owner ${r.owner}${p.record.value ? `; ${p.record.value}` : ""}`, cite(r));
    }
  } else if (tool === "quotations_waiting") {
    const quotes = await pick(["quotations"]);
    const flagged = quotes.map((q) => ({ q, s: recordSignals(q, today).filter((s) => s.type.startsWith("QUOTATION_")) })).filter((x) => x.s.length);
    for (const t of ["QUOTATION_WAITING", "QUOTATION_EXPIRING", "QUOTATION_EXPIRED"]) ctx.fact(t === "QUOTATION_WAITING" ? `Awaiting a response (${SALES_THRESHOLDS.quotationWaitingDays}+ days)` : t === "QUOTATION_EXPIRING" ? `Expiring within ${SALES_THRESHOLDS.quotationExpiringDays} days` : "Past validity, still open", flagged.filter((x) => x.s.some((s) => s.type === t)).length);
    for (const { q, s } of flagged.sort((a, b) => Math.max(...b.s.map((x) => x.score)) - Math.max(...a.s.map((x) => x.score))).slice(0, 12))
      ctx.fact(`${q.title} (${q.id}, ${q.status})`, `${s.map((x) => x.label).join("; ")}; owner ${q.owner}${q.amount ? `; ${money(q.amount, q.currency)}` : ""}`, cite(q));
  } else if (tool === "high_value_no_next_action") {
    const leads = (await pick(["leads"])).filter((l) => isOpen(l) && isHighValue(l) && (!l.due || l.due < today));
    ctx.fact("High-value thresholds", Object.entries(SALES_THRESHOLDS.highValue).map(([c, v]) => money(v, c)).join(", "));
    ctx.fact("High-value opportunities without a current next action", leads.length);
    for (const l of leads.sort((a, b) => b.amount - a.amount).slice(0, 12))
      ctx.fact(`${l.title} (${l.status})`, `${money(l.amount, l.currency)}; ${l.due ? `follow-up overdue since ${l.due}` : "no follow-up date"}; owner ${l.owner}`, cite(l));
  } else if (tool === "search") {
    const terms = [...new Set(route.terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2))].slice(0, 5);
    if (!terms.length) return null;
    const variants = (t: string) => SYNONYMS.find((g) => g.includes(t)) ?? [t];
    const records = await pick(SEARCH_KINDS.filter((k) => allowedModules(actor).includes(k)));
    const structured = (r: RecordItem) => ({ title: r.title, product: r.product, destination: [r.destination, r.attributes?.country].filter(Boolean).join(", "), contact: r.contact, packaging: (r.lines ?? []).map((l) => `${l.description} ${l.packaging ?? ""}`).join(" "), incoterm: r.attributes?.incoterm ?? "" });
    const matches: { r: RecordItem; where: string[] }[] = [];
    for (const r of records) {
      const fields = structured(r);
      const where: string[] = [];
      const ok = terms.every((t) => {
        const hit = Object.entries(fields).find(([, v]) => variants(t).some((x) => (v ?? "").toLowerCase().includes(x)));
        if (hit) return where.push(`${hit[0]} "${String(hit[1]).slice(0, 60)}"`), true;
        // Text search only after the structured fields: notes and description.
        const text = [r.detail, ...(r.notes ?? []).map((n) => n.text)].join(" ").toLowerCase();
        if (variants(t).some((x) => text.includes(x))) return where.push("notes"), true;
        return false;
      });
      if (ok) matches.push({ r, where });
    }
    ctx.fact("Search terms", terms.join(", "));
    ctx.fact("Matches", matches.length);
    // Counts by type are Enercore's, so the answer never has to count them itself.
    const byKind = SEARCH_KINDS.map((k) => [k, matches.filter((m) => m.r.kind === k).length] as const).filter(([, n]) => n);
    if (byKind.length) ctx.fact("Matches by type", byKind.map(([k, n]) => `${KIND_NOUN[k]}s: ${n}`).join(", "));
    if (matches.length > 15) ctx.fact("Listed below", "the 15 most relevant matches (structured-field matches first)");
    for (const { r, where } of matches.sort((a, b) => Number(b.where.includes("notes") ? 0 : 1) - Number(a.where.includes("notes") ? 0 : 1) || (b.r.updatedAt ?? "").localeCompare(a.r.updatedAt ?? "")).slice(0, 15))
      ctx.fact(`${r.title} (${KIND_NOUN[r.kind] ?? r.kind}, ${r.status})`, `matched in ${[...new Set(where)].join(", ")}; owner ${r.owner}`, cite(r));
  }
  return {
    context: ctx,
    instructions: `Answer the employee's QUESTION using the FACTS, quoting figures exactly as given (never add, convert or estimate amounts; different currencies stay separate; no forecasts). Start with a direct answer in "summary". Use "points" for the key figures and the notable items (cite their references). Add risks and next actions a manager would care about, as proposals. When facts are grouped by person, report them as operational facts about the work — never judge, rank or label people. No suggestions and no draft unless the question asks for a message.`,
  };
}

const STOP = new Set("a an and any are asked about all can customers customer did do does find for from get give going have in is it leads lead list me my of on or our quotations quotation search show that the them to we what which who with want wants looking need needs please".split(" "));

/** Search words from a question: products, grades, ports, names (no stop words). */
export function searchTerms(question: string) {
  const words = question.replace(/[^\p{L}\p{N}/\s-]+/gu, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));
  return [...new Set(words)].slice(0, 3);
}

/** A simple keyword route, used if the model's routing fails. */
export function keywordRoute(question: string, actor: Actor): Route {
  const q = question.toLowerCase();
  const company = actor.companies.find((c) => q.includes(c.toLowerCase())) ?? null;
  const allowed = toolsFor(actor);
  const none = (because: string): Route => ({ tool: "none", company: null, kind: null, terms: [], because });
  const choose = (tool: ManagementTool, terms: string[] = []): Route => (allowed.includes(tool) ? { tool, company, kind: null, terms, because: "keywords" } : none("no access"));
  // Specific intents first, so "Which leads need attention?" isn't read as a search.
  if (/quotations?.*(waiting|pending|response|expir|no reply)|(waiting|pending).*quotations?/.test(q)) return choose("quotations_waiting");
  if (/high[- ]value|no next action|without (a )?next/.test(q)) return choose("high_value_no_next_action");
  if (/attention|priorit|what should|focus|work on/.test(q)) return choose("leads_attention");
  if (/\b(find|search|look up)\b|which (customers|leads|buyers) (asked|want|need|are going)|going to\b|leads? for\b|asked for\b/.test(q)) {
    const terms = searchTerms(question.replace(new RegExp(actor.companies.join("|") || "$^", "gi"), ""));
    if (terms.length) return choose("search", terms);
  }
  if (/overdue|late|follow[- ]?up|chase/.test(q)) return /invoice|payment|receivable|owe/.test(q) ? choose("receivables") : choose("overdue_followups");
  if (/receivable|owe|outstanding|unpaid|invoice|collection/.test(q)) return choose("receivables");
  if (/biggest|largest|top|best deal|highest/.test(q)) return choose("top_open_deals");
  if (/pipeline|forecast|won|lost|win rate|funnel/.test(q)) return choose("pipeline_summary");
  const kind = BREAKDOWN_KINDS.find((k) => q.includes(k.slice(0, -1)));
  if (kind && /status|how many|breakdown|count/.test(q)) return allowedModules(actor).includes(kind) ? { tool: "status_breakdown", company, kind, terms: [], because: "keywords" } : none("no access");
  return none("no match");
}
