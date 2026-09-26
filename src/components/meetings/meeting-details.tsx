"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ArrowLeft, Circle, Copy, Download, ExternalLink, FileText, Link2, NotebookPen, RefreshCw, Trash2 } from "lucide-react";
import { Button, DatePicker, Dialog, DialogActions, DialogPresence, Field, Select, Textarea } from "../ui/controls";
import { stages } from "@/lib/domain";
import { useCollabEvents } from "@/lib/collab-client";
import {
  cancelMeeting,
  createGuestLink,
  endMeetingForAll,
  getMeeting,
  openPrejoin,
  internalMeetingUrl,
  openRecord,
  revokeGuestLink,
} from "@/lib/meeting-client";
import { RELATED_NOUN, durationLabel, joinable, scopeLabel, statusLabel, type GuestExpiry, type MeetingDetails, type RelatedRecord } from "@/lib/meetings";
import { businessStamp } from "@/lib/gst";
import MeetingForm from "./meeting-form";
import { CopyMeetingLink } from "./meeting-link";

/**
 * One meeting, in full: when and what it is, who was invited and who came,
 * guest access, recordings — and what the reader may do with it. Kept
 * current by meeting events. Two links, never confused: the GUEST link
 * (/meet/<token>, for people outside Enercore; organisers only) and the
 * INTERNAL link (Collaboration, sign-in required).
 */

const EXPIRY: [GuestExpiry, string][] = [
  ["1h", "1 hour"],
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["meeting_end", "Until the meeting ends"],
];

export default function MeetingDetailsView({ meetingId, meId, onBack, onReport }: { meetingId: string; meId: string; onBack: () => void; onReport: () => void }) {
  const [data, setData] = useState<(MeetingDetails & { available: boolean }) | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"cancel" | "end" | "revoke" | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState<GuestExpiry>("meeting_end");
  const [admission, setAdmission] = useState<"admit" | "open">("admit");
  const [outcome, setOutcome] = useState(false);

  const load = useCallback(() => {
    getMeeting(meetingId)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The meeting couldn't be loaded."));
  }, [meetingId]);
  useEffect(load, [load]);
  // The admission choice starts from the meeting's own rule.
  const rule = data?.meeting.guestAccess;
  useEffect(() => {
    if (rule === "open" || rule === "admit") setAdmission(rule);
  }, [rule]);
  useCollabEvents(true, (event) => event.type.startsWith("meeting.") && "meeting" in event && event.meeting.id === meetingId && load(), load);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setNotice(done);
      setConfirm(null);
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, done = "Copied.") => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setNotice("Copy isn't available here — select the link and copy it.");
    }
  };

  if (error)
    return (
      <section className="meet-page">
        <header className="meet-page-head">
          <Button className="icon-button" aria-label="Back to meetings" onClick={onBack}>
            <ArrowLeft size={18} />
          </Button>
          <h2>Meeting</h2>
        </header>
        <p className="form-error meet-page-note" role="alert">{error}</p>
      </section>
    );
  if (!data)
    return (
      <section className="meet-page">
        <p className="muted small meet-page-note">Loading meeting…</p>
      </section>
    );

  const m = data.meeting;
  const manage = m.canManage;
  const open = m.status === "live" || m.status === "scheduled";
  const length = m.startedAt && m.endedAt ? durationLabel(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) : null;
  const facts: [string, string][] = [
    ["Status", statusLabel[m.status]],
    ["Type", scopeLabel(m)],
    ["Organiser", m.createdBy.name],
    ...(m.conversationTitle ? ([[m.scope === "direct" ? "With" : "Room", m.conversationTitle]] as [string, string][]) : []),
    ...(m.related ? ([[`Related ${RELATED_NOUN[m.related.kind].toLowerCase()}`, m.related.title]] as [string, string][]) : []),
    ...(m.scheduledAt ? ([["Scheduled", `${businessStamp(m.scheduledAt)}${m.durationMin ? ` · ${durationLabel(m.durationMin * 60_000)}` : ""}`]] as [string, string][]) : []),
    ...(m.startedAt ? ([["Started", businessStamp(m.startedAt)]] as [string, string][]) : []),
    ...(m.endedAt ? ([["Ended", businessStamp(m.endedAt)]] as [string, string][]) : []),
    ...(length ? ([["Duration", length]] as [string, string][]) : []),
    ["Guests", m.guestAccess === "off" ? "No guests" : m.guestAccess === "admit" ? "With a link — host admits" : "With a link — join directly"],
    ["Recording", m.recording.active ? "Recording now" : m.recording.available ? `${m.recording.available} saved` : "Not recorded"],
  ];

  return (
    <section className="meet-page meet-details" aria-labelledby="meet-details-title">
      <header className="meet-page-head">
        <Button className="icon-button" aria-label="Back to meetings" onClick={onBack}>
          <ArrowLeft size={18} />
        </Button>
        <h2 id="meet-details-title">{m.title}</h2>
        <span className={`meet-status-pill is-${m.status}`}>{statusLabel[m.status]}</span>
      </header>
      <div className="meet-page-body">
        {notice && (
          <p className="meet-page-toast" role="status">
            {notice}
          </p>
        )}
        <div className="meet-details-actions">
          {(m.status === "live" || (m.status === "scheduled" && joinable(m))) && (
            <Button className="primary" disabled={!data.available} onClick={() => openPrejoin(m.id)}>
              {m.status === "live" ? "Join" : "Start meeting"}
            </Button>
          )}
          {open && (
            <CopyMeetingLink
              meetingId={m.id}
              className="secondary"
              label={manage && m.scope !== "direct" ? "Copy meeting link" : "Copy internal link"}
              onCopied={setNotice}
            />
          )}
          {open && manage && m.scope !== "direct" && (
            <Button className="secondary" onClick={() => void copy(internalMeetingUrl(m.id), "Internal link copied — for people in Enercore (sign-in required).")}>
              <Copy size={15} aria-hidden="true" /> Copy internal link
            </Button>
          )}
          {manage && m.status === "scheduled" && (
            <Button className="secondary" onClick={() => setEditing(true)}>
              Edit schedule
            </Button>
          )}
          {m.related && (
            <Button className="secondary" onClick={() => openRecord(m.related!.kind, m.related!.id)}>
              <ExternalLink size={15} aria-hidden="true" /> Open {RELATED_NOUN[m.related.kind].toLowerCase()}
            </Button>
          )}
          {m.related && (m.status === "ended" || m.status === "live") && (
            <Button className="secondary" onClick={() => setOutcome(true)}>
              <NotebookPen size={15} aria-hidden="true" /> Log outcome
            </Button>
          )}
          {(m.status === "ended" || m.status === "missed" || m.status === "live") && (
            <Button className="secondary" onClick={onReport}>
              <FileText size={15} aria-hidden="true" /> View report
            </Button>
          )}
          {manage && m.status === "scheduled" && (
            <Button className="secondary delete-action" onClick={() => setConfirm("cancel")}>
              Cancel meeting
            </Button>
          )}
          {manage && m.status === "live" && (
            <Button className="secondary delete-action" onClick={() => setConfirm("end")}>
              End meeting
            </Button>
          )}
        </div>

        <dl className="meet-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {manage && open && m.scope !== "direct" && (
          <section className="meet-card" aria-labelledby="guest-access">
            <h3 id="guest-access">
              <Link2 size={15} aria-hidden="true" /> Guest link
            </h3>
            {data.guestLink ? (
              <p className="meet-card-note">
                Active · {data.guestLink.untilMeetingEnd ? "until the meeting ends" : `expires ${businessStamp(data.guestLink.expiresAt!)}`} ·{" "}
                {m.guestAccess === "admit" ? "you admit each guest" : "guests join directly"}
              </p>
            ) : (
              <p className="meet-card-note">No guest link. Guests without an Enercore account can join only with one.</p>
            )}
            {data.guestLink?.url && (
              <>
                <p className="meet-link-label">For clients and other people outside Enercore</p>
                <div className="meet-link-row">
                  <input readOnly value={data.guestLink.url} aria-label="Guest link" onFocus={(e) => e.currentTarget.select()} />
                  <Button className="secondary compact" onClick={() => void copy(data.guestLink!.url!, "Guest link copied — anyone with it can ask to join.")}>
                    Copy
                  </Button>
                </div>
              </>
            )}
            {data.guestLink && !data.guestLink.url && (
              <p className="meet-card-note small">This link was created before links could be shown again. Regenerate to get one you can copy (the old one stops working).</p>
            )}

            <div className="meet-link-controls">
              <Field>
                Expires
                <Select value={expiry} onChange={(e) => setExpiry(e.target.value as GuestExpiry)}>
                  {EXPIRY.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field>
                Guests
                <Select value={admission} onChange={(e) => setAdmission(e.target.value as "admit" | "open")}>
                  <option value="admit">Host must admit</option>
                  <option value="open">Anyone with the link</option>
                </Select>
              </Field>
            </div>
            <div className="meet-details-actions">
              <Button
                className="primary compact"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const r = await createGuestLink(m.id, expiry, admission);
                    await navigator.clipboard?.writeText(r.url).catch(() => {});
                  }, data.guestLink ? "New guest link created and copied. The old link no longer works." : "Guest link created and copied.")
                }
              >
                {data.guestLink ? (
                  <>
                    <RefreshCw size={14} aria-hidden="true" /> Regenerate link
                  </>
                ) : (
                  "Create guest link"
                )}
              </Button>
              {data.guestLink && (
                <Button className="secondary compact delete-action" disabled={busy} onClick={() => setConfirm("revoke")}>
                  <Trash2 size={14} aria-hidden="true" /> Revoke
                </Button>
              )}
            </div>
          </section>
        )}

        {data.invitees.length > 0 && (
          <section className="meet-card" aria-labelledby="meet-invitees">
            <h3 id="meet-invitees">Invited ({data.invitees.length})</h3>
            <ul className="meet-people-list">
              {data.invitees.map((p) => (
                <li key={p.id}>
                  <b>{p.name}</b>
                  <small>{p.role}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="meet-card" aria-labelledby="meet-attendance">
          <h3 id="meet-attendance">Joined ({m.participants.length})</h3>
          {m.participants.length ? (
            <ul className="meet-people-list">
              {m.participants.map((p) => (
                <li key={p.id}>
                  <b>{p.name}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meet-card-note">Nobody has joined yet.</p>
          )}
        </section>

        {data.recordings.length > 0 && (
          <section className="meet-card" aria-labelledby="meet-recordings">
            <h3 id="meet-recordings">
              <Circle size={12} fill="currentColor" aria-hidden="true" /> Recordings
            </h3>
            <ul className="meet-people-list">
              {data.recordings.map((r) => (
                <li key={r.id}>
                  <b>
                    {businessStamp(r.startedAt)} · {r.durationSeconds ? durationLabel(r.durationSeconds * 1000) : "—"}
                  </b>
                  <small>
                    Started by {r.startedBy} ·{" "}
                    {r.status === "saved" ? "Saved" : r.status === "failed" ? "Failed" : r.status === "processing" ? "Processing" : "Recording"}
                  </small>
                  {r.url && (
                    <a className="ui-button secondary compact" href={r.url} download>
                      <Download size={14} aria-hidden="true" /> Download
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <DialogPresence>
        {outcome && m.related && (
          <OutcomeDialog
            meetingTitle={m.title}
            record={m.related}
            onClose={() => setOutcome(false)}
            onDone={(message) => {
              setOutcome(false);
              setNotice(message);
            }}
          />
        )}
        {editing && <MeetingForm mode={{ kind: "edit", meeting: m, invitees: data.invitees }} onClose={() => setEditing(false)} onDone={() => load()} />}
        {confirm === "cancel" && (
          <Dialog title="Cancel this meeting?" onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact">
            <p>Everyone invited will be told it's cancelled. It stays in history.</p>
            <DialogActions
              cancel="Keep meeting"
              onCancel={() => setConfirm(null)}
              primary={{ label: "Cancel meeting", pendingLabel: "Cancelling…", tone: "danger", pending: busy, onClick: () => void act(() => cancelMeeting(m.id), "Meeting cancelled.") }}
            />
          </Dialog>
        )}
        {confirm === "end" && (
          <Dialog title="End the meeting for everyone?" onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact">
            <p>Everyone, including guests, will be disconnected. The history and report are kept.</p>
            <DialogActions
              cancel="Keep meeting"
              onCancel={() => setConfirm(null)}
              primary={{ label: "End for everyone", pendingLabel: "Ending…", tone: "danger", pending: busy, onClick: () => void act(() => endMeetingForAll(m.id), "Meeting ended.") }}
            />
          </Dialog>
        )}
        {confirm === "revoke" && (
          <Dialog title="Revoke the guest link?" onClose={() => !busy && setConfirm(null)} dismissOnOutside={!busy} className="dialog-compact">
            <p>Nobody new can join with it. Guests already in the meeting stay until they leave or you remove them.</p>
            <DialogActions
              cancel="Keep link"
              onCancel={() => setConfirm(null)}
              primary={{
                label: "Revoke link",
                pendingLabel: "Revoking…",
                tone: "danger",
                pending: busy,
                onClick: () =>
                  void act(async () => {
                    await revokeGuestLink(m.id);
                  }, "Guest link revoked."),
              }}
            />
          </Dialog>
        )}
      </DialogPresence>
    </section>
  );
}

/**
 * After the meeting: notes, the next follow-up and (optionally) a new
 * status for the related record — saved through the ordinary records API
 * (the same audited note and status changes as Log activity), so the
 * record's own permissions and workflow rules apply. No separate tasks.
 */
function OutcomeDialog({
  meetingTitle,
  record,
  onClose,
  onDone,
}: {
  meetingTitle: string;
  record: RelatedRecord;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = !!(notes || due || status);

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/records", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.id, ...body }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((result as { error?: string }).error || "The record couldn't be updated.");
  };

  // The dialog's footer is rendered outside the form: the button names it.
  const formId = useId();

  async function save() {
    if (!notes.trim()) return setError("Add what was agreed or discussed.");
    setBusy(true);
    setError("");
    try {
      await patch({ action: "note", text: `Meeting "${meetingTitle}": ${notes.trim()}`.slice(0, 5000), ...(due ? { due } : {}) });
      if (status) await patch({ action: "status", status });
      onDone(`Outcome saved to the ${RELATED_NOUN[record.kind].toLowerCase()}${due ? ` · follow-up ${due}` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The record couldn't be updated.");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Log meeting outcome" onClose={() => !busy && onClose()} dismissOnOutside={!busy && !dirty} className="dialog-compact">
      <form
        id={formId}
        className="ui-form-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="small muted">
          Saved on <b>{record.title}</b> as an activity note, like Log activity.
        </p>
        <Field>
          Outcome and notes
          <Textarea value={notes} rows={4} maxLength={4500} onChange={(e) => setNotes(e.target.value)} required autoFocus />
        </Field>
        <Field hint="Optional — sets the record's next action date.">
          Next follow-up
          <DatePicker value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field hint="Optional — only moves allowed by the record's workflow are saved.">
          Update status
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {stages[record.kind].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogActions onCancel={onClose} primary={{ type: "submit", form: formId, label: "Save outcome", pendingLabel: "Saving…", pending: busy }} />
      </form>
    </Dialog>
  );
}
