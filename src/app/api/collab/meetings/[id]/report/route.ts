import { collabContext, handle, json } from "@/lib/collab-auth";
import { buildReport } from "@/lib/meeting-report-data";
import { requireMeeting, viewFor } from "@/lib/meeting-service";
import { attachRelated } from "@/lib/meeting-related";
import type { MeetingReport } from "@/lib/meetings";

type Params = { params: Promise<{ id: string }> };

/**
 * GET: the meeting's report, built only from what was recorded: attendance
 * sessions (summed per person, so reconnects count once with their full
 * time), who was invited and who came, and the activity log. No
 * transcripts or summaries are invented. Same access as the meeting.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    const view = (await attachRelated(db, actor, [await viewFor(db, actor, meeting, canManage)], [meeting]))[0];
    const report: MeetingReport = await buildReport(db, meeting, view);
    return json(report);
  });
}
