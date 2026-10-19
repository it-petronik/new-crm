import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../d1";
import { canRead, type Actor, type RecordItem } from "../domain";
import { businessToday } from "../gst";
import { auditEvents, automationRules, businessRecords, tasks, users, type TaskRow } from "../schema";
import type { NotificationDraft } from "../notification-rules";
import {
  LINKABLE_KINDS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TRANSITIONS,
  VIEWS,
  assigneeProblem,
  bucketOf,
  canManageTask,
  canSeeTask,
  canWorkOnTask,
  createTaskInput,
  isClosed,
  isTaskManager,
  mayAssignOthers,
  pastDueTime,
  taskCommand,
  teamTasksAllowed,
  type Candidate,
  type TaskPriority,
  type TaskStatus,
  type TaskViewName,
} from "./model";
import type { z } from "zod";

/**
 * Task persistence. Every operation re-reads what it needs and checks the
 * rules in ./model on the server; writes are one D1 batch (task + audit),
 * and updates carry the version the person saw, so a concurrent edit is
 * refused instead of overwritten.
 */

export class TaskError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const notFound = () => new TaskError(404, "This task isn't available to you.");

export type TaskLink = { id: string; kind: string; title: string; status: string } | { restricted: true } | null;
export type TaskView = {
  id: string;
  company: string;
  branch: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  dueTime: string | null;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string };
  link: TaskLink;
  automation: { ruleId: string; name: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  bucket: TaskViewName;
  pastDueTime: boolean;
  can: { work: boolean; manage: boolean };
};
export type TaskHistoryItem = { id: string; at: string; actor: string; action: string; changes: string[] };

const toCandidate = (row: typeof users.$inferSelect): Candidate => ({
  id: row.id,
  name: row.name,
  role: row.role as Actor["role"],
  companies: row.companies,
  branches: row.branches,
  moduleAccess: (row.moduleAccess || undefined) as Actor["moduleAccess"],
  active: row.active,
});
export async function person(db: Database, id: string) {
  const row = await db.select().from(users).where(eq(users.id, id)).get();
  return row ? toCandidate(row) : undefined;
}
async function names(db: Database, ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  const map = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 90)
    for (const r of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique.slice(i, i + 90))).all()) map.set(r.id, r.name);
  return map;
}
async function recordsById(db: Database, ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  const map = new Map<string, RecordItem>();
  for (let i = 0; i < unique.length; i += 90)
    for (const r of await db.select({ id: businessRecords.id, payload: businessRecords.payload }).from(businessRecords).where(inArray(businessRecords.id, unique.slice(i, i + 90))).all())
      map.set(r.id, r.payload as RecordItem);
  return map;
}

/** Shapes rows for one reader: a linked record they may not open shows as restricted. */
export async function present(db: Database, actor: Actor, rows: TaskRow[], now = new Date()): Promise<TaskView[]> {
  const [people, records, rules] = await Promise.all([
    names(db, rows.flatMap((r) => [r.assigneeId, r.createdBy])),
    recordsById(db, rows.map((r) => r.linkedRecordId ?? "")),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.ruleId).filter((x): x is string => !!x))];
      return new Map(ids.length ? (await db.select({ id: automationRules.id, name: automationRules.name }).from(automationRules).where(inArray(automationRules.id, ids)).all()).map((r) => [r.id, r.name]) : []);
    })(),
  ]);
  const today = businessToday(now);
  return rows.map((r) => {
    const record = r.linkedRecordId ? records.get(r.linkedRecordId) : undefined;
    const link: TaskLink = !r.linkedRecordId
      ? null
      : record && !record.deletedAt && canRead(actor, record)
        ? { id: record.id, kind: record.kind, title: record.title, status: record.status }
        : { restricted: true };
    return {
      id: r.id,
      company: r.company,
      branch: r.branch,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      dueDate: r.dueDate,
      dueTime: r.dueTime,
      assignee: { id: r.assigneeId, name: people.get(r.assigneeId) ?? "Former colleague" },
      createdBy: { id: r.createdBy, name: people.get(r.createdBy) ?? "Former colleague" },
      link,
      automation: r.ruleId ? { ruleId: r.ruleId, name: rules.get(r.ruleId) ?? "Automation" } : null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      bucket: bucketOf(r, today),
      pastDueTime: pastDueTime(r, now),
      can: { work: canWorkOnTask(actor, r), manage: canManageTask(actor, r) },
    };
  });
}

/* ------------------------------------------------------------------ list */

export type TaskQuery = {
  view: TaskViewName;
  scope: "mine" | "team";
  q?: string;
  priority?: TaskPriority[];
  status?: TaskStatus[];
  assigneeId?: string;
  source?: "manual" | "automation";
  /** The company chosen in the header narrows the list; it never widens it. */
  company?: string;
  sort?: "due" | "priority" | "updated" | "title";
  page?: number;
  pageSize?: number;
};

const bucketExpr = (today: string) =>
  sql<string>`CASE WHEN ${tasks.status} IN ('completed','cancelled') THEN 'completed' WHEN ${tasks.dueDate} < ${today} THEN 'overdue' WHEN ${tasks.dueDate} = ${today} THEN 'today' ELSE 'upcoming' END`;
const priorityRank = sql`CASE ${tasks.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;

/** Rows this person may see in a scope — the same rule as canSeeTask, in SQL. */
function scopeWhere(actor: Actor, scope: "mine" | "team"): SQL | undefined {
  if (!actor.companies.length) return sql`0`;
  const company = inArray(tasks.company, actor.companies);
  if (scope === "mine") return and(company, eq(tasks.assigneeId, actor.id));
  return and(company, actor.branches.length ? or(inArray(tasks.branch, actor.branches), eq(tasks.assigneeId, actor.id), eq(tasks.createdBy, actor.id)) : undefined);
}

export async function listTasks(db: Database, actor: Actor, query: TaskQuery, now = new Date()) {
  const scope = query.scope === "team" && teamTasksAllowed(actor) ? "team" : "mine";
  const today = businessToday(now);
  const bucket = bucketExpr(today);
  const base = scopeWhere(actor, scope);
  const text = query.q?.trim().slice(0, 100);
  const pattern = text ? `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : "";
  const filters = and(
    base,
    pattern ? or(sql`${tasks.title} LIKE ${pattern} ESCAPE '\\'`, sql`${tasks.description} LIKE ${pattern} ESCAPE '\\'`) : undefined,
    query.company && query.company !== "All companies" ? eq(tasks.company, query.company) : undefined,
    query.priority?.length ? inArray(tasks.priority, query.priority) : undefined,
    query.status?.length ? inArray(tasks.status, query.status) : undefined,
    scope === "team" && query.assigneeId ? eq(tasks.assigneeId, query.assigneeId) : undefined,
    query.source === "automation" ? sql`${tasks.ruleId} IS NOT NULL` : query.source === "manual" ? sql`${tasks.ruleId} IS NULL` : undefined,
  );
  const counted = await db.select({ bucket, n: sql<number>`count(*)` }).from(tasks).where(filters).groupBy(bucket).all();
  const counts = Object.fromEntries(VIEWS.map((v) => [v, Number(counted.find((c) => c.bucket === v)?.n ?? 0)])) as Record<TaskViewName, number>;
  const where = and(filters, sql`${bucket} = ${query.view}`);
  const closed = query.view === "completed";
  const order =
    query.sort === "priority"
      ? [asc(priorityRank), asc(tasks.dueDate), asc(tasks.id)]
      : query.sort === "updated"
        ? [desc(tasks.updatedAt), asc(tasks.id)]
        : query.sort === "title"
          ? [asc(sql`lower(${tasks.title})`), asc(tasks.id)]
          : closed
            ? [desc(sql`coalesce(${tasks.completedAt}, ${tasks.updatedAt})`), asc(tasks.id)]
            : [asc(tasks.dueDate), asc(sql`coalesce(${tasks.dueTime}, '99:99')`), asc(priorityRank), asc(tasks.id)];
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 5), 50);
  const total = counts[query.view];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const rows = await db.select().from(tasks).where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize).all();
  // Belt and braces: the SQL scope mirrors canSeeTask; nothing else leaves.
  const visible = rows.filter((r) => canSeeTask(actor, r));
  return { scope, teamAvailable: teamTasksAllowed(actor), today, counts, total, page, pages, pageSize, items: await present(db, actor, visible, now) };
}

export async function getTaskRow(db: Database, actor: Actor, id: string) {
  const row = id.length <= 100 ? await db.select().from(tasks).where(eq(tasks.id, id)).get() : undefined;
  if (!row || !canSeeTask(actor, row)) throw notFound();
  return row;
}

const FIELD_LABELS: Record<string, string> = { title: "Title", description: "Description", priority: "Priority", dueDate: "Due date", dueTime: "Due time", assigneeId: "Assignee", linkedRecordId: "Linked record", status: "Status" };
type Snapshot = Partial<Record<keyof typeof FIELD_LABELS, string | null>>;
const snapshot = (r: Pick<TaskRow, "title" | "description" | "priority" | "dueDate" | "dueTime" | "assigneeId" | "linkedRecordId" | "status">): Snapshot => ({
  title: r.title, description: r.description, priority: r.priority, dueDate: r.dueDate, dueTime: r.dueTime, assigneeId: r.assigneeId, linkedRecordId: r.linkedRecordId, status: r.status,
});

export async function taskDetail(db: Database, actor: Actor, id: string) {
  const row = await getTaskRow(db, actor, id);
  const [task] = await present(db, actor, [row]);
  const events = await db.select().from(auditEvents).where(and(eq(auditEvents.subject, "task"), eq(auditEvents.recordId, id))).orderBy(desc(auditEvents.at)).limit(50).all();
  const people = await names(db, events.flatMap((e) => [(e.before as Snapshot | null)?.assigneeId ?? "", (e.after as Snapshot | null)?.assigneeId ?? ""]));
  const shown = (key: string, v: string | null | undefined) =>
    v == null || v === ""
      ? "none"
      : key === "assigneeId"
        ? (people.get(v) ?? "Former colleague")
        : key === "status"
          ? STATUS_LABELS[v as TaskStatus] ?? v
          : key === "priority"
            ? PRIORITY_LABELS[v as TaskPriority] ?? v
            : key === "linkedRecordId"
              ? "a record"
              : v;
  const history: TaskHistoryItem[] = events.map((e) => {
    const before = (e.before ?? {}) as Snapshot;
    const after = (e.after ?? {}) as Snapshot;
    const changes = e.before
      ? Object.keys(FIELD_LABELS)
          .filter((k) => (before[k] ?? null) !== (after[k] ?? null))
          .map((k) => (k === "description" ? "Description changed" : k === "linkedRecordId" ? (after[k] ? "Linked record changed" : "Link removed") : `${FIELD_LABELS[k]}: ${shown(k, before[k])} → ${shown(k, after[k])}`))
      : [];
    return { id: e.id, at: e.at.toISOString(), actor: e.actor, action: e.action, changes };
  });
  return { task, history };
}

export async function tasksForRecord(db: Database, actor: Actor, recordId: string) {
  const row = recordId.length <= 100 ? await db.select({ payload: businessRecords.payload }).from(businessRecords).where(eq(businessRecords.id, recordId)).get() : undefined;
  const record = row?.payload as RecordItem | undefined;
  if (!record || record.deletedAt || !canRead(actor, record)) throw new TaskError(404, "This record isn't available to you.");
  const rows = (await db.select().from(tasks).where(eq(tasks.linkedRecordId, recordId)).orderBy(asc(tasks.dueDate)).limit(100).all()).filter((r) => canSeeTask(actor, r));
  rows.sort((a, b) => Number(isClosed(a.status)) - Number(isClosed(b.status)));
  return present(db, actor, rows.slice(0, 50));
}

/* ----------------------------------------------------------------- write */

async function linkedRecord(db: Database, actor: Actor, id: string | null, company: string) {
  if (!id) return null;
  const row = id.length <= 100 ? await db.select({ payload: businessRecords.payload }).from(businessRecords).where(eq(businessRecords.id, id)).get() : undefined;
  const record = row?.payload as RecordItem | undefined;
  if (!record || record.deletedAt || !canRead(actor, record)) throw new TaskError(404, "That record isn't available to you.");
  if (!LINKABLE_KINDS.includes(record.kind)) throw new TaskError(400, "Tasks can't be linked to this kind of record.");
  if (record.company !== company) throw new TaskError(400, "Link a record from the task's company.");
  return record;
}
/** An unlinked task sits in the assignee's branch when they have one. */
function unlinkedBranch(actor: Actor, assignee: Candidate | undefined) {
  const shared = assignee?.branches.find((b) => !actor.branches.length || actor.branches.includes(b));
  return shared || actor.branches[0] || assignee?.branches[0] || "Main";
}

async function checkAssignee(db: Database, actor: Actor, assigneeId: string, scope: { company: string; branch: string }, linked: RecordItem | null) {
  if (assigneeId !== actor.id && !mayAssignOthers(actor, scope)) throw new TaskError(403, "You can only plan tasks for yourself here.");
  const assignee = assigneeId === actor.id ? { ...actor, active: true } : await person(db, assigneeId);
  const problem = assigneeProblem(assignee, scope, linked);
  if (problem) throw new TaskError(400, problem);
  return assignee!;
}

const sha = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const auditStatement = (db: Database, e: { company: string; actor: string; actorId: string; action: string; taskId: string; before?: Snapshot | null; after: Snapshot; at: Date }) =>
  db.insert(auditEvents).values({ id: crypto.randomUUID(), company: e.company, actor: e.actor, actorId: e.actorId, action: e.action, recordId: e.taskId, before: e.before ?? null, after: e.after, at: e.at, subject: "task", branch: null });

const priorityOf = (p: TaskPriority): NotificationDraft["priority"] => (p === "urgent" ? "urgent" : p === "high" ? "important" : "normal");
export function assignmentDraft(task: Pick<TaskRow, "id" | "title" | "priority" | "assigneeId" | "version">, by: { id: string | null; name: string }): NotificationDraft {
  return {
    recipientId: task.assigneeId,
    actorId: by.id,
    type: "task.assigned",
    category: "assignment",
    title: "Task assigned to you",
    body: `${by.name} · ${task.title}`,
    entityType: "task",
    entityId: task.id,
    priority: priorityOf(task.priority),
    dedupeKey: `task:${task.id}:assigned:${task.version}`,
  };
}

export async function createTask(db: Database, actor: Actor, raw: unknown, now = new Date()) {
  const input = createTaskInput.parse(raw);
  if (!actor.companies.includes(input.company)) throw new TaskError(403, "You don't have access to that company.");
  const id = "TSK-" + (await sha(`${actor.id}:${input.requestId}`)).slice(0, 32);
  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (existing) {
    if (!canSeeTask(actor, existing)) throw notFound();
    return { task: (await present(db, actor, [existing]))[0], duplicate: true, draft: null };
  }
  const linked = await linkedRecord(db, actor, input.linkedRecordId, input.company);
  const candidate = input.assigneeId === actor.id ? undefined : await person(db, input.assigneeId);
  const branch = linked ? linked.branch : unlinkedBranch(actor, candidate);
  const scope = { company: input.company, branch };
  await checkAssignee(db, actor, input.assigneeId, scope, linked);
  const row: TaskRow = {
    id, company: input.company, branch, title: input.title, description: input.description, assigneeId: input.assigneeId, createdBy: actor.id,
    priority: input.priority, status: "open", dueDate: input.dueDate, dueTime: input.dueTime, linkedRecordId: linked?.id ?? null,
    ruleId: null, dedupeKey: null, version: 1, createdAt: now, updatedAt: now, completedAt: null,
  };
  try {
    await db.batch([
      db.insert(tasks).values(row),
      auditStatement(db, { company: row.company, actor: actor.name, actorId: actor.id, action: "Created task", taskId: id, after: snapshot(row), at: now }),
    ]);
  } catch (error) {
    // A simultaneous resubmission of the same request: the first one won.
    if (/UNIQUE|constraint/i.test(String(error))) {
      const again = await db.select().from(tasks).where(eq(tasks.id, id)).get();
      if (again) {
        if (!canSeeTask(actor, again)) throw notFound();
        return { task: (await present(db, actor, [again]))[0], duplicate: true, draft: null };
      }
    }
    if (/task_scope_invalid/.test(String(error))) throw new TaskError(400, "Link a record from the task's company.");
    throw error;
  }
  return { task: (await present(db, actor, [row]))[0], duplicate: false, draft: row.assigneeId !== actor.id ? assignmentDraft(row, actor) : null };
}

export async function updateTask(db: Database, actor: Actor, raw: unknown, now = new Date()) {
  const command = taskCommand.parse(raw);
  const current = await getTaskRow(db, actor, command.id);
  if (current.version !== command.expectedVersion) throw new TaskError(409, "Someone else changed this task. Review the latest version and try again.");
  const next: TaskRow = { ...current };
  let action = "";
  let draft: NotificationDraft | null = null;
  if (command.action === "edit") {
    if (!canWorkOnTask(actor, current)) throw new TaskError(403, "You can't change this task.");
    if (isClosed(current.status)) throw new TaskError(409, "Reopen the task before editing it.");
    const v = command.values;
    let linked: RecordItem | null = null;
    if (v.linkedRecordId !== undefined && v.linkedRecordId !== current.linkedRecordId) {
      linked = await linkedRecord(db, actor, v.linkedRecordId, current.company);
      next.linkedRecordId = linked?.id ?? null;
      if (linked) next.branch = linked.branch;
      // The person doing the work must still be able to open the new link.
      const assignee = current.assigneeId === actor.id ? { ...actor, active: true } : await person(db, current.assigneeId);
      const problem = assigneeProblem(assignee, { company: current.company, branch: next.branch }, linked);
      if (problem) throw new TaskError(400, problem);
    }
    Object.assign(next, { title: v.title, description: v.description, priority: v.priority, dueDate: v.dueDate, dueTime: v.dueTime });
    action = "Edited task";
  } else if (command.action === "assign") {
    if (!canManageTask(actor, current)) throw new TaskError(403, "You can't reassign this task.");
    if (isClosed(current.status)) throw new TaskError(409, "Reopen the task before reassigning it.");
    if (command.assigneeId === current.assigneeId) return { task: (await present(db, actor, [current]))[0], draft: null };
    const linked = current.linkedRecordId ? await linkedRecord(db, actor, current.linkedRecordId, current.company) : null;
    const candidate = command.assigneeId === actor.id ? undefined : await person(db, command.assigneeId);
    if (!linked) next.branch = unlinkedBranch(actor, candidate ?? { ...actor, active: true });
    await checkAssignee(db, actor, command.assigneeId, { company: current.company, branch: next.branch }, linked);
    next.assigneeId = command.assigneeId;
    action = "Reassigned task";
  } else {
    const to = command.status;
    if (to === current.status) return { task: (await present(db, actor, [current]))[0], draft: null };
    if (!TRANSITIONS[current.status].includes(to)) throw new TaskError(409, `A ${STATUS_LABELS[current.status].toLowerCase()} task can't be marked ${STATUS_LABELS[to].toLowerCase()}.`);
    if (to === "cancelled" ? !canManageTask(actor, current) : !canWorkOnTask(actor, current)) throw new TaskError(403, "You can't change this task's status.");
    next.status = to;
    next.completedAt = to === "completed" ? now : null;
    action = to === "completed" ? "Completed task" : to === "cancelled" ? "Cancelled task" : to === "in_progress" ? "Started task" : isClosed(current.status) ? "Reopened task" : "Moved task back to open";
  }
  next.version = current.version + 1;
  next.updatedAt = now;
  try {
    await db.batch([
      db
        .update(tasks)
        .set({
          title: next.title, description: next.description, priority: next.priority, dueDate: next.dueDate, dueTime: next.dueTime, assigneeId: next.assigneeId,
          linkedRecordId: next.linkedRecordId, branch: next.branch, status: next.status, completedAt: next.completedAt, updatedAt: now,
          // A stale version violates NOT NULL and rolls back the whole batch, audit included.
          version: sql`CASE WHEN ${tasks.version} = ${current.version} THEN ${tasks.version} + 1 ELSE NULL END`,
        })
        .where(eq(tasks.id, current.id)),
      auditStatement(db, { company: current.company, actor: actor.name, actorId: actor.id, action, taskId: current.id, before: snapshot(current), after: snapshot(next), at: now }),
    ]);
  } catch (error) {
    if (/NOT NULL constraint failed: Task\.version/.test(String(error))) throw new TaskError(409, "Someone else changed this task. Review the latest version and try again.");
    if (/task_scope_invalid/.test(String(error))) throw new TaskError(400, "Link a record from the task's company.");
    throw error;
  }
  if (command.action === "assign" && next.assigneeId !== actor.id) draft = assignmentDraft(next, actor);
  return { task: (await present(db, actor, [next]))[0], draft };
}

/** People this person may give a task to, for one company/branch/link. */
export async function assignableFor(db: Database, actor: Actor, input: { company: string; branch?: string; linkedRecordId?: string | null }) {
  if (!actor.companies.includes(input.company)) throw new TaskError(403, "You don't have access to that company.");
  const linked = await linkedRecord(db, actor, input.linkedRecordId ?? null, input.company);
  if (!isTaskManager(actor)) return [{ id: actor.id, name: actor.name, role: actor.role }];
  const all = (await db.select().from(users).where(eq(users.active, true)).all()).map(toCandidate);
  return all
    .filter((p) => {
      const scope = { company: input.company, branch: linked ? linked.branch : unlinkedBranch(actor, p) };
      return (p.id === actor.id || mayAssignOthers(actor, scope)) && !assigneeProblem(p, scope, linked);
    })
    .map((p) => ({ id: p.id, name: p.name, role: p.role }))
    .sort((a, b) => Number(b.id === actor.id) - Number(a.id === actor.id) || a.name.localeCompare(b.name));
}

export { snapshot as taskSnapshot };
export type TaskCommand = z.infer<typeof taskCommand>;
