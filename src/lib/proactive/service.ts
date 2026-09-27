import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Database } from "../d1";
import { money, outstanding, stages, type Actor, type RecordItem } from "../domain";
import { visibleMeetings } from "../meeting-data";
import { auditEvents, meetingMessages, meetingNotes, meetingReports, proactiveStates } from "../schema";
import { gstToday } from "../ai/context";
import { AiError } from "../ai/gateway";
import { readableRecords } from "../ai/records";
import { isCashEntry } from "../cashbook";
import { proactiveSignals, isMine, type Category, type ProactiveMeeting, type ProactiveSignal } from "./signals";

/**
 * The Action Center — what currently needs action, for THIS person, over
 * what they may read. Deterministic: no AI call to detect, rank, count,
 * resolve or render. Snooze / dismiss are personal UI state (ProactiveState)
 * and never change business data.
 */

export const GROUPS: Record<string, Category[]> = {
  all: ["sales", "quotation", "customer", "meeting", "order", "logistics", "accounts", "data_quality", "approval", "management"],
  sales: ["sales", "quotation", "customer", "meeting", "approval"],
  operations: ["order", "logistics"],
  finance: ["accounts"],
  data: ["data_quality"],
};

/** Roles that see a team scope (everyone else: their own work). */
export const hasTeamScope = (actor: Actor) => ["MD", "MD Assistant", "Group Manager", "Branch Manager", "Sales Manager", "Logistics Manager", "Accounts Manager", "HR Manager"].includes(actor.role);

async function meetingInputs(db: Database, actor: Actor): Promise<ProactiveMeeting[]> {
  const rows = await visibleMeetings(db, actor);
  const ended = rows.filter((m) => m.status === "ended" && m.createdBy === actor.id).map((m) => m.id);
  const [reports, chat, notes] = ended.length
    ? await Promise.all([
        db.select({ id: meetingReports.meetingId }).from(meetingReports).where(inArray(meetingReports.meetingId, ended)).all(),
        db.select({ id: meetingMessages.meetingId }).from(meetingMessages).where(and(inArray(meetingMessages.meetingId, ended), isNull(meetingMessages.deletedAt))).all(),
        db.select({ id: meetingNotes.meetingId }).from(meetingNotes).where(and(inArray(meetingNotes.meetingId, ended), isNull(meetingNotes.deletedAt))).all(),
      ])
    : [[], [], []];
  const reported = new Set(reports.map((r) => r.id));
  const withContent = new Set([...chat, ...notes].map((r) => r.id));
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
    endedAt: m.endedAt ? m.endedAt.toISOString() : null,
    relatedRecordId: m.relatedRecordId ?? null,
    createdBy: m.createdBy,
    hasContent: withContent.has(m.id),
    hasReport: reported.has(m.id),
  }));
}

/** Every signal for the actor in scope, before personal snooze/dismiss. */
export async function signalsFor(db: Database, actor: Actor, scope: "mine" | "team") {
  const [records, meetings] = await Promise.all([readableRecords(db, actor), meetingInputs(db, actor)]);
  const all = proactiveSignals({ actor, records, meetings, today: gstToday() });
  const effective = scope === "team" && hasTeamScope(actor) ? "team" : "mine";
  return { records, signals: effective === "team" ? all : all.filter((s) => isMine(s, actor.id)), scope: effective as "mine" | "team" };
}

export async function actionCenter(db: Database, actor: Actor, options: { scope: "mine" | "team"; group: keyof typeof GROUPS }) {
  const { records, signals, scope } = await signalsFor(db, actor, options.scope);
  const states = await db.select().from(proactiveStates).where(eq(proactiveStates.userId, actor.id)).all();
  const now = Date.now();
  const hidden = new Map(states.map((s) => [s.signalKey, s]));
  let snoozed = 0;
  let dismissed = 0;
  const visible = signals.filter((s) => {
    const st = hidden.get(s.key);
    // Only for the condition as it was: a materially different one shows again.
    if (st && st.fingerprint !== s.fingerprint) return true;
    if (st?.dismissedAt && s.dismissible) return (dismissed++, false);
    if (st?.snoozedUntil && st.snoozedUntil.getTime() > now && s.snoozable) return (snoozed++, false);
    return true;
  });
  const inGroup = visible.filter((s) => GROUPS[options.group].includes(s.category));
  const section = (name: ProactiveSignal["section"], max = 30) => inGroup.filter((s) => s.section === name).slice(0, max);
  const countIn = (group: keyof typeof GROUPS) => visible.filter((s) => GROUPS[group].includes(s.category)).length;
  return {
    today: gstToday(),
    scope,
    group: options.group,
    teamAvailable: hasTeamScope(actor),
    sections: { needs_action: section("needs_action"), today: section("today"), waiting: section("waiting"), data: section("data") },
    counts: { all: countIn("all"), sales: countIn("sales"), operations: countIn("operations"), finance: countIn("finance"), data: countIn("data") },
    hidden: { snoozed, dismissed },
    summary: scope === "team" ? teamSummary(actor, visible, records) : null,
  };
}

/**
 * Exceptions for managers and the MD — operational facts only. Grouped by
 * owner as plain counts; never a score, rank or judgement of people.
 */
function teamSummary(actor: Actor, signals: ProactiveSignal[], records: RecordItem[]) {
  const count = (pred: (s: ProactiveSignal) => boolean) => signals.filter(pred).length;
  const owed = new Map<string, number>();
  for (const r of records.filter((r) => r.kind === "accounts" && !isCashEntry(r) && !r.deletedAt))
    if (signals.some((s) => s.type === "PAYMENT_OVERDUE" && s.entity.id === r.id)) owed.set(r.currency || "USD", (owed.get(r.currency || "USD") ?? 0) + outstanding(r));
  const byOwner = new Map<string, number>();
  for (const s of signals.filter((s) => s.type === "FOLLOW_UP_OVERDUE")) byOwner.set(s.entity.owner || "Unassigned", (byOwner.get(s.entity.owner || "Unassigned") ?? 0) + 1);
  return {
    tiles: [
      { id: "decisions", label: "Decisions required", count: count((s) => s.category === "approval"), group: "sales" },
      { id: "commercial", label: "Commercial risks", count: count((s) => ["sales", "quotation"].includes(s.category) && s.severity !== "normal"), group: "sales" },
      { id: "money", label: "Money requiring attention", count: count((s) => s.category === "accounts"), detail: [...owed.entries()].map(([c, v]) => money(v, c)).join(" + ") || null, group: "finance" },
      { id: "operations", label: "Operations exceptions", count: count((s) => ["order", "logistics"].includes(s.category) && s.severity !== "normal"), group: "operations" },
      { id: "stalled", label: "High-value opportunities without next action", count: count((s) => s.type === "HIGH_VALUE_NO_NEXT_ACTION" || s.type === "NEGOTIATION_STALLED"), group: "sales" },
      { id: "waiting", label: "Quotations waiting for a response", count: count((s) => s.type === "QUOTATION_WAITING_RESPONSE"), group: "sales" },
    ].filter((t) => t.count > 0 || ["decisions", "commercial", "money", "operations"].includes(t.id)),
    overdueFollowUpsByOwner: [...byOwner.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([owner, n]) => ({ owner, count: n })),
    actorRole: actor.role,
  };
}

/* ---------------------------------------------------------- snooze/dismiss */

export async function setSignalState(db: Database, actor: Actor, key: string, action: "snooze" | "dismiss" | "restore", until?: string) {
  // Only a signal this person can currently see, and only if its type allows it.
  const { signals } = await signalsFor(db, actor, "team");
  const s = signals.find((x) => x.key === key);
  if (!s) throw new AiError(404, "That item is no longer active.");
  const now = new Date();
  if (action === "dismiss" && !s.dismissible) throw new AiError(409, "This item can't be dismissed — it clears when the underlying record is updated.");
  let snoozedUntil: Date | null = null;
  if (action === "snooze") {
    if (!s.snoozable) throw new AiError(409, "This item can't be snoozed.");
    const t = until ? Date.parse(until) : NaN;
    const max = now.getTime() + 14 * 86_400_000;
    if (!Number.isFinite(t) || t <= now.getTime() || t > max) throw new AiError(400, "Choose a time within the next 14 days.");
    snoozedUntil = new Date(t);
  }
  const row = { userId: actor.id, signalKey: key, fingerprint: s.fingerprint, snoozedUntil, dismissedAt: action === "dismiss" ? now : null, updatedAt: now };
  if (action === "restore") await db.delete(proactiveStates).where(and(eq(proactiveStates.userId, actor.id), eq(proactiveStates.signalKey, key))).run();
  else await db.insert(proactiveStates).values(row).onConflictDoUpdate({ target: [proactiveStates.userId, proactiveStates.signalKey], set: row }).run();
  return { ok: true };
}

/* ------------------------------------------------------ what changed */

/**
 * What changed in the last `days` — from the audit trail and creation
 * times of records this person may read (never inferred from text).
 */
export async function changesSince(db: Database, actor: Actor, days: 1 | 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const records = await readableRecords(db, actor);
  const readable = new Map(records.map((r) => [r.id, r]));
  const audit = actor.companies.length
    ? (await db.select().from(auditEvents).where(and(inArray(auditEvents.company, actor.companies), gte(auditEvents.at, since))).all()).filter((a) => readable.has(a.recordId) && !a.subject)
    : [];
  const created = records.filter((r) => Date.parse(r.createdAt) >= since.getTime());
  const transitions = audit
    .map((a) => ({ a, m: a.action.match(/^(\w+): (.+) → (.+)$/) }))
    .filter((x) => x.m)
    .map(({ a, m }) => ({ recordId: a.recordId, kind: m![1], from: m![2], to: m![3], at: a.at.toISOString(), actor: a.actor }));
  const count = (pred: (t: (typeof transitions)[number]) => boolean) => transitions.filter(pred).length;
  const createdOf = (kind: string) => created.filter((r) => r.kind === kind && !isCashEntry(r)).length;
  const payments = audit.filter((a) => a.action.startsWith("Recorded payment"));
  const meetings = (await visibleMeetings(db, actor)).filter((m) => m.status === "ended" && m.endedAt && m.endedAt >= since);
  const facts = [
    { id: "new_leads", label: "New leads", count: createdOf("leads") },
    { id: "lead_status", label: "Lead status changes", count: count((t) => t.kind === "leads") },
    { id: "won", label: "Leads won", count: count((t) => t.kind === "leads" && t.to === "Won") },
    { id: "lost", label: "Leads lost", count: count((t) => t.kind === "leads" && t.to === "Lost") },
    { id: "new_quotations", label: "New quotations", count: createdOf("quotations") },
    { id: "approved", label: "Quotations approved", count: count((t) => t.kind === "quotations" && t.to === "Approved") },
    { id: "accepted", label: "Quotations accepted", count: count((t) => t.kind === "quotations" && t.to === "Accepted") },
    { id: "orders", label: "New orders", count: createdOf("orders") },
    { id: "delays", label: "Shipments delayed", count: count((t) => t.kind === "logistics" && t.to === "Delayed") },
    { id: "payments", label: "Payments recorded", count: payments.length },
    { id: "meetings", label: "Meetings ended", count: meetings.length },
  ];
  const notable = transitions
    .filter((t) => ["Won", "Lost", "Accepted", "Approved", "Delayed", "Overdue", "Cancelled"].includes(t.to))
    .slice(-15)
    .reverse()
    .map((t) => {
      const r = readable.get(t.recordId)!;
      return { recordId: r.id, kind: r.kind, title: r.title, change: `${t.from} → ${t.to}`, at: t.at, by: t.actor, value: r.amount ? money(r.amount, r.currency) : "" };
    });
  return { days, since: since.toISOString(), facts, notable, pipelineStages: stages.leads };
}
