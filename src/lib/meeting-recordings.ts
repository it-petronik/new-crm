import type { RecordingView } from "./meetings";
import type { meetingRecordings } from "./schema";

type RecordingRow = typeof meetingRecordings.$inferSelect;

/** A recording as its authorised readers see it. The URL re-checks access on every request. */
export const recordingView = (r: RecordingRow): RecordingView => ({
  id: r.id,
  startedBy: r.startedBy,
  startedAt: r.startedAt.toISOString(),
  stoppedAt: r.stoppedAt?.toISOString() ?? null,
  durationSeconds: r.durationSeconds ?? (r.stoppedAt ? Math.round((r.stoppedAt.getTime() - r.startedAt.getTime()) / 1000) : null),
  status: r.status,
  url: r.status === "saved" && r.fileKey ? `/api/collab/recordings/${r.id}` : null,
});
