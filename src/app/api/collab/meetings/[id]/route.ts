import { z } from "zod";
import { cleanLine } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { findMeeting, meetingViews, updateMeeting } from "@/lib/meeting-data";
import { announce, requireMeeting } from "@/lib/meeting-service";
import { providerConfig } from "@/lib/livekit-config";
import { afterResponse } from "@/lib/collab-realtime";
import { DURATIONS, MEETING_TITLE_MAX } from "@/lib/meetings";

type Params = { params: Promise<{ id: string }> };

/** GET: one meeting, for its pre-join screen. */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    const [view] = await meetingViews(db, [meeting], () => canManage);
    return json({ meeting: view, available: !!(await providerConfig()) });
  });
}

const change = z
  .object({
    title: z.string().min(1).max(MEETING_TITLE_MAX * 2).optional(),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    durationMin: z.number().int().refine((n) => DURATIONS.includes(n)).nullable().optional(),
    cancel: z.literal(true).optional(),
  })
  .strict();

/** PATCH: reschedule, rename or cancel a scheduled meeting (its managers only). */
export function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can change this meeting.");
    if (meeting.status !== "scheduled") throw new CollabError(409, "Only an upcoming meeting can be changed.");
    const body = change.parse(await request.json());
    const values: Parameters<typeof updateMeeting>[2] = {};
    if (body.cancel) values.status = "cancelled";
    if (body.title !== undefined) values.title = cleanLine(body.title).slice(0, MEETING_TITLE_MAX) || meeting.title;
    if (body.durationMin !== undefined) values.durationMin = body.durationMin;
    if (body.scheduledAt) {
      const at = new Date(body.scheduledAt);
      if (at.getTime() < Date.now() - 5 * 60_000) throw new CollabError(400, "Choose a time in the future.");
      values.scheduledAt = at;
      values.reminderSentAt = null;
    }
    await updateMeeting(db, meeting.id, values);
    const row = (await findMeeting(db, meeting.id))!;
    await afterResponse("meeting-updated", () => announce(db, "meeting.updated", row));
    return json({ meeting: (await meetingViews(db, [row], () => canManage))[0] });
  });
}
