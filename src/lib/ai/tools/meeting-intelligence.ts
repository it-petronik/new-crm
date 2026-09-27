import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../d1";
import { CollabError } from "../../collab-access";
import { canRead, canWrite, stages, type Actor, type RecordItem } from "../../domain";
import { findRecord } from "../../data";

import { businessStamp, businessTime } from "../../gst";
import { listMeetingNotes, NOTE_REQUIREMENT_FIELDS, requirementText } from "../../meeting-notes";
import { buildReport } from "../../meeting-report-data";
import { meetingViews } from "../../meeting-data";
import { attachRelated } from "../../meeting-related";
import { requireMeeting } from "../../meeting-service";
import { durationLabel, statusLabel } from "../../meetings";
import { meetingReports, users } from "../../schema";
import {
  CLAIM_LABELS,
  REQUIREMENT_LABELS,
  STATED_STATUSES,
  buildProfile,
  isSettledStatus,
  verifyExtracted,
  type ClaimStatus,
  type RequirementField,
  type RequirementValue,
} from "../../sales/requirements";
import { followUpDateAllowed } from "../suggestions";
import { transition } from "../../workflow";
import { unsupportedCompletion } from "../../sales/safety";
import { AiContext, isCalendarDate } from "../context";
import { AiError, generateStructured } from "../gateway";
import {
  MEETING_SYNTHESIS_FORMAT,
  meetingExtractionFormat,
  meetingExtractionJsonSchema,
  meetingExtractionSchema,
  meetingSynthesisJsonSchema,
  meetingSynthesisSchema,
  prepareMeetingExtraction,
  type MeetingExtraction,
} from "../meeting-schema";
import type { Suggestion } from "../suggestions";
import { requirementUpdateSuggestion } from "./sales";

/**
 * Meeting Intelligence — ZERO-COST MODE. There is no transcript: the report
 * is built only from the meeting's written record (details, attendance,
 * Meeting Chat, structured meeting notes). It is generated only when an
 * employee asks, persisted, and read back with no AI call.
 *
 * The stored report uses meeting sources only, so anyone who may open the
 * meeting may read it. Lead-specific suggestions are derived per viewer at
 * read time (deterministically — no AI), only for a lead that viewer may read.
 */

export const REPORT_VERSION = 1;
export const NO_TRANSCRIPT_REPORT = "No transcript is available. This report uses meeting details, attendance and Meeting Chat.";
const CHUNK_CHARS = 6_000;
const MAX_CHUNKS = 6;

/** What the report's references point at (all within the meeting). */
export type ReportSource = { kind: "chat" | "note" | "meeting"; id: string; label: string; speaker: string | null; guest: boolean; at: string | null };
type Cited = { text: string; refs: string[] };
export type StoredReport = {
  version: number;
  scope: string;
  coverage: { chatMessages: number; notes: number; analysedMessages: number; truncated: boolean };
  summary: string;
  keyPoints: Cited[];
  decisions: Cited[];
  actionItems: { task: string; owner: string | null; due: string | null; refs: string[] }[];
  openQuestions: Cited[];
  nextSteps: Cited[];
  requirements: { field: RequirementField; label: string; value: string; status: ClaimStatus; statusLabel: string; source: string; ref: string; at: string | null }[];
  followUp: { date: string; ref: string } | null;
  sources: Record<string, ReportSource>;
  history: { version: number; generatedAt: string; models: string; generatedBy: string }[];
};

const notFound = (e: unknown) => (e instanceof CollabError ? new AiError(404, "Meeting not found.") : e);

/* ------------------------------------------------------------ sources */

async function meetingInputs(db: Database, actor: Actor, id: unknown) {
  let found;
  try {
    found = await requireMeeting(db, actor, id);
  } catch (e) {
    throw notFound(e);
  }
  const { meeting } = found;
  const [view] = await attachRelated(db, actor, await meetingViews(db, [meeting]), [meeting]);
  const report = await buildReport(db, meeting, view);
  const noteRows = await listMeetingNotes(db, meeting.id);
  const authorIds = [...new Set(noteRows.map((n) => n.authorId))];
  const names = new Map((authorIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds)).all() : []).map((u) => [u.id, u.name]));
  const notes = noteRows.map((n) => ({ ...n, author: names.get(n.authorId) ?? "Former employee", data: (n.data ?? {}) as Record<string, string> }));
  const chat = report.chat.filter((c) => !c.deleted && c.body.trim());
  return { meeting, view, report, notes, chat };
}
type Inputs = Awaited<ReturnType<typeof meetingInputs>>;

/** The fingerprint of the written record: any change to it marks a report stale. */
async function fingerprintOf(i: Inputs) {
  const basis = JSON.stringify([
    REPORT_VERSION,
    i.meeting.status,
    i.meeting.endedAt?.getTime() ?? null,
    i.chat.map((c) => [c.id, c.body]),
    i.notes.map((n) => [n.id, n.kind, n.text, n.data]),
    i.report.participants.map((p) => [p.name, p.totalSeconds]),
  ]);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Meeting facts shared by every chunk (no CRM data: the report is meeting-only). */
function meetingFacts(ctx: AiContext, i: Inputs, meetingRef: string) {
  const m = i.meeting;
  ctx.fact("Meeting", `${m.title} — ${statusLabel[m.status]}`, meetingRef);
  ctx.fact("Organiser", i.view.createdBy.name, meetingRef);
  if (m.startedAt) ctx.fact("Started", businessStamp(m.startedAt), meetingRef);
  if (m.startedAt && m.endedAt) ctx.fact("Duration", durationLabel(m.endedAt.getTime() - m.startedAt.getTime()), meetingRef);
  ctx.fact("Attended", i.report.participants.length ? i.report.participants.map((p) => `${p.name}${p.kind === "guest" ? " (guest)" : ""}`).join(", ") : "nobody joined", meetingRef);
  ctx.fact("Not available", "no transcript, no recording, no audio — only the written record (Meeting Chat and meeting notes)");
}

type Item = { key: string; source: ReportSource; text: string };

/** Every textual item, oldest first: chat messages and meeting notes. */
function textualItems(i: Inputs): Item[] {
  const chat: Item[] = i.chat.map((c) => ({
    key: `chat-${c.id}`,
    source: { kind: "chat", id: c.id, label: `Meeting Chat · ${c.name}${c.guest ? " (Guest)" : ""} · ${businessTime(new Date(c.at))}`, speaker: c.name, guest: c.guest, at: c.at },
    text: c.body,
  }));
  const notes: Item[] = i.notes.map((n) => ({
    key: `note-${n.id}`,
    source: { kind: "note", id: n.id, label: `Meeting note (${n.kind}) · ${n.author} · ${businessTime(n.createdAt)}`, speaker: n.author, guest: false, at: n.createdAt.toISOString() },
    text: n.kind === "action" ? `${n.text}${n.data.owner ? ` — owner: ${n.data.owner}` : ""}${n.data.due ? ` — due ${n.data.due}` : ""}` : n.kind === "requirement" ? `${requirementText(n.data)} (${n.data.status ?? "requested"})` : n.text,
  }));
  return [...chat, ...notes].sort((a, b) => (a.source.at ?? "").localeCompare(b.source.at ?? ""));
}

/** Bounded chunks, never splitting an item; the newest items win if there are too many. */
export function chunkItems<T extends { text: string }>(items: T[], budget = CHUNK_CHARS, max = MAX_CHUNKS) {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const it of items) {
    const len = Math.min(it.text.length, 1_500) + 80;
    if (current.length && size + len > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(it);
    size += len;
  }
  if (current.length) chunks.push(current);
  return { chunks: chunks.slice(-max), truncated: chunks.length > max };
}

/* ------------------------------------------------------ verification */

const HEDGE = /\b(?:maybe|might|perhaps|possibly|should we|could we|shall we|consider|let'?s see|not sure|probably|would it|what if)\b/i;

/**
 * Checks one chunk's extraction against its own sources: references must
 * exist; decisions need non-hedged support (or a Decision note); an owner
 * must be named in the cited text; requirements must quote their source
 * (Phase 2 rules, status capped by the sentence); nothing may claim an event
 * the text doesn't record.
 */
export function verifyChunk(x: MeetingExtraction, refMap: Map<string, Item>) {
  const known = (refs: string[]) => refs.filter((r) => refMap.has(r));
  const textOf = (refs: string[]) => refs.map((r) => refMap.get(r)!.text).join("\n");
  const all = [...refMap.values()].map((v) => v.text).join("\n");
  const cited = (list: Cited[]) =>
    list
      .map((c) => ({ text: c.text, refs: known(c.refs) }))
      .filter((c) => c.refs.length && !unsupportedCompletion(c.text, textOf(c.refs)));
  const decisions = cited(x.decisions).filter((d) => d.refs.some((r) => refMap.get(r)!.key.startsWith("note-") && refMap.get(r)!.source.label.includes("(decision)")) || !HEDGE.test(textOf(d.refs)));
  const actionItems = x.actionItems
    .map((a) => {
      const refs = known(a.refs);
      const src = textOf(refs).toLowerCase();
      const owner = a.owner && src.includes(a.owner.toLowerCase().split(" ")[0]) ? a.owner : null;
      const due = a.due && isCalendarDate(a.due) && src.includes(a.due) ? a.due : a.due && isCalendarDate(a.due) && refs.some((r) => refMap.get(r)!.text.includes(`due ${a.due}`)) ? a.due : null;
      return { task: a.task, owner, due, refs };
    })
    .filter((a) => a.refs.length && !unsupportedCompletion(a.task, textOf(a.refs)));
  const sources = new Map([...refMap].map(([ref, it]) => [ref, { label: it.source.label, kind: (it.source.kind === "note" ? "meeting_note" : "meeting_chat") as "meeting_note" | "meeting_chat", text: it.text }]));
  const requirements = verifyExtracted(x.requirements, sources).kept.map((k) => ({ ...k, at: refMap.get(k.value.source.ref!)?.source.at ?? null, key: refMap.get(k.value.source.ref!)!.key }));
  const followUp = x.followUp.date && x.followUp.ref && refMap.has(x.followUp.ref) && isCalendarDate(x.followUp.date) ? { date: x.followUp.date, key: refMap.get(x.followUp.ref)!.key } : null;
  return {
    summary: unsupportedCompletion(x.summary, all) ? "" : x.summary,
    keyPoints: cited(x.keyPoints),
    decisions,
    actionItems,
    openQuestions: cited(x.openQuestions),
    nextSteps: cited(x.nextSteps),
    requirements,
    followUp,
  };
}

/* ---------------------------------------------------------- generation */

export async function generateMeetingReport(db: Database, actor: Actor, id: unknown, options: { regenerate: boolean }) {
  const i = await meetingInputs(db, actor, id);
  if (i.meeting.status !== "ended") throw new AiError(409, "The AI report is available once the meeting has ended.");
  const fingerprint = await fingerprintOf(i);
  const existing = await db.select().from(meetingReports).where(eq(meetingReports.meetingId, i.meeting.id)).get();
  // Same written record and no explicit Regenerate: the stored report, no AI call.
  if (existing && !options.regenerate && existing.fingerprint === fingerprint) return readMeetingReport(db, actor, i.meeting.id);

  const items = textualItems(i);
  const models = new Set<string>();
  const { chunks, truncated } = chunkItems(items);
  const refKeys = new Map<string, string>(); // global key → stable global ref id (G1, G2…)
  const sources: Record<string, ReportSource> = {};
  const globalRef = (it: Item) => {
    if (!refKeys.has(it.key)) {
      const ref = `S${refKeys.size + 1}`;
      refKeys.set(it.key, ref);
      sources[ref] = it.source;
    }
    return refKeys.get(it.key)!;
  };
  const merged = { summary: "", keyPoints: [] as Cited[], decisions: [] as Cited[], actionItems: [] as StoredReport["actionItems"], openQuestions: [] as Cited[], nextSteps: [] as Cited[], requirements: [] as { field: RequirementField; value: RequirementValue; at: string | null; key: string }[], followUp: null as { date: string; key: string } | null };

  const requirementNoteKeys = new Set(i.notes.filter((n) => n.kind === "requirement").map((n) => `note-${n.id}`));
  // FAST model per chunk (one call for a typical meeting), references kept throughout.
  for (const chunk of chunks) {
    const ctx = new AiContext(`Meeting ${i.meeting.title}`);
    const meetingRef = ctx.ref(`Meeting: ${i.meeting.title}`, { type: "meeting", id: i.meeting.id, view: "report" });
    meetingFacts(ctx, i, meetingRef);
    const refMap = new Map<string, Item>();
    for (const it of chunk) {
      const ref = ctx.ref(it.source.label, { type: "meeting", id: i.meeting.id, view: "report", anchor: it.key });
      refMap.set(ref, it);
      ctx.text(it.source.kind === "chat" ? (it.source.guest ? "meeting_chat_guest" : "meeting_chat") : "meeting_note", `${it.source.label}: ${it.text}`, ref);
    }
    const single = chunks.length === 1;
    const r = await generateStructured({
      db,
      actor,
      feature: "meeting",
      tier: "fast",
      instructions: `Build meeting notes from the meeting's WRITTEN record only (Meeting Chat messages and meeting notes). There is no transcript and no audio: never write that anyone "said" or "discussed" something beyond what they wrote, and never imply audio or video was analysed. Guests (marked "(Guest)") are the customer's side; everyone else is Enercore staff.

${meetingExtractionFormat(single)}`,
      prompt: `CONTEXT:\n${ctx.render()}`,
      schema: meetingExtractionSchema,
      jsonSchema: meetingExtractionJsonSchema,
      prepare: prepareMeetingExtraction,
      flagged: ctx.flagged,
    });
    models.add(r.model);
    const v = verifyChunk(r.data, refMap);
    const toGlobal = (refs: string[]) => refs.map((ref) => globalRef(refMap.get(ref)!));
    if (single) merged.summary = v.summary;
    merged.keyPoints.push(...v.keyPoints.map((c) => ({ text: c.text, refs: toGlobal(c.refs) })));
    merged.decisions.push(...v.decisions.map((c) => ({ text: c.text, refs: toGlobal(c.refs) })));
    merged.actionItems.push(...v.actionItems.map((a) => ({ ...a, refs: toGlobal(a.refs) })));
    merged.openQuestions.push(...v.openQuestions.map((c) => ({ text: c.text, refs: toGlobal(c.refs) })));
    merged.nextSteps.push(...v.nextSteps.map((c) => ({ text: c.text, refs: toGlobal(c.refs) })));
    // Typed requirement notes are added exactly below; the model's reading of the same note is not counted twice.
    // Chunk-local references (R#) become global ones (S#) before anything is merged.
    const byKey = new Map([...refMap.values()].map((x) => [x.key, x]));
    merged.requirements.push(
      ...v.requirements
        .filter((req) => !requirementNoteKeys.has(req.key))
        .map((req) => ({ ...req, value: { ...req.value, source: { ...req.value.source, ref: globalRef(byKey.get(req.key)!) } } })),
    );
    if (v.followUp) {
      merged.followUp = v.followUp;
      globalRef([...refMap.values()].find((x) => x.key === v.followUp!.key)!);
    }
  }

  // Requirement notes are typed by employees: exact values, with the status they chose — no AI needed.
  for (const n of i.notes.filter((n) => n.kind === "requirement")) {
    const it = items.find((x) => x.key === `note-${n.id}`)!;
    const status = (STATED_STATUSES as readonly string[]).includes(n.data.status) ? (n.data.status as ClaimStatus) : "requested";
    for (const [field, value] of Object.entries(n.data))
      if (field !== "status" && (NOTE_REQUIREMENT_FIELDS as readonly string[]).includes(field) && value?.trim())
        merged.requirements.push({ field: field as RequirementField, value: { value: value.trim(), source: { label: it.source.label, ref: globalRef(it), kind: "meeting_note" }, confidence: "high", status }, at: it.source.at, key: it.key });
  }

  // Long meetings: one PRIMARY synthesis over the merged, verified facts (not the raw text).
  if (chunks.length > 1) {
    const ctx = new AiContext(`Meeting ${i.meeting.title}`);
    const meetingRef = ctx.ref(`Meeting: ${i.meeting.title}`, { type: "meeting", id: i.meeting.id, view: "report" });
    meetingFacts(ctx, i, meetingRef);
    const local = new Map<string, string>(); // global S# → local R#
    const cite = (refs: string[]) => refs.map((g) => local.get(g) ?? (local.set(g, ctx.ref(sources[g].label, { type: "meeting", id: i.meeting.id, view: "report", anchor: `${sources[g].kind}-${sources[g].id}` })), local.get(g)!)).map((r) => `[${r}]`).join("");
    for (const d of merged.decisions) ctx.fact("Decision", `${d.text} ${cite(d.refs)}`);
    for (const a of merged.actionItems) ctx.fact("Action item", `${a.task}${a.owner ? ` (owner ${a.owner})` : ""}${a.due ? ` (due ${a.due})` : ""} ${cite(a.refs)}`);
    for (const q of merged.openQuestions) ctx.fact("Open question", `${q.text} ${cite(q.refs)}`);
    for (const k of merged.keyPoints.slice(0, 20)) ctx.fact("Point", `${k.text} ${cite(k.refs)}`);
    for (const r of merged.requirements) ctx.fact(`Requirement — ${REQUIREMENT_LABELS[r.field]}`, `${r.value.value} (${r.value.status}) ${cite([r.value.source.ref!])}`);
    const back = new Map([...local].map(([g, l]) => [l, g]));
    const s = await generateStructured({
      db,
      actor,
      feature: "meeting",
      tier: "primary",
      instructions: `Summarise this meeting from the FACTS (already extracted from its written record; there is no transcript). ${MEETING_SYNTHESIS_FORMAT}`,
      prompt: `CONTEXT:\n${ctx.render()}`,
      schema: meetingSynthesisSchema,
      jsonSchema: meetingSynthesisJsonSchema,
    });
    models.add(s.model);
    const map = (list: Cited[]) => list.map((c) => ({ text: c.text, refs: c.refs.map((r) => back.get(r)).filter((r): r is string => !!r) })).filter((c) => c.refs.length);
    merged.summary = s.data.summary;
    merged.keyPoints = map(s.data.keyPoints);
    merged.nextSteps = map(s.data.nextSteps);
  }

  const chatCount = i.chat.length;
  const analysed = chunks.flat().filter((x) => x.source.kind === "chat").length;
  const report: StoredReport = {
    version: REPORT_VERSION,
    scope: `${NO_TRANSCRIPT_REPORT}${i.notes.length ? ` It also uses ${i.notes.length} meeting note${i.notes.length === 1 ? "" : "s"}.` : ""}${truncated ? ` Only the most recent ${analysed} of ${chatCount} chat messages were analysed.` : ""}`,
    coverage: { chatMessages: chatCount, notes: i.notes.length, analysedMessages: analysed, truncated },
    summary: items.length ? merged.summary : "Nothing was written in the meeting chat and no meeting notes were added, so there is nothing to summarise beyond attendance.",
    keyPoints: dedupe(merged.keyPoints),
    decisions: dedupe(merged.decisions),
    actionItems: merged.actionItems.filter((a, n, all) => all.findIndex((b) => b.task.toLowerCase() === a.task.toLowerCase()) === n),
    openQuestions: dedupe(merged.openQuestions),
    nextSteps: dedupe(merged.nextSteps),
    requirements: merged.requirements
      .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
      .map((r) => ({ field: r.field, label: REQUIREMENT_LABELS[r.field], value: r.value.value, status: r.value.status, statusLabel: CLAIM_LABELS[r.value.status], source: r.value.source.label, ref: refKeys.get(r.key) ?? r.value.source.ref!, at: r.at })),
    followUp: merged.followUp ? { date: merged.followUp.date, ref: refKeys.get(merged.followUp.key)! } : null,
    sources,
    history: [...(((existing?.report as StoredReport | undefined)?.history) ?? []), ...(existing ? [{ version: existing.version, generatedAt: existing.generatedAt.toISOString(), models: existing.models, generatedBy: existing.generatedBy }] : [])].slice(-10),
  };
  const row = { meetingId: i.meeting.id, version: (existing?.version ?? 0) + 1, fingerprint, report, models: [...models].join(", ") || "none", generatedBy: actor.id, generatedAt: new Date(), editedSummary: null, editedBy: null, editedAt: null };
  await db.insert(meetingReports).values(row).onConflictDoUpdate({ target: meetingReports.meetingId, set: row }).run();
  return readMeetingReport(db, actor, i.meeting.id);
}

const dedupe = (list: Cited[]) => list.filter((c, n, all) => all.findIndex((d) => d.text.toLowerCase() === c.text.toLowerCase()) === n);

/* ---------------------------------------------------------------- read */

/**
 * The stored report for someone who may open the meeting — no AI call —
 * with suggestions derived for THIS viewer, only if they may read (and, for
 * suggestions, change) the related lead.
 */
export async function readMeetingReport(db: Database, actor: Actor, id: unknown) {
  const i = await meetingInputs(db, actor, id);
  const row = await db.select().from(meetingReports).where(eq(meetingReports.meetingId, i.meeting.id)).get();
  const organiser = i.meeting.createdBy === actor.id;
  const base = {
    meeting: { id: i.meeting.id, title: i.meeting.title, status: i.meeting.status, ended: i.meeting.status === "ended" },
    transcript: { provider: "none" as const, available: false },
    canGenerate: i.meeting.status === "ended",
    canEdit: organiser,
    coverage: { chatMessages: i.chat.length, notes: i.notes.length },
  };
  if (!row) return { ...base, report: null, lead: null };
  const report = row.report as StoredReport;
  const [by, editor] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, row.generatedBy)).get(),
    row.editedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, row.editedBy)).get() : null,
  ]);
  const stale = (await fingerprintOf(i)) !== row.fingerprint;
  return {
    ...base,
    report: {
      ...report,
      summary: row.editedSummary ?? report.summary,
      aiSummary: report.summary,
      edited: row.editedSummary ? { by: editor?.name ?? "someone", at: row.editedAt?.toISOString() ?? null } : null,
      version: row.version,
      models: row.models,
      generatedAt: row.generatedAt.toISOString(),
      generatedBy: by?.name ?? "someone",
      stale,
      conflicts: conflictsOf(report),
    },
    lead: await leadSection(db, actor, i, report),
  };
}

/** Values that changed during the meeting: every mention in time order; the latest is only a candidate. */
function conflictsOf(report: StoredReport) {
  const byField = new Map<string, StoredReport["requirements"]>();
  for (const r of report.requirements) byField.set(r.field, [...(byField.get(r.field) ?? []), r]);
  return [...byField.entries()]
    .filter(([field, list]) => buildProfile(list.map((r) => ({ field: r.field, value: { value: r.value, source: { label: r.source, kind: "meeting_chat" as const }, confidence: "high" as const, status: r.status } }))).entries.find((e) => e.field === field)!.status === "conflict")
    .map(([field, list]) => ({ field, label: REQUIREMENT_LABELS[field as RequirementField], mentions: list, latest: list[list.length - 1] }));
}

/** Per-viewer, deterministic: the related lead's suggestions and quotation readiness. */
async function leadSection(db: Database, actor: Actor, i: Inputs, report: StoredReport) {
  if (!i.view.related || i.view.related.kind !== "leads") return null;
  const lead = (await findRecord(db, i.view.related.id))?.payload as RecordItem | undefined;
  if (!lead || lead.deletedAt || !canRead(actor, lead)) return null;
  const writable = canWrite(actor, lead);
  const suggestions: Suggestion[] = [];
  const recordOf = { id: lead.id, kind: lead.kind, title: lead.title, status: lead.status, due: lead.due };
  if (writable) {
    const lines = [
      ...report.decisions.map((d) => `- Decision: ${d.text}`),
      ...report.actionItems.map((a) => `- Action: ${a.task}${a.owner ? ` (${a.owner})` : ""}${a.due ? ` — due ${a.due}` : ""}`),
      ...report.requirements.map((r) => `- ${r.label}: ${r.value} (${r.statusLabel})`),
      ...report.openQuestions.map((q) => `- Open: ${q.text}`),
    ];
    if (lines.length)
      suggestions.push({
        id: "outcome-note",
        type: "add_note",
        record: recordOf,
        label: `Add the meeting outcome to ${lead.title}`,
        reason: "From the meeting report (Meeting Chat and meeting notes; no transcript).",
        apply: { action: "note", id: lead.id, text: `Meeting outcome — ${i.meeting.title} (from Meeting Chat and meeting notes; no transcript):\n${lines.join("\n").slice(0, 1800)}\n\n(Suggested by Enercore AI, reviewed by ${actor.name}.)` },
        defaultSelected: true,
      });
    if (report.followUp && followUpDateAllowed(report.followUp.date) && report.followUp.date !== lead.due)
      suggestions.push({
        id: "follow-up",
        type: "set_follow_up",
        record: recordOf,
        label: `Set the next follow-up on ${lead.title} to ${report.followUp.date}`,
        reason: `Named in ${report.sources[report.followUp.ref]?.label ?? "the meeting record"}.`,
        apply: { action: "note", id: lead.id, text: `Follow-up scheduled for ${report.followUp.date} (from the meeting "${i.meeting.title}").`, due: report.followUp.date },
        defaultSelected: true,
      });
    const kept = report.requirements.map((r) => ({ field: r.field, value: { value: r.value, source: { label: r.source, ref: r.ref, kind: "meeting_chat" as const }, confidence: "high" as const, status: r.status } }));
    const update = requirementUpdateSuggestion(lead, kept, { reason: "From the meeting record.", latest: true });
    if (update) suggestions.push(update);
    // A status change only when the record states a stage outright (e.g. a Decision note "Move to Negotiation").
    const stage = stages.leads.find((s) => report.decisions.some((d) => new RegExp(`\\b(?:move|moved|change|changed|set)\\b.*\\b${s}\\b`, "i").test(d.text)));
    if (stage && stage !== lead.status) {
      try {
        transition({ records: [lead], audit: [] }, actor, lead.id, stage);
        suggestions.push({ id: "status", type: "change_status", record: recordOf, label: `Change ${lead.title} from ${lead.status} to ${stage}`, reason: "A decision in the meeting record names this stage.", apply: { action: "status", id: lead.id, status: stage }, defaultSelected: false });
      } catch {}
    }
  }
  return {
    id: lead.id,
    title: lead.title,
    canWrite: writable,
    suggestions,
    /** Values from this meeting that are only requested/discussed (never taken as agreed). */
    unconfirmed: report.requirements.filter((r) => !isSettledStatus(r.status)).map((r) => `${r.label}: ${r.value}`),
  };
}

/* ---------------------------------------------------------------- edit */

export async function editMeetingSummary(db: Database, actor: Actor, id: unknown, summary: string) {
  const i = await meetingInputs(db, actor, id);
  if (i.meeting.createdBy !== actor.id) throw new AiError(403, "Only the organiser can edit the meeting notes.");
  const row = await db.select().from(meetingReports).where(eq(meetingReports.meetingId, i.meeting.id)).get();
  if (!row) throw new AiError(404, "There is no AI report to edit yet.");
  await db
    .update(meetingReports)
    .set({ editedSummary: summary.trim() || null, editedBy: summary.trim() ? actor.id : null, editedAt: summary.trim() ? new Date() : null })
    .where(eq(meetingReports.meetingId, i.meeting.id))
    .run();
  return readMeetingReport(db, actor, i.meeting.id);
}

