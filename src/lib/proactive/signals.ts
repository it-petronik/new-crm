import { canApprove, canRead, money, outstanding, type Actor, type RecordItem } from "../domain";
import { isCashEntry } from "../cashbook";
import { SALES_THRESHOLDS, businessDateOf, dayDiff, isHighValue, lastActivity, recordSignals, type SignalMeeting } from "../sales/signals";

/**
 * Proactive signals — DETERMINISTIC. Enercore code decides what currently
 * needs action, how urgent it is, who it is for and which actions are
 * allowed. No model is involved in detection, priority, counts, data quality
 * or resolution: a signal simply stops being derived once its condition is
 * fixed. Sales/quotation/meeting rules come from Phase 2 (one source of
 * truth); this adds orders, logistics, accounts, approvals, data quality and
 * duplicate candidates.
 */

/** Central thresholds (whole GST days / minutes). Nothing here is decided by AI. */
export const PROACTIVE_THRESHOLDS = {
  approvalOverdueDays: 2,
  orderStaleDays: 7,
  shipmentNoUpdateDays: 5,
  documentsPendingDays: 3,
  etaApproachingDays: 3,
  deliveryOverdueSevereDays: 7,
  invoiceDraftDays: 3,
  meetingStartingSoonMinutes: 30,
  meetingReportWindowDays: 7,
} as const;

export const CATEGORIES = ["sales", "quotation", "customer", "meeting", "order", "logistics", "accounts", "data_quality", "approval", "management"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Severity = "urgent" | "important" | "normal";

/** Actions a signal may offer. The AI can never add to this list. */
export const ACTIONS = [
  "open",
  "draft_follow_up",
  "set_follow_up",
  "complete_details",
  "prepare_meeting",
  "review_meeting",
  "generate_meeting_report",
  "review_approval",
  "review_duplicates",
] as const;
export type ActionId = (typeof ACTIONS)[number];

export type ProactiveSignal = {
  /** Dedupe key: one condition = one signal. */
  key: string;
  type: string;
  category: Category;
  severity: Severity;
  /** Which Action Center section it belongs to. */
  section: "needs_action" | "today" | "waiting" | "data";
  entity: { type: string; id: string; title: string; status: string; company: string; branch: string; ownerId: string | null; owner: string | null; value: string; due?: string; updatedAt?: string };
  /** Other records involved (duplicates). */
  related?: { type: string; id: string; title: string }[];
  label: string;
  facts: Record<string, string | number>;
  /** Missing fields for Quick Complete (field names on the record). */
  missing?: string[];
  actions: ActionId[];
  dismissible: boolean;
  snoozable: boolean;
  rank: number;
  /**
   * A short hash of the facts that make this condition what it is (never the
   * facts themselves). A snooze or dismissal holds only while it matches: a
   * materially different condition on the same record surfaces again.
   */
  fingerprint: string;
  meetingId?: string;
};

export type ProactiveMeeting = SignalMeeting & {
  createdBy: string;
  scheduledAt: string | null;
  /** Has written content (chat or notes) — for "report not generated". */
  hasContent?: boolean;
  hasReport?: boolean;
};

/**
 * Signals that are about time passing since the last change: a new change,
 * then quiet again, is a new condition — so the record's last update counts.
 * For the rest, what matters is the stage, the dates and what is missing.
 */
const IDLE_TYPES = new Set(["LEAD_GONE_QUIET", "NEGOTIATION_STALLED", "QUOTATION_WAITING_RESPONSE", "QUOTATION_APPROVAL_PENDING", "QUOTATION_APPROVAL_OVERDUE", "ORDER_STATUS_STALE", "SHIPMENT_NO_UPDATE", "DOCUMENTS_PENDING", "INVOICE_WAITING"]);
function fingerprintOf(s: Omit<ProactiveSignal, "rank" | "fingerprint">) {
  const parts = [s.type, s.entity.status, s.entity.due ?? "", (s.missing ?? []).join(","), String(s.facts.evidence ?? ""), IDLE_TYPES.has(s.type) ? (s.entity.updatedAt ?? "") : ""];
  // FNV-1a, 32-bit: stable, tiny, and carries none of the CRM values.
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const WEIGHT: Record<Severity, number> = { urgent: 3_000_000, important: 2_000_000, normal: 1_000_000 };
/** Value only breaks ties inside a severity band, per currency tier — no FX, no mixing. */
const valueWeight = (r: RecordItem) => (isHighValue(r) ? 50_000 : r.amount > 0 ? 10_000 : 0);

const entityOf = (r: RecordItem) => ({ type: r.kind, id: r.id, title: r.title, status: r.status, company: r.company, branch: r.branch, ownerId: r.ownerId ?? null, owner: r.owner ?? null, value: r.amount ? money(r.amount, r.currency) : "", due: r.due || "", updatedAt: r.updatedAt });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------ stage-aware completeness */

export type MissingField = "contact" | "product" | "quantity" | "destination" | "due" | "country" | "quotation";
export const MISSING_LABELS: Record<MissingField, string> = {
  contact: "Contact",
  product: "Product",
  quantity: "Quantity",
  destination: "Destination",
  due: "Next follow-up",
  country: "Country",
  quotation: "Linked quotation",
};
const hasContact = (r: RecordItem) => !!(r.contact?.trim() || r.email?.trim() || r.phone?.trim());

/**
 * What a record should have at its CURRENT stage — centralised. A brand-new
 * enquiry is not asked for quotation-stage details.
 */
export function missingFields(r: RecordItem, options: { hasQuotation?: boolean; canSeeQuotations?: boolean } = {}): MissingField[] {
  const out: MissingField[] = [];
  if (r.kind === "leads") {
    const core = () => {
      if (!r.product?.trim()) out.push("product");
      if (!(r.quantity > 0)) out.push("quantity");
      if (!r.destination?.trim()) out.push("destination");
    };
    if (["New", "Contacted"].includes(r.status)) {
      if (!hasContact(r)) out.push("contact");
    } else if (r.status === "Qualified") {
      if (!hasContact(r)) out.push("contact");
      core();
      if (!r.due) out.push("due");
    } else if (r.status === "Quote Sent") {
      core();
      if (!r.due) out.push("due");
      if (options.canSeeQuotations && options.hasQuotation === false) out.push("quotation");
    } else if (r.status === "Negotiation") {
      if (!hasContact(r)) out.push("contact");
      core();
      if (!r.due) out.push("due");
    }
  } else if (r.kind === "customers" && r.status === "Active") {
    if (!hasContact(r)) out.push("contact");
    if (!r.attributes?.country?.trim() && !r.destination?.trim()) out.push("country");
  } else if (r.kind === "suppliers" && r.status === "Active") {
    if (!hasContact(r)) out.push("contact");
    if (!r.product?.trim()) out.push("product");
    if (!r.attributes?.country?.trim()) out.push("country");
  }
  return out;
}

/* ------------------------------------------------------ duplicate candidates */

const SUFFIXES = /\b(?:l\.?l\.?c|ltd|limited|fze|fzco|fz\s?llc|co|company|inc|incorporated|llp|plc|gmbh|est|establishment|trading|general trading|group)\b\.?/g;
/** A company name reduced to its identity: case, punctuation and legal suffixes removed. */
export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
const phoneKey = (p?: string) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-9) : "";
};

/**
 * Possible duplicates among customers or suppliers of the same company —
 * only on deterministic evidence (same normalised name, same email, same
 * phone). Advisory: nothing is merged.
 */
export function duplicateCandidates(records: RecordItem[]) {
  const out: { a: RecordItem; b: RecordItem; evidence: string[] }[] = [];
  const pool = records.filter((r) => (r.kind === "customers" || r.kind === "suppliers") && !r.deletedAt);
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const [a, b] = [pool[i], pool[j]];
      if (a.kind !== b.kind || a.company !== b.company) continue;
      const evidence: string[] = [];
      const na = normalizeName(a.title);
      if (na.length >= 3 && na === normalizeName(b.title)) evidence.push("same name (ignoring legal suffixes)");
      if (a.email?.trim() && a.email.trim().toLowerCase() === b.email?.trim().toLowerCase()) evidence.push("same email");
      const pa = phoneKey(a.phone);
      if (pa && pa === phoneKey(b.phone)) evidence.push("same phone");
      if (evidence.length) out.push({ a, b, evidence });
    }
  return out;
}

/* ------------------------------------------------------------------ engine */

const CLOSED_ORDER = ["Completed", "Cancelled"];
const CLOSED_SHIPMENT = ["Delivered", "Cancelled"];

/**
 * Every signal for this actor over records they may read (the caller passes
 * only readable records) and meetings they may reach. Pure.
 */
export function proactiveSignals(input: { actor: Actor; records: RecordItem[]; meetings: ProactiveMeeting[]; today: string; now?: Date }): ProactiveSignal[] {
  const { actor, records, meetings, today } = input;
  const now = input.now ?? new Date();
  const out: ProactiveSignal[] = [];
  const push = (s: Omit<ProactiveSignal, "rank" | "fingerprint">, bump = 0) => out.push({ ...s, rank: WEIGHT[s.severity] + bump, fingerprint: fingerprintOf(s) });
  const byParent = new Map<string, RecordItem[]>();
  for (const r of records) if (r.parentId) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const readsQuotations = records.some((r) => r.kind === "quotations") || canRead(actor, { kind: "quotations", company: actor.companies[0], branch: actor.branches[0] ?? "Main", ownerId: actor.id } as RecordItem);
  const idleOf = (r: RecordItem) => {
    const last = lastActivity(r);
    return last ? dayDiff(businessDateOf(last), today) : 0;
  };

  for (const r of records) {
    if (r.deletedAt) continue;
    const idle = idleOf(r);
    const due = (r.due || "").slice(0, 10);
    const base = { entity: entityOf(r), dismissible: false, snoozable: true };

    /* Sales, quotations, lead meetings — Phase 2 rules, one source of truth. */
    if (r.kind === "leads" || r.kind === "quotations") {
      for (const s of recordSignals(r, today, meetings)) {
        if (s.type === "REQUIREMENT_INCOMPLETE") continue; // data quality below covers it, stage-aware
        const map: Record<string, { type: string; category: Category; severity: Severity; section: ProactiveSignal["section"]; actions: ActionId[]; dismissible?: boolean }> = {
          FOLLOW_UP_OVERDUE: { type: "FOLLOW_UP_OVERDUE", category: "sales", severity: "important", section: "needs_action", actions: ["open", "draft_follow_up", "set_follow_up"] },
          FOLLOW_UP_TODAY: { type: "FOLLOW_UP_DUE_TODAY", category: "sales", severity: "important", section: "today", actions: ["open", "draft_follow_up", "set_follow_up"] },
          LEAD_GONE_QUIET: { type: "LEAD_GONE_QUIET", category: "sales", severity: "normal", section: "needs_action", actions: ["open", "draft_follow_up", "set_follow_up"], dismissible: true },
          NEGOTIATION_STALLED: { type: "NEGOTIATION_STALLED", category: "sales", severity: "important", section: "needs_action", actions: ["open", "draft_follow_up", "set_follow_up"] },
          HIGH_VALUE_NO_NEXT_ACTION: { type: "HIGH_VALUE_NO_NEXT_ACTION", category: "sales", severity: "important", section: "needs_action", actions: ["open", "set_follow_up"] },
          QUOTATION_WAITING: { type: "QUOTATION_WAITING_RESPONSE", category: "quotation", severity: "important", section: "waiting", actions: ["open", "draft_follow_up", "set_follow_up"] },
          QUOTATION_EXPIRING: { type: "QUOTATION_EXPIRING", category: "quotation", severity: "important", section: "needs_action", actions: ["open", "draft_follow_up"] },
          QUOTATION_EXPIRED: { type: "QUOTATION_EXPIRED", category: "quotation", severity: "normal", section: "needs_action", actions: ["open", "draft_follow_up"] },
          MEETING_TODAY: { type: "MEETING_TODAY", category: "meeting", severity: "normal", section: "today", actions: ["open", "prepare_meeting"] },
          MEETING_OUTCOME_MISSING: { type: "MEETING_ENDED_NO_OUTCOME", category: "meeting", severity: "important", section: "needs_action", actions: ["review_meeting", "generate_meeting_report"] },
        };
        const m = map[s.type];
        if (!m) continue;
        push({ ...base, key: `${m.type}:${r.id}${s.meetingId ? `:${s.meetingId}` : ""}`, type: m.type, category: m.category, severity: m.severity, section: m.section, label: s.label, facts: { ...(s.days !== undefined ? { days: s.days } : {}) }, actions: m.actions, dismissible: !!m.dismissible, meetingId: s.meetingId }, s.score * 10 + valueWeight(r));
      }
      // Approvals: blocking a transaction — for someone who may approve.
      if (r.kind === "quotations" && r.status === "Pending Approval" && canApprove(actor, r)) {
        const overdue = idle >= PROACTIVE_THRESHOLDS.approvalOverdueDays;
        push({ ...base, key: `QUOTATION_APPROVAL:${r.id}`, type: overdue ? "QUOTATION_APPROVAL_OVERDUE" : "QUOTATION_APPROVAL_PENDING", category: "approval", severity: "urgent", section: "needs_action", label: overdue ? `Awaiting your approval for ${plural(idle, "day")}` : "Awaiting your approval", facts: { days: idle }, actions: ["review_approval"], snoozable: false }, idle * 100 + valueWeight(r));
      }
      // Accepted, but nothing downstream exists (only judged when the order would be visible).
      if (r.kind === "quotations" && r.status === "Accepted" && records.some((x) => x.kind === "orders") && !(byParent.get(r.id) ?? []).length && idle <= 30)
        push({ ...base, key: `QUOTATION_ACCEPTED_NO_DOWNSTREAM:${r.id}`, type: "QUOTATION_ACCEPTED_NO_DOWNSTREAM_ACTION", category: "quotation", severity: "important", section: "needs_action", label: "Accepted, but no order is recorded", facts: {}, actions: ["open"] }, valueWeight(r));
    }

    /* Orders. */
    if (r.kind === "orders" && !CLOSED_ORDER.includes(r.status)) {
      const shipments = (byParent.get(r.id) ?? []).filter((x) => x.kind === "logistics");
      if (shipments.some((x) => x.status === "Delayed"))
        push({ ...base, key: `ORDER_DELAYED:${r.id}`, type: "ORDER_DELAYED", category: "order", severity: "urgent", section: "needs_action", label: "Its shipment is delayed", facts: {}, actions: ["open"] }, valueWeight(r));
      else if (due && due < today)
        push({ ...base, key: `ORDER_DELAYED:${r.id}`, type: "ORDER_DELAYED", category: "order", severity: "important", section: "needs_action", label: `Required-by date passed ${plural(dayDiff(due, today), "day")} ago`, facts: { days: dayDiff(due, today) }, actions: ["open"] }, dayDiff(due, today) * 100 + valueWeight(r));
      else if (idle >= PROACTIVE_THRESHOLDS.orderStaleDays)
        push({ ...base, key: `ORDER_STATUS_STALE:${r.id}`, type: "ORDER_STATUS_STALE", category: "order", severity: "normal", section: "needs_action", label: `No update for ${plural(idle, "day")}`, facts: { days: idle }, actions: ["open"], dismissible: true }, idle);
    }

    /* Logistics. */
    if (r.kind === "logistics" && !CLOSED_SHIPMENT.includes(r.status)) {
      const overdue = due && due < today ? dayDiff(due, today) : 0;
      if (r.status === "Delayed")
        push({ ...base, key: `SHIPMENT_DELAYED:${r.id}`, type: "SHIPMENT_DELAYED", category: "logistics", severity: "urgent", section: "needs_action", label: "Shipment delayed", facts: {}, actions: ["open"] }, valueWeight(r));
      else if (overdue > 0)
        push({ ...base, key: `DELIVERY_OVERDUE:${r.id}`, type: "DELIVERY_OVERDUE", category: "logistics", severity: overdue > PROACTIVE_THRESHOLDS.deliveryOverdueSevereDays ? "urgent" : "important", section: "needs_action", label: `Expected delivery passed ${plural(overdue, "day")} ago`, facts: { days: overdue }, actions: ["open"] }, overdue * 100);
      else if (r.status === "In Transit" && due && dayDiff(today, due) <= PROACTIVE_THRESHOLDS.etaApproachingDays)
        push({ ...base, key: `ETA_APPROACHING:${r.id}`, type: "ETA_APPROACHING", category: "logistics", severity: "normal", section: "today", label: dayDiff(today, due) === 0 ? "Expected delivery today" : `Expected delivery in ${plural(dayDiff(today, due), "day")}`, facts: { days: dayDiff(today, due) }, actions: ["open"] });
      if (r.status === "Documents Pending" && idle >= PROACTIVE_THRESHOLDS.documentsPendingDays)
        push({ ...base, key: `DOCUMENTS_PENDING:${r.id}`, type: "DOCUMENTS_PENDING", category: "logistics", severity: "important", section: "waiting", label: `Documents pending for ${plural(idle, "day")}`, facts: { days: idle }, actions: ["open"] }, idle * 10);
      else if (r.status !== "Delayed" && !overdue && idle >= PROACTIVE_THRESHOLDS.shipmentNoUpdateDays)
        push({ ...base, key: `SHIPMENT_NO_UPDATE:${r.id}`, type: "SHIPMENT_NO_UPDATE", category: "logistics", severity: "normal", section: "needs_action", label: `No update for ${plural(idle, "day")}`, facts: { days: idle }, actions: ["open"], dismissible: true }, idle);
    }

    /* Accounts (invoices, not cashbook entries). */
    if (r.kind === "accounts" && !isCashEntry(r) && !["Paid", "Cancelled"].includes(r.status)) {
      const owed = outstanding(r);
      const late = due && due < today ? dayDiff(due, today) : 0;
      if (owed > 0 && r.status !== "Draft" && (r.status === "Overdue" || late > 0))
        push({ ...base, key: `PAYMENT_OVERDUE:${r.id}`, type: "PAYMENT_OVERDUE", category: "accounts", severity: "urgent", section: "needs_action", label: late ? `${money(owed, r.currency)} overdue by ${plural(late, "day")}` : `${money(owed, r.currency)} overdue`, facts: { days: late, outstanding: money(owed, r.currency) }, actions: ["open"], snoozable: false }, late * 100 + valueWeight(r));
      else if (r.status === "Draft" && idle >= PROACTIVE_THRESHOLDS.invoiceDraftDays)
        push({ ...base, key: `INVOICE_WAITING:${r.id}`, type: "INVOICE_WAITING", category: "accounts", severity: "important", section: "waiting", label: `Draft invoice not sent for ${plural(idle, "day")}`, facts: { days: idle }, actions: ["open"] }, idle * 10);
    }

    /* Data quality — stage-aware, advisory. */
    const missing = missingFields(r, { hasQuotation: (byParent.get(r.id) ?? []).some((x) => x.kind === "quotations"), canSeeQuotations: readsQuotations });
    if (missing.length && !(r.kind === "leads" && ["Won", "Lost"].includes(r.status))) {
      const serious = r.kind === "leads" && ["Quote Sent", "Negotiation"].includes(r.status);
      push(
        {
          ...base,
          key: `DATA_INCOMPLETE:${r.id}`,
          type: r.kind === "leads" ? "LEAD_INCOMPLETE" : r.kind === "customers" ? "CUSTOMER_INCOMPLETE" : "SUPPLIER_INCOMPLETE",
          category: "data_quality",
          severity: serious ? "important" : "normal",
          section: "data",
          label: `${plural(missing.length, "detail")} missing`,
          facts: { codes: missing.map((m) => (r.kind === "leads" ? `LEAD_NO_${m.toUpperCase()}` : `NO_${m.toUpperCase()}`)).join(",") },
          missing: missing.filter((m) => m !== "quotation"),
          actions: missing.some((m) => m !== "quotation") ? ["complete_details", "open"] : ["open"],
          dismissible: !serious,
        },
        missing.length * 10 + valueWeight(r),
      );
    }
  }

  /* Duplicate candidates (advisory). */
  for (const d of duplicateCandidates(records)) {
    const [a, b] = [d.a, d.b].sort((x, y) => x.id.localeCompare(y.id));
    push({
      key: `DUPLICATE:${a.id}:${b.id}`,
      type: "DUPLICATE_CANDIDATE",
      category: "data_quality",
      severity: "normal",
      section: "data",
      entity: entityOf(a),
      related: [{ type: b.kind, id: b.id, title: b.title }],
      label: `Possible duplicate: ${a.title} / ${b.title}`,
      facts: { evidence: d.evidence.join(", ") },
      actions: ["review_duplicates"],
      dismissible: true,
      snoozable: false,
    });
  }

  /* Meetings the person may reach (not tied to a lead). */
  for (const m of meetings) {
    const at = m.scheduledAt ? new Date(m.scheduledAt) : null;
    const entity = { type: "meeting", id: m.id, title: m.title, status: m.status, company: "", branch: "", ownerId: m.createdBy, owner: null, value: "" };
    if (m.status === "scheduled" && at) {
      const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
      if (minutes >= -5 && minutes <= PROACTIVE_THRESHOLDS.meetingStartingSoonMinutes)
        push({ key: `MEETING_STARTING_SOON:${m.id}`, type: "MEETING_STARTING_SOON", category: "meeting", severity: "important", section: "today", entity, label: minutes <= 0 ? "Starting now" : `Starts in ${plural(minutes, "minute")}`, facts: { minutes }, actions: ["open"], dismissible: false, snoozable: false, meetingId: m.id }, 1000 - minutes);
      else if (!m.relatedRecordId && businessDateOf(m.scheduledAt!) === today && minutes > 0)
        push({ key: `MEETING_TODAY:${m.id}`, type: "MEETING_TODAY", category: "meeting", severity: "normal", section: "today", entity, label: "Meeting today", facts: {}, actions: ["open"], dismissible: false, snoozable: false, meetingId: m.id });
    }
    if (m.status === "ended" && m.endedAt && m.createdBy === input.actor.id && m.hasContent && !m.hasReport && dayDiff(businessDateOf(m.endedAt), today) <= PROACTIVE_THRESHOLDS.meetingReportWindowDays)
      push({ key: `MEETING_REPORT_NOT_GENERATED:${m.id}`, type: "MEETING_REPORT_NOT_GENERATED", category: "meeting", severity: "normal", section: "needs_action", entity, label: "Meeting ended — review outcome (no AI report yet)", facts: {}, actions: ["review_meeting", "generate_meeting_report"], dismissible: true, snoozable: true, meetingId: m.id });
  }

  // One condition = one signal.
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))).sort((a, b) => b.rank - a.rank || a.key.localeCompare(b.key));
}

/** "Mine": records I own, and approvals waiting on me; "team": everything I may read. */
export const isMine = (s: ProactiveSignal, actorId: string) => s.entity.ownerId === actorId || s.category === "approval";

export { SALES_THRESHOLDS };
