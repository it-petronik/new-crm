import { z } from "zod";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { GONE, guestContext, guestJson, resolveLink } from "@/lib/meeting-guest-api";
import type { GuestMeetingInfo } from "@/lib/meetings";

/**
 * POST { token }: what a guest may know before joining — the meeting's
 * title, time, organiser's first name and whether a host admits guests.
 * Nothing else about the organisation, its people or its data.
 */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const body = z.object({ token: z.string().max(100) }).safeParse(await request.json().catch(() => null));
  const link = body.success ? await resolveLink(context.db, body.data.token) : null;
  if (!link) return guestJson({ error: GONE }, 404);
  const organiser = await context.db.select({ name: users.name }).from(users).where(eq(users.id, link.meeting.createdBy)).get();
  const info: GuestMeetingInfo = {
    title: link.meeting.title,
    status: link.meeting.status,
    scheduledAt: link.meeting.scheduledAt?.toISOString() ?? null,
    organiser: (organiser?.name ?? "The organiser").split(" ")[0],
    admission: link.meeting.guestAccess === "open" ? "open" : "admit",
  };
  return guestJson(info);
}
