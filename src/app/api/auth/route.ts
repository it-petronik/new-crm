import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, isPreview } from "@/lib/db";
import {
  checkOrigin,
  startSession,
  hashToken,
  sessionCookie,
} from "@/lib/auth";
const credentials = z.object({
  email: z.email().max(191),
  password: z.string().min(1).max(128),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview() || !process.env.DATABASE_URL)
      return NextResponse.json(
        { error: "Credential login requires a configured database." },
        { status: 503 },
      );
    const { email, password } = credentials.parse(await request.json());
    const key = hashToken(email.trim().toLowerCase());
    const blocked = await db.$transaction(async (tx) => {
      const old = await tx.loginAttempt.findUnique({ where: { key } });
      if (!old || old.resetAt < new Date()) {
        await tx.loginAttempt.upsert({
          where: { key },
          create: { key, count: 1, resetAt: new Date(Date.now() + 15 * 60000) },
          update: { count: 1, resetAt: new Date(Date.now() + 15 * 60000) },
        });
        return false;
      }
      const updated = await tx.loginAttempt.update({
        where: { key },
        data: { count: { increment: 1 } },
      });
      return updated.count > 10;
    });
    if (blocked)
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    const valid = await bcrypt.compare(
      password,
      user?.passwordHash ??
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!user || !user.active || !valid)
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    await startSession(user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to sign in. Check your details and server configuration.",
      },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(sessionCookie)?.value;
    if (token && process.env.DATABASE_URL)
      await db.session.deleteMany({ where: { id: hashToken(token) } });
    jar.delete(sessionCookie);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign out." }, { status: 400 });
  }
}
