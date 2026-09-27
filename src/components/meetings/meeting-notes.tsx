"use client";

import { useEffect, useState } from "react";
import { CheckSquare, Gavel, ListChecks, NotebookPen, Trash2 } from "lucide-react";
import { Button, Input, Textarea } from "../ui/controls";
import { meetingNotesApi, type MeetingNote } from "@/lib/ai/client";
import { businessTime } from "@/lib/gst";

/**
 * Structured meeting notes — the reliable written record of a meeting when
 * there is no transcript. Buttons, not slash commands: Decision, Action item,
 * Customer requirement, Note. Employees only; guests never see this.
 */

type Kind = MeetingNote["kind"];
const KINDS: { kind: Kind; label: string; icon: React.ReactNode }[] = [
  { kind: "decision", label: "Decision", icon: <Gavel size={14} aria-hidden="true" /> },
  { kind: "action", label: "Action item", icon: <CheckSquare size={14} aria-hidden="true" /> },
  { kind: "requirement", label: "Customer requirement", icon: <ListChecks size={14} aria-hidden="true" /> },
  { kind: "note", label: "Note", icon: <NotebookPen size={14} aria-hidden="true" /> },
];
const KIND_LABEL: Record<Kind, string> = { decision: "Decision", action: "Action item", requirement: "Customer requirement", note: "Note" };

const REQ_FIELDS: [string, string, string][] = [
  ["product", "Product", "e.g. Base Oil SN500"],
  ["quantity", "Quantity", "e.g. 500 MT/month"],
  ["destination", "Destination / port", "e.g. Mombasa"],
  ["incoterm", "Incoterm", "e.g. CIF"],
  ["packaging", "Packaging", "e.g. 208L drums"],
  ["paymentTerms", "Payment terms", "e.g. LC at sight"],
  ["deliveryTimeline", "Delivery", "e.g. before 30 Nov"],
  ["targetPrice", "Target price", "only if the customer gave one"],
];
const STATUSES: [string, string][] = [
  ["requested", "Requested by the customer"],
  ["preferred", "Preferred by the customer"],
  ["discussed", "Discussed only"],
  ["proposed", "Proposed by us"],
  ["agreed", "Agreed by both sides"],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);

export function NoteLine({ n }: { n: MeetingNote }) {
  return (
    <>
      <span className={`meet-note-kind is-${n.kind}`}>{KIND_LABEL[n.kind]}</span>
      <span className="meet-note-text">{n.text}</span>
      {n.kind === "action" && (n.data.owner || n.data.due) && (
        <small className="muted">
          {n.data.owner ? `Owner: ${n.data.owner}` : ""}
          {n.data.owner && n.data.due ? " · " : ""}
          {n.data.due ? `Due ${n.data.due}` : ""}
        </small>
      )}
      {n.kind === "requirement" && <small className="meet-note-status">{STATUS_LABEL[n.data.status] ?? "Requested by the customer"} — not an Enercore commitment unless agreed</small>}
      <small className="muted">
        {n.author.name} · {businessTime(new Date(n.createdAt))}
      </small>
    </>
  );
}

export default function MeetingNotes({ meetingId, compact = false }: { meetingId: string; compact?: boolean }) {
  const [notes, setNotes] = useState<MeetingNote[] | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("requested");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    meetingNotesApi.list(meetingId).then(
      (n) => live && setNotes(n),
      (e) => live && setError(e instanceof Error ? e.message : "Couldn't load notes."),
    );
    return () => {
      live = false;
    };
  }, [meetingId]);

  const reset = () => {
    setKind(null);
    setText("");
    setOwner("");
    setDue("");
    setFields({});
    setStatus("requested");
  };
  const save = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setError("");
    try {
      const body =
        kind === "requirement"
          ? { kind, status, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())), ...(text.trim() ? { text } : {}) }
          : kind === "action"
            ? { kind, text, ...(owner.trim() ? { owner } : {}), ...(due ? { due } : {}) }
            : { kind, text };
      const note = await meetingNotesApi.add(meetingId, body);
      setNotes((list) => [...(list ?? []), note]);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: MeetingNote) => {
    try {
      await meetingNotesApi.remove(meetingId, n.id);
      setNotes((list) => (list ?? []).filter((x) => x.id !== n.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the note.");
    }
  };
  const canSave = kind === "requirement" ? Object.values(fields).some((v) => v.trim()) : text.trim().length > 0;

  return (
    // In the room it is its own region; on the report it sits inside the "Meeting notes" card.
    <section className={`meet-notes${compact ? " is-compact" : ""}`} aria-label={compact ? "Meeting notes" : undefined}>
      {!compact && <p className="meet-notes-hint muted">Notes are the meeting&apos;s written record (there is no transcript). Only employees see them.</p>}
      <div className="meet-notes-add" role="group" aria-label="Add a meeting note">
        {KINDS.map((k) => (
          <Button key={k.kind} className={`secondary compact${kind === k.kind ? " is-active" : ""}`} aria-pressed={kind === k.kind} onClick={() => setKind(kind === k.kind ? null : k.kind)}>
            {k.icon} {k.label}
          </Button>
        ))}
      </div>
      {kind && (
        <form
          className="meet-note-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {kind === "requirement" ? (
            <>
              <div className="meet-note-grid">
                {REQ_FIELDS.map(([name, label, placeholder]) => (
                  <label key={name}>
                    {label}
                    <Input value={fields[name] ?? ""} placeholder={placeholder} maxLength={160} onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <label>
                What was said about it
                <select className="ui-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              {KIND_LABEL[kind]}
              <Textarea value={text} rows={2} maxLength={kind === "note" ? 2000 : 1000} onChange={(e) => setText(e.target.value)} />
            </label>
          )}
          {kind === "action" && (
            <div className="meet-note-grid">
              <label>
                Owner (optional)
                <Input value={owner} maxLength={80} onChange={(e) => setOwner(e.target.value)} />
              </label>
              <label>
                Due (optional)
                <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
          )}
          <div className="meet-note-actions">
            <Button type="button" className="secondary compact" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" className="primary compact" disabled={!canSave || busy}>
              {busy ? "Saving…" : `Add ${KIND_LABEL[kind].toLowerCase()}`}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notes === null ? (
        <p className="muted small">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="muted small">No notes yet.</p>
      ) : (
        <ul className="meet-note-list">
          {notes.map((n) => (
            <li key={n.id} id={`note-${n.id}`}>
              <NoteLine n={n} />
              {n.mine && (
                <Button className="icon-button" aria-label={`Remove ${KIND_LABEL[n.kind].toLowerCase()}`} onClick={() => void remove(n)}>
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
