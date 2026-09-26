import { and, eq } from "drizzle-orm";
import type { Database } from "../d1";
import { businessRecords } from "../schema";
import { RECORD_PAGE_LIMIT, findRecord, listRecordsForActor } from "../data";
import { canRead, money, type Actor, type Kind, type RecordItem } from "../domain";
import { AiError } from "./gateway";

/**
 * Records for AI tools — always through the CRM's own rules:
 * company/branch scope in SQL (as the records page does), then `canRead`
 * per record (role, module access, own-records-only roles). A record the
 * person can't read never reaches a tool, let alone the model.
 */

export async function readableRecords(db: Database, actor: Actor, kinds?: Kind[]): Promise<RecordItem[]> {
  const rows = await listRecordsForActor(db, actor.companies, actor.branches, RECORD_PAGE_LIMIT);
  return rows
    .map((r) => r.payload as RecordItem)
    .filter((r) => !r.deletedAt && canRead(actor, r) && (!kinds || kinds.includes(r.kind)));
}

/** True when the person's scan may have been cut at the page limit (said in answers). */
export const mayBeTruncated = (count: number) => count >= RECORD_PAGE_LIMIT;

/** One record the person may read, or the same "not found" as a missing one. */
export async function readableRecord(db: Database, actor: Actor, id: unknown, kind?: Kind): Promise<RecordItem> {
  if (typeof id !== "string" || id.length > 100) throw new AiError(404, "Record not found.");
  const row = await findRecord(db, id);
  const record = row?.payload as RecordItem | undefined;
  if (!record || record.deletedAt || !canRead(actor, record) || (kind && record.kind !== kind)) throw new AiError(404, "Record not found.");
  return record;
}

/** Same name, compared loosely (case, spacing, punctuation). */
export const sameName = (a: string | undefined, b: string | undefined) => {
  const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return !!norm(a) && norm(a) === norm(b);
};

/** Sums money per currency — amounts in different currencies are never added together. */
export function sumByCurrency(items: { amount: number; currency: string }[]) {
  const totals = new Map<string, number>();
  for (const i of items) totals.set(i.currency || "USD", Math.round(((totals.get(i.currency || "USD") ?? 0) + (Number(i.amount) || 0)) * 100) / 100);
  return totals;
}

export function formatTotals(totals: Map<string, number>) {
  if (!totals.size) return "0";
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    // Same formatting as everywhere else in the CRM.
    .map(([currency, amount]) => money(amount, currency))
    .join(" + ");
}

export const CLOSED: Record<string, string[]> = {
  leads: ["Won", "Lost"],
  quotations: ["Accepted", "Rejected", "Expired"],
  orders: ["Completed", "Cancelled"],
  logistics: ["Delivered", "Cancelled"],
  accounts: ["Paid", "Cancelled"],
};
export const isOpen = (r: RecordItem) => !(CLOSED[r.kind] ?? []).includes(r.status);

/**
 * How many OTHER customer records in this company have exactly the same
 * normalised name — across the whole company, not only what this person can
 * see, so an invisible namesake still stops two histories being merged. Only
 * the count leaves this function.
 */
export async function customerNamesakes(db: Database, customer: RecordItem) {
  const rows = await db
    .select({ id: businessRecords.id, payload: businessRecords.payload })
    .from(businessRecords)
    .where(and(eq(businessRecords.kind, "customers"), eq(businessRecords.company, customer.company)));
  return rows.filter((r) => r.id !== customer.id && !(r.payload as RecordItem).deletedAt && sameName((r.payload as RecordItem).title, customer.title)).length;
}
