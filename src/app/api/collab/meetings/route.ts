import { z } from "zod";
import { eq } from "drizzle-orm";
import { cleanLine, isId, messageId } from "@/lib/collab";
import { CollabError, collabContext, handle, json, rateLimit } from "@/lib/collab-auth";
import { conversationMembers } from "@/lib/schema";
import { insertMeeting, meetingViews, setInvitees, visibleMeetings } from "@/lib/meeting-data";
import { eligibleInvitees } from "@/lib/meeting-invitees";
import { meetingScheduled, meetingStarted } from "@/lib/meeting-service";
import { providerConfig } from "@/lib/livekit-config";
import { attachRelated, linkableRecord, readableRecord } from "@/lib/meeting-related";
import { DURATIONS, MEETING_TITLE_MAX, providerRoomName } from "@/lib/meetings";

/**
 * GET: every meeting the caller may see — their conversations' meetings and
 * standalone meetings they organise or were invited to — for the Meetings
 * page. `canManage` is worked out per meeting for this reader.
 */
export function GET(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    // ?recordId=: a CRM record's meetings — only for someone who may read the
    // record, and even then only the meetings they may already reach.
    const recordId = new URL(request.url).searchParams.get("recordId");
    if (recordId !== null && !(await readableRecord(db, actor, recordId))) throw new CollabError(404, "Record not found.");
    const rows = (await visibleMeetings(db, actor)).filter((r) => recordId === null || r.relatedRecordId === recordId);
    const roles = new Map(
      (await db.select({ id: conversationMembers.conversationId, role: conversationMembers.role }).from(conversationMembers).where(eq(conversationMembers.userId, actor.id)).all()).map((r) => [r.id, r.role]),
    );
    const views = await meetingViews(
      db,
      rows,
      (r) => r.createdBy === actor.id || (!!r.conversationId && (roles.get(r.conversationId) === "owner" || roles.get(r.conversationId) === "admin")),
      actor.id,
    );
    // A DM's either side may manage its call.
    for (const v of views) if (v.scope === "direct") v.canManage = true;
    return json({ meetings: await attachRelated(db, actor, views, rows), available: !!(await providerConfig()) });
  });
}

const input = z
  .object({
    mode: z.enum(["now", "schedule"]),
    media: z.enum(["video", "voice"]),
    title: z.string().min(1).max(MEETING_TITLE_MAX * 2),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    durationMin: z.number().int().refine((n) => DURATIONS.includes(n)).nullable().optional(),
    inviteeIds: z.array(z.string().refine(isId)).max(200).default([]),
    guestAccess: z.enum(["off", "open", "admit"]).default("off"),
    // A lead, customer, quotation or order this meeting is about (optional).
    relatedRecordId: z.string().max(100).nullable().optional(),
  })
  .strict();

/**
 * POST: a standalone meeting — no Collaboration room needed (it has its own meeting chat). The organiser picks
 * colleagues directly; they are invited through notifications and may
 * join; nobody else can. Guests only ever arrive through a guest link.
 */
export function POST(request: Request) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const body = input.parse(await request.json());
    const title = cleanLine(body.title).slice(0, MEETING_TITLE_MAX);
    if (!title) throw new CollabError(400, "Give the meeting a title.");
    const now = new Date();
    let scheduledAt: Date | null = null;
    if (body.mode === "schedule") {
      if (!body.scheduledAt) throw new CollabError(400, "Choose a date and time.");
      scheduledAt = new Date(body.scheduledAt);
      if (scheduledAt.getTime() < now.getTime() - 5 * 60_000) throw new CollabError(400, "Choose a time in the future.");
      if (scheduledAt.getTime() > now.getTime() + 366 * 86_400_000) throw new CollabError(400, "Choose a time within the next year.");
    } else if (!(await providerConfig())) throw new CollabError(503, "Meetings aren't set up yet. Ask your administrator.");
    const invitees = await eligibleInvitees(db, actor, body.inviteeIds);
    const related = await linkableRecord(db, actor, body.relatedRecordId);
    await rateLimit(db, actor, "meeting");

    const row = await insertMeeting(db, {
      id: messageId(now.getTime()),
      conversationId: null,
      createdBy: actor.id,
      title,
      kind: body.mode === "now" ? "instant" : "scheduled",
      media: body.media,
      status: body.mode === "now" ? "live" : "scheduled",
      scheduledAt,
      durationMin: body.durationMin ?? null,
      startedAt: body.mode === "now" ? now : null,
      endedAt: null,
      providerRoom: providerRoomName(),
      reminderSentAt: null,
      createdAt: now,
      guestAccess: body.guestAccess,
      relatedRecordId: related?.id ?? null,
      relatedRecordKind: related?.kind ?? null,
    });
    if (!row) throw new CollabError(409, "The meeting couldn't be created. Try again.");
    await setInvitees(db, row.id, invitees, actor.id);
    if (row.status === "live") await meetingStarted(db, row, actor, { direct: false, roomName: null });
    else await meetingScheduled(db, row, actor);
    return json({ meeting: (await attachRelated(db, actor, await meetingViews(db, [row], () => true, actor.id), [row]))[0] }, 201);
  });
}
