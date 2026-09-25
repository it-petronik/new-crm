import { NextResponse } from "next/server";

/**
 * The realtime socket is served by the Worker entry (worker.ts), which
 * intercepts this path before Next.js sees it. Reaching this handler means
 * that entry is not in front — local `next dev`, or a build without the
 * collaboration Durable Object — so the client falls back to refreshing on
 * focus instead of retrying in a loop.
 */
export function GET() {
  return NextResponse.json(
    { error: "Live updates are not available in this environment." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
