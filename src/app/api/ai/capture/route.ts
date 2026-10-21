import { z } from "zod";
import { aiEndpoint } from "@/lib/ai/route";
import { AiError, generateStructured } from "@/lib/ai/gateway";
import { canWrite, type RecordItem } from "@/lib/domain";
import { CAPTURE_FIELDS, verifiedCapture } from "@/lib/ai/capture-fields";
import { redactSensitive, untrusted } from "@/lib/ai/sanitize";

const input = z.object({ text: z.string().trim().min(10).max(2500), company: z.string().min(1).max(40), branch: z.string().min(1).max(80) }).strict();
const output = z.object({ items: z.array(z.object({ field: z.enum(CAPTURE_FIELDS), value: z.string().min(1).max(160), evidence: z.string().min(1).max(300) }).strict()).max(18) }).strict();

/** Explicit-click draft extraction. No other CRM records read or changed. */
export function POST(request: Request) {
  return aiEndpoint(request, async ({ actor, db }) => {
    const body = await request.text();
    if (body.length > 12000) throw new AiError(400, "Paste a shorter inquiry (up to 2,500 characters).");
    const {text, company, branch} = input.parse(JSON.parse(body));
    const draft = { kind: "leads", company, branch, ownerId: actor.id } as RecordItem;
    if (!canWrite(actor, draft)) throw new AiError(403, "Your access does not include creating leads for this brand.");
    const safeText = redactSensitive(text);
    const block = untrusted({source: "inquiry", text: safeText}, 2500);
    const result = await generateStructured({
      db, actor, feature: "lead", tier: "fast", singleAttempt: true,
      instructions: `Extract draft lead fields explicitly present in the inquiry. Each value and its evidence must be exact substrings of the inquiry. Omit ambiguous or missing information. title is the CUSTOMER organisation, never the issuing brand. No owner, brand, status, price, commercial terms, follow-up or dates. quantity and unit must be separate literal substrings from the SAME quantity phrase. Return {"items":[{"field":"email","value":"...","evidence":"..."}]}. Allowed fields: ${CAPTURE_FIELDS.join(", ")}.`,
      prompt: block.rendered, schema: output, jsonSchema: z.toJSONSchema(output, {target: "draft-7"}), flagged: block.flagged ? 1 : 0,
    });
    return { draft: verifiedCapture(safeText, result.data.items), source: "ai", model: result.model };
  });
}
