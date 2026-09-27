import { z } from "zod";
import { aiEndpoint } from "@/lib/ai/route";
import { editMeetingSummary, generateMeetingReport, readMeetingReport } from "@/lib/ai/tools/meeting-intelligence";

type Params = { params: Promise<{ id: string }> };

/**
 * Meeting Intelligence (zero-cost mode — no transcript).
 * GET: the stored report — no AI call. POST: generate on an employee's
 * request (the stored report is returned unchanged unless the written record
 * changed or Regenerate is asked for). PATCH: the organiser edits the summary.
 * All three need current access to the meeting; guests have no session here.
 */

export function GET(request: Request, { params }: Params) {
  return aiEndpoint(request, async ({ actor, db }) => readMeetingReport(db, actor, (await params).id), { spend: false });
}

const generate = z.object({ regenerate: z.boolean().default(false) }).strict();
export function POST(request: Request, { params }: Params) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const { regenerate } = generate.parse(await request.json().catch(() => ({})));
    return generateMeetingReport(db, actor, (await params).id, { regenerate });
  });
}

const edit = z.object({ summary: z.string().max(3000) }).strict();
export function PATCH(request: Request, { params }: Params) {
  return aiEndpoint(request, async ({ actor, db }) => editMeetingSummary(db, actor, (await params).id, edit.parse(await request.json()).summary));
}
