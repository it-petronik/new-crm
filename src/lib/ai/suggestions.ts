import type { Database } from "../d1";
import { canWrite, stages, type Actor, type RecordItem } from "../domain";
import { findRecord } from "../data";
import { transition } from "../workflow";
import type { AiContext } from "./context";
import { addCalendarYears, gstToday, isCalendarDate } from "./context";
import type { AiAnswer } from "./schema";
import { clip } from "./sanitize";

/**
 * Suggestions the model proposes are only ever PROPOSALS. Each one is
 * checked here against the person's CURRENT rights and the record's rules;
 * what survives is returned with the exact call the person's browser would
 * make to the EXISTING records API — only if they choose to apply it, and
 * that API checks and audits everything again.
 *
 * Never: delete, assign, approve, create orders, change prices, payments.
 * Status changes are proposed for leads only (no side effects there).
 */

export type Suggestion = {
  id: string;
  type: "add_note" | "set_follow_up" | "change_status";
  record: { id: string; kind: string; title: string; status: string; due: string };
  /** What will change, in words. */
  label: string;
  reason: string;
  /** Body for PATCH /api/records — sent only when the person applies it. */
  apply: { action: "note"; id: string; text: string; due?: string } | { action: "status"; id: string; status: string };
};

/** A follow-up date the CRM would accept from AI: today through today + 1 calendar year (GST). */
export function followUpDateAllowed(date: string, today = gstToday()) {
  return isCalendarDate(date) && date >= today && date <= addCalendarYears(today, 1);
}

export async function reviewSuggestions(db: Database, actor: Actor, answer: AiAnswer, context: AiContext): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  for (const [index, s] of answer.suggestions.entries()) {
    const target = context.suggestionTargets.get(s.recordRef);
    if (!target) continue;
    const row = await findRecord(db, target.id);
    const record = row?.payload as RecordItem | undefined;
    if (!record || !canWrite(actor, record)) continue;
    const base = { id: `s${index + 1}`, record: { id: record.id, kind: record.kind, title: record.title, status: record.status, due: record.due }, reason: clip(s.reason, 300) };
    if (s.type === "add_note") {
      const text = clip(s.value, 2000);
      if (!text) continue;
      out.push({ ...base, type: "add_note", label: `Add a note to ${record.title}`, apply: { action: "note", id: record.id, text: `${text}\n\n(Suggested by Enercore AI, reviewed by ${actor.name}.)` } });
    } else if (s.type === "set_follow_up") {
      const date = s.value.trim();
      if (!followUpDateAllowed(date) || date === record.due) continue;
      out.push({ ...base, type: "set_follow_up", label: `Set the next follow-up on ${record.title} to ${date}`, apply: { action: "note", id: record.id, text: `Follow-up scheduled for ${date}: ${base.reason}`, due: date } });
    } else if (s.type === "change_status") {
      if (record.kind !== "leads") continue;
      const status = stages.leads.find((st) => st.toLowerCase() === s.value.trim().toLowerCase());
      if (!status || status === record.status) continue;
      // The CRM's own transition rule decides (a dry run: nothing is saved).
      try {
        transition({ records: [record], audit: [] }, actor, record.id, status);
      } catch {
        continue;
      }
      out.push({ ...base, type: "change_status", label: `Change ${record.title} from ${record.status} to ${status}`, apply: { action: "status", id: record.id, status } });
    }
  }
  return out;
}
