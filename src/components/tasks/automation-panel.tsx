"use client";
import {LoadingState} from "../ui/async-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, History, Settings2 } from "lucide-react";
import styles from "../studio/tasks.module.css";
import { Button, Dialog, DialogActions, DialogPresence, Field, Input, Select } from "../ui/controls";
import { EmptyState, FormGrid, Surface } from "../ui/layout";
import { StatusBadge, TonePill } from "../ui/status-badge";
import { useUnsavedChanges } from "../use-unsaved";
import { businessStampShort } from "@/lib/gst";
import { LEAD_OPEN_STAGES, PRIORITY_LABELS, TASK_PRIORITIES, TICKET_PRIORITIES, type TaskPriority } from "@/lib/tasks/model";
import { openRecord, tasksApi, TaskRequestError, type RulePreview, type RuleRun, type RuleView } from "@/lib/tasks/client";
import type { Actor } from "@/lib/domain";
import { kindLabel } from "./task-dialog";

const RUN_LABEL = { success: "Succeeded", skipped: "Skipped", failed: "Failed" } as const;
const dueLabel = (days: number) => (days === 0 ? "Same day" : days === 1 ? "Next day" : `${days} days later`);

/**
 * Task automation: three presets per company, each off until someone with
 * the right role turns it on. Preview never writes; history shows what each
 * rule did, including why a task was not created.
 */
export default function AutomationPanel({ actor }: { actor: Actor }) {
  const [data, setData] = useState<{ companies: string[]; rules: RuleView[] } | null>(null);
  const [error, setError] = useState("");
  const [company, setCompany] = useState("");
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [previewing, setPreviewing] = useState<RuleView | null>(null);
  const [history, setHistory] = useState<RuleView | null>(null);
  const load = useCallback(() => {
    tasksApi.rules().then(
      (r) => (setData(r), setError(""), setCompany((c) => (c && r.companies.includes(c) ? c : (r.companies[0] ?? "")))),
      (e) => setError(e instanceof Error ? e.message : "Couldn't load automation."),
    );
  }, []);
  useEffect(load, [load]);

  if (error) return <EmptyState title="Automation couldn't be loaded" detail={error} action={<Button variant="secondary" onClick={load}>Try again</Button>} />;
  if (!data) return <p className="muted small">Loading automation…</p>;
  const rules = data.rules.filter((r) => r.company === company);
  return (
    <div className={styles.page}>
      <p className={styles.ruleText}>
        Rules create internal tasks only — they never change customers, quotations or orders. Every rule starts switched off. Lead follow-ups and outstanding events are checked every five minutes on the Dubai business day; repeated checks never create a second task.
      </p>
      {data.companies.length > 1 && (
        <Field style={{ maxWidth: 280 }}>
          Company
          <Select value={company} onChange={(e) => setCompany(e.target.value)}>
            {data.companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className={styles.rules}>
        {rules.map((r) => (
          <Surface key={r.preset} className={styles.rule} aria-label={r.label}>
            <div className={styles.ruleHead}>
              <div>
                <h3>{r.rule?.name ?? r.label}</h3>
                <p>{r.trigger}</p>
              </div>
              <StatusBadge status={!r.rule ? "Not set up" : r.rule.enabled ? "Active" : "Inactive"} size="sm" />
            </div>
            <p className={styles.ruleText}>{r.detail}</p>
            {r.rule && (
              <p className={styles.ruleText}>
                {r.preset === "lead_follow_up" ? "Goes to the lead's owner" : r.rule.assignee ? `Goes to ${r.rule.assignee.name}${r.rule.assignee.active ? "" : " (inactive)"}` : "No assignee chosen"} · due {dueLabel(r.rule.dueDays).toLowerCase()}
                {r.rule.dueTime ? ` at ${r.rule.dueTime}` : ""} · {PRIORITY_LABELS[r.rule.priority as TaskPriority]} priority
              </p>
            )}
            {r.rule && (
              <div className={styles.counts} aria-label="Run history totals">
                <TonePill tone="success">{r.lastRuns.success} created</TonePill>
                <TonePill tone="warning">{r.lastRuns.skipped} skipped</TonePill>
                <TonePill tone={r.lastRuns.failed ? "danger" : "neutral"}>{r.lastRuns.failed} failed</TonePill>
              </div>
            )}
            {r.rule?.assignee && !r.rule.assignee.active && <p className={styles.notice}>The chosen person is inactive, so new events are skipped. Choose someone else.</p>}
            <div className={styles.ruleActions}>
              {r.canEdit && (
                <Button variant={r.rule ? "secondary" : "primary"} onClick={() => setEditing(r)}>
                  <Settings2 size={15} /> {r.rule ? "Edit" : "Set up"}
                </Button>
              )}
              {r.rule && (
                <Button variant="secondary" onClick={() => setPreviewing(r)}>
                  <Eye size={15} /> Preview
                </Button>
              )}
              {r.rule && (
                <Button variant="ghost" onClick={() => setHistory(r)}>
                  <History size={15} /> History
                </Button>
              )}
              {!r.canEdit && !r.rule && <span className="muted small">Not set up. Ask a manager who looks after this area.</span>}
            </div>
            {r.rule && (
              <small className="muted">
                Last changed by {r.rule.updatedBy}, {businessStampShort(r.rule.updatedAt)}
                {r.canEdit ? "" : " · view only"}
              </small>
            )}
          </Surface>
        ))}
      </div>
      <DialogPresence>{editing && <RuleDialog view={editing} actor={actor} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}</DialogPresence>
      <DialogPresence>{previewing?.rule && <PreviewDialog view={previewing} onClose={() => setPreviewing(null)} />}</DialogPresence>
      <DialogPresence>{history?.rule && <HistoryDialog view={history} onClose={() => setHistory(null)} />}</DialogPresence>
    </div>
  );
}

function RuleDialog({ view, actor, onClose, onSaved }: { view: RuleView; actor: Actor; onClose: () => void; onSaved: () => void }) {
  const rule = view.rule;
  const [name, setName] = useState(rule?.name ?? view.label);
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [assigneeId, setAssigneeId] = useState(rule?.assignee?.id ?? "");
  const [dueDays, setDueDays] = useState(rule?.dueDays ?? 0);
  const [dueTime, setDueTime] = useState(rule?.dueTime ?? "");
  const [priority, setPriority] = useState<TaskPriority>((rule?.priority as TaskPriority) ?? "normal");
  const [statuses, setStatuses] = useState<string[]>(rule?.conditions.statuses ?? []);
  const [priorities, setPriorities] = useState<string[]>(rule?.conditions.priorities ?? []);
  const [lookback, setLookback] = useState(rule?.conditions.lookbackDays ?? 0);
  const [branches, setBranches] = useState((rule?.conditions.branches ?? []).join(", "));
  const [people, setPeople] = useState<{ id: string; name: string; role: string; branches: string[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unsaved = useUnsavedChanges(busy);
  const formId = useRef(`rule-form-${view.company}-${view.preset}`.replace(/\W/g, "-")).current;
  const ownerAssigned = view.preset === "lead_follow_up";

  useEffect(() => {
    if (ownerAssigned) return;
    tasksApi.candidates(view.company, view.preset).then(
      (r) => setPeople(r.people),
      () => setPeople([]),
    );
  }, [ownerAssigned, view.company, view.preset]);

  const toggle = (list: string[], value: string, setter: (v: string[]) => void) => setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await tasksApi.saveRule({
        company: view.company,
        preset: view.preset,
        name: name.trim(),
        enabled,
        assigneeId: ownerAssigned ? null : assigneeId || null,
        dueDays,
        dueTime: dueTime || null,
        priority,
        conditions: {
          ...(view.preset === "lead_follow_up" ? { statuses, lookbackDays: lookback } : {}),
          ...(view.preset === "it_ticket_triage" ? { priorities } : {}),
          branches: branches.split(",").map((b) => b.trim()).filter(Boolean),
        },
        ...(rule ? { expectedVersion: rule.version } : {}),
      });
      unsaved.reset();
      onSaved();
    } catch (err) {
      setError(err instanceof TaskRequestError ? err.message : "Couldn't save the automation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog title={rule ? `Edit ${view.label.toLowerCase()}` : `Set up ${view.label.toLowerCase()}`} description={`${view.company} · ${view.trigger}`} onClose={unsaved.guard(onClose)} dismissOnOutside={!unsaved.dirty && !busy}>
        <form id={formId} onSubmit={submit} onInput={unsaved.markDirty} onChange={unsaved.markDirty} noValidate>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <FormGrid>
            <Field className={styles.wide}>
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </Field>
            <label className={`${styles.wide} ${styles.choices}`}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled — create tasks when this happens
            </label>
            {ownerAssigned ? (
              <p className={`${styles.wide} ${styles.ruleText}`}>Each task goes to the lead&apos;s owner. If the owner is inactive or can no longer open the lead, no task is created and the reason is shown in History.</p>
            ) : (
              <Field className={styles.wide} hint={people && !people.length ? "Nobody in this company can receive these tasks yet." : "Only active people who can open these records are listed."}>
                Assignee
                <Select value={assigneeId || "none"} onChange={(e) => setAssigneeId(e.target.value === "none" ? "" : e.target.value)} disabled={!people}>
                  <option value="none">Choose a person</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.name} · ${p.role}${p.branches.length ? ` (${p.branches.join(", ")})` : ""}`}
                    </option>
                  ))}
                  {rule?.assignee && !(people ?? []).some((p) => p.id === rule.assignee!.id) && <option value={rule.assignee.id}>{`${rule.assignee.name} (no longer eligible)`}</option>}
                </Select>
              </Field>
            )}
            <Field>
              Due
              <Select value={String(dueDays)} onChange={(e) => setDueDays(Number(e.target.value))}>
                {[0, 1, 2, 3, 5, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {dueLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field hint="Optional · Dubai time">
              Due time
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </Field>
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
            {view.preset === "lead_follow_up" && (
              <Field hint="Also pick up follow-ups that are already this many days late.">
                Catch up overdue follow-ups
                <Select value={String(lookback)} onChange={(e) => setLookback(Number(e.target.value))}>
                  {[0, 1, 2, 3, 7].map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? "Only today's" : `Up to ${d} day${d === 1 ? "" : "s"} late`}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {view.preset === "lead_follow_up" && (
              <fieldset className={styles.wide}>
                <legend className="ui-field-label">Lead stages (none ticked = every open stage)</legend>
                <div className={styles.choices}>
                  {LEAD_OPEN_STAGES.map((s) => (
                    <label key={s}>
                      <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(statuses, s, setStatuses)} /> {s}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {view.preset === "it_ticket_triage" && (
              <fieldset className={styles.wide}>
                <legend className="ui-field-label">Ticket priorities (none ticked = every priority)</legend>
                <div className={styles.choices}>
                  {TICKET_PRIORITIES.map((p) => (
                    <label key={p}>
                      <input type="checkbox" checked={priorities.includes(p)} onChange={() => toggle(priorities, p, setPriorities)} /> {p}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Field className={styles.wide} hint="Leave empty for the whole company. Separate several with commas.">
              Branches
              <Input value={branches} onChange={(e) => setBranches(e.target.value)} placeholder="e.g. Main" maxLength={400} />
            </Field>
          </FormGrid>
          <p className="muted small">Saved as {actor.name}. Changes apply to events from now on; existing tasks are not changed.</p>
        </form>
        <DialogActions pending={busy} onCancel={unsaved.guard(onClose)} primary={{ label: rule ? "Save rule" : "Save", pendingLabel: "Saving…", type: "submit", form: formId, pending: busy }} />
      </Dialog>
      {unsaved.confirm}
    </>
  );
}

function PreviewDialog({ view, onClose }: { view: RuleView; onClose: () => void }) {
  const [data, setData] = useState<RulePreview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    tasksApi.preview(view.rule!.id).then(setData, (e) => setError(e instanceof Error ? e.message : "Couldn't build the preview."));
  }, [view.rule]);
  const tone = { create: "Succeeded", skip: "Skipped", already: "Completed" } as const;
  return (
    <Dialog title={`Preview · ${view.rule!.name}`} description="Read-only. Nothing is created by this preview." onClose={onClose}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted small">Checking…</p>}
      {data && (
        <>
          {!data.enabled && <p className={styles.notice}>This rule is switched off, so nothing below will happen until it is enabled.</p>}
          {data.configurationProblem && <p className={styles.notice}>{data.configurationProblem}</p>}
          <p className={styles.ruleText}>
            {data.mode === "today"
              ? `${data.total} lead follow-up${data.total === 1 ? "" : "s"} match today. New tasks would be due ${data.due}.`
              : `Examples from recent records. A new event would create a task due ${data.due}.`}
          </p>
          {data.items.length ? (
            <ul className={styles.runs} aria-label="Preview results">
              {data.items.map((i) => (
                <li key={i.record.id}>
                  <StatusBadge status={i.outcome === "create" ? "Would create" : tone[i.outcome]} size="sm" />
                  <div>
                    <button type="button" className={styles.link} onClick={() => (openRecord(i.record.kind, i.record.id), onClose())}>
                      {kindLabel(i.record.kind)} · {i.record.title}
                    </button>
                    <p>{i.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing matches right now" detail={data.mode === "today" ? "No open lead's follow-up is due today under this rule's conditions." : "No recent records match this rule's conditions."} />
          )}
          {data.hidden > 0 && <p className="muted small">{data.hidden} matching record{data.hidden === 1 ? "" : "s"} outside your access {data.hidden === 1 ? "is" : "are"} counted but not shown.</p>}
        </>
      )}
      <DialogActions cancel="Close" />
    </Dialog>
  );
}

function HistoryDialog({ view, onClose }: { view: RuleView; onClose: () => void }) {
  const [runs, setRuns] = useState<RuleRun[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    tasksApi.history(view.rule!.id).then((r) => setRuns(r.runs), (e) => setError(e instanceof Error ? e.message : "Couldn't load history."));
  }, [view.rule]);
  return (
    <Dialog title={`History · ${view.rule!.name}`} description="The latest 50 runs, newest first." onClose={onClose} variant="drawer">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!runs && !error && <LoadingState label="Loading automation history"/>}
      {runs && !runs.length && <EmptyState title="No runs yet" detail="Runs appear here once the rule is enabled and something happens." />}
      {runs && runs.length > 0 && (
        <ul className={styles.runs} aria-label="Run history">
          {runs.map((r) => (
            <li key={r.id}>
              <StatusBadge status={RUN_LABEL[r.status]} size="sm" />
              <div>
                <p>{r.message}</p>
                <small>
                  {businessStampShort(r.at)}
                  {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
                  {r.record && " · "}
                  {r.record && ("restricted" in r.record ? "a record you can't open" : `${kindLabel(r.record.kind)} ${r.record.title}`)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      <DialogActions cancel="Close" />
    </Dialog>
  );
}
