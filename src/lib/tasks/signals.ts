import { and, eq, inArray, lte, or } from "drizzle-orm";
import type { Database } from "../d1";
import type { Actor } from "../domain";
import { businessToday } from "../gst";
import type { ProactiveSignal } from "../proactive/signals";
import { tasks, users } from "../schema";
import { STATUS_LABELS, canSeeTask, pastDueTime, type TaskPriority } from "./model";

/**
 * Tasks in the Action Center. Due-today and overdue tasks join the existing
 * signals; a task linked to a record that already has a signal is folded
 * into that signal ("Task: …") instead of appearing twice. Snooze and
 * dismiss do not apply: a task clears when it is completed or cancelled.
 */
const DAY = 86_400_000;
const WEIGHT = { urgent: 3_000_000, important: 2_000_000, normal: 1_000_000 } as const;
const severityOf = (p: TaskPriority, overdue: boolean): ProactiveSignal["severity"] =>
  p === "urgent" ? "urgent" : p === "high" || overdue ? "important" : "normal";
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

export async function withTaskSignals(db: Database, actor: Actor, signals: ProactiveSignal[], scope: "mine" | "team", now = new Date()) {
  if (!actor.companies.length) return signals;
  const today = businessToday(now);
  const inScope =
    scope === "mine"
      ? eq(tasks.assigneeId, actor.id)
      : actor.branches.length
        ? or(inArray(tasks.branch, actor.branches), eq(tasks.assigneeId, actor.id), eq(tasks.createdBy, actor.id))
        : undefined;
  const rows = (
    await db
      .select({ task: tasks, assignee: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(inArray(tasks.company, actor.companies), inArray(tasks.status, ["open", "in_progress"]), lte(tasks.dueDate, today), inScope))
      .limit(300)
      .all()
  ).filter((r) => canSeeTask(actor, r.task));
  const byRecord = new Map<string, ProactiveSignal>();
  for (const s of signals) if (!byRecord.has(s.entity.id)) byRecord.set(s.entity.id, s);
  const added: ProactiveSignal[] = [];
  for (const { task: t, assignee } of rows) {
    const existing = t.linkedRecordId ? byRecord.get(t.linkedRecordId) : undefined;
    // One item per condition: the record's own signal now names its task.
    if (existing && (scope === "team" || existing.entity.ownerId === t.assigneeId)) {
      existing.task ??= { id: t.id, title: t.title };
      continue;
    }
    const overdue = t.dueDate < today;
    const days = Math.round((Date.parse(today) - Date.parse(t.dueDate)) / DAY);
    const severity = severityOf(t.priority, overdue);
    added.push({
      key: `TASK:${t.id}`,
      type: overdue ? "TASK_OVERDUE" : "TASK_DUE_TODAY",
      category: "task",
      severity,
      section: overdue || pastDueTime(t, now) ? "needs_action" : "today",
      entity: { type: "task", id: t.id, title: t.title, status: STATUS_LABELS[t.status], company: t.company, branch: t.branch, ownerId: t.assigneeId, owner: assignee ?? null, value: "", due: t.dueDate, updatedAt: t.updatedAt.toISOString() },
      label: overdue ? `Task overdue ${days} day${days === 1 ? "" : "s"}` : t.dueTime ? `Task due today at ${t.dueTime}` : "Task due today",
      facts: {},
      actions: ["open"],
      dismissible: false,
      snoozable: false,
      rank: WEIGHT[severity] + (overdue ? Math.min(days, 30) * 1000 : 0),
      fingerprint: fnv([t.status, t.dueDate, t.dueTime ?? "", t.priority].join("|")),
    });
  }
  return [...signals, ...added].sort((a, b) => b.rank - a.rank);
}
