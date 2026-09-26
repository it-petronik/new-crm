import { z } from "zod";

/**
 * The only shape an Enercore AI answer may take. The model is constrained
 * to it (JSON schema on Workers AI) and the result is validated again here;
 * anything else is rejected, never shown.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const refs = z.array(z.string().regex(/^R\d{1,3}$/)).max(8).default([]);
const item = z.object({ text: text(400), refs });

export const SUGGESTION_TYPES = ["add_note", "set_follow_up", "change_status"] as const;

export const answerSchema = z.object({
  /** Plain-language answer or summary. */
  summary: text(1500),
  /** Key points, each tied to references. */
  points: z.array(item).max(8).default([]),
  risks: z.array(item).max(5).default([]),
  nextActions: z.array(item).max(6).default([]),
  /** A draft the person can copy and send themselves (never sent by AI). */
  draft: z
    .object({ kind: z.enum(["email", "message", "note"]), subject: z.string().max(160).optional(), body: text(2500) })
    .nullable()
    .default(null),
  /** Proposed CRM changes — only ever applied by the person, through the normal CRM. */
  suggestions: z
    .array(
      z.object({
        type: z.enum(SUGGESTION_TYPES),
        recordRef: z.string().regex(/^R\d{1,3}$/),
        value: text(2000),
        reason: text(300),
      }),
    )
    .max(3)
    .default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  /** What the answer would need but wasn't available. */
  missing: z.array(text(200)).max(5).default([]),
});

export type AiAnswer = z.infer<typeof answerSchema>;

/** JSON schema handed to Workers AI (its JSON mode). */
export const answerJsonSchema = z.toJSONSchema(answerSchema, { target: "draft-7", io: "output" });

/* ------------------------------------------------ management question router */

export const MANAGEMENT_TOOLS = ["pipeline_summary", "overdue_followups", "status_breakdown", "top_open_deals", "receivables", "none"] as const;

export const routeSchema = z.object({
  tool: z.enum(MANAGEMENT_TOOLS),
  company: z.string().max(40).nullable().default(null),
  kind: z.enum(["leads", "quotations", "orders", "logistics", "accounts", "customers"]).nullable().default(null),
  /** Why this tool answers the question (for the audit trail, not shown). */
  because: z.string().max(200).default(""),
});
export type Route = z.infer<typeof routeSchema>;
export const routeJsonSchema = z.toJSONSchema(routeSchema, { target: "draft-7", io: "output" });

/**
 * Tidies the model's raw JSON before validation — never adds anything:
 * suggestions of any type other than the three allowed are DROPPED (a
 * model asking to delete, assign, approve, re-price, record a payment or
 * create an order simply loses that item), invalid references are removed,
 * and over-long lists and text are cut to the schema's limits so one long
 * sentence doesn't discard a whole answer. The shape is still validated.
 */
export function prepareAnswer(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const a = raw as Record<string, unknown>;
  const cut = (v: unknown, max: number) => (typeof v === "string" ? (v.trim().length > max ? `${v.trim().slice(0, max - 1)}…` : v) : v);
  const refList = (v: unknown) => (Array.isArray(v) ? v.filter((r) => typeof r === "string" && /^R\d{1,3}$/.test(r)).slice(0, 8) : []);
  const items = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v
          .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as { text?: unknown }).text === "string" && !!(i as { text: string }).text.trim())
          .slice(0, max)
          .map((i) => ({ text: cut(i.text, 400), refs: refList(i.refs) }))
      : v;
  const draft = a.draft && typeof a.draft === "object" ? { ...(a.draft as Record<string, unknown>), subject: cut((a.draft as Record<string, unknown>).subject, 160), body: cut((a.draft as Record<string, unknown>).body, 2500) } : a.draft;
  return {
    ...a,
    summary: cut(a.summary, 1500),
    points: items(a.points, 8),
    risks: items(a.risks, 5),
    nextActions: items(a.nextActions, 6),
    draft: draft && typeof draft === "object" && (draft as { subject?: unknown }).subject === "" ? { ...draft, subject: undefined } : draft,
    suggestions: Array.isArray(a.suggestions)
      ? a.suggestions
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && (SUGGESTION_TYPES as readonly string[]).includes(String((s as { type?: unknown }).type)))
          .filter((s) => typeof s.recordRef === "string" && /^R\d{1,3}$/.test(s.recordRef) && typeof s.value === "string" && s.value.trim() && typeof s.reason === "string" && s.reason.trim())
          .slice(0, 3)
          .map((s) => ({ type: s.type, recordRef: s.recordRef, value: cut(s.value, 2000), reason: cut(s.reason, 300) }))
      : a.suggestions,
    missing: Array.isArray(a.missing) ? a.missing.filter((m) => typeof m === "string" && m.trim()).slice(0, 5).map((m) => cut(m, 200)) : a.missing,
  };
}

/**
 * The answer format, spelled out for the model. Workers AI enforces the JSON
 * schema while decoding but does not show it to the model, so without this
 * the model writes everything into the first field.
 */
export const ANSWER_FORMAT = `Output format — one JSON object with these fields, in this order:
- "summary": 2–4 short sentences (at most 80 words). The direct answer only.
- "points": up to 6 key facts, each {"text": one sentence, "refs": ["R1", …]} — cite the reference ids the fact comes from.
- "risks": up to 4 risks, each {"text", "refs"}. Empty if none.
- "nextActions": up to 5 concrete next steps, each {"text", "refs"}.
- "draft": null, or {"kind": "email" | "message" | "note", "subject": short subject, "body": the draft text} when the task asks for one. It is only a draft for the employee to review and send themselves.
- "suggestions": up to 3 proposed CRM changes when the task allows them, each {"type": "add_note" | "set_follow_up" | "change_status", "recordRef": "R1", "value": the note text / a date YYYY-MM-DD / a stage name, "reason": one sentence}. Otherwise [].
- "confidence": "high" | "medium" | "low".
- "missing": up to 5 short items the answer would need but CONTEXT doesn't have.
Keep every text short. Never put the whole answer into "summary".`;

export const ROUTE_FORMAT = `Output format — one JSON object: {"tool": one tool name from the list, or "none"; "company": a company name from the allowed list, or null; "kind": "leads" | "quotations" | "orders" | "logistics" | "accounts" | "customers" (status_breakdown only), or null; "because": a few words}.`;
