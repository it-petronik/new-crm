import { NextResponse } from "next/server";
import { notifyAccount } from "@/lib/notify";
import { z } from "zod";
import { getDb, isPreview } from "@/lib/db";
import { checkOrigin } from "@/lib/auth";
import {
  findPasswordReset, redeemPasswordReset, recordLoginAttempt,
  PasswordResetConsequenceError,
} from "@/lib/data";
import { hashPassword } from "@/lib/password";
import {
  hashResetToken, looksLikeToken, confirmationFailureLog, MIN_PASSWORD_LENGTH,
} from "@/lib/password-reset";

const input = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

/** One message for absent, expired, already-used and tampered tokens. */
const INVALID = "That reset link is invalid or has expired. Ask an administrator for a new one.";

export async function POST(request: Request) {
  // Tracks how far the request got, so an operator can tell a malformed
  // request from a database failure without any of them being distinguishable
  // to the caller.
  let stage = "origin";
  try {
    checkOrigin(request);
    if (isPreview())
      return NextResponse.json(
        { error: "Password reset requires a configured database." },
        { status: 503 },
      );
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

    stage = "body";
    const body = input.safeParse(await request.json());
    if (!body.success)
      return NextResponse.json(
        { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 },
      );
    const { token, password } = body.data;

    // Cheap shape check first, so a malformed token never reaches the database.
    if (!looksLikeToken(token))
      return NextResponse.json({ error: INVALID }, { status: 400 });

    stage = "lookup";
    const tokenHash = await hashResetToken(token);
    // Limit guessing per token hash rather than per IP, which a proxy can rotate.
    const attempts = await recordLoginAttempt(db, `reset-confirm:${tokenHash.slice(0, 32)}`);
    if (attempts > 10)
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );

    const found = await findPasswordReset(db, tokenHash);
    if (!found || found.reset.expiresAt.getTime() < Date.now() || !found.user.active)
      return NextResponse.json({ error: INVALID }, { status: 400 });

    // Argon2id runs only after a valid token is found, so an invalid token
    // cannot be used to force expensive hashing.
    stage = "hash";
    const passwordHash = await hashPassword(password);
    stage = "redeem";
    // The redemption itself consumes the token, so only one of two concurrent
    // requests can win. The loser gets the same generic message.
    const auditId = crypto.randomUUID();
    const redeemed = await redeemPasswordReset(db, tokenHash, passwordHash, {
      id: auditId,
      company: found.user.companies[0],
      actor: found.user.name,
      actorId: found.user.id,
      action: `Password reset completed (issued by ${found.reset.issuedByName})`,
      recordId: found.user.id,
      subject: "account",
      branch: found.user.branches[0] ?? null,
      // No password, no hash, no token.
    });
    if (!redeemed) return NextResponse.json({ error: INVALID }, { status: 400 });
    await notifyAccount(db, {
      userId: found.user.id,
      actor: null,
      type: "account.password_changed",
      title: "Your password was changed",
      body: "If this wasn't you, tell your administrator straight away.",
      key: `password-changed:${auditId}`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // The response below is byte-identical to the one an unknown or expired
    // token gets, so this adds nothing for the caller to learn from. The
    // record is server-side only and carries no token, hash, password or URL.
    const consumed = error instanceof PasswordResetConsequenceError;
    console.error(
      JSON.stringify(confirmationFailureLog(stage, consumed, consumed ? error.cause : error)),
    );
    return NextResponse.json({ error: INVALID }, { status: 400 });
  }
}
