"use client";
import { useState } from "react";
import { Phone, MessageCircle, Mail, Users, FileText, Check } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Input } from "@/components/ui/controls";
import FollowUpControl from "./follow-up-control";
import { followUpPresets } from "@/lib/attention";
import type { RecordItem } from "@/lib/domain";

/**
 * Logging a contact in a few seconds.
 *
 * Before this, recording "I called them" meant opening the full edit form,
 * writing a note and typing a date. That cost is why CRM data goes stale. Here
 * the three things that actually matter — what happened, how it went, when to
 * try again — are one tap each, and the whole thing is a single write through
 * the existing audited note action.
 */

const KINDS = [
  { id: "Called", icon: Phone },
  { id: "WhatsApp", icon: MessageCircle },
  { id: "Email", icon: Mail },
  { id: "Meeting", icon: Users },
  { id: "Note", icon: FileText },
] as const;

/** Common results, so the usual case needs no typing at all. */
const OUTCOMES = ["Interested", "No answer", "Asked for quote", "Not now", "Not interested"];

export default function LogActivity({
  record, onLog, onClose, busy,
}: {
  record: RecordItem;
  /** Writes through the existing dated-note action. */
  onLog: (text: string, due?: string) => Promise<void> | void;
  onClose: () => void;
  busy?: boolean;
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

  return (
    <Dialog onClose={onClose} title="Log activity" className="log-activity-dialog">
      <p className="muted small log-activity-record">{record.title}</p>

      <div className="log-activity-kinds" role="group" aria-label="What happened">
        {KINDS.map(({ id, icon: Icon }) => (
          <Button
            key={id}
            className={`log-activity-kind${id === kind ? " is-active" : ""}`}
            aria-pressed={id === kind}
            onClick={() => setKind(id)}
          >
            <Icon size={15} aria-hidden="true" />
            {id}
          </Button>
        ))}
      </div>

      <div className="log-activity-outcomes" role="group" aria-label="Outcome">
        {OUTCOMES.map((value) => (
          <Button
            key={value}
            className={`log-activity-chip${value === outcome ? " is-active" : ""}`}
            aria-pressed={value === outcome}
            onClick={() => setOutcome(value === outcome ? "" : value)}
          >
            {value}
          </Button>
        ))}
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
        busy={saving}
        onChoose={(date) => setDue(date)}
        onClear={() => setDue(undefined)}
      />
      <p className="muted small">
        {due ? `Next follow-up ${due}` : "No follow-up will be scheduled."}
      </p>

      {error && <div className="form-error" role="alert"><span>{error}</span></div>}

      <DialogActions>
        <Button className="secondary" type="button" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button className="primary" type="button" disabled={saving} onClick={() => void save()}>
          <Check size={16} /> {saving ? "Saving…" : "Log activity"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
