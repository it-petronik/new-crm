import { z } from "zod";
import { allowedModules, canRead, type Actor, type Kind, type Module, type RecordItem } from "../domain";
import { hasTeamScope } from "../proactive/team";
import { businessToday } from "../gst";

/**
 * Tasks: internal work for one person, optionally linked to one CRM record.
 *
 * Pure rules only (no database), so who may see, change and receive a task
 * can be read and tested in one place. A task never grants access to
 * anything: its linked record stays behind the record's own read rule, and
 * an assignee must already be able to open that record.
 */

export const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Labels match the shared status map, so each state has its own tone. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const isClosed = (s: TaskStatus) => s === "completed" || s === "cancelled";

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const PRIORITY_LABELS: Record<TaskPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** HR and leave records are personal; a task never points at them. */
export const LINKABLE_KINDS: Kind[] = ["leads", "quotations", "orders", "logistics", "accounts", "customers", "suppliers", "products", "marketing", "it"];

export const VIEWS = ["today", "overdue", "upcoming", "completed"] as const;
export type TaskViewName = (typeof VIEWS)[number];

/* ------------------------------------------------------------- automation */

export const PRESETS = ["lead_follow_up", "it_ticket_triage", "quotation_handoff"] as const;
export type Preset = (typeof PRESETS)[number];
export type RuleConditions = {
  /** Lead stages that count (lead follow-up). Empty = every open stage. */
  statuses?: string[];
  /** Ticket priorities that count (IT triage). Empty = every priority. */
  priorities?: string[];
  /** Branches that count. Empty = the whole company. */
  branches?: string[];
  /** Lead follow-up: also pick up follow-ups this many days overdue (0–7). */
  lookbackDays?: number;
};

/** People who see their team's tasks (same roles as the Action Center's team scope). */
export const isTaskManager = (actor: Actor) => hasTeamScope(actor);
export const teamTasksAllowed = hasTeamScope;

type Scoped = { company: string; branch: string };
export const inScope = (actor: Actor, t: Scoped) =>
  actor.companies.includes(t.company) && (!actor.branches.length || actor.branches.includes(t.branch));

type TaskFacts = Scoped & { assigneeId: string; createdBy: string; status: TaskStatus };

/** Assignee and creator see their own tasks; team roles see tasks in their scope. */
export function canSeeTask(actor: Actor, t: TaskFacts) {
  if (!actor.companies.includes(t.company)) return false;
  if (t.assigneeId === actor.id || t.createdBy === actor.id) return true;
  return hasTeamScope(actor) && inScope(actor, t);
}
const manages = (actor: Actor, t: Scoped) => isTaskManager(actor) && inScope(actor, t);
/** Edit details, start, complete or reopen. */
export const canWorkOnTask = (actor: Actor, t: TaskFacts) =>
  canSeeTask(actor, t) && (t.assigneeId === actor.id || t.createdBy === actor.id || manages(actor, t));
/** Hand the task to someone else, or cancel it. */
export const canManageTask = (actor: Actor, t: TaskFacts) =>
  canSeeTask(actor, t) && (t.createdBy === actor.id || manages(actor, t));
/** Only a team role assigns work to other people; everyone may plan their own. */
export const mayAssignOthers = (actor: Actor, scope: Scoped) => manages(actor, scope);

export type Candidate = Actor & { active: boolean };
/**
 * Who may receive a task: an active person in the task's company and branch
 * who could already open the linked record. Each check is independent of the
 * others, and none of them is satisfied by the task itself.
 */
export function assigneeProblem(person: Candidate | undefined, scope: Scoped, linked?: RecordItem | null): string {
  if (!person) return "Choose a person for this task.";
  if (!person.active) return `${person.name} is inactive.`;
  if (!inScope(person, scope)) return `${person.name} does not work in this company or branch.`;
  if (linked && !canRead(person, linked)) return `${person.name} cannot open the linked record.`;
  return "";
}

/** Status changes a person may make. Closed tasks are reopened before editing. */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["open", "completed", "cancelled"],
  completed: ["open"],
  cancelled: ["open"],
};

/* ------------------------------------------------------------------ time */

const DAY = 86_400_000;
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** `HH:MM` now, in Dubai. */
export function businessClock(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
/** Which My Day view a task belongs to, on the Dubai calendar. */
export function bucketOf(t: { status: TaskStatus; dueDate: string }, today = businessToday()): TaskViewName {
  if (isClosed(t.status)) return "completed";
  if (t.dueDate < today) return "overdue";
  return t.dueDate === today ? "today" : "upcoming";
}
/** Due today at a time that has already passed in Dubai. */
export const pastDueTime = (t: { status: TaskStatus; dueDate: string; dueTime: string | null }, at = new Date()) =>
  !isClosed(t.status) && t.dueDate === businessToday(at) && !!t.dueTime && t.dueTime < businessClock(at);

/* ------------------------------------------------------------ validation */

const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");
const id = z.string().min(1).max(100);
export const taskFields = z.object({
  title: z.string().trim().min(2, "Title needs at least 2 characters.").max(160, "Title is too long."),
  description: z.string().trim().max(4000, "Description is too long.").default(""),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  dueDate: date,
  dueTime: time.nullable().default(null),
  assigneeId: id,
  linkedRecordId: id.nullable().default(null),
});
export const createTaskInput = taskFields.extend({
  company: z.string().min(1).max(80),
  branch: z.string().max(80).default(""),
  requestId: z.string().min(8).max(100),
});
export const taskCommand = z.discriminatedUnion("action", [
  // An omitted link keeps the current one (a link the editor cannot open stays as it is).
  z.object({ action: z.literal("edit"), id, expectedVersion: z.number().int().positive(), values: taskFields.omit({ assigneeId: true, linkedRecordId: true }).extend({ linkedRecordId: id.nullable().optional() }) }),
  z.object({ action: z.literal("assign"), id, expectedVersion: z.number().int().positive(), assigneeId: id }),
  z.object({ action: z.literal("status"), id, expectedVersion: z.number().int().positive(), status: z.enum(TASK_STATUSES) }),
]);

export const ruleInput = z.object({
  company: z.string().min(1).max(80),
  preset: z.enum(PRESETS),
  name: z.string().trim().min(2, "Name needs at least 2 characters.").max(120),
  enabled: z.boolean(),
  assigneeId: id.nullable(),
  dueDays: z.number().int().min(0).max(30),
  dueTime: time.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  conditions: z
    .object({
      statuses: z.array(z.string().max(40)).max(10).optional(),
      priorities: z.array(z.string().max(20)).max(6).optional(),
      branches: z.array(z.string().max(80)).max(20).optional(),
      lookbackDays: z.number().int().min(0).max(7).optional(),
    })
    .strict(),
  expectedVersion: z.number().int().positive().optional(),
});

/* ------------------------------------------------------------- automation */

export const LEAD_OPEN_STAGES = ["New", "Contacted", "Qualified", "Quote Sent", "Negotiation"];
export const TICKET_PRIORITIES = ["Low", "Normal", "High", "Urgent"];

export const PRESET_INFO: Record<Preset, { label: string; trigger: string; detail: string; kind: Kind; ownerAssigned: boolean; editModule: Module }> = {
  lead_follow_up: {
    label: "Lead follow-up due",
    trigger: "When an open lead's follow-up date arrives",
    detail: "Creates one follow-up task for the lead's owner, linked to the lead.",
    kind: "leads",
    ownerAssigned: true,
    editModule: "leads",
  },
  it_ticket_triage: {
    label: "IT ticket triage",
    trigger: "When an IT ticket is created",
    detail: "Creates one triage task for the person you choose, linked to the ticket.",
    kind: "it",
    ownerAssigned: false,
    editModule: "it",
  },
  quotation_handoff: {
    label: "Operations handoff",
    trigger: "When a quotation is accepted and its order is created",
    detail: "Creates one handoff task for the person you choose, linked to the new sales order. The order, shipment and invoice are created by the quotation workflow, never by this rule.",
    kind: "orders",
    ownerAssigned: false,
    editModule: "orders",
  },
};

/**
 * Who may change a company's rules: the MD and group managers for every
 * preset; a department manager for their own department's preset. A
 * branch-limited person cannot change a company-wide rule.
 */
export function canEditRule(actor: Actor, company: string, preset: Preset) {
  if (!actor.companies.includes(company) || actor.branches.length) return false;
  const module = PRESET_INFO[preset].editModule;
  if (actor.moduleAccess?.[module] === "read" || !allowedModules(actor).includes(module)) return false;
  if (["MD", "MD Assistant", "IT Administrator", "Group Manager"].includes(actor.role)) return true;
  return (
    (preset === "lead_follow_up" && actor.role === "Sales Manager") ||
    (preset === "it_ticket_triage" && actor.role === "IT Administrator") ||
    (preset === "quotation_handoff" && actor.role === "Logistics Manager")
  );
}
/** Who may see rules and their history (read-only unless canEditRule). */
export const canViewRules = (actor: Actor, company: string) =>
  actor.companies.includes(company) && (PRESETS.some((p) => canEditRule(actor, company, p)) || ["MD Assistant", "Branch Manager"].includes(actor.role) && hasTeamScope(actor));
