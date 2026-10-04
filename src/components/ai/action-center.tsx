"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../studio/action-center.module.css";
import { AlarmClock, ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, Copy, EyeOff, FileText, ListChecks, MessageSquare, RotateCcw, Sparkles, Undo2, XCircle, Target, Truck, Wallet, Database } from "lucide-react";
import { Button, Dialog, DialogActions, DialogPresence, Field, Input } from "../ui/controls";
import FollowUpControl from "../follow-up-control";
import { AiAnswerView, AiLoading, useAiStatus } from "./ai-answer";
import { DraftDialog } from "./sales-copilot";
import type { AiResult } from "@/lib/ai/client";
import { businessTime } from "@/lib/gst";
import { MISSING_LABELS, type MissingField } from "@/lib/proactive/signals";
import { proactive, RECORDS_CHANGED, announceRecordsChanged, tomorrowMorning, type ActionCenterView, type ActionGroup, type ActionScope, type ChangesView, type ProactiveSignal } from "@/lib/proactive/client";

/**
 * The Action Center — what needs action now, computed by Enercore's own
 * rules (no AI call to detect, rank, count or show anything). Every change is
 * previewed and made through the ordinary records API as the person's own
 * edit; AI appears only when someone asks for a brief or a draft.
 */

const GROUP_LABELS: Record<ActionGroup, string> = { all: "All", sales: "Sales", operations: "Operations", finance: "Finance", data: "Data quality" };
const GROUP_ICONS = { all: ListChecks, sales: Target, operations: Truck, finance: Wallet, data: Database };
const SECTIONS: { id: keyof ActionCenterView["sections"]; title: string; empty: string }[] = [
  { id: "needs_action", title: "Needs action", empty: "Nothing needs action right now." },
  { id: "today", title: "Today", empty: "Nothing else is due today." },
  { id: "waiting", title: "Waiting", empty: "Nothing is waiting on others." },
  { id: "data", title: "Data to complete", empty: "No records are missing details for their stage." },
];
const SEVERITY: Record<ProactiveSignal["severity"], { label: string; tone: string }> = {
  urgent: { label: "Urgent", tone: "red" },
  important: { label: "Important", tone: "amber" },
  normal: { label: "Normal", tone: "blue" },
};
const KIND_LABELS: Record<string, string> = { leads: "Lead", quotations: "Quotation", orders: "Order", logistics: "Shipment", accounts: "Invoice", customers: "Customer", suppliers: "Supplier", meeting: "Meeting" };

const openRecord = (kind: string, id: string) => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id } }));
const openMeeting = (meetingId: string, view: "details" | "report") => window.dispatchEvent(new CustomEvent("enercore:open-meeting-page", { detail: { meetingId, view } }));
const openEntity = (s: ProactiveSignal) => (s.entity.type === "meeting" ? openMeeting(s.entity.id, "details") : openRecord(s.entity.type, s.entity.id));
const canFollowUp = (s: ProactiveSignal) => s.actions.includes("set_follow_up") && !!s.entity.updatedAt;

/** Refetches when CRM data changes here, a notification arrives, or the tab regains focus. */
function useLiveRefresh(refresh: () => void) {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 300);
    };
    const onVisible = () => document.visibilityState === "visible" && soon();
    window.addEventListener(RECORDS_CHANGED, soon);
    window.addEventListener("focus", soon);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(RECORDS_CHANGED, soon);
      window.removeEventListener("focus", soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/* ------------------------------------------------------------ Quick Complete */

const QUICK_FIELDS: Exclude<MissingField, "quotation">[] = ["contact", "product", "quantity", "destination", "due", "country"];

export function QuickCompleteDialog({ signal, onClose, onSaved }: { signal: ProactiveSignal; onClose: () => void; onSaved: () => void }) {
  const missing = (signal.missing ?? []) as MissingField[];
  const fields = QUICK_FIELDS.filter((f) => missing.includes(f));
  const [v, setV] = useState({ contact: "", email: "", phone: "", product: "", quantity: "", unit: "MT", destination: "", due: "", country: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const formId = `quick-complete-${signal.entity.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const values: Record<string, unknown> = {};
    if (v.contact.trim()) values.contact = v.contact.trim();
    if (v.email.trim()) values.email = v.email.trim();
    if (v.phone.trim()) values.phone = v.phone.trim();
    if (v.product.trim()) values.product = v.product.trim();
    if (v.quantity.trim()) {
      const q = Number(v.quantity);
      if (!(q > 0)) return setError("Enter a quantity above zero.");
      values.quantity = q;
      values.unit = v.unit.trim() || "MT";
    }
    if (v.destination.trim()) values.destination = v.destination.trim();
    if (v.due) values.due = v.due;
    if (v.country.trim()) values.attributes = { country: v.country.trim() };
    if (!Object.keys(values).length) return setError("Enter at least one missing detail.");
    setBusy(true);
    setError("");
    try {
      await proactive.complete(signal.entity.id, signal.entity.updatedAt!, values);
      announceRecordsChanged();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save these details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Complete details · ${signal.entity.title}`} onClose={onClose} className="quick-complete-dialog" dismissOnOutside={!busy}>
      <form id={formId} className="quick-complete" onSubmit={submit} noValidate>
        <p className="muted small">Only what this {KIND_LABELS[signal.entity.type]?.toLowerCase() ?? "record"} is missing at its current stage ({signal.entity.status}). Nothing else changes.</p>
        {fields.includes("contact") && (
          <fieldset className="quick-complete-group">
            <legend>Contact (at least one)</legend>
            <Field>
              Contact name
              <Input value={v.contact} maxLength={160} onChange={set("contact")} autoComplete="off" />
            </Field>
            <Field>
              Email
              <Input type="email" value={v.email} maxLength={160} onChange={set("email")} autoComplete="off" />
            </Field>
            <Field>
              Phone
              <Input type="tel" value={v.phone} maxLength={50} onChange={set("phone")} autoComplete="off" />
            </Field>
          </fieldset>
        )}
        {fields.includes("product") && (
          <Field>
            Product
            <Input value={v.product} maxLength={160} onChange={set("product")} />
          </Field>
        )}
        {fields.includes("quantity") && (
          <div className="quick-complete-row">
            <Field>
              Quantity
              <Input type="number" inputMode="decimal" min={0} step="any" value={v.quantity} onChange={set("quantity")} />
            </Field>
            <Field>
              Unit
              <Input value={v.unit} maxLength={20} onChange={set("unit")} />
            </Field>
          </div>
        )}
        {fields.includes("destination") && (
          <Field>
            Destination
            <Input value={v.destination} maxLength={160} onChange={set("destination")} />
          </Field>
        )}
        {fields.includes("due") && (
          <Field>
            Next follow-up
            <Input type="date" value={v.due} onChange={set("due")} />
          </Field>
        )}
        {fields.includes("country") && (
          <Field>
            Country
            <Input value={v.country} maxLength={80} onChange={set("country")} />
          </Field>
        )}
        {missing.includes("quotation") && <p className="ai-fineprint">No quotation is linked yet — open the lead to create one.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <DialogActions
        start={
          <Button className="secondary" onClick={() => openEntity(signal)}>
            Open record
          </Button>
        }
        primary={{ label: "Save details", pendingLabel: "Saving…", type: "submit", form: formId, pending: busy, disabled: !fields.length }}
      />
    </Dialog>
  );
}

/* ------------------------------------------------------- follow-up (bulk) */

type Outcome = { id: string; ok: boolean; message: string };

/**
 * Set the next follow-up on one or more records — previewed (current → new),
 * then applied one by one through the records API. Each item is checked on
 * its own: one that changed since it was shown is skipped, not overwritten.
 */
export function FollowUpDialog({ items, onClose, onDone }: { items: ProactiveSignal[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const done = results !== null;

  async function apply() {
    if (!date || busy) return;
    setBusy(true);
    const out: Outcome[] = [];
    for (const s of items) {
      try {
        const now = await proactive.current(s.entity.id);
        if (now.updatedAt !== s.entity.updatedAt) {
          out.push({ id: s.entity.id, ok: false, message: "Changed since it was shown — skipped. Review it first." });
          continue;
        }
        await proactive.setFollowUp(s.entity.id, date);
        out.push({ id: s.entity.id, ok: true, message: `Follow-up set for ${date}` });
      } catch (e) {
        out.push({ id: s.entity.id, ok: false, message: e instanceof Error ? e.message : "Couldn't update this record." });
      }
    }
    setResults(out);
    setBusy(false);
    if (out.some((o) => o.ok)) {
      announceRecordsChanged();
      onDone();
    }
  }

  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  return (
    <Dialog title={items.length === 1 ? `Set follow-up · ${items[0].entity.title}` : `Set follow-up for ${items.length} records`} onClose={onClose} className="follow-up-review-dialog" dismissOnOutside={!busy}>
      {!done && <FollowUpControl busy={busy} onChoose={(d) => setDate(d)} compact />}
      <table className="action-preview" aria-label="Changes to review">
        <thead>
          <tr>
            <th>Record</th>
            <th>Next follow-up</th>
            {done && <th>Result</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const r = byId.get(s.entity.id);
            return (
              <tr key={s.entity.id}>
                <td>
                  {KIND_LABELS[s.entity.type] ?? s.entity.type} · {s.entity.title}
                </td>
                <td>
                  <span className="action-preview-from">{s.entity.due || "none"}</span> → <b>{date || "choose a date"}</b>
                </td>
                {done && (
                  <td className={r?.ok ? "action-result is-ok" : "action-result is-failed"}>
                    {r?.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} {r?.message}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ai-fineprint">Each change is saved as your own note with the new date, and appears in the record&apos;s history. Nothing is sent to anyone.</p>
      {done ? (
        <DialogActions cancel="Close" />
      ) : (
        <DialogActions primary={{ label: items.length === 1 ? "Apply" : `Apply to ${items.length}`, pendingLabel: "Applying…", onClick: apply, pending: busy, disabled: !date }} />
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------- cards */

function SignalCard({
  s,
  team,
  selectable,
  selected,
  onSelect,
  onAct,
  aiDrafts,
}: {
  s: ProactiveSignal;
  team: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onAct: (action: "follow_up" | "complete" | "draft" | "snooze" | "dismiss", s: ProactiveSignal) => void;
  aiDrafts: boolean;
}) {
  const sev = SEVERITY[s.severity];
  const due = s.entity.due?.slice(0, 10);
  const when = due
    ? due
    : s.section === "needs_action"
      ? "Now"
      : s.section === "today"
        ? "Today"
        : s.section === "waiting"
          ? "Waiting"
          : "When convenient";
  return (
    <li className={`action-card is-${s.severity}`} data-signal={s.type}>
      {selectable ? (
        <input type="checkbox" className="action-card-check" aria-label={`Select ${s.entity.title}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      ) : (
        <span className="action-card-check" aria-hidden="true" />
      )}
      <div className="action-what">
        <Button className="record-link action-card-title" onClick={() => openEntity(s)}>
          {s.entity.title}
        </Button>
        <small className="action-card-top">
          {KIND_LABELS[s.entity.type] ?? s.entity.type}
          {s.entity.value && ` · ${s.entity.value}`}
          {team && s.entity.owner && ` · ${s.entity.owner}`}
        </small>
      </div>
      <div className="action-why">
        {/* Normal is the default; only a raised severity earns a badge. */}
        {s.severity !== "normal" && <span className={`badge ${sev.tone}`}>{sev.label}</span>}
        {!s.related?.length ? (
          <span className="action-card-label">
            {s.label}
            {s.missing && s.missing.length > 0 && `: ${s.missing.map((m) => MISSING_LABELS[m as MissingField] ?? m).join(", ")}`}
          </span>
        ) : (
          <span className="action-card-missing">
            Possible duplicate of{" "}
            {s.related.map((r) => (
              <Button key={r.id} className="record-link" onClick={() => openRecord(r.type, r.id)}>
                {r.title}
              </Button>
            ))}
            {s.facts.evidence ? ` — ${s.facts.evidence}` : ""}
          </span>
        )}
      </div>
      <div className="action-when">
        <span className="sr-only">When: </span>
        {when}
      </div>
      <div className="copilot-actions action-card-actions">
        {s.actions.includes("complete_details") && (
          <Button className="secondary compact" onClick={() => onAct("complete", s)}>
            <ListChecks size={14} aria-hidden="true" /> Complete details
          </Button>
        )}
        {canFollowUp(s) && (
          <Button className="secondary compact" onClick={() => onAct("follow_up", s)}>
            <CalendarClock size={14} aria-hidden="true" /> Set follow-up
          </Button>
        )}
        {aiDrafts && s.actions.includes("draft_follow_up") && (
          <Button className="secondary compact" onClick={() => onAct("draft", s)}>
            <MessageSquare size={14} aria-hidden="true" /> Draft message
          </Button>
        )}
        {(s.actions.includes("review_meeting") || s.actions.includes("generate_meeting_report")) && (
          <Button className="secondary compact" onClick={() => openMeeting(s.entity.id, "report")}>
            <FileText size={14} aria-hidden="true" /> Review meeting
          </Button>
        )}
        {s.actions.includes("review_approval") && (
          <Button className="secondary compact" onClick={() => openEntity(s)}>
            Review approval
          </Button>
        )}
        {s.actions.includes("review_duplicates") && (
          <Button className="secondary compact" onClick={() => openEntity(s)}>
            <Copy size={14} aria-hidden="true" /> Review
          </Button>
        )}
        {!s.actions.some((a) => ["complete_details", "review_approval", "review_duplicates", "review_meeting"].includes(a)) && (
          <Button className="secondary compact" onClick={() => openEntity(s)}>
            Open <ArrowRight size={14} aria-hidden="true" />
          </Button>
        )}
        {s.snoozable && (
          <Button className="ghost compact" aria-label={`Snooze ${s.entity.title} until tomorrow`} onClick={() => onAct("snooze", s)}>
            <AlarmClock size={14} aria-hidden="true" /> Tomorrow
          </Button>
        )}
        {s.dismissible && (
          <Button className="ghost compact" aria-label={`Dismiss ${s.entity.title}`} onClick={() => onAct("dismiss", s)}>
            <EyeOff size={14} aria-hidden="true" /> Dismiss
          </Button>
        )}
      </div>
    </li>
  );
}

/* ----------------------------------------------------------- changes + AI */

function ChangesPanel({ aiReady }: { aiReady: boolean }) {
  const [days, setDays] = useState<1 | 7>(1);
  const [view, setView] = useState<ChangesView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    proactive.changes(days).then(setView, (e) => setError(e instanceof Error ? e.message : "Couldn't load recent changes."));
  }, [days]);
  useEffect(load, [load]);
  useLiveRefresh(load);
  const shown = view?.facts.filter((f) => f.count > 0) ?? [];
  return (
    <section className="panel action-changes" aria-labelledby="action-changes-title">
      <div className="panel-heading">
        <h2 id="action-changes-title">{days === 1 ? "What changed since yesterday" : "This week"}</h2>
        <div className="segmented" role="group" aria-label="Period">
          <Button className={days === 1 ? "selected" : ""} aria-pressed={days === 1} onClick={() => setDays(1)}>
            24 hours
          </Button>
          <Button className={days === 7 ? "selected" : ""} aria-pressed={days === 7} onClick={() => setDays(7)}>
            7 days
          </Button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {view && !shown.length && <p className="muted small">No recorded changes in this period.</p>}
      {shown.length > 0 && (
        <dl className="action-change-facts">
          {shown.map((f) => (
            <div key={f.id}>
              <dt>{f.label}</dt>
              <dd>{f.count}</dd>
            </div>
          ))}
        </dl>
      )}
      {view && view.notable.length > 0 && (
        <ul className="action-change-list">
          {view.notable.map((n, i) => (
            <li key={`${n.recordId}-${i}`}>
              <Button className="record-link" onClick={() => openRecord(n.kind, n.recordId)}>
                {n.title}
              </Button>{" "}
              <span>{n.change}</span>
              <small className="muted">
                {n.value ? ` · ${n.value}` : ""} · {n.by} · {businessTime(new Date(n.at))}
              </small>
            </li>
          ))}
        </ul>
      )}
      {aiReady && <BriefButton kind={days === 1 ? "changes" : "week"} label={days === 1 ? "Summarise changes with AI" : "Weekly brief with AI"} />}
    </section>
  );
}

function BriefButton({ kind, label }: { kind: "today" | "changes" | "week"; label: string }) {
  const [state, setState] = useState<{ busy: boolean; result?: AiResult; error?: string }>({ busy: false });
  const running = useRef(false);
  useEffect(() => setState({ busy: false }), [kind]);
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setState({ busy: true });
    try {
      setState({ busy: false, result: await proactive.brief(kind) });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : "Enercore AI couldn't answer right now." });
    } finally {
      running.current = false;
    }
  };
  return (
    <div className="action-brief">
      {!state.result && !state.busy && (
        <Button className="secondary compact" onClick={() => void run()}>
          <Sparkles size={14} aria-hidden="true" /> {label}
        </Button>
      )}
      {state.busy && <AiLoading label="Summarising the facts above…" />}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.result && (
        <>
          <AiAnswerView result={state.result} />
          <p className="ai-fineprint">
            AI summary of the counts above · {businessTime(new Date(state.result.generatedAt))}. Check before relying on it.{" "}
            <Button className="record-link" onClick={() => void run()}>
              <RotateCcw size={12} aria-hidden="true" /> Refresh
            </Button>
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- the page */

export default function ActionCenter() {
  const status = useAiStatus();
  const aiReady = !!status?.available;
  const [scope, setScope] = useState<ActionScope>("mine");
  const [group, setGroup] = useState<ActionGroup>("all");
  const [view, setView] = useState<ActionCenterView | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [followUp, setFollowUp] = useState<ProactiveSignal[] | null>(null);
  const [completing, setCompleting] = useState<ProactiveSignal | null>(null);
  const [drafting, setDrafting] = useState<ProactiveSignal | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    proactive.center(scope, group).then(
      (v) => {
        if (n !== seq.current) return;
        setView(v);
        setError("");
        // A selection only ever covers what is still shown.
        const shown = new Set(Object.values(v.sections).flat().map((s) => s.key));
        setSelected((sel) => new Set([...sel].filter((k) => shown.has(k))));
      },
      (e) => n === seq.current && setError(e instanceof Error ? e.message : "Couldn't load the Action Center."),
    );
  }, [scope, group]);
  useEffect(load, [load]);
  useLiveRefresh(load);

  const all = view ? Object.values(view.sections).flat() : [];
  const chosen = all.filter((s) => selected.has(s.key) && canFollowUp(s));

  async function act(action: "follow_up" | "complete" | "draft" | "snooze" | "dismiss", s: ProactiveSignal) {
    if (action === "follow_up") return setFollowUp([s]);
    if (action === "complete") return setCompleting(s);
    if (action === "draft") return setDrafting(s);
    try {
      if (action === "snooze") await proactive.snooze(s.key, tomorrowMorning(view!.today));
      else await proactive.dismiss(s.key);
      setNotice({
        text: action === "snooze" ? `Snoozed until tomorrow · ${s.entity.title}` : `Dismissed · ${s.entity.title}`,
        undo: () => void proactive.restore(s.key).then(() => (setNotice(null), load())),
      });
      load();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "Couldn't update this item." });
    }
  }

  const team = view?.scope === "team";
  return (
    <div className={`action-center ${styles.workspace}`}>
      <div className="page-heading">
        <div>
          <h1>Action Center</h1>
          <p>Your next steps, in one place. Review, follow up, or complete the details.</p>
        </div>
      </div>

      <div className="action-toolbar">
        <div className="segmented action-groups" role="group" aria-label="Filter">
          {(Object.keys(GROUP_LABELS) as ActionGroup[]).map((g) => (
            <Button key={g} className={group === g ? "selected" : ""} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {GROUP_LABELS[g]}
              {view && <b className="action-count">{view.counts[g]}</b>}
            </Button>
          ))}
        </div>
        {view?.teamAvailable && (
          <div className="segmented" role="group" aria-label="Whose work">
            <Button className={scope === "mine" ? "selected" : ""} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
              Mine
            </Button>
            <Button className={scope === "team" ? "selected" : ""} aria-pressed={scope === "team"} onClick={() => setScope("team")}>
              Team
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!view && !error && <p className="muted small">Loading…</p>}

      {view?.summary && (
        <section className="panel action-summary" aria-label="Exceptions">
          <div className="action-tiles">
            {view.summary.tiles.map((t) => {
              const Icon = GROUP_ICONS[t.group];
              return <button key={t.id} type="button" className={`action-tile${t.count ? "" : " is-zero"}`} onClick={() => setGroup(t.group)} aria-label={`${t.label}: ${t.count}. Show ${GROUP_LABELS[t.group].toLowerCase()}`}>
                <span className={styles.tileHead}><span className={styles.tileIcon}><Icon size={17}/></span><ArrowUpRight size={14} aria-hidden="true"/></span>
                <span className="action-tile-count">{t.count}</span>
                <span className="action-tile-label">{t.label}</span>
                {t.detail && <small>{t.detail}</small>}
              </button>;
            })}
          </div>
          {view.summary.overdueFollowUpsByOwner.length > 0 && (
            <details className={styles.owners}><summary>Overdue follow-ups by owner <span>{view.summary.overdueFollowUpsByOwner.length}</span></summary><ul>{view.summary.overdueFollowUpsByOwner.map(o => <li key={o.owner}><span>{o.owner}</span><b>{o.count}</b></li>)}</ul></details>
          )}
        </section>
      )}

      {aiReady && view && (
        <div className="action-ai">
          <BriefButton kind="today" label="Brief me with AI" />
        </div>
      )}

      {chosen.length > 0 && (
        <div className="action-bulk" role="region" aria-label="Selected items">
          <span>{chosen.length} selected</span>
          <Button className="primary compact" onClick={() => setFollowUp(chosen)}>
            <CalendarClock size={14} aria-hidden="true" /> Set follow-up for selected
          </Button>
          <Button className="secondary compact" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {notice && (
        <div className="action-notice" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <Button className="secondary compact" onClick={notice.undo}>
              <Undo2 size={14} aria-hidden="true" /> Undo
            </Button>
          )}
          <Button className="icon-button" aria-label="Close message" onClick={() => setNotice(null)}>
            <XCircle size={15} />
          </Button>
        </div>
      )}

      {view && (
        <div className="action-sections">
          {[...SECTIONS]
            .sort((a, b) => Number(!view.sections[a.id].length) - Number(!view.sections[b.id].length))
            .map((sec) => {
            const items = view.sections[sec.id];
            return (
              <section key={sec.id} className={`panel action-section${items.length ? "" : " is-empty"}`} aria-labelledby={`action-${sec.id}`}>
                <div className="panel-heading">
                  <h2 id={`action-${sec.id}`}>
                    {sec.title} <span className="muted">{items.length}</span>
                  </h2>
                </div>
                {items.length ? (
                  <>
                  <ul className="action-list" tabIndex={0} aria-label={`${sec.title} items`}>
                    {items.map((s) => (
                      <SignalCard
                        key={s.key}
                        s={s}
                        team={team}
                        aiDrafts={aiReady && !!status?.features.sales}
                        selectable={canFollowUp(s)}
                        selected={selected.has(s.key)}
                        onSelect={(on) =>
                          setSelected((sel) => {
                            const next = new Set(sel);
                            if (on) next.add(s.key);
                            else next.delete(s.key);
                            return next;
                          })
                        }
                        onAct={(a, x) => void act(a, x)}
                      />
                    ))}
                  </ul>
                  </>
                ) : (
                  <p className="muted small">{sec.empty}</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {view && (view.hidden.snoozed > 0 || view.hidden.dismissed > 0) && (
        <p className="muted small">
          Hidden by you: {view.hidden.snoozed} snoozed · {view.hidden.dismissed} dismissed. They return automatically if the situation changes.
        </p>
      )}

      {view && <ChangesPanel aiReady={aiReady} />}

      <DialogPresence>
        {followUp && <FollowUpDialog items={followUp} onClose={() => setFollowUp(null)} onDone={() => (setSelected(new Set()), load())} />}
      </DialogPresence>
      <DialogPresence>{completing && <QuickCompleteDialog signal={completing} onClose={() => setCompleting(null)} onSaved={load} />}</DialogPresence>
      <DialogPresence>
        {drafting && (
          <DraftDialog record={{ id: drafting.entity.id, title: drafting.entity.title }} purpose={drafting.entity.type === "quotations" ? "quotation_follow_up" : "follow_up"} canNote onClose={() => setDrafting(null)} onSaved={load} />
        )}
      </DialogPresence>
    </div>
  );
}

/* --------------------------------------------------------- My Day digest */

/** A compact Action Center summary for My Day — the same rules, no AI. */
export function ActionDigest({ onOpen }: { onOpen: () => void }) {
  const [view, setView] = useState<ActionCenterView | null>(null);
  const load = useCallback(() => {
    proactive.center("mine", "all").then(setView, () => undefined);
  }, []);
  useEffect(load, [load]);
  useLiveRefresh(load);
  if (!view) return null;
  const counts = SECTIONS.map((s) => ({ ...s, n: view.sections[s.id].length }));
  if (!counts.some((c) => c.n)) return null;
  // Lead and quotation work (follow-ups, quiet or stalled deals, lead data
  // gaps) and today's meetings already appear on My Day — in its follow-ups,
  // the AI suggestions and Today's meetings. Named here: only what they don't show.
  const shownElsewhere = (s: ProactiveSignal) => ["sales", "quotation", "meeting"].includes(s.category) || (s.entity.type === "leads" && s.section === "data");
  const top = [...view.sections.needs_action, ...view.sections.today, ...view.sections.data].filter((s) => !shownElsewhere(s)).slice(0, 3);
  return (
    <section className="panel action-digest" aria-labelledby="action-digest-title">
      <div className="panel-heading">
        <h2 id="action-digest-title">
          <ListChecks size={16} aria-hidden="true" /> Action Center
        </h2>
        <Button className="secondary compact" onClick={onOpen}>
          Open <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
      <dl className="action-digest-counts">
        {counts.map((c) => (
          <div key={c.id}>
            <dt>{c.title}</dt>
            <dd>{c.n}</dd>
          </div>
        ))}
      </dl>
      {top.length > 0 && (
        <ul className="copilot-myday-list">
          {top.map((s) => (
            <li key={s.key}>
              <Button className="record-link" onClick={() => openEntity(s)}>
                <span className="my-day-title">{s.entity.title}</span>
                <small>
                  {SEVERITY[s.severity].label} · {s.label}
                </small>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
