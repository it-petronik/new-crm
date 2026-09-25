import { z } from "zod";
import { cleanLine } from "@/lib/collab";
import { CollabError, collabContext, handle, json, rateLimit, requireRead } from "@/lib/collab-auth";
import { canManageFor, conversationMeetings, insertMeeting, liveMeeting, meetingViews } from "@/lib/meeting-data";
import { meetingScheduled, meetingStarted } from "@/lib/meeting-service";
import { providerConfig } from "@/lib/livekit-config";
import { DURATIONS, MEETING_TITLE_MAX, defaultTitle, providerRoomName } from "@/lib/meetings";
import { messageId } from "@/lib/collab";

type Params = { params: Promise<{ id: string }> };

/** GET: this conversation's live, upcoming and recent meetings. */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const access = await requireRead(db, actor, (await params).id);
    const rows = await conversationMeetings(db, access.conversation.id);
    return json({
      meetings: await meetingViews(db, rows, canManageFor(actor, access)),
      // Whether the provider is configured here; the UI explains if not.
      available: !!(await providerConfig()),
    });
  });
}

const input = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now"), media: z.enum(["video", "voice"]), title: z.string().max(MEETING_TITLE_MAX * 2).optional() }).strict(),
  z
    .object({
      mode: z.literal("schedule"),
      media: z.enum(["video", "voice"]),
      title: z.string().min(1).max(MEETING_TITLE_MAX * 2),
      scheduledAt: z.iso.datetime({ offset: true }),
      durationMin: z.number().int().refine((n) => DURATIONS.includes(n)).nullable().optional(),
    })
    .strict(),
]);

/**
 * POST: start a meeting now, or schedule one. Only someone who may post in
 * the conversation can; everyone who may read it can see and join it.
 * Starting when one is already live returns that one instead of a second.
 */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const access = await requireRead(db, actor, (await params).id);
    if (!access.canPost) throw new CollabError(403, "You can't start a meeting in this conversation.");
    const body = input.parse(await request.json());
    const c = access.conversation;
    const direct = c.kind === "direct";

    if (body.mode === "now") {
      const existing = await liveMeeting(db, c.id);
      if (existing) return json({ meeting: (await meetingViews(db, [existing], canManageFor(actor, access)))[0], existing: true });
      if (!(await providerConfig())) throw new CollabError(503, "Meetings aren't set up yet. Ask your administrator.");
    }
    await rateLimit(db, actor, "meeting");

    const now = new Date();
    const title = cleanLine(body.title ?? "").slice(0, MEETING_TITLE_MAX) || defaultTitle(body.media, direct, c.name);
    let scheduledAt: Date | null = null;
    if (body.mode === "schedule") {
      scheduledAt = new Date(body.scheduledAt);
      if (scheduledAt.getTime() < now.getTime() - 5 * 60_000) throw new CollabError(400, "Choose a time in the future.");
      if (scheduledAt.getTime() > now.getTime() + 366 * 86_400_000) throw new CollabError(400, "Choose a time within the next year.");
    }
    const row = await insertMeeting(db, {
      id: messageId(now.getTime()),
      conversationId: c.id,
      createdBy: actor.id,
      title,
      kind: body.mode === "now" ? "instant" : "scheduled",
      media: body.media,
      status: body.mode === "now" ? "live" : "scheduled",
      scheduledAt,
      durationMin: body.mode === "schedule" ? (body.durationMin ?? null) : null,
      startedAt: body.mode === "now" ? now : null,
      endedAt: null,
      providerRoom: providerRoomName(),
      reminderSentAt: null,
      createdAt: now,
    });
    if (!row) {
      // Someone else started one at the same moment: the database kept
      // theirs, and this caller joins it.
      const winner = await liveMeeting(db, c.id);
      if (!winner) throw new CollabError(409, "The meeting couldn't be started. Try again.");
      return json({ meeting: (await meetingViews(db, [winner], canManageFor(actor, access)))[0], existing: true });
    }
    if (body.mode === "now") await meetingStarted(db, row, actor, { direct, roomName: c.name });
    else await meetingScheduled(db, row, actor);
    return json({ meeting: (await meetingViews(db, [row], canManageFor(actor, access)))[0] }, 201);
  });
}
