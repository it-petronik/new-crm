"use client";
import { useCallback, useEffect, useState } from "react";
import { Link2, Lock, Workflow } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Button, Dialog, DialogActions, Field, Select } from "../ui/controls";
import { StatusBadge, TonePill } from "../ui/status-badge";
import { businessStampShort } from "@/lib/gst";
import { PRIORITY_LABELS, STATUS_LABELS, isClosed } from "@/lib/tasks/model";
import { announceTasksChanged, openRecord, tasksApi, TaskRequestError, type Assignable, type TaskHistoryItem, type TaskView } from "@/lib/tasks/client";
import { kindLabel } from "./task-dialog";

export const priorityTone = (p: TaskView["priority"]) => (p === "urgent" ? "danger" : p === "high" ? "warning" : p === "low" ? "neutral" : "info");
export const dueText = (t: Pick<TaskView, "dueDate" | "dueTime">) => {
  const d = new Date(`${t.dueDate}T00:00:00Z`);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
  if (!t.dueTime) return day;
  const [h, m] = t.dueTime.split(":").map(Number);
  return `${day}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** One task: its facts, link, history and the actions this person may take. */
export function TaskDetail({ taskId, onClose, onEdit }: { taskId: string; onClose: () => void; onEdit: (t: TaskView) => void }) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reassign, setReassign] = useState<Assignable[] | null>(null);
  const [assignee, setAssignee] = useState("");
  const load = useCallback(() => {
    tasksApi.detail(taskId).then(
      (r) => (setTask(r.task), setHistory(r.history), setError("")),
      (e) => setError(e instanceof Error ? e.message : "This task isn't available to you."),
    );
  }, [taskId]);
  useEffect(load, [load]);

  async function act(body: Record<string, unknown>) {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      const r = await tasksApi.update({ id: task.id, expectedVersion: task.version, ...body });
      setTask(r.task);
      setReassign(null);
      announceTasksChanged();
      load();
    } catch (e) {
      setError(e instanceof TaskRequestError ? e.message : "Couldn't update the task.");
      // A conflict means someone else changed it: show the latest version.
      if (e instanceof TaskRequestError && e.status === 409) load();
    } finally {
      setBusy(false);
    }
  }

  const closed = task ? isClosed(task.status) : false;
  return (
    <Dialog title={task?.title ?? "Task"} description={task ? `${task.company} · ${task.branch}` : undefined} onClose={onClose} variant="drawer" className="task-detail">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!task && !error && <p className="muted small">Loading…</p>}
      {task && (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={STATUS_LABELS[task.status]} />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <TonePill tone={priorityTone(task.priority)}>{PRIORITY_LABELS[task.priority]}</TonePill>
              </dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd className={task.bucket === "overdue" || task.pastDueTime ? styles.late : undefined}>
                {dueText(task)}
                {task.bucket === "overdue" ? " · overdue" : task.pastDueTime ? " · past due time" : ""}
              </dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{task.assignee.name}</dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>{task.automation ? `Automation · ${task.automation.name}` : task.createdBy.name}</dd>
            </div>
            <div>
              <dt>Linked record</dt>
              <dd>
                {!task.link ? (
                  "None"
                ) : "restricted" in task.link ? (
                  <span className={styles.restricted}>
                    <Lock size={13} aria-hidden="true" /> A record you can&apos;t open
                  </span>
                ) : (
                  <LinkButton link={task.link} onOpen={onClose} />
                )}
              </dd>
            </div>
          </dl>
          {task.description && <p className={styles.description}>{task.description}</p>}
          {task.automation && (
            <p className="muted small">
              <Workflow size={13} aria-hidden="true" /> Created automatically by the “{task.automation.name}” rule.
            </p>
          )}
          {reassign && (
            <Field>
              Reassign to
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {reassign.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <h3 className={styles.historyTitle}>History</h3>
          <ul className={styles.history} aria-label="Task history">
            {history.map((h) => (
              <li key={h.id}>
                <span>
                  <b>{h.action}</b> · {h.actor}
                </span>
                <small>{businessStampShort(h.at)}</small>
                {h.changes.length > 0 && (
                  <ul>
                    {h.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <DialogActions
            pending={busy}
            start={
              <>
                {task.can.work && !closed && (
                  <Button variant="secondary" onClick={() => onEdit(task)} disabled={busy}>
                    Edit
                  </Button>
                )}
                {task.can.manage && !closed && !reassign && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      tasksApi.assignees(task.company, task.link && "id" in task.link ? task.link.id : null).then(
                        (r) => (setReassign(r.people), setAssignee(r.people.find((p) => p.id !== task.assignee.id)?.id ?? task.assignee.id)),
                        (e) => setError(e.message),
                      )
                    }
                  >
                    Reassign
                  </Button>
                )}
                {task.can.manage && !closed && (
                  <Button variant="ghost" disabled={busy} onClick={() => act({ action: "status", status: "cancelled" })}>
                    Cancel task
                  </Button>
                )}
                {task.can.work && task.status === "open" && (
                  <Button variant="ghost" disabled={busy} onClick={() => act({ action: "status", status: "in_progress" })}>
                    Start
                  </Button>
                )}
              </>
            }
            cancel="Close"
            primary={
              reassign
                ? { label: "Reassign", pendingLabel: "Saving…", pending: busy, disabled: assignee === task.assignee.id, onClick: () => act({ action: "assign", assigneeId: assignee }) }
                : !task.can.work
                  ? undefined
                  : closed
                    ? { label: "Reopen", pendingLabel: "Saving…", pending: busy, onClick: () => act({ action: "status", status: "open" }) }
                    : { label: "Mark complete", pendingLabel: "Saving…", pending: busy, onClick: () => act({ action: "status", status: "completed" }) }
            }
          />
        </>
      )}
    </Dialog>
  );
}

function LinkButton({ link, onOpen }: { link: { id: string; kind: string; title: string }; onOpen: () => void }) {
  return (
    <button type="button" className={styles.link} onClick={() => (openRecord(link.kind, link.id), onOpen())}>
      <Link2 size={13} aria-hidden="true" />
      {kindLabel(link.kind)} · {link.title}
    </button>
  );
}
