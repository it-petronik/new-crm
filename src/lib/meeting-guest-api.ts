import { NextResponse } from "next/server";
import { isPreview, getDb } from "./db";
import { recordLoginAttempt } from "./data";
import { checkOrigin } from "./auth";
import type { Database } from "./d1";

/**
 * Shared checks for the public guest endpoints (/api/meet/*).
 *
 * These never read or create a CRM session: a guest is identified only by
 * the link token (to ask to join) and then by their own random secret (to
 * learn the host's decision and receive a meeting token). Every answer for
 * an unknown, expired, revoked or finished link is the same short message.
 */

export const GONE = "This meeting link isn't valid anymore. Ask the organiser for a new one.";
export const guestJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function guestContext(request: Request): Promise<{ db: Database } | NextResponse> {
  if (isPreview()) return guestJson({ error: GONE }, 404);
  try {
    checkOrigin(request);
  } catch {
    return guestJson({ error: "Invalid request." }, 403);
  }
  const db = await getDb();
  if (!db) return guestJson({ error: "Meetings are unavailable right now." }, 503);
  if (await guestLimited(db, request)) return guestJson({ error: "Too many attempts. Try again in a few minutes." }, 429);
  return { db };
}

/**
 * Per-client limit on the public guest endpoints. Tokens are 256 random
 * bits, so this is about protecting the service, not about guessing; it is
 * keyed by the client, not the link, so several guests sharing one link
 * (and a page waiting for the meeting to start) are never locked out.
 */
export async function guestLimited(db: Database, request: Request) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return (await recordLoginAttempt(db, `guest-ip:${ip}`, 10 * 60_000)) > 400;
}

export { resolveLink } from "./meeting-links";
