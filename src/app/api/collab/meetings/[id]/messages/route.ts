import { z } from "zod";
import { isId } from "@/lib/collab";
import { collabContext, handle, json, rateLimit } from "@/lib/collab-auth";
import { requireMeeting } from "@/lib/meeting-service";
import { announceMeetingMessage, listMeetingMessages, postMeetingMessage, toView } from "@/lib/meeting-chat";
import { afterResponse } from "@/lib/collab-realtime";

type Params = { params: Promise<{ id: string }> };

/**
 * GET: the meeting's chat, for anyone who may open the meeting now (during
 * and after it). `?after=<seq>` returns only newer messages.
 */
export function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, false);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    const after = Number(new URL(request.url).searchParams.get("after"));
    const rows = await listMeetingMessages(db, meeting.id, { after: Number.isSafeInteger(after) && after > 0 ? after : null });
    return json({ messages: rows.map((r) => toView(r, { userId: actor.id })), live: meeting.status === "live" });
  });
}

const input = z.object({ body: z.string().max(8000), clientKey: z.string().refine(isId) }).strict();

/** POST: send a message while the meeting is live. */
export function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, db } = await collabContext(request, true);
    const { meeting } = await requireMeeting(db, actor, (await params).id);
    const { body, clientKey } = input.parse(await request.json());
    await rateLimit(db, actor, "message");
    const { row, created } = await postMeetingMessage(db, meeting, { userId: actor.id, name: actor.name }, body, clientKey);
    if (created) await afterResponse("meeting-message", () => announceMeetingMessage(db, meeting, row.id));
    return json({ message: toView(row, { userId: actor.id }) }, created ? 201 : 200);
  });
}
