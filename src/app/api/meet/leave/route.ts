import { z } from "zod";
import { eq } from "drizzle-orm";
import { meetingGuests } from "@/lib/schema";
import { findGuestBySecret } from "@/lib/meeting-data";
import { guestContext, guestJson } from "@/lib/meeting-guest-api";
import { hashToken, looksLikeToken } from "@/lib/meeting-guests";

/** POST { secret }: the guest left (or gave up waiting). Their secret stops working. */
export async function POST(request: Request) {
  const context = await guestContext(request);
  if (context instanceof Response) return context;
  const body = z.object({ secret: z.string().max(100) }).safeParse(await request.json().catch(() => null));
  if (body.success && looksLikeToken(body.data.secret)) {
    const guest = await findGuestBySecret(context.db, await hashToken(body.data.secret));
    if (guest) await context.db.update(meetingGuests).set({ status: "left" }).where(eq(meetingGuests.id, guest.id)).run();
  }
  return guestJson({ ok: true });
}
