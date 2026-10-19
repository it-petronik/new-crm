"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Button, DialogPresence } from "../ui/controls";
import { TASKS_CHANGED, tasksApi, type TaskView } from "@/lib/tasks/client";
import type { Actor, RecordItem } from "@/lib/domain";
import { TaskDialog } from "./task-dialog";
import { TaskDetail } from "./task-detail";
import { TaskRows } from "./task-list";

/**
 * Tasks linked to one record, on that record's page. Only tasks this person
 * may see are listed (the server filters); adding one links it here.
 */
export default function RecordTasks({ record, actor }: { record: RecordItem; actor: Actor }) {
  const [items, setItems] = useState<TaskView[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    tasksApi.forRecord(record.id).then(
      (r) => (setItems(r.items), setError("")),
      (e) => setError(e instanceof Error ? e.message : "Couldn't load tasks."),
    );
  }, [record.id]);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, load);
    return () => window.removeEventListener(TASKS_CHANGED, load);
  }, [load]);
  const open = items?.filter((t) => t.status === "open" || t.status === "in_progress").length ?? 0;
  return (
    <section className={styles.recordTasks} aria-labelledby={`record-tasks-${record.id}`}>
      <div className={styles.recordHead}>
        <h3 id={`record-tasks-${record.id}`}>
          Tasks {items && items.length > 0 && <span className="muted">· {open} open</span>}
        </h3>
        <Button className="secondary compact" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> Add task
        </Button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <p className="muted small">Loading tasks…</p>
      ) : !items.length ? (
        <p className="muted small">No tasks for this {record.kind === "it" ? "ticket" : "record"} yet.</p>
      ) : (
        <TaskRows items={items} showAssignee label={`Tasks for ${record.title}`} onOpen={(t) => setOpenId(t.id)} onError={setError} />
      )}
      <DialogPresence>
        {(creating || editing) && (
          <TaskDialog
            actor={actor}
            task={editing}
            link={creating ? { id: record.id, kind: record.kind, title: record.title, company: record.company } : null}
            onClose={() => (setCreating(false), setEditing(null))}
            onSaved={() => (setCreating(false), setEditing(null), load())}
          />
        )}
      </DialogPresence>
      <DialogPresence>{openId && !editing && <TaskDetail taskId={openId} onClose={() => setOpenId(null)} onEdit={setEditing} />}</DialogPresence>
    </section>
  );
}
