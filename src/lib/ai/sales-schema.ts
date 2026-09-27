import { z } from "zod";
import { NEXT_ACTIONS } from "../sales/signals";
import { REQUIREMENT_FIELDS, STATED_STATUSES } from "../sales/requirements";
import { SUGGESTION_TYPES } from "./schema";
import { SECTION_KEYS, type SectionKey } from "../sales/sections";

export { SECTION_KEYS, SECTION_TITLES, type SectionKey } from "../sales/sections";

/**
 * Sales Copilot output schemas. Like Phase 1: every field required in the
 * JSON schema (Workers AI enforces it while decoding), the format spelled out
 * in the prompt (the model doesn't see the schema), tidied, then validated.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const refs = z.array(z.string().regex(/^R\d{1,3}$/)).max(8);
const item = z.object({ text: text(300), refs });

/** SalesAnswer: lead brief, customer brief, meeting prep, post-meeting review. */
export const salesAnswerSchema = z.object({
  summary: text(600),
  sections: z.array(z.object({ key: z.enum(SECTION_KEYS), items: z.array(item).max(6) })).max(10),
  questions: z.array(text(200)).max(6),
  nextAction: z.object({ action: z.enum([...NEXT_ACTIONS, "none"]), why: z.string().trim().max(300), refs }),
  suggestions: z
    .array(z.object({ type: z.enum(SUGGESTION_TYPES), recordRef: z.string().regex(/^R\d{1,3}$/), value: text(2000), reason: text(300) }))
    .max(3),
  confidence: z.enum(["high", "medium", "low"]),
  missing: z.array(text(200)).max(5),
});
export type SalesAnswer = z.infer<typeof salesAnswerSchema>;
export const salesAnswerJsonSchema = z.toJSONSchema(salesAnswerSchema, { target: "draft-7", io: "output" });

export const salesFormat = (keys: readonly SectionKey[], options: { questions: boolean; nextAction: boolean; suggestions: boolean }) => `Output format — one JSON object with these fields, in this order:
- "summary": 1–3 short sentences (at most 60 words).
- "sections": one object per key, in this order: ${keys.map((k) => `"${k}"`).join(", ")}. Each {"key": the key, "items": up to 5 items {"text": one short sentence, "refs": ["R1", …]}}. Use an empty "items" list when CONTEXT has nothing for that key.
- "questions": ${options.questions ? "up to 6 short questions the employee could ask the customer, about things CONTEXT does not answer" : "[]"}.
- "nextAction": ${options.nextAction ? `{"action": ONE action from the ALLOWED NEXT ACTIONS list, "why": one sentence from the facts, "refs": […]}` : `{"action": "none", "why": "", "refs": []}`}.
- "suggestions": ${options.suggestions ? `up to 3 proposed CRM changes as described in the task, each {"type", "recordRef", "value", "reason"}` : "[]"}.
- "confidence": "high" | "medium" | "low".
- "missing": up to 5 short items CONTEXT doesn't have.
Keep every text short. Proposals only — never write that something was done.`;

/** CommercialRequirement extraction (verified against the source text afterwards). */
export const extractionSchema = z.object({
  items: z
    .array(
      z.object({
        field: z.enum(REQUIREMENT_FIELDS),
        value: text(160),
        evidence: text(240),
        ref: z.string().regex(/^R\d{1,3}$/),
        status: z.enum(STATED_STATUSES),
      }),
    )
    .max(24),
});
export const extractionJsonSchema = z.toJSONSchema(extractionSchema, { target: "draft-7", io: "output" });
export const EXTRACTION_FORMAT = `Output format — {"items": [ … ]}, each item {"field": one of ${REQUIREMENT_FIELDS.map((f) => `"${f}"`).join(", ")}; "value": the value as stated (e.g. "500 MT/month", "CFR", "208L drums"); "evidence": the exact words copied from the text block, 3–30 words; "ref": the ref of the block the evidence is in; "status": what the text says about it — "requested" (the customer asks for or needs it: "we require…", "our requirement is…", "we need…", a target price), "preferred" ("we prefer…"), "discussed" (a question or mention only: "can you do…?", "is … possible?"), "proposed" (our side offered it), "confirmed" or "agreed" (ONLY when the text says it was confirmed or agreed), or "unknown"}. A question is never "agreed". A customer's request is never our acceptance. Only values the text states explicitly. If nothing is stated, return {"items": []}.`;

/** DraftMessage. */
export const draftSchema = z.object({ subject: z.string().trim().max(160), body: text(1500) });
export const draftJsonSchema = z.toJSONSchema(draftSchema, { target: "draft-7", io: "output" });
export const DRAFT_FORMAT = `Output format — {"subject": a short subject line (empty "" unless the channel is email), "body": the message text}.`;

/** Priority explanations (SalesPriority enrichment). */
export const priorityNotesSchema = z.object({
  items: z.array(z.object({ ref: z.string().regex(/^R\d{1,3}$/), why: text(240), action: z.enum(NEXT_ACTIONS) })).max(10),
});
export const priorityNotesJsonSchema = z.toJSONSchema(priorityNotesSchema, { target: "draft-7", io: "output" });
export const PRIORITY_FORMAT = `Output format — {"items": [ … ]}, one per priority in CONTEXT, each {"ref": the priority's reference, "why": one sentence on why it matters today, using only its facts, "action": ONE of that priority's allowed actions}.`;

/** Cuts over-long strings and lists so one long sentence doesn't discard an answer; drops unknown items. */
export function prepareSales(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const a = raw as Record<string, unknown>;
  const cut = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > max ? `${v.trim().slice(0, max - 1)}…` : v);
  const refList = (v: unknown) => (Array.isArray(v) ? v.filter((r) => typeof r === "string" && /^R\d{1,3}$/.test(r)).slice(0, 8) : []);
  const items = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.filter((i) => i && typeof i === "object" && typeof (i as { text?: unknown }).text === "string" && (i as { text: string }).text.trim()).slice(0, max).map((i) => ({ text: cut((i as { text: string }).text, 300), refs: refList((i as { refs?: unknown }).refs) }))
      : [];
  const na = (a.nextAction && typeof a.nextAction === "object" ? a.nextAction : {}) as Record<string, unknown>;
  return {
    ...a,
    summary: cut(a.summary, 600),
    sections: Array.isArray(a.sections)
      ? a.sections
          .filter((s) => s && typeof s === "object" && (SECTION_KEYS as readonly string[]).includes(String((s as { key?: unknown }).key)))
          .slice(0, 10)
          .map((s) => ({ key: (s as { key: string }).key, items: items((s as { items?: unknown }).items, 6) }))
      : [],
    questions: Array.isArray(a.questions) ? a.questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 6).map((q) => cut(q, 200)) : [],
    nextAction: { action: (NEXT_ACTIONS as readonly string[]).includes(String(na.action)) ? na.action : "none", why: typeof na.why === "string" ? cut(na.why, 300) : "", refs: refList(na.refs) },
    suggestions: Array.isArray(a.suggestions)
      ? a.suggestions
          .filter((s) => s && typeof s === "object" && (SUGGESTION_TYPES as readonly string[]).includes(String((s as { type?: unknown }).type)))
          .filter((s) => typeof (s as { recordRef?: unknown }).recordRef === "string" && /^R\d{1,3}$/.test((s as { recordRef: string }).recordRef) && typeof (s as { value?: unknown }).value === "string" && (s as { value: string }).value.trim() && typeof (s as { reason?: unknown }).reason === "string" && (s as { reason: string }).reason.trim())
          .slice(0, 3)
          .map((s) => {
            const x = s as Record<string, string>;
            return { type: x.type, recordRef: x.recordRef, value: cut(x.value, 2000), reason: cut(x.reason, 300) };
          })
      : [],
    confidence: ["high", "medium", "low"].includes(String(a.confidence)) ? a.confidence : "medium",
    missing: Array.isArray(a.missing) ? a.missing.filter((m) => typeof m === "string" && m.trim()).slice(0, 5).map((m) => cut(m, 200)) : [],
  };
}

export function prepareExtraction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const items = (raw as { items?: unknown }).items;
  return {
    items: Array.isArray(items)
      ? items
          .filter((i) => i && typeof i === "object" && (REQUIREMENT_FIELDS as readonly string[]).includes(String((i as { field?: unknown }).field)))
          .filter((i) => ["value", "evidence", "ref"].every((k) => typeof (i as Record<string, unknown>)[k] === "string" && ((i as Record<string, string>)[k]).trim()) && /^R\d{1,3}$/.test((i as { ref: string }).ref.trim()))
          .slice(0, 24)
          .map((i) => {
            const x = i as Record<string, string>;
            const status = (STATED_STATUSES as readonly string[]).includes(String(x.status)) ? x.status : "unknown";
            return { field: x.field, value: x.value.trim().slice(0, 160), evidence: x.evidence.trim().slice(0, 240), ref: x.ref.trim(), status };
          })
      : [],
  };
}
