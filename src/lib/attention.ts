import { canApprove, type Actor, type RecordItem } from "./domain";
import { businessToday } from "./gst";

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

/**
 * "Today" for the business, not for the reader's laptop.
 *
 * The company runs on Dubai time. Using the UTC date would mean that between
 * midnight and 04:00 Gulf time every follow-up was judged against yesterday —
 * an hour of the morning where the CRM quietly disagrees with the office.
 */
const today0 = () => businessToday();

/** Shifts a business date by whole days without reintroducing a local clock. */
const addDays = (date: string, days: number) =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY));
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
  today = today0(),
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
  today = today0(),
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
export const followUpPresets = (from?: Date | string) => {
  // Offsets are counted from the business day, so "tomorrow" means tomorrow in
  // Dubai even for someone working from another timezone.
  const base =
    typeof from === "string" ? from : from ? businessToday(from) : today0();
  return [
    { label: "Tomorrow", date: addDays(base, 1) },
    { label: "In 3 days", date: addDays(base, 3) },
    { label: "Next week", date: addDays(base, 7) },
    { label: "In 2 weeks", date: addDays(base, 14) },
  ];
};

export { iso as isoDate };

// ---------------------------------------------------------------- next action

export type NextAction = {
  label: string;
  tone: "urgent" | "warning" | "info" | "neutral" | "done";
};

/**
 * What this record needs next, derived rather than stored.
 *
 * Nobody should have to open a record to find out what to do with it. Every
 * answer here comes from status, due date and last activity, so it stays true
 * without anyone maintaining a field.
 */
export function nextAction(r: RecordItem, today = today0()): NextAction {
  if (r.deletedAt) return { label: "Deleted", tone: "neutral" };
  if (!isOpen(r)) return { label: r.status, tone: "done" };

  if (r.status === "Pending Approval") return { label: "Awaiting approval", tone: "warning" };
  if (r.status === "Overdue") return { label: "Payment overdue", tone: "urgent" };
  if (r.status === "Delayed")
    return { label: r.kind === "logistics" ? "Shipment delayed" : "Order delayed", tone: "urgent" };

  const due = (r.due || "").slice(0, 10);
  if (due) {
    const overdueBy = daysBetween(due, today);
    if (overdueBy > 1) return { label: `Follow up — ${overdueBy} days late`, tone: "urgent" };
    if (overdueBy === 1) return { label: "Follow up — 1 day late", tone: "urgent" };
    if (overdueBy === 0) return { label: "Follow up today", tone: "warning" };
    if (overdueBy === -1) return { label: "Follow up tomorrow", tone: "info" };
    if (overdueBy >= -7) return { label: `Follow up ${due}`, tone: "info" };
  }

  const idle = idleDays(r, today);
  if (r.kind === "quotations" && r.status === "Sent")
    return idle >= 7
      ? { label: `No response for ${idle} days`, tone: "warning" }
      : { label: "Awaiting customer response", tone: "info" };
  if (r.kind === "quotations" && r.status === "Draft")
    return { label: "Send quotation", tone: "info" };
  if (r.kind === "leads" && r.status === "New") return { label: "Make first contact", tone: "info" };
  if (r.kind === "leads" && r.status === "Qualified") return { label: "Prepare quotation", tone: "info" };
  if (idle >= (STALE_DAYS[r.kind] ?? 30))
    return { label: `No activity for ${idle} days`, tone: "warning" };

  return { label: "No next action", tone: "neutral" };
}

/**
 * How long a record of each kind may sit untouched before it counts as stale.
 * A shipment going quiet for a fortnight is a problem; a supplier record is not.
 */
export const STALE_DAYS: Record<string, number> = {
  leads: 14,
  quotations: 7,
  orders: 14,
  logistics: 7,
  accounts: 14,
  customers: 90,
  suppliers: 180,
};

/** Records of a kind that have gone quiet for longer than that kind allows. */
export const staleRecords = (records: RecordItem[], today = today0()) =>
  records.filter(
    (r) => isOpen(r) && idleDays(r, today) >= (STALE_DAYS[r.kind] ?? 30),
  );

// --------------------------------------------------------------- morning brief

export type BriefLine = { text: string; tone: NextAction["tone"]; to?: string };

/**
 * A deterministic executive briefing.
 *
 * Every line is counted from the records themselves — nothing is generated,
 * estimated or phrased by a model. Lines that would read "0 of something" are
 * omitted rather than padded, so the brief is short on a good day.
 */
export function morningBrief(
  actor: Actor,
  records: RecordItem[],
  today = today0(),
): BriefLine[] {
  const items = attentionItems(actor, records, today);
  const lines: BriefLine[] = [];
  const money = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));

  if (items.length)
    lines.push({
      text: `${items.length} ${items.length === 1 ? "item needs" : "items need"} attention`,
      tone: items.some((i) => i.severity === "urgent") ? "urgent" : "warning",
    });

  const overduePay = records.filter((r) => isOpen(r) && r.status === "Overdue");
  if (overduePay.length) {
    const total = overduePay.reduce((sum, r) => sum + (r.amount || 0), 0);
    lines.push({
      text: `${overduePay[0].currency} ${money(total)} overdue across ${overduePay.length} ${overduePay.length === 1 ? "invoice" : "invoices"}`,
      tone: "urgent",
      to: "accounts",
    });
  }

  const silentQuotes = records.filter(
    (r) => isOpen(r) && r.kind === "quotations" && r.status === "Sent" && idleDays(r, today) >= 7,
  );
  if (silentQuotes.length)
    lines.push({
      text: `${silentQuotes.length} ${silentQuotes.length === 1 ? "quotation has" : "quotations have"} had no response for 7+ days`,
      tone: "warning",
      to: "quotations",
    });

  const delayed = records.filter((r) => isOpen(r) && r.status === "Delayed");
  if (delayed.length)
    lines.push({
      text: `${delayed.length} ${delayed.length === 1 ? "shipment is" : "shipments are"} delayed`,
      tone: "urgent",
      to: "logistics",
    });

  // Who is carrying overdue work, rather than who is "top".
  const behind = new Set(
    records
      .filter((r) => isOpen(r) && r.due && daysBetween(r.due.slice(0, 10), today) > 0 && r.owner)
      .map((r) => r.owner),
  );
  if (behind.size)
    lines.push({
      text: `${behind.size} ${behind.size === 1 ? "person has" : "people have"} overdue follow-ups`,
      tone: "warning",
    });

  const yesterday = iso(new Date(Date.parse(today) - DAY));
  const wonRecently = records.filter(
    (r) => r.status === "Won" && (r.updatedAt || "").slice(0, 10) >= yesterday,
  );
  if (wonRecently.length) {
    const total = wonRecently.reduce((sum, r) => sum + (r.amount || 0), 0);
    lines.push({
      text: `${wonRecently.length} ${wonRecently.length === 1 ? "deal" : "deals"} won since yesterday${total ? ` · ${wonRecently[0].currency} ${money(total)}` : ""}`,
      tone: "done",
    });
  }

  const stale = staleRecords(records.filter((r) => r.kind === "leads"), today);
  if (stale.length)
    lines.push({
      text: `${stale.length} ${stale.length === 1 ? "opportunity has" : "opportunities have"} gone quiet`,
      tone: "warning",
      to: "leads",
    });

  return lines;
}

// ------------------------------------------------------- operational views

export type OperationalView = {
  id: string;
  label: string;
  detail: string;
  records: RecordItem[];
};

/**
 * The slices people actually open the CRM to look at.
 *
 * Each is a question with an answer already in memory — "what is overdue",
 * "which quotations has nobody answered" — so it needs no saved-query backend
 * and no hand-built filter. Empty slices are dropped: a list of questions with
 * no answers is noise.
 *
 * `records` must already be permission-scoped by the caller.
 */
export function operationalViews(
  actor: Actor,
  records: RecordItem[],
  today = today0(),
): OperationalView[] {
  const open = records.filter(isOpen);
  const overdue = open.filter(
    (r) => r.due && daysBetween(r.due.slice(0, 10), today) > 0,
  );
  const dueToday = open.filter((r) => r.due && r.due.slice(0, 10) === today);
  const silentQuotes = open.filter(
    (r) => r.kind === "quotations" && r.status === "Sent" && idleDays(r, today) >= 7,
  );
  const delayed = open.filter((r) => r.status === "Delayed");
  const unpaid = open.filter((r) => r.status === "Overdue");
  const mine = open.filter((r) => r.ownerId === actor.id);
  const stale = staleRecords(open, today);
  const highValue = [...open]
    .filter((r) => (r.amount || 0) > 0)
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 20);

  return (
    [
      { id: "overdue", label: "Overdue follow-ups", detail: "Past their follow-up date", records: overdue },
      { id: "today", label: "Due today", detail: "Follow up before the day ends", records: dueToday },
      { id: "silent-quotes", label: "Quotations awaiting response", detail: "Sent, no reply for 7+ days", records: silentQuotes },
      { id: "delayed", label: "Delayed shipments and orders", detail: "Behind schedule", records: delayed },
      { id: "unpaid", label: "Outstanding payments", detail: "Invoices past due", records: unpaid },
      { id: "stale", label: "Gone quiet", detail: "No activity for longer than expected", records: stale },
      { id: "high-value", label: "Highest value open records", detail: "By amount", records: highValue },
      { id: "mine", label: "My records", detail: "Everything you own", records: mine },
    ] as OperationalView[]
  ).filter((view) => view.records.length > 0);
}
