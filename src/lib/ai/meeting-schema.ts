import { z } from "zod";
import { REQUIREMENT_FIELDS, STATED_STATUSES } from "../sales/requirements";

/**
 * Meeting Intelligence output schemas (zero-cost mode: no transcript).
 * Every field is required in the JSON schema, the format is spelled out in
 * the prompt, and the result is tidied, validated, then checked against the
 * cited sources on the server.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const refs = z.array(z.string().regex(/^R\d{1,3}$/)).max(6);
const item = z.object({ text: text(300), refs });

export const meetingExtractionSchema = z.object({
  summary: z.string().trim().max(700),
  keyPoints: z.array(item).max(8),
  decisions: z.array(item).max(8),
  actionItems: z.array(z.object({ task: text(240), owner: z.string().trim().max(80).nullable(), due: z.string().trim().max(10).nullable(), refs })).max(10),
  openQuestions: z.array(item).max(8),
  nextSteps: z.array(item).max(6),
  requirements: z.array(z.object({ field: z.enum(REQUIREMENT_FIELDS), value: text(160), evidence: text(240), ref: z.string().regex(/^R\d{1,3}$/), status: z.enum(STATED_STATUSES) })).max(20),
  followUp: z.object({ date: z.string().trim().max(10).nullable(), ref: z.string().nullable() }),
});
export type MeetingExtraction = z.infer<typeof meetingExtractionSchema>;
export const meetingExtractionJsonSchema = z.toJSONSchema(meetingExtractionSchema, { target: "draft-7", io: "output" });

export const meetingExtractionFormat = (withSummary: boolean) => `Output format — one JSON object with these fields, in this order:
- "summary": ${withSummary ? "2–4 short sentences on what the meeting's written record shows" : '""'}.
- "keyPoints": up to 8 {"text", "refs"} — the main points in the chat and notes.
- "decisions": up to 8 {"text", "refs"} — ONLY what the text states was decided (a Decision note, or "agreed"/"decided"/"we will"). Never "maybe", "should we", "let's consider".
- "actionItems": up to 10 {"task", "owner", "due", "refs"} — "owner" only if the text names who will do it, else null; "due" only as YYYY-MM-DD if the text gives a date, else null.
- "openQuestions": up to 8 {"text", "refs"} — questions asked but not answered.
- "nextSteps": up to 6 {"text", "refs"} — proposals, in future tense.
- "requirements": up to 20 {"field": one of ${REQUIREMENT_FIELDS.map((f) => `"${f}"`).join(", ")}; "value"; "evidence": exact words copied from the text; "ref"; "status": "requested" | "preferred" | "discussed" | "proposed" | "confirmed" | "agreed" | "unknown"}. A customer's question or request is never "agreed"; our side offering something is "proposed".
- "followUp": {"date": YYYY-MM-DD only if the text names a follow-up date, else null; "ref": its source, else null}.
Every "refs"/"ref" must be a reference id listed in CONTEXT. Never write that anyone "said" anything — only what was written.`;

/** Final synthesis over merged, already-verified facts (long meetings only). */
export const meetingSynthesisSchema = z.object({ summary: text(700), keyPoints: z.array(item).max(8), nextSteps: z.array(item).max(6) });
export const meetingSynthesisJsonSchema = z.toJSONSchema(meetingSynthesisSchema, { target: "draft-7", io: "output" });
export const MEETING_SYNTHESIS_FORMAT = `Output format — {"summary": 2–4 short sentences; "keyPoints": up to 8 {"text", "refs"}; "nextSteps": up to 6 {"text", "refs"} in future tense}. Use only the FACTS; cite their references.`;

/** Cuts long text and lists; drops malformed items (the shape is still validated). */
export function prepareMeetingExtraction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const a = raw as Record<string, unknown>;
  const cut = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > max ? `${v.trim().slice(0, max - 1)}…` : v);
  const refList = (v: unknown) => (Array.isArray(v) ? v.filter((r) => typeof r === "string" && /^R\d{1,3}$/.test(r)).slice(0, 6) : []);
  const items = (v: unknown, max: number) =>
    Array.isArray(v) ? v.filter((i) => i && typeof i === "object" && typeof (i as { text?: unknown }).text === "string" && (i as { text: string }).text.trim()).slice(0, max).map((i) => ({ text: cut((i as { text: string }).text, 300), refs: refList((i as { refs?: unknown }).refs) })) : [];
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const fu = (a.followUp && typeof a.followUp === "object" ? a.followUp : {}) as Record<string, unknown>;
  return {
    summary: typeof a.summary === "string" ? cut(a.summary, 700) : "",
    keyPoints: items(a.keyPoints, 8),
    decisions: items(a.decisions, 8),
    actionItems: Array.isArray(a.actionItems)
      ? a.actionItems
          .filter((i) => i && typeof i === "object" && typeof (i as { task?: unknown }).task === "string" && (i as { task: string }).task.trim())
          .slice(0, 10)
          .map((i) => {
            const x = i as Record<string, unknown>;
            return { task: cut(x.task, 240), owner: str(x.owner, 80), due: str(x.due, 10), refs: refList(x.refs) };
          })
      : [],
    openQuestions: items(a.openQuestions, 8),
    nextSteps: items(a.nextSteps, 6),
    requirements: Array.isArray(a.requirements)
      ? a.requirements
          .filter((i) => i && typeof i === "object" && (REQUIREMENT_FIELDS as readonly string[]).includes(String((i as { field?: unknown }).field)))
          .filter((i) => ["value", "evidence", "ref"].every((k) => typeof (i as Record<string, unknown>)[k] === "string" && ((i as Record<string, string>)[k]).trim()) && /^R\d{1,3}$/.test((i as { ref: string }).ref.trim()))
          .slice(0, 20)
          .map((i) => {
            const x = i as Record<string, string>;
            return { field: x.field, value: x.value.trim().slice(0, 160), evidence: x.evidence.trim().slice(0, 240), ref: x.ref.trim(), status: (STATED_STATUSES as readonly string[]).includes(String(x.status)) ? x.status : "unknown" };
          })
      : [],
    followUp: { date: str(fu.date, 10), ref: typeof fu.ref === "string" && /^R\d{1,3}$/.test(fu.ref) ? fu.ref : null },
  };
}
