"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogActions, Field, Input, Select } from "@/components/ui/controls";
import FollowUpControl from "./follow-up-control";
import { followUpPresets } from "@/lib/attention";
import type { Actor, RecordItem } from "@/lib/domain";
import { LeadFeedbackPanel } from "./leads/lead-feedback";
import type { LeadFeedbackAction } from "@/lib/lead-desk";

/**
 * Logging a contact in a few seconds.
 *
 * Before this, recording "I called them" meant opening the full edit form,
 * writing a note and typing a date. That cost is why CRM data goes stale. Here
 * the three things that actually matter — what happened, how it went, when to
 * try again — are one tap each, and the whole thing is a single write through
 * the existing audited note action.
 */

const KINDS = ["Called", "WhatsApp", "Email", "Meeting", "Note"] as const;

/** Common results, so the usual case needs no typing at all. */
const OUTCOMES = ["Interested", "No answer", "Asked for quote", "Not now", "Not interested"];

export default function LogActivity({
  record, onLog, onClose, busy, actor, onLeadSave,
}: {
  record: RecordItem;
  /** Writes through the existing dated-note action. */
  onLog: (text: string, due?: string) => Promise<void> | void;
  onClose: () => void;
  busy?: boolean;
  actor?: Actor;
  onLeadSave?: (action: LeadFeedbackAction) => Promise<void>;
}) {
  const [kind, setKind] = useState<string>("Called");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState<string | undefined>(followUpPresets()[1].date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (saving || busy) return;
    setSaving(true);
    setError("");
    try {
      // One line, readable in the record's history without decoding.
      const text = [kind, outcome && `— ${outcome}`, note.trim() && `· ${note.trim()}`]
        .filter(Boolean)
        .join(" ");
      await onLog(text, due);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that activity.");
      setSaving(false);
    }
  }

  if (record.kind === "leads" && actor && onLeadSave) return <Dialog title="Update lead" onClose={onClose}><LeadFeedbackPanel record={record} actor={actor} busy={busy} onSave={async action=>{await onLeadSave(action);onClose();}}/></Dialog>;
  return (
    <Dialog onClose={onClose} title="Log activity" className="log-activity-dialog">
      <p className="muted small log-activity-record">{record.title}</p>

      <div className="activity-choice-grid">
        <Field>Activity type<Select aria-label="Activity type" value={kind} onChange={event => setKind(event.target.value)}>{KINDS.map(value => <option key={value}>{value}</option>)}</Select></Field>
        <Field>Result (optional)<Select aria-label="Activity result" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">No result yet</option>{OUTCOMES.map(value => <option key={value}>{value}</option>)}</Select></Field>
      </div>

      <Field hint="Optional">
        Add a detail
        <Input
          name="note"
          value={note}
          placeholder="Anything worth remembering next time"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <FollowUpControl
        compact
        value={due}
        busy={saving}
        onChoose={(date) => setDue(date)}
        onClear={() => setDue(undefined)}
      />
      <p className="muted small">
        {due ? `Next follow-up ${due}` : "No follow-up will be scheduled."}
      </p>

      {error && <div className="form-error" role="alert"><span>{error}</span></div>}

      <DialogActions
        onCancel={onClose}
        primary={{
          label: "Log activity",
          pendingLabel: "Saving…",
          icon: <Check size={16} aria-hidden="true" />,
          pending: saving,
          onClick: save,
        }}
      />
    </Dialog>
  );
}
