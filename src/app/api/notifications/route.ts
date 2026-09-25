import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { checkOrigin, currentActor } from "@/lib/auth";
import { isId } from "@/lib/collab";
import { publish } from "@/lib/collab-realtime";
import { DEFAULT_PREFERENCES, type NotificationInbox } from "@/lib/notification-types";
import { inbox, readAll, setRead } from "@/lib/notification-store";

/**
 * The reader's own notification inbox. Everything is scoped to the signed-in
 * person by the query itself: there is no id that reaches another person's
 * notifications, and items about things they can no longer see are shown
 * without their details (see notification-store `redact`).
 */

const EMPTY: NotificationInbox = { items: [], unread: 0, nextBefore: null, preferences: DEFAULT_PREFERENCES };
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request) {
  // Preview has no server inbox; it never reads or writes real data.
  if (isPreview()) return NextResponse.json(EMPTY, noStore);
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null && !isId(before)) return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  return NextResponse.json(await inbox(db, actor, before ?? undefined), noStore);
}

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), ids: z.array(z.string().refine(isId)).min(1).max(200) }),
  z.object({ action: z.literal("unread"), ids: z.array(z.string().refine(isId)).min(1).max(200) }),
  z.object({ action: z.literal("read_all"), upTo: z.string().refine(isId) }),
]);

/** Mark read, mark unread, or mark everything read; other devices follow live. */
export async function PATCH(request: Request) {
  try {
    // Preview never writes, whoever asks.
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const c = command.parse(await request.json());
    if (c.action === "read_all") {
      await readAll(db, actor.id, c.upTo);
      await publish([actor.id], { type: "notification.read_all", conversationId: "", upTo: c.upTo });
    } else {
      const read = c.action === "read";
      const ids = await setRead(db, actor.id, c.ids, read);
      if (ids.length) await publish([actor.id], { type: "notification.read", conversationId: "", ids, read });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to update notifications." }, { status: 400 });
  }
}
