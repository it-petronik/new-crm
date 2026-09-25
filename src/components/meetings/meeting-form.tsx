"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarPlus, Search, Video, X } from "lucide-react";
import { Button, DatePicker, Dialog, DialogActions, Field, Input, Select } from "../ui/controls";
import { collabFetch } from "@/lib/collab-client";
import type { ConversationSummary, Person } from "@/lib/collab";
import { createStandalone, openPrejoin, scheduleMeeting, startMeeting, updateMeetingApi } from "@/lib/meeting-client";
import { DURATIONS, MEETING_TITLE_MAX, durationLabel, type InviteeView, type MeetingMedia, type MeetingView } from "@/lib/meetings";
import { businessClock, businessInstant, businessToday } from "@/lib/gst";

/**
 * One form for every way a meeting is made or rescheduled:
 * - in a room ("Schedule a meeting"),
 * - standalone from Meetings → New meeting, with invitees picked from
 *   eligible colleagues and optional guest access,
 * - editing an upcoming meeting's time.
 *
 * [Cancel] [Create meeting] / [Cancel] [Save changes]. A click outside
 * closes it only when nothing typed would be lost and nothing is saving.
 */

type Mode =
  | { kind: "room"; conversation: ConversationSummary }
  | { kind: "standalone" }
  // About a CRM record: standalone, linked to it, its owner invited.
  | { kind: "record"; record: { id: string; title: string; ownerId: string; owner: string }; meId: string; when: "now" | "schedule" }
  | { kind: "edit"; meeting: MeetingView; invitees: InviteeView[] };

const nextHalfHour = () => new Date(Math.ceil((Date.now() + 5 * 60_000) / (30 * 60_000)) * 30 * 60_000);

export default function MeetingForm({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone?: (m: MeetingView) => void }) {
  const editing = mode.kind === "edit" ? mode.meeting : null;
  const start = editing?.scheduledAt ? new Date(editing.scheduledAt) : nextHalfHour();
  const initial = useMemo(
    () => ({
      title: (
        editing?.title ??
        (mode.kind === "room" ? `${mode.conversation.title} meeting` : mode.kind === "record" ? `Meeting with ${mode.record.title}` : "")
      ).slice(0, MEETING_TITLE_MAX),
      when: (mode.kind === "standalone" ? "now" : mode.kind === "record" ? mode.when : "schedule") as "now" | "schedule",
      date: businessToday(start),
      time: businessClock(start),
      duration: String(editing?.durationMin ?? 30),
      media: (editing?.media ?? "video") as MeetingMedia,
      guestAccess: (editing?.guestAccess ?? "off") as "off" | "open" | "admit",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [title, setTitle] = useState(initial.title);
  const [when, setWhen] = useState(initial.when);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(initial.duration);
  const [media, setMedia] = useState<MeetingMedia>(initial.media);
  const [guestAccess, setGuestAccess] = useState(initial.guestAccess);
  const [invitees, setInvitees] = useState<InviteeView[]>(
    mode.kind === "edit"
      ? mode.invitees
      : mode.kind === "record" && mode.record.ownerId !== mode.meId
        ? [{ id: mode.record.ownerId, name: mode.record.owner, role: "Record owner" }]
        : [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The dialog's footer is rendered outside the form: the button names it.
  const formId = useId();

  const standalone = mode.kind === "standalone" || mode.kind === "record" || (mode.kind === "edit" && mode.meeting.scope === "standalone");
  const initialInvitees = mode.kind === "edit" ? mode.invitees.length : mode.kind === "record" && mode.record.ownerId !== mode.meId ? 1 : 0;
  const dirty =
    title !== initial.title || when !== initial.when || date !== initial.date || time !== initial.time || duration !== initial.duration ||
    media !== initial.media || guestAccess !== initial.guestAccess || invitees.length !== initialInvitees;

  async function submit() {
    setError("");
    const cleanTitle = title.trim();
    if (!cleanTitle) return setError("Give the meeting a title.");
    const at = when === "schedule" ? businessInstant(date, time) : null;
    if (when === "schedule" && !at) return setError("Choose a valid date and time.");
    if (at && at.getTime() < Date.now() - 60_000) return setError("Choose a time in the future.");
    const durationMin = duration ? Number(duration) : null;
    setBusy(true);
    try {
      let meeting: MeetingView;
      if (mode.kind === "edit") {
        meeting = (
          await updateMeetingApi(mode.meeting.id, {
            title: cleanTitle,
            ...(at ? { scheduledAt: at.toISOString() } : {}),
            durationMin,
            ...(standalone ? { inviteeIds: invitees.map((i) => i.id) } : {}),
          })
        ).meeting;
      } else if (mode.kind === "room") {
        meeting =
          when === "now"
            ? (await startMeeting(mode.conversation.id, media)).meeting
            : (await scheduleMeeting(mode.conversation.id, { title: cleanTitle, media, scheduledAt: at!.toISOString(), durationMin })).meeting;
      } else {
        meeting = (
          await createStandalone({
            mode: when,
            media,
            title: cleanTitle,
            ...(at ? { scheduledAt: at.toISOString() } : {}),
            durationMin,
            inviteeIds: invitees.map((i) => i.id),
            guestAccess,
            relatedRecordId: mode.kind === "record" ? mode.record.id : null,
          })
        ).meeting;
      }
      onDone?.(meeting);
      onClose();
      if (mode.kind !== "edit" && when === "now") openPrejoin(meeting.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The meeting couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        mode.kind === "edit"
          ? "Edit meeting"
          : mode.kind === "room"
            ? "Schedule a meeting"
            : mode.kind === "record"
              ? mode.when === "now"
                ? "Start a meeting"
                : "Schedule a meeting"
              : "New meeting"
      }
      onClose={() => !busy && onClose()}
      dismissOnOutside={!busy && !dirty}
      className="meet-form-dialog"
    >
      <form
        id={formId}
        className="ui-form-stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field>
          Title
          <Input value={title} maxLength={MEETING_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. Product meeting" />
        </Field>
        {mode.kind === "record" && (
          <p className="small muted meet-form-related">
            About <b>{mode.record.title}</b> — the meeting is linked to it for people who can see it. Guests never see CRM details.
          </p>
        )}
        {mode.kind === "standalone" && (
          <div className="segmented meet-when" role="group" aria-label="When">
            <Button type="button" className={when === "now" ? "selected" : ""} aria-pressed={when === "now"} onClick={() => setWhen("now")}>
              Start now
            </Button>
            <Button type="button" className={when === "schedule" ? "selected" : ""} aria-pressed={when === "schedule"} onClick={() => setWhen("schedule")}>
              Schedule
            </Button>
          </div>
        )}
        {when === "schedule" && (
          <>
            <div className="meet-schedule-row">
              <Field>
                Date
                <DatePicker value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field hint="Gulf Standard Time (GST)">
                Time
                <Input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} required />
              </Field>
            </div>
            <Field>
              Duration
              <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map((d) => (
                  <option key={d} value={String(d)}>
                    {durationLabel(d * 60_000)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {mode.kind !== "edit" && (
          <Field>
            Type
            <Select value={media} onChange={(e) => setMedia(e.target.value as MeetingMedia)}>
              <option value="video">Video meeting</option>
              <option value="voice">Voice meeting</option>
            </Select>
          </Field>
        )}
        {standalone && <InviteePicker value={invitees} onChange={setInvitees} />}
        {(mode.kind === "standalone" || mode.kind === "record") && (
          <Field hint={guestAccess === "off" ? "Only people you invite from Enercore." : "Create the guest link from the meeting's details after saving."}>
            Guests without an Enercore account
            <Select value={guestAccess} onChange={(e) => setGuestAccess(e.target.value as typeof guestAccess)}>
              <option value="off">No guests</option>
              <option value="admit">Guests with a link — host must admit</option>
              <option value="open">Guests with a link — join directly</option>
            </Select>
          </Field>
        )}
        {mode.kind === "room" && (
          <p className="small muted">Everyone in this room can see and join it, and will get a reminder 10 minutes before.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <DialogActions
          onCancel={onClose}
          primary={{
            type: "submit",
            form: formId,
            label: mode.kind === "edit" ? "Save changes" : when === "now" ? "Start meeting" : "Create meeting",
            pendingLabel: mode.kind === "edit" ? "Saving…" : "Creating…",
            pending: busy,
            icon: mode.kind === "edit" ? undefined : when === "now" ? <Video size={16} aria-hidden="true" /> : <CalendarPlus size={16} aria-hidden="true" />,
          }}
        />
      </form>
    </Dialog>
  );
}

/**
 * Pick colleagues to invite: search by name or role among the people the
 * organiser can reach (shared company — the server applies the same rule
 * and refuses anyone else).
 */
function InviteePicker({ value, onChange }: { value: InviteeView[]; onChange: (v: InviteeView[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      collabFetch<{ people: Person[] }>(`/people?q=${encodeURIComponent(q.trim())}`)
        .then((r) => active && setResults(r.people))
        .catch(() => active && setResults([]));
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);
  const chosen = new Set(value.map((v) => v.id));
  const options = results.filter((p) => !chosen.has(p.id)).slice(0, 8);
  return (
    <div className="meet-invitees">
      <span className="ui-field-label">Invite people</span>
      {value.length > 0 && (
        <ul className="meet-invitee-chips" aria-label="Invited">
          {value.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((v) => v.id !== p.id))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="meet-invitee-search">
        <Search size={15} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or role" aria-label="Search people to invite" />
      </label>
      {options.length > 0 && (
        <ul className="meet-invitee-results" role="listbox" aria-label="People">
          {options.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onChange([...value, { id: p.id, name: p.name, role: p.role }])}>
                <b>{p.name}</b>
                <small>{p.role}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
