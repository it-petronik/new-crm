import { z } from "zod";
import { cleanLine, isId } from "@/lib/collab";
import { CollabError, collabContext, handle, json } from "@/lib/collab-auth";
import { findMeeting, listInvitees, recordingsOf, setInvitees, updateMeeting } from "@/lib/meeting-data";
import { eligibleInvitees } from "@/lib/meeting-invitees";
import { evictFromMeetings, inviteesAdded, meetingChanged, announce, requireMeeting, viewFor } from "@/lib/meeting-service";
import { providerConfig, recordingSetup } from "@/lib/livekit-config";
import { afterResponse } from "@/lib/collab-realtime";
import { recordingView } from "@/lib/meeting-recordings";
import { attachRelated } from "@/lib/meeting-related";
import { guestLinkStatus } from "@/lib/meeting-link-status";
import { DURATIONS, MEETING_TITLE_MAX, type MeetingDetails } from "@/lib/meetings";

type Params = { params: Promise<{ id: string }> };

/** GET: one meeting's details, for its pre-join screen and details page. */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    const details: MeetingDetails = {
      meeting: (await attachRelated(db, actor, [await viewFor(db, actor, meeting, canManage)], [meeting]))[0],
      invitees: (await listInvitees(db, meeting.id)).map(({ id, name, role }) => ({ id, name, role })),
      // Only the people who manage the meeting ever see its guest link.
      guestLink: canManage ? await guestLinkStatus(db, meeting) : null,
      recordings: (await recordingsOf(db, meeting.id)).map(recordingView),
      canRecord: canManage && !!(await recordingSetup()),
    };
    return json({ ...details, available: !!(await providerConfig()) });
  });
}

const change = z
  .object({
    title: z.string().min(1).max(MEETING_TITLE_MAX * 2).optional(),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    durationMin: z.number().int().refine((n) => DURATIONS.includes(n)).nullable().optional(),
    inviteeIds: z.array(z.string().refine(isId)).max(200).optional(),
    guestAccess: z.enum(["off", "open", "admit"]).optional(),
    cancel: z.literal(true).optional(),
  })
  .strict();

/**
 * PATCH (managers): rename, reschedule, change invitees or guest access,
 * or cancel an upcoming meeting. Everyone affected is told; anyone removed
 * from a live standalone meeting is disconnected.
 */
export function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting, canManage } = await requireMeeting(db, actor, (await params).id);
    if (!canManage) throw new CollabError(403, "Only the organiser can change this meeting.");
    const body = change.parse(await request.json());
    const open = meeting.status === "scheduled" || meeting.status === "live";
    if (!open) throw new CollabError(409, "This meeting is over.");
    if ((body.cancel || body.scheduledAt) && meeting.status !== "scheduled") throw new CollabError(409, "Only an upcoming meeting can be rescheduled or cancelled.");
    if (body.inviteeIds && meeting.conversationId) throw new CollabError(400, "A room's meeting is for the room's members.");

    const values: Parameters<typeof updateMeeting>[2] = {};
    if (body.cancel) values.status = "cancelled";
    if (body.title !== undefined) values.title = cleanLine(body.title).slice(0, MEETING_TITLE_MAX) || meeting.title;
    if (body.durationMin !== undefined) values.durationMin = body.durationMin;
    if (body.guestAccess) values.guestAccess = body.guestAccess;
    const rescheduled = !!body.scheduledAt && new Date(body.scheduledAt).getTime() !== meeting.scheduledAt?.getTime();
    if (body.scheduledAt) {
      const at = new Date(body.scheduledAt);
      if (at.getTime() < Date.now() - 5 * 60_000) throw new CollabError(400, "Choose a time in the future.");
      values.scheduledAt = at;
      values.reminderSentAt = null;
    }
    if (Object.keys(values).length) await updateMeeting(db, meeting.id, values);

    let added: string[] = [];
    if (body.inviteeIds) {
      const result = await setInvitees(db, meeting.id, await eligibleInvitees(db, actor, body.inviteeIds), actor.id);
      added = result.added;
      for (const id of result.removed) await evictFromMeetings(db, id, undefined, meeting.id);
    }
    const row = (await findMeeting(db, meeting.id))!;
    if (body.cancel) await meetingChanged(db, row, actor, "cancelled");
    else if (rescheduled) await meetingChanged(db, row, actor, "rescheduled");
    else await afterResponse("meeting-updated", () => announce(db, "meeting.updated", row, actor.id));
    if (added.length) await inviteesAdded(db, row, actor, added);
    return json({ meeting: (await attachRelated(db, actor, [await viewFor(db, actor, row, canManage)], [row]))[0] });
  });
}
