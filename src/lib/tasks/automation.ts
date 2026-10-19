import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../d1";
import { canRead, type Actor, type RecordItem } from "../domain";
import { businessToday } from "../gst";
import { plan, type AutomationAction, type AutomationEvent, type Rule, type Trigger } from "../proactive/automation";
import { automationEvents, automationRules, automationRuns, businessRecords, tasks, users, type AutomationRuleRow, type TaskRow } from "../schema";
import type { NotificationDraft } from "../notification-rules";
import {
  LEAD_OPEN_STAGES,
  PRESETS,
  PRESET_INFO,
  addDays,
  assigneeProblem,
  canEditRule,
  canViewRules,
  ruleInput,
  type Preset,
  type RuleConditions,
} from "./model";
import { TaskError, assignmentDraft, auditStatement, person, taskSnapshot } from "./store";

/**
 * Task automation on the existing rule engine (src/lib/proactive/automation):
 * each stored rule becomes a typed Rule whose only action is CREATE_TASK.
 *
 * Reliability, in one place:
 * - Event-driven presets (IT ticket created, quotation accepted) enqueue an
 *   AutomationEvent in the SAME batch as the business change, so the change
 *   and the obligation to act on it commit together. Events are processed
 *   right after the response and again by the five-minute sweep.
 * - Lead follow-ups are found by the sweep from the records themselves.
 * - Every (rule, condition) has one dedupe key. The task, its run row and its
 *   audit entry are one batch guarded by unique indexes, so a repeated run,
 *   a replayed event or two concurrent sweeps can never create two tasks.
 * - A task is internal work: creating one never writes a business record and
 *   never enqueues an event, so automation cannot trigger itself.
 * - "Today" is the Dubai business day.
 */

const PRESET_TRIGGER: Record<Preset, Trigger> = { lead_follow_up: "FOLLOW_UP_DUE", it_ticket_triage: "RECORD_CREATED", quotation_handoff: "STATUS_CHANGED" };
const MAX_ATTEMPTS = 3;

/** A stored rule as the engine's typed Rule. */
export function engineRule(row: AutomationRuleRow): Rule {
  const c = row.conditions ?? {};
  const conditions: Rule["conditions"] = [{ type: "branch_in", branches: c.branches ?? [] }];
  if (row.preset === "lead_follow_up") conditions.unshift({ type: "kind_is", kind: "leads" }, { type: "status_in", statuses: c.statuses?.length ? c.statuses : LEAD_OPEN_STAGES });
  if (row.preset === "it_ticket_triage") conditions.unshift({ type: "kind_is", kind: "it" }, { type: "priority_in", priorities: c.priorities ?? [] });
  if (row.preset === "quotation_handoff") conditions.unshift({ type: "kind_is", kind: "quotations" }, { type: "status_to", status: "Accepted" });
  const action: AutomationAction = {
    type: "CREATE_TASK",
    assignee: row.preset === "lead_follow_up" ? "owner" : { userId: row.assigneeId },
    dueDays: row.dueDays,
    dueTime: row.dueTime,
    priority: row.priority,
  };
  return { id: row.id, trigger: PRESET_TRIGGER[row.preset], conditions, actions: [action], enabled: row.enabled };
}
const eventOf = (trigger: Trigger, r: RecordItem, extra: Partial<AutomationEvent> = {}): AutomationEvent => ({
  trigger, kind: r.kind, recordId: r.id, ownerId: r.ownerId, status: r.status, branch: r.branch, priority: r.attributes?.priority, amount: r.amount, currency: r.currency, ...extra,
});

/* ------------------------------------------------------------ the outbox */

/**
 * Statements to add to a business change's own batch: one outbox event per
 * trigger, only when an enabled rule for it exists in that company.
 */
export async function automationOutbox(db: Database, change: { before?: RecordItem; after: RecordItem; created?: RecordItem[] }): Promise<{ statements: BatchItem<"sqlite">[]; ids: string[] }> {
  const r = change.after;
  let trigger: "RECORD_CREATED" | "STATUS_CHANGED" | null = null;
  let preset: Preset | null = null;
  const data: Record<string, string> = {};
  if (!change.before && r.kind === "it") (trigger = "RECORD_CREATED"), (preset = "it_ticket_triage");
  if (change.before && r.kind === "quotations" && change.before.status !== "Accepted" && r.status === "Accepted") {
    trigger = "STATUS_CHANGED";
    preset = "quotation_handoff";
    data.from = change.before.status;
    data.to = r.status;
    const order = change.created?.find((c) => c.kind === "orders") ?? null;
    data.orderId = order?.id ?? `${r.id}-SO`;
  }
  if (!trigger || !preset) return { statements: [], ids: [] };
  const rule = await db.select({ id: automationRules.id }).from(automationRules).where(and(eq(automationRules.company, r.company), eq(automationRules.preset, preset), eq(automationRules.enabled, true))).get();
  if (!rule) return { statements: [], ids: [] };
  const id = `${trigger}:${r.id}`;
  return {
    ids: [id],
    statements: [db.insert(automationEvents).values({ id, company: r.company, trigger, recordId: r.id, data, attempts: 0, lastError: null, createdAt: new Date(), processedAt: null }).onConflictDoNothing()],
  };
}

type Outcome = { status: "success" | "skipped" | "failed"; message: string; taskId?: string; draft?: NotificationDraft };
const loadRecord = async (db: Database, id: string) => (await db.select({ payload: businessRecords.payload }).from(businessRecords).where(eq(businessRecords.id, id)).get())?.payload as RecordItem | undefined;

/**
 * Carries out one rule for one condition. Writes exactly one run row per
 * dedupe key; returns null when that key was already handled.
 */
async function execute(db: Database, rule: AutomationRuleRow, key: string, source: RecordItem, target: RecordItem | undefined, trigger: Trigger, now: Date): Promise<Outcome | null> {
  const dedupeKey = `${rule.id}:${key}`;
  const seen = await db.select({ id: automationRuns.id }).from(automationRuns).where(and(eq(automationRuns.ruleId, rule.id), eq(automationRuns.dedupeKey, key))).get();
  if (seen) return null;
  const record = (target: RecordItem | undefined) => (target ? target.id : null);
  const skip = async (message: string, status: "skipped" | "failed" = "skipped"): Promise<Outcome | null> => {
    const inserted = await db
      .insert(automationRuns)
      .values({ id: crypto.randomUUID(), ruleId: rule.id, company: rule.company, dedupeKey: key, trigger, recordId: record(target ?? source), taskId: null, status, message, attempts: 1, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id })
      .all();
    return inserted.length ? { status, message } : null;
  };
  if (!target || target.deletedAt) return skip(rule.preset === "quotation_handoff" ? "The accepted quotation's sales order was not found, so no handoff task was created." : "The record is no longer available.");
  const action = engineRule(rule).actions[0] as Extract<AutomationAction, { type: "CREATE_TASK" }>;
  const assigneeId = action.assignee === "owner" ? source.ownerId : action.assignee.userId;
  if (!assigneeId) return skip("No assignee is configured for this rule.");
  const assignee = await person(db, assigneeId);
  if (!assignee) return skip("The configured assignee no longer exists.");
  const problem = assigneeProblem(assignee, { company: target.company, branch: target.branch }, target);
  if (problem) return skip(`${problem} No task was created.`);
  if (rule.preset === "lead_follow_up") {
    const open = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.ruleId, rule.id), eq(tasks.linkedRecordId, target.id), inArray(tasks.status, ["open", "in_progress"]))).get();
    if (open) return skip("An earlier follow-up task for this lead is still open.");
  }
  const what = [target.product, target.quantity ? `${target.quantity} ${target.unit}`.trim() : "", target.destination].filter((s) => s && String(s).trim()).join(" · ");
  const title =
    rule.preset === "lead_follow_up" ? `Follow up: ${target.title}` : rule.preset === "it_ticket_triage" ? `Triage ticket: ${target.title}` : `Operations handoff: ${target.title}`;
  const description =
    rule.preset === "lead_follow_up"
      ? `The follow-up date for this lead (${source.due}) has arrived.${what ? `\n${what}` : ""}`
      : rule.preset === "it_ticket_triage"
        ? `New ${source.attributes?.priority || "Normal"} priority ticket${source.attributes?.category ? ` · ${source.attributes.category}` : ""}. Review it and set the next step.`
        : `Quotation ${source.id} was accepted and this sales order was created. Plan delivery and documents.${what ? `\n${what}` : ""}`;
  const task: TaskRow = {
    id: `TSK-${crypto.randomUUID()}`,
    company: target.company,
    branch: target.branch,
    title: title.slice(0, 160),
    description,
    assigneeId,
    createdBy: rule.updatedBy,
    priority: rule.priority,
    status: "open",
    dueDate: addDays(businessToday(now), action.dueDays),
    dueTime: action.dueTime,
    linkedRecordId: target.id,
    ruleId: rule.id,
    dedupeKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  const message = `Created a task for ${assignee.name}, due ${task.dueDate}${task.dueTime ? ` at ${task.dueTime}` : ""}.`;
  try {
    await db.batch([
      db.insert(tasks).values(task),
      db.insert(automationRuns).values({ id: crypto.randomUUID(), ruleId: rule.id, company: rule.company, dedupeKey: key, trigger, recordId: target.id, taskId: task.id, status: "success", message, attempts: 1, createdAt: now, updatedAt: now }),
      auditStatement(db, { company: task.company, actor: `Automation · ${rule.name}`, actorId: rule.updatedBy, action: "Created task by automation", taskId: task.id, after: taskSnapshot(task), at: now }),
    ]);
  } catch (error) {
    // Another sweep finished the same key first: nothing more to do.
    if (/UNIQUE/i.test(String(error))) return null;
    throw error;
  }
  return { status: "success", message, taskId: task.id, draft: assignmentDraft(task, { id: null, name: `Automation · ${rule.name}` }) };
}

/** Processes pending outbox events (all, or the given ids). Returns notification drafts. */
export async function processEvents(db: Database, options: { ids?: string[]; limit?: number } = {}, now = new Date()) {
  const pending = await db
    .select()
    .from(automationEvents)
    .where(and(isNull(automationEvents.processedAt), options.ids?.length ? inArray(automationEvents.id, options.ids) : undefined, lt(automationEvents.attempts, MAX_ATTEMPTS)))
    .orderBy(automationEvents.createdAt)
    .limit(options.limit ?? 50)
    .all();
  const drafts: NotificationDraft[] = [];
  const outcomes: Outcome[] = [];
  for (const event of pending) {
    // Claim the attempt first, so two sweeps do not both work on one event.
    const claimed = await db
      .update(automationEvents)
      .set({ attempts: sql`${automationEvents.attempts} + 1` })
      .where(and(eq(automationEvents.id, event.id), eq(automationEvents.attempts, event.attempts), isNull(automationEvents.processedAt)))
      .returning({ id: automationEvents.id })
      .all();
    if (!claimed.length) continue;
    try {
      const source = await loadRecord(db, event.recordId);
      const preset: Preset = event.trigger === "RECORD_CREATED" ? "it_ticket_triage" : "quotation_handoff";
      const rows = await db.select().from(automationRules).where(and(eq(automationRules.company, event.company), eq(automationRules.preset, preset), eq(automationRules.enabled, true))).all();
      if (source) {
        const facts = eventOf(event.trigger, source, { from: event.data?.from, to: event.data?.to });
        const planned = new Set(plan(rows.map(engineRule), facts).map((p) => p.rule));
        for (const rule of rows.filter((r) => planned.has(r.id))) {
          const target = rule.preset === "quotation_handoff" ? await loadRecord(db, event.data?.orderId ?? `${source.id}-SO`) : source;
          const outcome = await execute(db, rule, `${event.trigger}:${source.id}`, source, target, event.trigger, now);
          if (outcome) outcomes.push(outcome);
          if (outcome?.draft) drafts.push(outcome.draft);
        }
      }
      await db.update(automationEvents).set({ processedAt: now, lastError: null }).where(eq(automationEvents.id, event.id)).run();
    } catch (error) {
      const last = event.attempts + 1 >= MAX_ATTEMPTS;
      await db.update(automationEvents).set({ lastError: String(error instanceof Error ? error.message : error).slice(0, 300), ...(last ? { processedAt: now } : {}) }).where(eq(automationEvents.id, event.id)).run();
      if (last) await recordFailure(db, event, now);
    }
  }
  return { drafts, outcomes };
}

/** After the final failed attempt, say so in each enabled rule's history. */
async function recordFailure(db: Database, event: typeof automationEvents.$inferSelect, now: Date) {
  const preset: Preset = event.trigger === "RECORD_CREATED" ? "it_ticket_triage" : "quotation_handoff";
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.company, event.company), eq(automationRules.preset, preset), eq(automationRules.enabled, true))).all();
  for (const rule of rules)
    await db
      .insert(automationRuns)
      .values({ id: crypto.randomUUID(), ruleId: rule.id, company: rule.company, dedupeKey: `${event.trigger}:${event.recordId}`, trigger: event.trigger, recordId: event.recordId, taskId: null, status: "failed", message: `The task could not be created after ${MAX_ATTEMPTS} attempts. Create it by hand, or contact IT if this continues.`, attempts: MAX_ATTEMPTS, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
}

/* -------------------------------------------------------- lead follow-ups */

async function leadCandidates(db: Database, rule: AutomationRuleRow, today: string) {
  const lookback = Math.min(Math.max(rule.conditions?.lookbackDays ?? 0, 0), 7);
  const earliest = addDays(today, -lookback);
  const rows = await db
    .select({ payload: businessRecords.payload })
    .from(businessRecords)
    .where(and(eq(businessRecords.company, rule.company), eq(businessRecords.kind, "leads"), inArray(businessRecords.status, LEAD_OPEN_STAGES)))
    .all();
  const engine = engineRule({ ...rule, enabled: true });
  return rows
    .map((r) => r.payload as RecordItem)
    .filter((r) => !r.deletedAt && r.due && r.due.slice(0, 10) <= today && r.due.slice(0, 10) >= earliest)
    .filter((r) => plan([engine], eventOf("FOLLOW_UP_DUE", r)).length > 0)
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}
const leadKey = (r: RecordItem) => `FOLLOW_UP_DUE:${r.id}:${r.due.slice(0, 10)}`;

export async function runLeadFollowUps(db: Database, now = new Date()) {
  const today = businessToday(now);
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.preset, "lead_follow_up"), eq(automationRules.enabled, true))).all();
  const drafts: NotificationDraft[] = [];
  const outcomes: Outcome[] = [];
  for (const rule of rules)
    for (const lead of (await leadCandidates(db, rule, today)).slice(0, 200)) {
      const outcome = await execute(db, rule, leadKey(lead), lead, lead, "FOLLOW_UP_DUE", now);
      if (outcome) outcomes.push(outcome);
      if (outcome?.draft) drafts.push(outcome.draft);
    }
  return { drafts, outcomes };
}

/** The scheduled part: lead follow-ups, then any events left in the outbox. */
export async function automationSweep(db: Database, now = new Date()) {
  const leads = await runLeadFollowUps(db, now);
  const events = await processEvents(db, { limit: 100 }, now);
  return { drafts: [...leads.drafts, ...events.drafts], outcomes: [...leads.outcomes, ...events.outcomes] };
}

/* -------------------------------------------------------------- settings */

export type RuleView = {
  preset: Preset;
  label: string;
  trigger: string;
  detail: string;
  company: string;
  canEdit: boolean;
  rule: null | {
    id: string; name: string; enabled: boolean; conditions: RuleConditions; assignee: { id: string; name: string; active: boolean } | null;
    dueDays: number; dueTime: string | null; priority: string; version: number; updatedAt: string; updatedBy: string;
  };
  lastRuns: { success: number; skipped: number; failed: number };
};

export async function listRules(db: Database, actor: Actor) {
  const companies = actor.companies.filter((c) => canViewRules(actor, c));
  if (!companies.length) return { companies: [], rules: [] as RuleView[] };
  const rows = await db.select().from(automationRules).where(inArray(automationRules.company, companies)).all();
  const people = new Map((await db.select({ id: users.id, name: users.name, active: users.active }).from(users).all()).map((u) => [u.id, u]));
  const counts = rows.length
    ? await db.select({ ruleId: automationRuns.ruleId, status: automationRuns.status, n: sql<number>`count(*)` }).from(automationRuns).where(inArray(automationRuns.ruleId, rows.map((r) => r.id))).groupBy(automationRuns.ruleId, automationRuns.status).all()
    : [];
  const rules: RuleView[] = companies.flatMap((company) =>
    PRESETS.map((preset) => {
      const row = rows.find((r) => r.company === company && r.preset === preset);
      const info = PRESET_INFO[preset];
      const of = (status: string) => Number(counts.find((c) => c.ruleId === row?.id && c.status === status)?.n ?? 0);
      const assignee = row?.assigneeId ? people.get(row.assigneeId) : undefined;
      return {
        preset, label: info.label, trigger: info.trigger, detail: info.detail, company,
        canEdit: canEditRule(actor, company, preset),
        rule: row
          ? {
              id: row.id, name: row.name, enabled: row.enabled, conditions: row.conditions ?? {}, dueDays: row.dueDays, dueTime: row.dueTime, priority: row.priority, version: row.version,
              updatedAt: row.updatedAt.toISOString(), updatedBy: people.get(row.updatedBy)?.name ?? "Former colleague",
              assignee: assignee ? { id: assignee.id, name: assignee.name, active: assignee.active } : null,
            }
          : null,
        lastRuns: { success: of("success"), skipped: of("skipped"), failed: of("failed") },
      };
    }),
  );
  return { companies, rules };
}

/** Validates the assignee a rule names: active, in the company, able to open that kind of record. */
async function ruleAssigneeProblem(db: Database, company: string, preset: Preset, assigneeId: string | null, branches: string[] = []) {
  if (preset === "lead_follow_up") return assigneeId ? "Lead follow-ups always go to the lead's owner." : "";
  if (!assigneeId) return "Choose who receives these tasks.";
  const p = await person(db, assigneeId);
  if (!p) return "Choose who receives these tasks.";
  if (!p.active) return `${p.name} is inactive.`;
  if (!p.companies.includes(company)) return `${p.name} does not work in ${company}.`;
  const kind = PRESET_INFO[preset].kind;
  // A record of that kind, in a branch they work in, owned by someone else.
  const sample = { kind, company, branch: p.branches[0] ?? "Main", ownerId: "__someone_else__", status: "Open", deletedAt: undefined } as unknown as RecordItem;
  if (!canRead(p, sample)) return `${p.name} cannot open ${kind === "it" ? "IT tickets" : "sales orders"} owned by others, so they could not work on these tasks.`;
  if (p.branches.length && (!branches.length || branches.some((b) => !p.branches.includes(b))))
    return `${p.name} works in ${p.branches.join(", ")} only. Choose someone who covers the whole company, or limit the rule to their branch.`;
  return "";
}

/** People a rule may name: active, in the company, able to open that kind of record. */
export async function ruleCandidates(db: Database, actor: Actor, company: string, preset: Preset) {
  if (!canEditRule(actor, company, preset) || preset === "lead_follow_up") return [];
  const people = await db.select({ id: users.id, name: users.name, role: users.role, branches: users.branches }).from(users).where(eq(users.active, true)).all();
  const out = [];
  for (const p of people) if (!(await ruleAssigneeProblem(db, company, preset, p.id, p.branches))) out.push({ id: p.id, name: p.name, role: p.role, branches: p.branches });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveRule(db: Database, actor: Actor, raw: unknown, now = new Date()) {
  const input = ruleInput.parse(raw);
  if (!canEditRule(actor, input.company, input.preset)) throw new TaskError(403, "You can't change this automation.");
  const conditions: RuleConditions = {};
  if (input.preset === "lead_follow_up") {
    conditions.statuses = (input.conditions.statuses ?? []).filter((s) => LEAD_OPEN_STAGES.includes(s));
    conditions.lookbackDays = input.conditions.lookbackDays ?? 0;
  }
  if (input.preset === "it_ticket_triage") conditions.priorities = (input.conditions.priorities ?? []).filter((p) => ["Low", "Normal", "High", "Urgent"].includes(p));
  conditions.branches = (input.conditions.branches ?? []).map((b) => b.trim()).filter(Boolean);
  const assigneeId = input.preset === "lead_follow_up" ? null : input.assigneeId;
  // A rule may be saved disabled while incomplete; it is enabled only when valid.
  const problem = await ruleAssigneeProblem(db, input.company, input.preset, assigneeId, conditions.branches);
  if (problem && (input.enabled || assigneeId)) throw new TaskError(400, problem);
  const existing = await db.select().from(automationRules).where(and(eq(automationRules.company, input.company), eq(automationRules.preset, input.preset))).get();
  const values = { name: input.name, enabled: input.enabled, conditions, assigneeId, dueDays: input.dueDays, dueTime: input.dueTime, priority: input.priority, updatedBy: actor.id, updatedAt: now };
  const audit = (action: string, id: string, before: unknown, after: unknown) =>
    auditStatement(db, { company: input.company, actor: actor.name, actorId: actor.id, action, taskId: id, before: before as never, after: after as never, at: now });
  if (!existing) {
    if (input.expectedVersion) throw new TaskError(409, "This automation was removed. Refresh and try again.");
    const id = `RULE-${input.company}-${input.preset}`.replace(/[^A-Za-z0-9_-]/g, "-");
    try {
      await db.batch([
        db.insert(automationRules).values({ id, company: input.company, preset: input.preset, createdBy: actor.id, createdAt: now, version: 1, ...values }),
        audit(input.enabled ? "Created and enabled automation" : "Created automation", id, null, values),
      ]);
    } catch (error) {
      if (/UNIQUE/i.test(String(error))) throw new TaskError(409, "Someone else set up this automation. Refresh and try again.");
      throw error;
    }
    return { id, version: 1 };
  }
  if (input.expectedVersion !== existing.version) throw new TaskError(409, "Someone else changed this automation. Review the latest version and try again.");
  try {
    await db.batch([
      db
        .update(automationRules)
        .set({ ...values, version: sql`CASE WHEN ${automationRules.version} = ${existing.version} THEN ${automationRules.version} + 1 ELSE NULL END` })
        .where(eq(automationRules.id, existing.id)),
      audit(existing.enabled !== input.enabled ? (input.enabled ? "Enabled automation" : "Disabled automation") : "Edited automation", existing.id, existing, values),
    ]);
  } catch (error) {
    if (/NOT NULL constraint failed: AutomationRule\.version/.test(String(error))) throw new TaskError(409, "Someone else changed this automation. Review the latest version and try again.");
    throw error;
  }
  return { id: existing.id, version: existing.version + 1 };
}

const ruleFor = async (db: Database, actor: Actor, id: string) => {
  const row = id.length <= 120 ? await db.select().from(automationRules).where(eq(automationRules.id, id)).get() : undefined;
  if (!row || !canViewRules(actor, row.company)) throw new TaskError(404, "This automation isn't available to you.");
  return row;
};

/** Run history, newest first. A record title is shown only to someone who may open it. */
export async function ruleHistory(db: Database, actor: Actor, id: string, limit = 50) {
  const rule = await ruleFor(db, actor, id);
  const runs = await db.select().from(automationRuns).where(eq(automationRuns.ruleId, rule.id)).orderBy(desc(automationRuns.createdAt)).limit(Math.min(limit, 100)).all();
  const records = new Map<string, RecordItem>();
  const ids = [...new Set(runs.map((r) => r.recordId).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 90)
    for (const r of await db.select({ id: businessRecords.id, payload: businessRecords.payload }).from(businessRecords).where(inArray(businessRecords.id, ids.slice(i, i + 90))).all()) records.set(r.id, r.payload as RecordItem);
  return runs.map((r) => {
    const record = r.recordId ? records.get(r.recordId) : undefined;
    return {
      id: r.id, at: r.createdAt.toISOString(), status: r.status, message: r.message, attempts: r.attempts, taskId: r.taskId,
      record: record && !record.deletedAt && canRead(actor, record) ? { id: record.id, kind: record.kind, title: record.title } : r.recordId ? { restricted: true as const } : null,
    };
  });
}

/**
 * Read-only preview: what the rule would do now. Nothing is written. Lead
 * follow-ups list today's candidates; event presets show recent examples.
 */
export async function previewRule(db: Database, actor: Actor, id: string, now = new Date()) {
  const rule = await ruleFor(db, actor, id);
  const today = businessToday(now);
  const configured = await ruleAssigneeProblem(db, rule.company, rule.preset, rule.assigneeId, rule.conditions?.branches ?? []);
  let candidates: RecordItem[] = [];
  if (rule.preset === "lead_follow_up") candidates = await leadCandidates(db, rule, today);
  else {
    const kind = rule.preset === "it_ticket_triage" ? "it" : "orders";
    const rows = await db
      .select({ payload: businessRecords.payload })
      .from(businessRecords)
      .where(and(eq(businessRecords.company, rule.company), eq(businessRecords.kind, kind)))
      .orderBy(desc(businessRecords.createdAt))
      .limit(20)
      .all();
    const engine = engineRule({ ...rule, enabled: true });
    candidates = rows
      .map((r) => r.payload as RecordItem)
      .filter((r) => !r.deletedAt)
      .filter((r) => (rule.preset === "it_ticket_triage" ? plan([engine], eventOf("RECORD_CREATED", r)).length > 0 : (rule.conditions?.branches ?? []).length === 0 || rule.conditions!.branches!.includes(r.branch)))
      .slice(0, 5);
  }
  const items = [];
  let hidden = 0;
  for (const r of candidates.slice(0, 25)) {
    if (!canRead(actor, r)) {
      hidden++;
      continue;
    }
    const assigneeId = rule.preset === "lead_follow_up" ? r.ownerId : rule.assigneeId;
    const p = assigneeId ? await person(db, assigneeId) : undefined;
    const problem = !assigneeId ? "No assignee is configured." : assigneeProblem(p, { company: r.company, branch: r.branch }, r);
    const key = rule.preset === "lead_follow_up" ? leadKey(r) : null;
    const done = key ? await db.select({ status: automationRuns.status }).from(automationRuns).where(and(eq(automationRuns.ruleId, rule.id), eq(automationRuns.dedupeKey, key))).get() : undefined;
    items.push({
      record: { id: r.id, kind: r.kind, title: r.title, due: r.due },
      assignee: p ? p.name : null,
      outcome: done ? "already" : problem ? "skip" : "create",
      message: done ? `Already handled (${done.status}).` : problem || `Would create a task for ${p!.name}, due ${addDays(today, rule.dueDays)}${rule.dueTime ? ` at ${rule.dueTime}` : ""}.`,
    });
  }
  return {
    enabled: rule.enabled,
    configurationProblem: configured,
    mode: rule.preset === "lead_follow_up" ? ("today" as const) : ("examples" as const),
    due: addDays(today, rule.dueDays),
    items,
    hidden,
    total: candidates.length,
  };
}
