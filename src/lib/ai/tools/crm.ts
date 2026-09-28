import { addIdentityContext } from "../../commercial/ai";
import { readRecords, listContacts } from "../../commercial/store";
import { businessRecords } from "../../schema";
import { sql } from "drizzle-orm";
import type { Database } from "../../d1";
import { canWrite, money, outstanding, stages, type Actor, type RecordItem } from "../../domain";
import { visibleMeetings } from "../../meeting-data";
import { AiContext, daysBetween, gstToday } from "../context";
import { CLOSED, formatTotals, isOpen, mayBeTruncated, readableRecord, readableRecords, sumByCurrency } from "../records";

/**
 * CRM tools: Lead AI and Customer 360. Each builds the context for ONE
 * answer, for ONE person, from records that person may read — the figures
 * computed here, deterministically. The model never sees anything else.
 */

/** A stored timestamp as its GST business date. */
const gstDate = (at: string) => (Number.isNaN(Date.parse(at)) ? at.slice(0, 10) : gstToday(new Date(at)));

export const KIND_LABEL: Record<string, string> = { leads: "Lead", quotations: "Quotation", orders: "Order", logistics: "Shipment", accounts: "Invoice", customers: "Customer" };

export function describe(ctx: AiContext, r: RecordItem, relationship?: string) {
  const ref = ctx.ref(`${KIND_LABEL[r.kind] ?? r.kind}: ${r.title} (${r.id})`, { type: "record", kind: r.kind, id: r.id });
  ctx.record(ref, {
    kind: KIND_LABEL[r.kind] ?? r.kind,
    id: r.id,
    title: r.title,
    status: r.status,
    company: r.company,
    branch: r.branch,
    owner: r.owner,
    product: r.product,
    quantity: r.quantity ? `${r.quantity} ${r.unit}` : "",
    value: r.amount ? money(r.amount, r.currency) : "",
    outstanding: r.kind === "accounts" ? money(outstanding(r), r.currency) : "",
    due: r.due,
    updated: r.updatedAt ? gstDate(r.updatedAt) : "",
    relationship,
  });
  return ref;
}

function addNotes(ctx: AiContext, r: RecordItem, ref: string, limit: number) {
  if (r.detail) ctx.text("record_description", r.detail, ref);
  for (const n of (r.notes ?? []).slice(-limit)) ctx.text("note", `${n.at ? gstDate(n.at) : ""} ${n.actor ?? ""}: ${n.text}`, ref);
}

/* ------------------------------------------------------------------ Lead */

export async function leadContext(db: Database, actor: Actor, id: unknown) {
  const lead = await readableRecord(db, actor, id, "leads");
  const today = gstToday();
  const ctx = new AiContext(`Lead ${lead.title}`);
  const ref = describe(ctx, lead);
  const stage = stages.leads.indexOf(lead.status);
  ctx.fact("Stage", `${lead.status}${stage >= 0 ? ` (step ${stage + 1} of ${stages.leads.length})` : ""}`, ref);
  if (lead.amount) ctx.fact("Estimated value", money(lead.amount, lead.currency), ref);
  const age = daysBetween(lead.createdAt, today);
  if (age !== null) ctx.fact("Age", `${age} day(s) since created`, ref);
  const idle = daysBetween(lead.updatedAt, today);
  if (idle !== null) ctx.fact("Last updated", `${idle} day(s) ago`, ref);
  if (lead.due) {
    const overdue = daysBetween(lead.due, today);
    ctx.fact("Next follow-up", overdue !== null && overdue > 0 && isOpen(lead) ? `${lead.due} — OVERDUE by ${overdue} day(s)` : lead.due, ref);
  } else ctx.fact("Next follow-up", "not set", ref);
  ctx.fact("Notes logged", (lead.notes ?? []).length, ref);

  // Quotations raised from this lead (linked), that the person may read.
  const quotes = (await readableRecords(db, actor, ["quotations"])).filter((q) => q.parentId === lead.id);
  ctx.fact("Quotations from this lead", quotes.length ? quotes.map((q) => `${q.id} (${q.status})`).join(", ") : "none");
  for (const q of quotes.slice(0, 5)) describe(ctx, q);

  // Meetings about this lead that the person may reach.
  const meetings = (await visibleMeetings(db, actor)).filter((m) => m.relatedRecordId === lead.id).slice(0, 5);
  ctx.fact("Meetings about this lead", meetings.length ? meetings.map((m) => `${m.title} — ${m.status}${m.startedAt ? `, ${gstToday(m.startedAt)}` : m.scheduledAt ? `, scheduled ${gstToday(m.scheduledAt)}` : ""}`).join("; ") : "none");
  for (const m of meetings) ctx.ref(`Meeting: ${m.title}`, { type: "meeting", id: m.id, view: m.status === "ended" ? "report" : "details" });

  if (canWrite(actor, lead)) ctx.allowSuggestionsFor(ref, "leads", lead.id);
  addNotes(ctx, lead, ref, 12);
  await addIdentityContext(db, actor, lead, ctx);
  return {
    record: lead,
    context: ctx,
    instructions: `Brief the salesperson on this lead in a few sentences: where it stands and what has happened. Then list risks (for example an overdue follow-up, no recent activity, a stalled stage) and the best next actions.
Draft a short, polite follow-up email to the customer contact (kind "email") that the salesperson can review and send themselves — do not promise prices, discounts or delivery dates that aren't in CONTEXT.
Suggest at most 3 CRM changes for this lead (reference ${ref}) only when CONTEXT clearly supports them: "add_note" (a factual note), "set_follow_up" (value = a date YYYY-MM-DD, today or later), "change_status" (value = one of: ${stages.leads.join(", ")}).`,
  };
}

/* ----------------------------------------------------------- Customer 360 */

export async function customerContext(db: Database, actor: Actor, id: unknown) {
  const customer = await readableRecord(db, actor, id, "customers");
  const today = gstToday();
  const ctx = new AiContext(`Customer ${customer.title}`);
  const ref = describe(ctx, customer);
  ctx.fact("Account status", customer.status, ref);
  for (const contact of await listContacts(db,actor,customer.id)) ctx.fact("Recorded contact", `${contact.name} · ${contact.role || "Contact"} · ${contact.active ? "Active" : "Inactive"} · version ${contact.version}`, ref);

  const all = await readRecords(db, actor, sql`json_extract(${businessRecords.payload}, '$.customerId') = ${customer.id}`);
  const list = all.filter(r => r.company === customer.company && r.branch === customer.branch);
  // Legacy candidates never contribute account history, counts, money or AI actions.
  const of = (kind: string) => list.filter((r) => r.kind === kind);

  const leads = of("leads");
  const openLeads = leads.filter(isOpen);
  ctx.fact("Leads", `${leads.length} (${openLeads.length} open, ${leads.filter((l) => l.status === "Won").length} won, ${leads.filter((l) => l.status === "Lost").length} lost)`);
  ctx.fact("Open pipeline value", formatTotals(sumByCurrency(openLeads)));
  const quotes = of("quotations");
  ctx.fact("Quotations", `${quotes.length} (${quotes.filter(isOpen).length} open; value open ${formatTotals(sumByCurrency(quotes.filter(isOpen)))})`);
  const orders = of("orders");
  ctx.fact("Orders", `${orders.length} (${orders.filter(isOpen).length} in progress; total ${formatTotals(sumByCurrency(orders.filter((o) => o.status !== "Cancelled")))})`);
  const invoices = of("accounts").filter((r) => r.status !== "Cancelled");
  const owed = invoices.map((r) => ({ amount: outstanding(r), currency: r.currency })).filter((x) => x.amount > 0);
  const overdue = invoices.filter((r) => outstanding(r) > 0 && (r.status === "Overdue" || (!!r.due && r.due < today)));
  ctx.fact("Outstanding receivables", formatTotals(sumByCurrency(owed)));
  ctx.fact("Overdue invoices", overdue.length ? `${overdue.length} (${formatTotals(sumByCurrency(overdue.map((r) => ({ amount: outstanding(r), currency: r.currency }))))})` : "none");
  const shipments = of("logistics");
  if (shipments.length) ctx.fact("Shipments", `${shipments.length} (${shipments.filter((s) => s.status === "Delayed").length} delayed, ${shipments.filter(isOpen).length} in progress)`);
  const last = list.map((r) => r.updatedAt).sort().at(-1);
  ctx.fact("Last activity", last ? `${gstToday(new Date(last))} (${daysBetween(last, today)} day(s) ago)` : "none recorded");
  ctx.fact(
    "Relationship basis",
    "Authoritative stable customerId relationships only. Possible legacy matches are kept separate for employee review and never attributed to this account",
    ref,
  );
  ctx.fact("Coverage", "Up to 200 authorized linked records; legacy matches are excluded.");

  // The records themselves (most recent first), overdue invoices first.
  for (const r of [...overdue, ...list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))].filter((r, i, a) => a.indexOf(r) === i).slice(0, 25)) {
    const rref = describe(ctx, r, "authoritative customerId");
    if (r.kind === "leads" && isOpen(r) && canWrite(actor, r)) ctx.allowSuggestionsFor(rref, "leads", r.id);
  }
  if (canWrite(actor, customer)) ctx.allowSuggestionsFor(ref, "customers", customer.id);
  for (const r of list.filter((x) => (x.notes ?? []).length).slice(0, 5)) addNotes(ctx, r, ctx.ref(`${KIND_LABEL[r.kind] ?? r.kind}: ${r.title} (${r.id})`, { type: "record", kind: r.kind, id: r.id }), 3);
  addNotes(ctx, customer, ref, 8);
  return {
    record: customer,
    context: ctx,
    /** The related records (heuristic, readable only) and the customer's own reference. */
    related: list,
    customerRef: ref,
    scope: "Only independently authorized customerId-linked records are included. Possible legacy name matches require separate review.",
    instructions: `Give a 360° view of this customer for the account team: relationship health, pipeline, orders, receivables and anything overdue — quoting the FACTS exactly. Then risks and the best next actions.
The related records have authoritative customerId links. Do not merge same-name customers. Legacy name matches are not attributed history. Coverage is bounded and permission-filtered, never guaranteed complete.
If useful, draft a short message to the customer (kind "email") the employee can review and send themselves.
Suggest at most 3 CRM changes, only for references that are records in CONTEXT and only when clearly supported: "add_note", "set_follow_up" (value YYYY-MM-DD), or "change_status" for an open lead (value one of: ${stages.leads.join(", ")}).`,
  };
}

export { CLOSED };
