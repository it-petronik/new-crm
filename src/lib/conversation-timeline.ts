import { callDuration, isDirectCall, scopeLabel, statusLabel, type MeetingView } from "./meetings";

/** Only saved, terminal calls belong in history; a live invitation is not a log. */
export function meetingHistory(meetings: MeetingView[]) {
  return meetings.filter(m => ["ended", "cancelled", "missed"].includes(m.status)).flatMap(meeting => {
    const createdAt = meeting.endedAt || meeting.scheduledAt || meeting.startedAt;
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return [];
    const elapsed = meeting.startedAt && meeting.endedAt ? Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt) : null;
    const unanswered = isDirectCall(meeting) && meeting.attendeeCount < 2;
    return [{ type: "call" as const, id: meeting.id, createdAt, meeting,
      label: scopeLabel(meeting),
      outcome: unanswered && meeting.status === "ended" ? "No answer" : statusLabel[meeting.status],
      // This is the saved call window, not an invented connected-talk duration.
      duration: elapsed !== null && elapsed >= 0 ? callDuration(elapsed) : null,
      durationLabel: unanswered ? "Attempt duration" : "Duration",
    }];
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
