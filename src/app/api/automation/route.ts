import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { checkOrigin, currentActor } from "@/lib/auth";
import { getDb, isPreview } from "@/lib/db";
import { listRules, previewRule, ruleCandidates, ruleHistory, saveRule } from "@/lib/tasks/automation";
import { PRESETS, type Preset } from "@/lib/tasks/model";
import { TaskError } from "@/lib/tasks/store";

/**
 * Task automation settings. Viewing and editing are checked per company and
 * preset on the server (canViewRules / canEditRule); preview is read-only.
 */

const noStore = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  if (error instanceof TaskError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Check the highlighted fields." }, { status: 400 });
  console.error(JSON.stringify({ event: "automation_request_failed", detail: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  return NextResponse.json({ error: "Couldn't load or save the automation. Try again, or contact IT if this continues." }, { status: 500 });
}

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  if (!db) return NextResponse.json({ error: "Automation needs the live workspace." }, { status: 503 });
  const p = new URL(request.url).searchParams;
  try {
    if (p.get("history")) return NextResponse.json({ runs: await ruleHistory(db, actor, p.get("history")!) }, { headers: noStore });
    if (p.get("candidates")) {
      const preset = (PRESETS as readonly string[]).includes(p.get("preset") || "") ? (p.get("preset") as Preset) : "it_ticket_triage";
      return NextResponse.json({ people: await ruleCandidates(db, actor, p.get("candidates")!, preset) }, { headers: noStore });
    }
    if (p.get("preview")) return NextResponse.json(await previewRule(db, actor, p.get("preview")!), { headers: noStore });
    return NextResponse.json(await listRules(db, actor), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (isPreview()) return NextResponse.json({ error: "Preview uses local fictional data." }, { status: 409 });
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const db = await getDb();
    if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
    return NextResponse.json(await saveRule(db, actor, await request.json()));
  } catch (error) {
    return failure(error);
  }
}
