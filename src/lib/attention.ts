import { canApprove, type Actor, type RecordItem } from "./domain";

/**
 * The exception engine behind both "My day" and the executive dashboard.
 *
 * The principle: nobody should have to go looking for a problem. Everything
 * that needs a human is derived from records already loaded, ranked by
 * business impact, and handed back with the action that resolves it.
 *
 * Pure and date-injectable so the rules can be tested without freezing a clock.
 */

export type Severity = "urgent" | "warning" | "info";

export type AttentionItem = {
  id: string;
  record: RecordItem;
  severity: Severity;
  /** Short phrase naming the problem, e.g. "Follow-up 6 days overdue". */
  reason: string;
  /** Grouping label shown beside the item. */
  category: string;
  /** What resolves it, so the row can offer the right control. */
  action: "approve" | "follow-up" | "open";
  /** Higher is more pressing. Severity dominates; impact breaks ties. */
  rank: number;
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** Statuses that mean the record is finished and needs nobody. */
const CLOSED = ["Won", "Lost", "Completed", "Paid", "Cancelled", "Resolved", "Rejected", "Inactive"];
export const isOpen = (r: RecordItem) => !r.deletedAt && !CLOSED.includes(r.status);

const WEIGHT: Record<Severity, number> = { urgent: 3_000_000, warning: 2_000_000, info: 1_000_000 };

/**
 * Value matters, but it must not let a large stale deal outrank a genuinely
 * urgent one, so it only ever breaks ties inside a severity band.
 */
const impact = (r: RecordItem) => Math.min(999_999, Math.round(r.amount || 0));

/** Days since the record was last touched. */
export const idleDays = (r: RecordItem, today: string) =>
  daysBetween((r.updatedAt || r.createdAt || today).slice(0, 10), today);

/**
 * Everything needing attention in the actor's scope, most pressing first.
 *
 * `records` must already be permission-scoped by the caller; this adds no
 * access of its own beyond the approval check, which is a capability rather
 * than a visibility rule.
 */
export function attentionItems(
  actor: Actor,
  records: RecordItem[],
  today = iso(new Date()),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (
    record: RecordItem,
    severity: Severity,
    category: string,
    reason: string,
    action: AttentionItem["action"],
    bump = 0,
  ) =>
    items.push({
      id: `${record.id}:${category}`,
      record, severity, category, reason, action,
      rank: WEIGHT[severity] + impact(record) + bump,
    });

  for (const record of records) {
    if (!isOpen(record)) continue;
    const due = (record.due || "").slice(0, 10);
    const overdueBy = due ? daysBetween(due, today) : 0;
    const idle = idleDays(record, today);

    // Someone is blocked waiting for a decision.
    if (record.status === "Pending Approval" && canApprove(actor, record)) {
      add(record, "urgent", "Approval", "Waiting for your approval", "approve", idle * 10);
      continue;
    }
    // Money and goods that have already slipped.
    if (record.status === "Overdue") {
      add(record, "urgent", "Payment", "Payment overdue", "open");
      continue;
    }
    if (record.status === "Delayed") {
      add(record, "urgent", record.kind === "logistics" ? "Logistics" : "Order", "Delayed", "open");
      continue;
    }
    // A commitment to contact someone that has passed.
    if (due && overdueBy > 0) {
      add(
        record, "urgent", "Follow-up",
        `Follow-up ${overdueBy} ${overdueBy === 1 ? "day" : "days"} overdue`,
        "follow-up", overdueBy * 10,
      );
      continue;
    }
    if (due && overdueBy === 0) {
      add(record, "warning", "Follow-up", "Follow-up due today", "follow-up");
      continue;
    }
    // A quotation nobody has answered is the most common silent loss.
    if (record.kind === "quotations" && record.status === "Sent" && idle >= 7) {
      add(record, "warning", "Quotation", `Sent ${idle} days ago, no response`, "follow-up", idle);
      continue;
    }
    // A valuable opportunity going cold.
    if (record.kind === "leads" && idle >= 14 && (record.amount || 0) > 0) {
      add(record, "warning", "Opportunity", `No activity for ${idle} days`, "follow-up", idle);
      continue;
    }
    if (record.kind === "leads" && idle >= 30) {
      add(record, "info", "Opportunity", `Untouched for ${idle} days`, "follow-up", idle);
    }
  }

  return items.sort((a, b) => b.rank - a.rank);
}

export type MyDay = {
  overdue: AttentionItem[];
  today: AttentionItem[];
  approvals: AttentionItem[];
  soon: RecordItem[];
  /** True when there is genuinely nothing to do, not merely nothing loaded. */
  clear: boolean;
};

/**
 * The employee view of the same facts: what must happen today, what is late,
 * and what is coming — scoped to the records they own, because an employee's
 * day is their own work, not the company's.
 */
export function myDay(
  actor: Actor,
  records: RecordItem[],
  today = iso(new Date()),
): MyDay {
  const mine = records.filter((r) => r.ownerId === actor.id);
  const items = attentionItems(actor, mine, today);
  // Approvals are a duty rather than ownership, so they are drawn from
  // everything the actor can see.
  const approvals = attentionItems(actor, records, today).filter((i) => i.action === "approve");

  const horizon = iso(new Date(Date.parse(today) + 7 * DAY));
  const soon = mine.filter((r) => {
    const due = (r.due || "").slice(0, 10);
    return isOpen(r) && due > today && due <= horizon;
  }).sort((a, b) => a.due.localeCompare(b.due));

  const overdue = items.filter((i) => i.category === "Follow-up" && i.severity === "urgent");
  const dueToday = items.filter((i) => i.category === "Follow-up" && i.severity === "warning");

  return {
    overdue, today: dueToday, approvals, soon,
    clear: !overdue.length && !dueToday.length && !approvals.length,
  };
}

/** Follow-up presets, so a date is one tap rather than a typed calendar. */
export const followUpPresets = (from = new Date()) => [
  { label: "Tomorrow", date: iso(new Date(from.getTime() + DAY)) },
  { label: "In 3 days", date: iso(new Date(from.getTime() + 3 * DAY)) },
  { label: "Next week", date: iso(new Date(from.getTime() + 7 * DAY)) },
  { label: "In 2 weeks", date: iso(new Date(from.getTime() + 14 * DAY)) },
];

export { iso as isoDate };
