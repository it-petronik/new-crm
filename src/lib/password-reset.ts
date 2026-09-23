import { type Actor } from "./domain";
import { canManageUsers } from "./domain";
import { inAdminScope, leadership } from "./access-control";

/**
 * Administrator-issued password reset tokens.
 *
 * The raw token exists only in the response that creates it and in the link
 * the administrator passes on. Everything stored or logged is the SHA-256 of
 * it, so neither the database nor the audit trail can be used to reset anyone.
 */

/** 32 bytes = 256 bits, matching the session token. */
const TOKEN_BYTES = 32;

export function createResetToken() {
  return [...crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256, not Argon2id. The token is already high-entropy random so there is
 * nothing to brute force, and a slow hash on an unauthenticated endpoint would
 * be a CPU-exhaustion vector inside the 10ms Workers Free budget.
 */
export async function hashResetToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A token is 64 lowercase hex characters; anything else is rejected early. */
export const looksLikeToken = (value: string) => /^[a-f0-9]{64}$/.test(String(value || ""));

/** Builds the link handed to the administrator. Uses the configured origin. */
export function resetLink(token: string, appUrl = process.env.APP_URL || "") {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/reset-password?token=${token}`;
}

/**
 * Who may issue a reset for whom.
 *
 * Mirrors the target-side rules of `mayAssign`: the actor must administer
 * users, the target must sit inside the actor's company and branch scope, and
 * only an MD may act on another leadership account. Self-issue is refused, so
 * a compromised admin session cannot quietly rewrite its own password; that is
 * what a second administrator is for.
 */
export function mayIssueReset(
  actor: Actor,
  target: { id: string; role: string; companies: string[]; branches: string[]; active: boolean },
) {
  if (!canManageUsers(actor)) return false;
  if (target.id === actor.id) return false;
  if (!target.active) return false;
  if (!inAdminScope(actor, target.companies, target.branches)) return false;
  if (actor.role !== "MD" && leadership.includes(target.role)) return false;
  return true;
}

/** Minutes a link stays valid, surfaced to the administrator. */
export const RESET_TTL_MINUTES = 30;

/** Shared minimum, matching the bootstrap requirement. */
export const MIN_PASSWORD_LENGTH = 14;

/**
 * Reduces an error to one safe log line.
 *
 * Long hex runs are redacted because a reset token, its SHA-256 and the
 * limiter key derived from it are all hex; this is defence in depth, since
 * nothing should place them in an error message in the first place. The result
 * is collapsed to one line and truncated so a log entry stays bounded.
 *
 * This does NOT make arbitrary error text safe. Callers must still withhold
 * detail from stages that can quote the request body, which carries the token
 * and the plaintext password.
 */
export function safeErrorSummary(error: unknown) {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
  return raw
    .replace(/[A-Fa-f0-9]{24,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Stages caused by the caller rather than by this service. A failure at one of
 * these is not an internal fault, and its message can quote the request body —
 * which holds the reset token and the plaintext password — so no detail is
 * recorded for them.
 */
export const CALLER_STAGES = new Set(["origin", "body"]);

/**
 * Builds the one log record emitted when a confirmation fails.
 *
 * Kept here rather than inline in the route so the exact shape, and the
 * promise that it carries no secret, can be tested directly. The caller passes
 * the underlying error; for a consumed token that is the `cause`, not the
 * wrapper.
 */
export function confirmationFailureLog(stage: string, consumed: boolean, error: unknown) {
  const internal = consumed || !CALLER_STAGES.has(stage);
  return {
    event: "password_reset_confirmation_failed",
    // `consequences` is the fail-closed window: the link is already spent and
    // the password did not change, so the user needs a new link.
    stage: consumed ? "consequences" : stage,
    tokenConsumed: consumed,
    ...(internal ? { detail: safeErrorSummary(error) } : {}),
  };
}
