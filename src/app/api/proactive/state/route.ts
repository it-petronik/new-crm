import { z } from "zod";
import { NextResponse } from "next/server";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { AiError } from "@/lib/ai/gateway";
import { setSignalState } from "@/lib/proactive/service";

/** POST: snooze / dismiss / restore one of MY signals. UI state only — no business data changes. */
const input = z.object({ key: z.string().min(3).max(200), action: z.enum(["snooze", "dismiss", "restore"]), until: z.string().max(40).optional() }).strict();
export async function POST(request: Request) {
  try {
    if (isPreview()) return NextResponse.json({ error: "Not available in preview." }, { status: 409 });
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const body = input.parse(await request.json());
    return NextResponse.json(await setSignalState(db, actor, body.key, body.action, body.until));
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error && e.message.startsWith("Invalid request origin")) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    return NextResponse.json({ error: "Check the request and try again." }, { status: 400 });
  }
}
