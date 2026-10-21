"use client";
import { Form } from '@/components/ui/controls';

import { useState } from "react";
import { Button, Field, Select, Textarea } from "../ui/controls";
import FollowUpControl from "../follow-up-control";
import { canWrite, type Actor, type RecordItem } from "@/lib/domain";
import {
  acknowledged,
  awaitingAllocation,
  businessToday,
  leadOutcomes,
  leadType,
  openLead,
  qualificationMissing,
  supplierOpportunity,
  type LeadFeedbackAction,
} from "@/lib/lead-desk";
import { businessStampShort } from "@/lib/gst";
import styles from "./lead-desk.module.css";

export function LeadFeedbackPanel({
  record,
  actor,
  busy,
  onSave,
}: {
  record: RecordItem;
  actor: Actor;
  busy?: boolean;
  onSave: (action: LeadFeedbackAction) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<string>("");
  const [due, setDue] = useState(
    record.due && record.due >= businessToday() ? record.due : businessToday(),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const writable =
    openLead(record) &&
    canWrite(actor, record) &&
    [
      "MD",
      "IT Administrator",
      "Group Manager",
      "Branch Manager",
      "Sales Manager",
      "Sales Executive",
    ].includes(actor.role);
  const missing = qualificationMissing(record);
  async function save(value: string) {
    if (saving || busy) return;
    setError("");
    setSaved("");
    if (value === "Not Relevant" && !note.trim()) {
      setError("Add a short reason so Marketing can improve the next lead.");
      return;
    }
    if (value !== "Acknowledged" && value !== "Not Relevant" && !due) {
      setError("Choose the next follow-up date.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        action: "lead-feedback",
        outcome: value as (typeof leadOutcomes)[number],
        note,
        ...(value !== "Acknowledged" && value !== "Not Relevant"
          ? { due }
          : {}),
      });
      setOutcome("");
      setNote("");
      setSaved(
        value === "Acknowledged"
          ? "Assignment acknowledged. No customer contact has been recorded."
          : "Outcome and follow-up saved. Marketing can see this update.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your update could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className={styles.feedback}
      aria-label={`Lead feedback for ${record.title}`}
    >
      <h3>Next step & feedback</h3>
      <p className={styles.muted}>
        {leadType(record)} ·{" "}
        {awaitingAllocation(record)
          ? "Awaiting sales allocation · open the record and use Assign"
          : acknowledged(record)
            ? "Assignment acknowledged"
            : "Awaiting owner acknowledgement"}
      </p>
      {record.attributes?.leadFeedbackAt && (
        <p className={styles.muted}>
          <strong>{record.attributes.leadOutcome}</strong> ·{" "}
          {record.attributes.leadFeedbackBy} ·{" "}
          {businessStampShort(record.attributes.leadFeedbackAt)}
          {record.attributes.leadFeedbackOwnerId !== record.ownerId
            ? " · Previous assignment"
            : ""}
          {record.attributes.leadFeedbackNote
            ? ` — ${record.attributes.leadFeedbackNote}`
            : ""}
        </p>
      )}
      {!supplierOpportunity(record) && missing.length > 0 && (
        <p className={styles.muted}>
          Before qualification: add {missing.join(", ")}. Capture can stay
          incomplete until these are known.
        </p>
      )}
      {writable && (
        <>
          {!acknowledged(record) && actor.id === record.ownerId && (
            <div>
              <Button
                className="secondary"
                disabled={busy || saving}
                onClick={() => void save("Acknowledged")}
              >
                Acknowledge assignment
              </Button>
            </div>
          )}
          <Field>Conversation outcome
            <Select aria-label="Conversation outcome" value={outcome} disabled={busy || saving} onChange={event => {
              setOutcome(event.target.value); setError(""); setSaved("");
            }}>
              <option value="">Choose what happened</option>
            {leadOutcomes
              .filter(
                (value) =>
                  value !== "Acknowledged" &&
                  !(
                    supplierOpportunity(record) &&
                    ["Waiting for Customer", "Quotation Needed"].includes(value)
                  ),
              )
              .map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </Select>
          </Field>
          {outcome && (
            <Form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void save(outcome);
              }}
            >
              <Field>
                {outcome === "Not Relevant"
                  ? "Reason *"
                  : "Short update (optional)"}
                <Textarea
                  aria-label="Lead feedback note"
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setError("");
                  }}
                  rows={2}
                />
              </Field>
              {outcome !== "Not Relevant" && (
                <FollowUpControl
                  value={due}
                  onChoose={setDue}
                  busy={saving || busy}
                />
              )}
              <p className={styles.muted}>
                Contact outcomes are staff-reported. Acknowledgement and
                unanswered calls do not count as a first customer response.
              </p>
              <div className={styles.actions}>
                <Button
                  className="primary"
                  type="submit"
                  disabled={busy || saving}
                >
                  {saving ? "Saving…" : "Save outcome"}
                </Button>
                <Button
                  className="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setOutcome("");
                    setError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </Form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className={styles.success}>
          {saved}
        </p>
      )}
    </section>
  );
}
