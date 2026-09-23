import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { findUserByEmail, recordLoginAttempt } from "@/lib/data";
import { verifyPassword, dummyHash } from "@/lib/password";
import { checkOrigin, startSession, hashToken, endSession, sessionCookie } from "@/lib/auth";

const credentials = z.object({
  email: z.email().max(191),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const db = await getDb();
    if (isPreview() || !db)
      return NextResponse.json(
        { error: "Credential login requires a configured database." },
        { status: 503 },
      );
    const { email, password } = credentials.parse(await request.json());
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
    await startSession(user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to sign in. Check your details and server configuration." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(sessionCookie)?.value;
    if (token) await endSession(token);
    jar.delete(sessionCookie);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign out." }, { status: 400 });
  }
}
