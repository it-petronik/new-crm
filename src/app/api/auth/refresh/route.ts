import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isPreview } from "@/lib/db";
import { checkOrigin, refreshCookie, refreshSession, sessionCookie } from "@/lib/auth";

/**
 * POST: renew this device's session from its "keep me signed in" cookie —
 * the only credential it accepts. Success sets a new session cookie and a
 * new (rotated) refresh cookie; the JSON carries no token.
 *
 *   200 { ok: true }      renewed
 *   409 { retry: true }   another tab renewed a moment ago; use its cookies
 *   401                   no valid credential — sign in again
 *
 * Preview never authenticates.
 */
export async function POST(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (isPreview()) return NextResponse.json({ error: "Preview has no sign-in." }, { status: 503, headers: noStore });
  try {
    checkOrigin(request);
  } catch {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  }
  const outcome = await refreshSession();
  if (outcome === "renewed") return NextResponse.json({ ok: true }, { headers: noStore });
  if (outcome === "raced") return NextResponse.json({ retry: true }, { status: 409, headers: noStore });
  const jar = await cookies();
  jar.delete(refreshCookie);
  jar.delete(sessionCookie);
  return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers: noStore });
}
