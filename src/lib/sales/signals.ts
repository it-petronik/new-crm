import { money, type RecordItem } from "../domain";
import { businessToday } from "../gst";

/**
 * Sales Signals — DETERMINISTIC. Enercore decides what needs attention, how
 * long something has been idle and how items rank; the AI may only explain a
 * signal and draft around it. Pure functions: no I/O, no model, easy to test.
 *
 * Quotations: `due` is the validity date ("Valid until"), so they produce
 * waiting / expiring / expired signals, never follow-up ones.
 */

export const SIGNAL_TYPES = [
  "FOLLOW_UP_OVERDUE",
  "FOLLOW_UP_TODAY",
  "LEAD_GONE_QUIET",
  "QUOTATION_WAITING",
  "QUOTATION_EXPIRING",
  "QUOTATION_EXPIRED",
  "MEETING_TODAY",
  "MEETING_OUTCOME_MISSING",
  "REQUIREMENT_INCOMPLETE",
  "NEGOTIATION_STALLED",
  "HIGH_VALUE_NO_NEXT_ACTION",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Thresholds, in whole GST days. */
export const SALES_THRESHOLDS = {
  goneQuietDays: 14,
  quotationWaitingDays: 3,
  quotationExpiringDays: 7,
  negotiationStalledDays: 7,
  meetingOutcomeWindowDays: 14,
  /** "High value", per currency (no conversion is ever made). */
  highValue: { USD: 50_000, EUR: 45_000, SGD: 65_000, AED: 180_000 } as Record<string, number>,
} as const;

export const NEXT_ACTIONS = [
  "call_customer",
  "send_follow_up",
  "schedule_meeting",
  "prepare_meeting",
  "prepare_quotation",
  "request_missing_info",
  "follow_up_quotation",
  "log_meeting_outcome",
  "set_follow_up",
  "review_negotiation",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  call_customer: "Call the customer",
  send_follow_up: "Send a follow-up",
  schedule_meeting: "Schedule a meeting",
  prepare_meeting: "Prepare for today's meeting",
  prepare_quotation: "Prepare a quotation",
  request_missing_info: "Request the missing information",
  follow_up_quotation: "Follow up the quotation",
  log_meeting_outcome: "Log the meeting outcome",
  set_follow_up: "Set the next follow-up",
  review_negotiation: "Review the stalled negotiation",
};

/** What a meeting contributes to signals (only meetings the person may see). */
export type SignalMeeting = {
  id: string;
  title: string;
  status: "scheduled" | "live" | "ended" | "cancelled" | "missed";
  scheduledAt: string | null;
  endedAt: string | null;
  relatedRecordId: string | null;
};

export type SalesSignal = {
  type: SignalType;
  recordId: string;
  /** Deterministic, factual label, e.g. "Follow-up overdue 3 days". */
  label: string;
  /** The deterministic next action this signal implies. */
  action: NextAction;
  score: number;
  days?: number;
  meetingId?: string;
};

export type SalesPriority = {
  record: { id: string; kind: string; title: string; status: string; company: string; owner: string; ownerId: string; value: string; due: string };
  signals: SalesSignal[];
  score: number;
  action: NextAction;
  /** Deterministic "why" for the action (the AI may rephrase, not change facts). */
  why: string;
  lastActivity: string | null;
  daysIdle: number | null;
  meetingId?: string;
};

const CLOSED: Record<string, string[]> = {
  leads: ["Won", "Lost"],
  quotations: ["Accepted", "Rejected", "Expired"],
};
export const isOpenDeal = (r: RecordItem) => (r.kind === "leads" || r.kind === "quotations") && !r.deletedAt && !(CLOSED[r.kind] ?? []).includes(r.status);

/** Whole days between two YYYY-MM-DD business dates. */
export const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
/** A stored timestamp or date as its GST business date. */
export const businessDateOf = (value: string) => (value.length <= 10 ? value : businessToday(new Date(value)));

/** The latest activity on a record: its last update or last note. */
export function lastActivity(r: RecordItem): string | null {
  const stamps = [r.updatedAt, ...(r.notes ?? []).map((n) => n.at)].filter((s): s is string => !!s && !Number.isNaN(Date.parse(s)));
  return stamps.length ? stamps.sort().at(-1)! : null;
}

export const isHighValue = (r: RecordItem) => {
  const threshold = SALES_THRESHOLDS.highValue[r.currency || "USD"];
  return threshold !== undefined && r.amount >= threshold;
};

/** Structured requirement fields a lead needs before quoting (deterministic, fields only). */
export function missingStructuredFields(r: RecordItem) {
  const missing: string[] = [];
  if (!r.product?.trim()) missing.push("product");
  if (!(r.quantity > 0)) missing.push("quantity");
  if (!r.destination?.trim()) missing.push("destination");
  return missing;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every signal for one record. `today` is the GST business date. */
export function recordSignals(r: RecordItem, today: string, meetings: SignalMeeting[] = []): SalesSignal[] {
  if (!isOpenDeal(r)) return [];
  const out: SalesSignal[] = [];
  const add = (s: Omit<SalesSignal, "recordId">) => out.push({ ...s, recordId: r.id });
  const due = (r.due || "").slice(0, 10);
  const last = lastActivity(r);
  const idle = last ? dayDiff(businessDateOf(last), today) : null;

  if (r.kind === "leads") {
    if (due && due < today) {
      const d = dayDiff(due, today);
      add({ type: "FOLLOW_UP_OVERDUE", label: `Follow-up overdue ${plural(d, "day")}`, action: "send_follow_up", score: 100 + Math.min(d, 30) * 3, days: d });
    } else if (due === today) add({ type: "FOLLOW_UP_TODAY", label: "Follow-up due today", action: "send_follow_up", score: 90 });
    if (idle !== null && idle >= SALES_THRESHOLDS.goneQuietDays)
      add({ type: "LEAD_GONE_QUIET", label: `No activity for ${plural(idle, "day")}`, action: "call_customer", score: 50 + Math.min(idle, 60) / 4, days: idle });
    if (r.status === "Negotiation" && idle !== null && idle >= SALES_THRESHOLDS.negotiationStalledDays)
      add({ type: "NEGOTIATION_STALLED", label: `Negotiation idle ${plural(idle, "day")}`, action: "review_negotiation", score: 70 + Math.min(idle, 30), days: idle });
    if (isHighValue(r) && !due)
      add({ type: "HIGH_VALUE_NO_NEXT_ACTION", label: `${money(r.amount, r.currency)} opportunity with no next action`, action: "set_follow_up", score: 76 });
    const missing = missingStructuredFields(r);
    if (["Qualified", "Negotiation"].includes(r.status) && missing.length)
      add({ type: "REQUIREMENT_INCOMPLETE", label: `Requirement incomplete: no ${missing.join(", ")}`, action: "request_missing_info", score: 40 + missing.length * 5 });
  }

  if (r.kind === "quotations") {
    if (["Sent", "Approved"].includes(r.status) && due) {
      if (due < today) add({ type: "QUOTATION_EXPIRED", label: `Quotation validity ended ${plural(dayDiff(due, today), "day")} ago`, action: "follow_up_quotation", score: 60, days: dayDiff(due, today) });
      else if (dayDiff(today, due) <= SALES_THRESHOLDS.quotationExpiringDays) {
        const d = dayDiff(today, due);
        add({ type: "QUOTATION_EXPIRING", label: d === 0 ? "Quotation expires today" : `Quotation expires in ${plural(d, "day")}`, action: "follow_up_quotation", score: 82 - d, days: d });
      }
    }
    if (r.status === "Sent" && idle !== null && idle >= SALES_THRESHOLDS.quotationWaitingDays)
      add({ type: "QUOTATION_WAITING", label: `Quotation awaiting response for ${plural(idle, "day")}`, action: "follow_up_quotation", score: 70 + Math.min(idle, 30), days: idle });
  }

  for (const m of meetings.filter((m) => m.relatedRecordId === r.id)) {
    if (["scheduled", "live"].includes(m.status) && m.scheduledAt && businessDateOf(m.scheduledAt) === today)
      add({ type: "MEETING_TODAY", label: `Meeting today: ${m.title}`, action: "prepare_meeting", score: 88, meetingId: m.id });
    if (m.status === "ended" && m.endedAt) {
      const endedDay = businessDateOf(m.endedAt);
      const age = dayDiff(endedDay, today);
      const logged = (r.notes ?? []).some((n) => n.at && Date.parse(n.at) >= Date.parse(m.endedAt!));
      if (age <= SALES_THRESHOLDS.meetingOutcomeWindowDays && !logged)
        add({ type: "MEETING_OUTCOME_MISSING", label: age === 0 ? `Meeting "${m.title}" ended today; no outcome logged` : `Meeting "${m.title}" ended ${plural(age, "day")} ago; no outcome logged`, action: "log_meeting_outcome", score: 84 - Math.min(age, 14), days: age, meetingId: m.id });
    }
  }
  return out;
}

/** Value makes an item matter more, without letting size alone outrank urgency. */
const valueBoost = (r: RecordItem) => (isHighValue(r) ? 10 : r.amount > 0 ? 3 : 0);

export function toPriority(r: RecordItem, signals: SalesSignal[], today: string): SalesPriority {
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const last = lastActivity(r);
  const daysIdle = last ? dayDiff(businessDateOf(last), today) : null;
  return {
    record: { id: r.id, kind: r.kind, title: r.title, status: r.status, company: r.company, owner: r.owner, ownerId: r.ownerId, value: r.amount ? money(r.amount, r.currency) : "", due: r.due },
    signals: sorted,
    score: top.score + (sorted.length - 1) * 5 + valueBoost(r),
    action: top.action,
    why: sorted.map((s) => s.label).join("; ") + ".",
    lastActivity: last ? businessDateOf(last) : null,
    daysIdle,
    meetingId: sorted.find((s) => s.meetingId)?.meetingId,
  };
}

/**
 * The day's priorities: records with at least one signal, ranked by
 * deterministic score (ties: higher value, then older activity, then id).
 */
export function salesPriorities(records: RecordItem[], today: string, meetings: SignalMeeting[] = [], limit = 10): SalesPriority[] {
  const scored = records
    .map((r) => ({ r, signals: recordSignals(r, today, meetings) }))
    .filter((x) => x.signals.length)
    .map((x) => ({ r: x.r, p: toPriority(x.r, x.signals, today) }));
  return scored
    .sort((a, b) => b.p.score - a.p.score || b.r.amount - a.r.amount || (a.p.lastActivity ?? "").localeCompare(b.p.lastActivity ?? "") || a.r.id.localeCompare(b.r.id))
    .slice(0, limit)
    .map((x) => x.p);
}

/**
 * Candidate next actions for one lead, best first — deterministic. The AI
 * may choose among these and explain why; it cannot add others.
 */
export function nextActionCandidates(r: RecordItem, signals: SalesSignal[], options: { hasQuotation: boolean; hasMeeting: boolean; missingForQuote: number }): NextAction[] {
  const out: NextAction[] = [];
  for (const s of [...signals].sort((a, b) => b.score - a.score)) out.push(s.action);
  if (r.kind === "leads") {
    if (["Qualified", "Negotiation"].includes(r.status) && !options.hasQuotation) out.push(options.missingForQuote ? "request_missing_info" : "prepare_quotation");
    if (["New", "Contacted"].includes(r.status)) out.push("call_customer");
    if (["Qualified", "Quote Sent", "Negotiation"].includes(r.status) && !options.hasMeeting) out.push("schedule_meeting");
    if (!r.due) out.push("set_follow_up");
    out.push("send_follow_up");
  }
  return [...new Set(out)];
}

/** A deterministic sentence explaining a candidate, from the facts only. */
export function whyFor(action: NextAction, r: RecordItem, signals: SalesSignal[], missing: string[]): string {
  const sig = signals.find((s) => s.action === action);
  if (sig) return `${sig.label}.`;
  if (action === "prepare_quotation") return `The lead is at ${r.status} and no quotation has been raised yet.`;
  if (action === "request_missing_info") return `A quotation still needs: ${missing.join(", ")}.`;
  if (action === "call_customer") return `The lead is at ${r.status}; a call would qualify the requirement.`;
  if (action === "schedule_meeting") return "No meeting is recorded for this lead yet.";
  if (action === "set_follow_up") return "No next follow-up date is set.";
  return "Keep the conversation moving.";
}
