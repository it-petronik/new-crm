"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Dialog, DialogActions, Field, Select } from "./ui/controls";
import type { RecordItem } from "@/lib/domain";

type Candidate = { id: string; name: string; role: string };

/**
 * Hands a record to someone else. The list comes from the server and holds
 * only people who could read the record once it is theirs; the assign
 * action re-checks exactly that, and the new owner is notified live.
 */
export default function AssignDialog({
  record,
  onClose,
  onAssigned,
}: {
  record: RecordItem;
  onClose: () => void;
  onAssigned: (name: string) => Promise<void>;
}) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/records/assignees?id=${encodeURIComponent(record.id)}`, { cache: "no-store" })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "People could not be loaded.");
        return result.people as Candidate[];
      })
      .then((list) => {
        if (!active) return;
        setPeople(list.filter((p) => p.id !== record.ownerId));
      })
      .catch((e: Error) => active && (setPeople([]), setError(e.message)));
    return () => {
      active = false;
    };
  }, [record.id, record.ownerId]);

  async function submit() {
    const person = people?.find((p) => p.id === choice);
    if (!person) {
      setError("Choose who should own this record.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", id: record.id, assigneeId: person.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to assign.");
      await onAssigned(person.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign.");
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Assign ${record.title}`} onClose={() => !busy && onClose()} className="assign-dialog">
      <p className="muted small">Currently with {record.owner}. The new owner is notified straight away.</p>
      <Field>
        Assign to
        <Select
          value={choice}
          disabled={!people || busy || !people.length}
          onChange={(e) => {
            setChoice(e.target.value);
            setError("");
          }}
        >
          {people?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.role}
            </option>
          ))}
        </Select>
      </Field>
      {people === null && <p className="muted small">Loading people…</p>}
      {people?.length === 0 && !error && <p className="muted small">Nobody else can own this record.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <DialogActions
        onCancel={onClose}
        primary={{
          label: "Assign",
          pendingLabel: "Assigning…",
          icon: <UserPlus size={16} aria-hidden="true" />,
          pending: busy,
          disabled: !choice,
          onClick: submit,
        }}
      />
    </Dialog>
  );
}
