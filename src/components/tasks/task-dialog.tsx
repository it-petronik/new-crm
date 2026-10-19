"use client";
import {Skeleton} from "../ui/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Button, Dialog, DialogActions, Field, Input, Select, Textarea } from "../ui/controls";
import { FormGrid } from "../ui/layout";
import { useUnsavedChanges } from "../use-unsaved";
import { businessToday } from "@/lib/gst";
import { LINKABLE_KINDS, PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks/model";
import { announceTasksChanged, tasksApi, TaskRequestError, type Assignable, type TaskView } from "@/lib/tasks/client";
import type { Actor, RecordItem } from "@/lib/domain";

const KIND_LABELS: Record<string, string> = { leads: "Lead", quotations: "Quotation", orders: "Sales order", logistics: "Shipment", accounts: "Invoice", customers: "Customer", suppliers: "Supplier", products: "Product", marketing: "Campaign", it: "IT ticket" };
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

type Link = { id: string; kind: string; title: string; company: string } | null;

/**
 * Create or edit one task. Every choice here is checked again on the server:
 * the person list only offers people who could receive the task, and the
 * record search only offers records this person can already open.
 */
export function TaskDialog({
  actor,
  task,
  link: initialLink = null,
  records = [],
  defaultCompany,
  onClose,
  onSaved,
}: {
  actor: Actor;
  /** Present when editing. */
  task?: TaskView | null;
  /** A record to link a new task to (from that record's page). */
  link?: Link;
  /** Records already loaded for this person, for the link search. */
  records?: RecordItem[];
  defaultCompany?: string;
  onClose: () => void;
  onSaved: (task: TaskView) => void;
}) {
  const editing = !!task;
  const [requestId] = useState(() => crypto.randomUUID());
  const companies = actor.companies;
  const [company, setCompany] = useState(task?.company ?? initialLink?.company ?? (defaultCompany && companies.includes(defaultCompany) ? defaultCompany : companies[0] ?? ""));
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? businessToday());
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee.id ?? actor.id);
  const [link, setLink] = useState<Link>(
    task?.link && "id" in task.link ? { id: task.link.id, kind: task.link.kind, title: task.link.title, company: task.company } : initialLink,
  );
  // A linked record this person can no longer open is kept as it is.
  const keepsRestricted = !!task?.link && "restricted" in task.link;
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Assignable[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const unsaved = useUnsavedChanges(busy);
  const formId = useRef(`task-form-${requestId}`).current;

  // Who may receive it depends on the company and the linked record.
  useEffect(() => {
    if (editing) return;
    let live = true;
    setPeople(null);
    tasksApi.assignees(company, link?.id ?? null).then(
      (r) => {
        if (!live) return;
        setPeople(r.people);
        if (!r.people.some((p) => p.id === assigneeId)) setAssigneeId(r.people[0]?.id ?? actor.id);
      },
      () => live && setPeople([{ id: actor.id, name: actor.name, role: actor.role }]),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, link?.id, editing]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return records
      .filter((r) => !r.deletedAt && r.company === company && LINKABLE_KINDS.includes(r.kind) && `${r.title} ${r.product} ${r.id}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [records, query, company]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFields({});
    if (title.trim().length < 2) return setFields({ title: "Title needs at least 2 characters." });
    if (!dueDate) return setFields({ dueDate: "Choose a due date." });
    setBusy(true);
    try {
      const values = { title: title.trim(), description: description.trim(), priority, dueDate, dueTime: dueTime || null, ...(keepsRestricted ? {} : { linkedRecordId: link?.id ?? null }) };
      const result = editing
        ? await tasksApi.update({ action: "edit", id: task!.id, expectedVersion: task!.version, values })
        : await tasksApi.create({ ...values, linkedRecordId: link?.id ?? null, assigneeId, company, requestId });
      unsaved.reset();
      announceTasksChanged();
      onSaved(result.task);
    } catch (err) {
      if (err instanceof TaskRequestError) {
        setFields(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^values\./, ""), v])));
        setError(err.message);
      } else setError("Couldn't save the task. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        title={editing ? "Edit task" : "New task"}
        description={editing ? task!.title : link ? `Linked to ${kindLabel(link.kind).toLowerCase()} ${link.title}` : "Plan work for yourself or your team."}
        onClose={unsaved.guard(onClose)}
        dismissOnOutside={!unsaved.dirty && !busy}
        className="task-dialog"
      >
        <form id={formId} onSubmit={submit} onInput={unsaved.markDirty} onChange={unsaved.markDirty} noValidate>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <FormGrid>
            <Field className={styles.wide} error={fields.title}>
              Title
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required autoFocus placeholder="e.g. Call the buyer about sample results" />
            </Field>
            <Field className={styles.wide} error={fields.description}>
              Description
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} placeholder="Optional details" />
            </Field>
            {!editing && companies.length > 1 && !initialLink && (
              <Field>
                Company
                <Select value={company} onChange={(e) => (setCompany(e.target.value), setLink(null))}>
                  {companies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!editing && (
              <Field error={fields.assigneeId} hint={people && people.length === 1 ? "Only team leads can assign tasks to others." : undefined}>
                Assignee
                {!people?<span role="status" aria-label="Loading assignees"><Skeleton h={40}/></span>:<Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {(people ?? [{ id: assigneeId, name: assigneeId === actor.id ? actor.name : "Loading…", role: "" }]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === actor.id ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                </Select>}
              </Field>
            )}
            <Field>
              Priority
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field error={fields.dueDate}>
              Due date
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </Field>
            <Field error={fields.dueTime} hint="Optional · Dubai time">
              Due time
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </Field>
            <div className={`ui-field ${styles.wide}`}>
              <span className="ui-field-label">Linked record</span>
              {keepsRestricted ? (
                <div className={styles.linkField}>
                  <Link2 size={14} aria-hidden="true" />
                  <span>A record you can&apos;t open (kept as is)</span>
                </div>
              ) : link ? (
                <div className={styles.linkField}>
                  <Link2 size={14} aria-hidden="true" />
                  <span title={link.title}>
                    {kindLabel(link.kind)} · {link.title}
                  </span>
                  {!initialLink && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove link" onClick={() => setLink(null)}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Optional · search your records by name"
                    aria-label="Search a record to link"
                    aria-describedby={fields.linkedRecordId ? `${formId}-link-error` : undefined}
                  />
                  {matches.length > 0 && (
                    <ul className={styles.matches} aria-label="Matching records">
                      {matches.map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => (setLink({ id: r.id, kind: r.kind, title: r.title, company: r.company }), setQuery(""))}>
                            <span>{r.title}</span>
                            <small>
                              {kindLabel(r.kind)} · {r.status}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {query.trim().length >= 2 && !matches.length && <p className="ui-field-message">No matching records in {company}.</p>}
                </>
              )}
              {fields.linkedRecordId && (
                <p id={`${formId}-link-error`} className="ui-field-message is-error" role="alert">
                  {fields.linkedRecordId}
                </p>
              )}
            </div>
          </FormGrid>
        </form>
        <DialogActions
          pending={busy}
          primary={{ label: editing ? "Save changes" : "Create task", pendingLabel: "Saving…", type: "submit", form: formId, pending: busy }}
          onCancel={unsaved.guard(onClose)}
        />
      </Dialog>
      {unsaved.confirm}
    </>
  );
}
