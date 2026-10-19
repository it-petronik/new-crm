"use client";
import { useState } from "react";
import { CheckCircle2, Circle, Link2, Lock, Workflow } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Avatar } from "../avatar";
import { Tooltip } from "../ui/controls";
import { StatusBadge, TonePill } from "../ui/status-badge";
import { PRIORITY_LABELS, STATUS_LABELS, isClosed } from "@/lib/tasks/model";
import { announceTasksChanged, openRecord, tasksApi, TaskRequestError, type TaskView } from "@/lib/tasks/client";
import { kindLabel } from "./task-dialog";
import { dueText, priorityTone } from "./task-detail";

/**
 * Task rows. Completing is one click on the circle; everything else opens
 * the task. Each change carries the version shown, so a stale row is refused
 * and refreshed rather than overwriting someone else's edit.
 */
export function TaskRows({
  items,
  showAssignee,
  onOpen,
  onError,
  label,
}: {
  items: TaskView[];
  showAssignee: boolean;
  onOpen: (t: TaskView) => void;
  onError: (message: string) => void;
  label: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  async function toggle(t: TaskView) {
    setPending(t.id);
    try {
      await tasksApi.update({ action: "status", id: t.id, expectedVersion: t.version, status: isClosed(t.status) ? "open" : "completed" });
    } catch (e) {
      onError(e instanceof TaskRequestError ? e.message : "Couldn't update the task.");
    } finally {
      setPending(null);
      announceTasksChanged();
    }
  }
  return (
    <ul className={styles.list} aria-label={label}>
      {items.map((t) => {
        const closed = isClosed(t.status);
        const late = !closed && (t.bucket === "overdue" || t.pastDueTime);
        const actionLabel = closed ? `Reopen ${t.title}` : `Mark ${t.title} complete`;
        return (
          <li key={t.id} className={`${styles.row}${closed ? ` ${styles.closed}` : ""}`} data-task={t.id}>
            <Tooltip label={t.can.work ? (closed ? "Reopen" : "Mark complete") : "Only the assignee, creator or a team lead can change this"}>
              <button
                type="button"
                className={styles.done}
                aria-label={actionLabel}
                aria-pressed={t.status === "completed"}
                disabled={!t.can.work || pending === t.id || t.status === "cancelled"}
                onClick={() => void toggle(t)}
              >
                {t.status === "completed" ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>
            </Tooltip>
            <div className={styles.what}>
              <button type="button" className={styles.title} onClick={() => onOpen(t)}>
                {t.title}
              </button>
              <div className={styles.meta}>
                {t.link && <LinkChip link={t.link} />}
                {t.automation && (
                  <span className={styles.restricted} title={`Created by the “${t.automation.name}” rule`}>
                    <Workflow size={12} aria-hidden="true" /> Automation
                  </span>
                )}
                <span>{t.company}</span>
              </div>
            </div>
            <div className={styles.side}>
              {showAssignee && (
                <span className={styles.person} title={t.assignee.name}>
                  <Avatar name={t.assignee.name} avatarId={t.assignee.id} size={22} />
                  <span>{t.assignee.name}</span>
                </span>
              )}
              <span className={`${styles.due}${late ? ` ${styles.late}` : ""}`}>
                {dueText(t)}
                {late && <span className="sr-only"> (overdue)</span>}
              </span>
              {t.priority !== "normal" && <TonePill tone={priorityTone(t.priority)}>{PRIORITY_LABELS[t.priority]}</TonePill>}
              <StatusBadge status={STATUS_LABELS[t.status]} size="sm" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The linked record, or "Restricted record" when this person cannot open it. */
export function LinkChip({ link }: { link: NonNullable<TaskView["link"]> }) {
  if ("restricted" in link)
    return (
      <span className={styles.restricted}>
        <Lock size={12} aria-hidden="true" /> Restricted record
      </span>
    );
  return (
    <button type="button" className={styles.link} onClick={() => openRecord(link.kind, link.id)} title={`Open ${link.title}`}>
      <Link2 size={12} aria-hidden="true" />
      {kindLabel(link.kind)} · {link.title}
    </button>
  );
}
