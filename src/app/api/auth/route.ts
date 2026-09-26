import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { findUserByEmail, recordLoginAttempt } from "@/lib/data";
import { verifyPassword, dummyHash } from "@/lib/password";
import { checkOrigin, currentActor, startSession, hashToken, endDevice, endEverywhere } from "@/lib/auth";

const credentials = z.object({
  email: z.email().max(191),
  password: z.string().min(1).max(128),
  // "Keep me signed in on this device" — on unless the person unticks it.
  remember: z.boolean().default(true),
});

/** GET: is this browser signed in right now? No details, no secrets. */
export async function GET() {
  const actor = isPreview() ? null : await currentActor();
  return NextResponse.json({ signedIn: !!actor }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const db = await getDb();
    if (isPreview() || !db)
      return NextResponse.json(
        { error: "Credential login requires a configured database." },
        { status: 503 },
      );
    const { email, password, remember } = credentials.parse(await request.json());
    const key = await hashToken(email.trim().toLowerCase());
    // One atomic upsert replaces the former read-then-write transaction.
    const attempts = await recordLoginAttempt(db, key);
    if (attempts > 10)
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    const user = await findUserByEmail(db, email);
    // Always verify something so the timing does not reveal whether the
    // account exists.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !user.active || !valid)
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    await startSession(user.id, remember);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to sign in. Check your details and server configuration." },
      { status: 400 },
    );
  }
}

/**
 * DELETE: sign out this device — its session and its "keep me signed in"
 * credential. With { everywhere: true }, every device of this person.
 */
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => ({}))) as { everywhere?: unknown };
    if (body.everywhere === true) {
      const actor = await currentActor();
      if (actor) await endEverywhere(actor.id);
    }
    await endDevice();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign out." }, { status: 400 });
  }
}
