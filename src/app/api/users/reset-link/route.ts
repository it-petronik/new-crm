import { NextResponse } from "next/server";
import { notifyAccount } from "@/lib/notify";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { checkOrigin, currentActor } from "@/lib/auth";
import { findUserById, issuePasswordReset, recordLoginAttempt, purgeExpiredResets } from "@/lib/data";
import {
  createResetToken, hashResetToken, resetLink, mayIssueReset, RESET_TTL_MINUTES,
} from "@/lib/password-reset";

const input = z.object({ userId: z.string().min(1).max(100) });

/**
 * Administrator-issued reset link. The raw token is returned exactly once and
 * never stored, logged or written to the audit payload.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview())
      return NextResponse.json(
        { error: "Preview uses local fictional data." },
        { status: 409 },
      );
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

    // Rate limit per administrator, reusing the atomic keyed counter.
    const attempts = await recordLoginAttempt(db, `reset-issue:${actor.id}`);
    if (attempts > 10)
      return NextResponse.json(
        { error: "Too many reset links generated. Try again in 15 minutes." },
        { status: 429 },
      );

    const { userId } = input.parse(await request.json());
    const target = await findUserById(db, userId);
    // One message whether the user is absent or out of scope, so this cannot
    // be used to probe which accounts exist.
    if (!target || !mayIssueReset(actor, target))
      return NextResponse.json(
        { error: "You cannot reset that account." },
        { status: 403 },
      );

    await purgeExpiredResets(db);
    const token = createResetToken();
    const auditId = crypto.randomUUID();
    await issuePasswordReset(
      db,
      await hashResetToken(token),
      target.id,
      { id: actor.id, name: actor.name },
      {
        id: auditId,
        company: target.companies[0],
        actor: actor.name,
        actorId: actor.id,
        action: `Issued password reset link for ${target.name}`,
        recordId: target.id,
        subject: "account",
        branch: target.branches[0] ?? null,
        // Deliberately no token, no hash, no password material.
      },
    );
    // No link, token or hash: only that it happened and who did it.
    await notifyAccount(db, {
      userId: target.id,
      actor: { id: actor.id, name: actor.name },
      type: "account.reset_issued",
      title: "A password reset was issued for your account",
      body: `By ${actor.name}. If you didn't ask for this, tell your administrator.`,
      key: `reset-issued:${auditId}`,
    });
    return NextResponse.json({
      link: resetLink(token),
      expiresInMinutes: RESET_TTL_MINUTES,
      user: { id: target.id, name: target.name },
    });
  } catch {
    return NextResponse.json({ error: "Unable to generate a reset link." }, { status: 400 });
  }
}
