import { z } from "zod";
import { allowedModules } from "@/lib/domain";
import { AiError } from "@/lib/ai/gateway";
import { aiEndpoint } from "@/lib/ai/route";
import {
  DRAFT_CHANNELS,
  DRAFT_PURPOSES,
  DRAFT_TONES,
  customerBrief,
  draftMessage,
  explainPriorities,
  leadBrief,
  leadSignals,
  meetingPreparation,
  meetingReview,
  quotationPreparation,
  todayPriorities,
} from "@/lib/ai/tools/sales";

/**
 * Sales Copilot. GET tasks are deterministic (signals, priorities — no model,
 * no quota); POST tasks use the model through the Phase 1 gateway, with the
 * same session, origin, preview and rate-limit checks.
 */

type Params = { params: Promise<{ task: string }> };
const id = z.string().min(1).max(100);
const scope = z.enum(["mine", "team"]).default("mine");

const needsSales = (modules: string[]) => {
  if (!modules.includes("leads")) throw new AiError(403, "Sales Copilot needs access to sales leads.");
};

export function GET(request: Request, { params }: Params) {
  return aiEndpoint(
    request,
    async ({ actor, db }) => {
      const task = (await params).task;
      const q = new URL(request.url).searchParams;
      if (task === "today") {
        needsSales(allowedModules(actor));
        return todayPriorities(db, actor, scope.parse(q.get("scope") ?? undefined));
      }
      if (task === "lead") return leadSignals(db, actor, id.parse(q.get("id")));
      throw new AiError(404, "Unknown task.");
    },
    { spend: false },
  );
}

const bodies = {
  today: z.object({ scope }).strict(),
  "lead-brief": z.object({ id }).strict(),
  "quote-prep": z.object({ id }).strict(),
  draft: z.object({ id, channel: z.enum(DRAFT_CHANNELS), tone: z.enum(DRAFT_TONES).default("professional"), purpose: z.enum(DRAFT_PURPOSES).default("follow_up") }).strict(),
  "customer-360": z.object({ id }).strict(),
  "customer-brief": z.object({ id }).strict(),
  "meeting-prep": z.object({ id }).strict(),
  "meeting-review": z.object({ id: z.string().min(1).max(64) }).strict(),
} as const;

export function POST(request: Request, { params }: Params) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const task = (await params).task;
    if (!(task in bodies)) throw new AiError(404, "Unknown task.");
    const raw = await request.json();
    switch (task) {
      case "today": {
        needsSales(allowedModules(actor));
        return explainPriorities(db, actor, bodies.today.parse(raw).scope);
      }
      case "lead-brief":
        return leadBrief(db, actor, bodies["lead-brief"].parse(raw).id);
      case "quote-prep":
        return quotationPreparation(db, actor, bodies["quote-prep"].parse(raw).id);
      case "draft":
        return draftMessage(db, actor, bodies.draft.parse(raw));
      case "customer-360":
        return customerBrief(db, actor, bodies["customer-360"].parse(raw).id, "360");
      case "customer-brief":
        return customerBrief(db, actor, bodies["customer-brief"].parse(raw).id, "precall");
      case "meeting-prep":
        return meetingPreparation(db, actor, bodies["meeting-prep"].parse(raw).id);
      default:
        return meetingReview(db, actor, bodies["meeting-review"].parse(raw).id);
    }
  });
}
