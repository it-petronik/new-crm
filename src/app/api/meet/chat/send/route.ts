import { z } from "zod";
import { isId } from "@/lib/collab";
import { CollabError } from "@/lib/collab-access";
import { GONE, guestContext, guestJson } from "@/lib/meeting-guest-api";
import { admittedGuest } from "@/lib/meeting-guest-chat";
import { announceMeetingMessage, guestRecentCount, postMeetingMessage, toView } from "@/lib/meeting-chat";
import { afterResponse } from "@/lib/collab-realtime";

const GUEST_MESSAGES_PER_MINUTE = 20;

/**
 * POST { secret, body, clientKey }: an admitted guest sends to the meeting
 * chat. The name shown is the one they were admitted under — never taken
 * from this request.
 */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const body = z
    .object({ secret: z.string().max(100), body: z.string().max(8000), clientKey: z.string().refine(isId) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return guestJson({ error: "Message not sent." }, 400);
  const found = await admittedGuest(context.db, body.data.secret);
  if (!found) return guestJson({ error: GONE }, 404);
  if ((await guestRecentCount(context.db, found.guest.id)) >= GUEST_MESSAGES_PER_MINUTE)
    return guestJson({ error: "You're sending messages too quickly. Wait a moment and try again." }, 429);
  try {
    const { row, created } = await postMeetingMessage(context.db, found.meeting, { guestId: found.guest.id, name: found.guest.name }, body.data.body, body.data.clientKey);
    // Announced after the reply, like employees' messages: sending never waits on it.
    if (created) await afterResponse("meeting-message", () => announceMeetingMessage(context.db, found.meeting, row.id));
    return guestJson({ message: toView(row, { guestId: found.guest.id }) }, created ? 201 : 200);
  } catch (e) {
    if (e instanceof CollabError) return guestJson({ error: e.message }, e.status);
    throw e;
  }
}
