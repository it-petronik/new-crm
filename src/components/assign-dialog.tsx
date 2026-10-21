"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Select } from "./ui/controls";
import type { Actor, RecordItem } from "@/lib/domain";
import { previewPeople } from "@/lib/team-preview";
import { mayOwn } from "@/lib/notification-rules";
import { readJsonResponse } from "@/lib/client-request";
import { SkeletonText } from "./ui/skeleton";

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
  previewActor,
  onPreviewAssign,
  onManageTeam,
}: {
  record: RecordItem;
  onClose: () => void;
  onAssigned: (name: string) => Promise<void>;
  previewActor?: Actor;
  onPreviewAssign?: (person: Candidate) => Promise<void>;
  onManageTeam?: () => void;
}) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (previewActor) {
      setPeople(
        previewPeople(previewActor).filter(
          (p) => p.id !== record.ownerId && mayOwn(p, record),
        ),
      );
      return;
    }
    fetch(`/api/records/assignees?id=${encodeURIComponent(record.id)}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const result = await readJsonResponse(
          r,
          "Salespeople could not load. Please try again.",
        );
        if (!r.ok)
          throw new Error(result.error || "People could not be loaded.");
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
      if (onPreviewAssign) {
        await onPreviewAssign(person);
        await onAssigned(person.name);
        return;
      }
      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          id: record.id,
          assigneeId: person.id,
        }),
      });
      const result = await readJsonResponse(
        response,
        "The assignment could not be saved. Please try again.",
      );
      if (!response.ok) throw new Error(result.error || "Unable to assign.");
      await onAssigned(person.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        record.kind === "leads"
          ? "Assign to salesperson"
          : `Assign ${record.title}`
      }
      onClose={() => !busy && onClose()}
      className="assign-dialog"
    >
      <p className="muted small">
        Currently with {record.owner}. The new owner is notified straight away.
      </p>
      <Field>
        {record.kind === "leads" ? "Responsible salesperson" : "Assign to"}
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
      {people === null && <div role="status" aria-label="Preparing salesperson choices"><SkeletonText lines={2}/></div>}
      {people?.length === 0 && !error && (
        <p className="muted small">{record.kind === "leads" ? "No other salesperson is available for this brand. Ask MD or IT to add them in Access control and select this brand." : "Nobody else can own this record."}</p>
      )}
      {record.kind === "leads" && (
        <p className="muted small">
          It appears in their lead list immediately. The person who created it
          can still follow its progress.{" "}
          {onManageTeam && (
            <Button className="text-button" onClick={onManageTeam}>
              Add or manage team
            </Button>
          )}
        </p>
      )}
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
