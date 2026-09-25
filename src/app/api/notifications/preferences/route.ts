import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { checkOrigin, currentActor } from "@/lib/auth";
import { savePreferences } from "@/lib/notification-store";

const input = z.object({ desktop: z.boolean(), preview: z.boolean() }).strict();

/**
 * PUT: the reader's own preferences. They change only how notifications
 * are presented (a desktop alert, message text in alerts); every
 * notification — security ones above all — is still recorded in the inbox.
 */
export async function PUT(request: Request) {
  try {
    // Preview never writes, whoever asks.
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    checkOrigin(request);
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    const prefs = input.parse(await request.json());
    await savePreferences(db, actor.id, prefs);
    return NextResponse.json({ preferences: prefs });
  } catch {
    return NextResponse.json({ error: "Unable to save preferences." }, { status: 400 });
  }
}
