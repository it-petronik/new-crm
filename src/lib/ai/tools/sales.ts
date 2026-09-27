import type { Database } from "../../d1";
import { allowedModules, canWrite, money, stages, type Actor, type RecordItem } from "../../domain";
import { businessStamp } from "../../gst";
import { visibleMeetings } from "../../meeting-data";
import { listMeetingMessages } from "../../meeting-chat";
import {
  NEXT_ACTION_LABELS,
  NEXT_ACTIONS,
  businessDateOf,
  dayDiff,
  lastActivity,
  nextActionCandidates,
  recordSignals,
  salesPriorities,
  whyFor,
  type NextAction,
  type SalesSignal,
  type SignalMeeting,
} from "../../sales/signals";
import {
  CLAIM_LABELS,
  COMMERCIAL_TERMS,
  QUOTE_REQUIRED,
  REQUIREMENT_LABELS,
  isSettledStatus,
  buildProfile,
  canStartQuotation,
  quotationPrefill,
  recordedValues,
  settled,
  verifyExtracted,
  type RequirementField,
  type RequirementProfile,
  type RequirementSource,
  type RequirementValue,
} from "../../sales/requirements";
import { draftSafety, unsupportedCompletion } from "../../sales/safety";
import { AiContext, daysBetween, gstToday, type Reference } from "../context";
import { AiError, generateStructured } from "../gateway";
import { readableRecord, readableRecords } from "../records";
import {
  DRAFT_FORMAT,
  EXTRACTION_FORMAT,
  PRIORITY_FORMAT,
  draftJsonSchema,
  draftSchema,
  extractionJsonSchema,
  extractionSchema,
  prepareExtraction,
  prepareSales,
  priorityNotesJsonSchema,
  priorityNotesSchema,
  salesAnswerJsonSchema,
  salesAnswerSchema,
  salesFormat,
  type SalesAnswer,
  type SectionKey,
} from "../sales-schema";
import type { AiAnswer } from "../schema";
import { reviewSuggestions, type Suggestion } from "../suggestions";
import { customerContext, describe } from "./crm";
import { meetingContext } from "./meetings-collab";

/**
 * Sales Copilot tools. Every function starts from the person's CURRENT
 * access (Phase 1 readers), builds the context itself, computes every fact
 * and signal deterministically, and asks the model only to explain, extract
 * (verified against the source), or draft. Nothing here writes to the CRM:
 * suggestions go back to the person, who applies them via the records API.
 */

type MeetingRow = Awaited<ReturnType<typeof visibleMeetings>>[number];
const toSignalMeeting = (m: MeetingRow): SignalMeeting => ({
  id: m.id,
  title: m.title,
  status: m.status,
  scheduledAt: m.scheduledAt ? m.scheduledAt.toISOString() : null,
  endedAt: m.endedAt ? m.endedAt.toISOString() : null,
  relatedRecordId: m.relatedRecordId ?? null,
});

const actionList = (actions: readonly NextAction[]) => actions.map((a) => `${a} (${NEXT_ACTION_LABELS[a]})`).join("; ");

/* ------------------------------------------------------------ lead bundle */

type Source = { label: string; kind: RequirementSource["kind"]; text: string };

async function leadBundle(db: Database, actor: Actor, id: unknown) {
  const lead = await readableRecord(db, actor, id, "leads");
  const today = gstToday();
  const quotes = (await readableRecords(db, actor, ["quotations"])).filter((q) => q.parentId === lead.id);
  const meetings = (await visibleMeetings(db, actor)).filter((m) => m.relatedRecordId === lead.id);
  const signals = recordSignals(lead, today, meetings.map(toSignalMeeting));

  const ctx = new AiContext(`Lead ${lead.title}`);
  const leadRef = describe(ctx, lead);
  const stage = stages.leads.indexOf(lead.status);
  ctx.fact("Stage", `${lead.status}${stage >= 0 ? ` (step ${stage + 1} of ${stages.leads.length})` : ""}`, leadRef);
  if (lead.amount) ctx.fact("Estimated value", money(lead.amount, lead.currency), leadRef);
  if (lead.contact) ctx.fact("Contact", lead.contact, leadRef);
  const age = daysBetween(lead.createdAt, today);
  if (age !== null) ctx.fact("Age", `${age} day(s) since created`, leadRef);
  const last = lastActivity(lead);
  if (last) ctx.fact("Last activity", `${businessDateOf(last)} (${dayDiff(businessDateOf(last), today)} day(s) ago)`, leadRef);
  ctx.fact("Next follow-up", lead.due || "not set", leadRef);
  for (const s of signals) ctx.fact("Signal", s.label, leadRef);

  const quoteRefs = new Map<string, string>();
  for (const q of quotes.slice(0, 5)) {
    const ref = describe(ctx, q);
    quoteRefs.set(q.id, ref);
    const idle = lastActivity(q);
    ctx.fact(`Quotation ${q.id}`, `${q.status}${q.due ? `, valid until ${q.due}` : ""}${idle ? `, last activity ${dayDiff(businessDateOf(idle), today)} day(s) ago` : ""}`, ref);
  }

  const sources = new Map<string, Source>();
  const meetingRefs = new Map<string, string>();
  for (const m of meetings.slice(0, 5)) {
    const ref = ctx.ref(`Meeting: ${m.title}`, { type: "meeting", id: m.id, view: m.status === "ended" ? "report" : "details" });
    meetingRefs.set(m.id, ref);
    const when = m.startedAt ?? m.scheduledAt;
    ctx.fact(`Meeting "${m.title}"`, `${m.status}${when ? `, ${businessStamp(when)}` : ""}`, ref);
  }
  // Person-written text: the lead's description and notes, then the chat of its recent meetings.
  if (lead.detail) ctx.text("lead_description", lead.detail, leadRef);
  for (const n of (lead.notes ?? []).slice(-12)) ctx.text("lead_note", `${n.at ? businessDateOf(n.at) : ""} ${n.actor ?? ""}: ${n.text}`, leadRef);
  sources.set(leadRef, { label: "Lead notes", kind: "note", text: "" });
  for (const m of meetings.filter((m) => m.status !== "scheduled").slice(0, 3)) {
    const ref = meetingRefs.get(m.id);
    if (!ref) continue;
    const chat = (await listMeetingMessages(db, m.id, { limit: 30 })).filter((c) => !c.deletedAt && c.body.trim());
    for (const c of chat) ctx.text("meeting_chat", `${businessStamp(c.createdAt)} ${c.senderName}${c.senderGuestId ? " (guest)" : ""}: ${c.body}`, ref);
    if (chat.length) sources.set(ref, { label: `Meeting chat · ${m.title}`, kind: "meeting_chat", text: "" });
  }
  for (const [ref, s] of sources) s.text = ctx.sourceText(ref);
  for (const [ref, s] of [...sources]) if (!s.text.trim()) sources.delete(ref);

  const recorded = recordedValues(lead, quotes, { lead: leadRef, quotation: (q) => quoteRefs.get(q.id) });
  return { lead, quotes, meetings, signals, ctx, leadRef, quoteRefs, meetingRefs, sources, recorded, today };
}
type LeadBundle = Awaited<ReturnType<typeof leadBundle>>;

const EXTRACT_INSTRUCTIONS = `Extract the customer's commercial requirements from the UNTRUSTED TEXT blocks only (lead notes, meeting chat). Record only values the text states explicitly — never infer, estimate or complete a value. For each value copy the exact supporting words as "evidence" and give the ref of the block it came from. If the text states different values at different times, list each one.`;

/** Requirement values stated in notes / meeting chat, each verified against its source. */
async function extractRequirements(db: Database, actor: Actor, b: LeadBundle) {
  if (!b.sources.size) return { kept: [] as { field: RequirementField; value: RequirementValue }[], rejected: 0 };
  const { data } = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "primary",
    instructions: `${EXTRACT_INSTRUCTIONS}\n\n${EXTRACTION_FORMAT}`,
    prompt: `CONTEXT:\n${b.ctx.render()}`,
    schema: extractionSchema,
    jsonSchema: extractionJsonSchema,
    prepare: prepareExtraction,
    flagged: b.ctx.flagged,
  });
  const { kept, rejected } = verifyExtracted(data.items, b.sources);
  return { kept, rejected: rejected.length };
}

const profileView = (p: RequirementProfile) => ({
  entries: p.entries.map((e) => ({
    field: e.field,
    label: e.label,
    status: e.status,
    values: e.values.map((v) => ({ value: v.value, source: v.source.label, ref: v.source.ref ?? null, confidence: v.confidence, claim: v.status, claimLabel: CLAIM_LABELS[v.status] })),
  })),
  conflicts: p.conflicts.map((c) => c.field),
  missingForQuote: p.missingForQuote,
  unconfirmedForQuote: p.unconfirmedForQuote,
});

/** How the model is told what a value is — its source AND its status. */
const claimText = (v: RequirementValue) =>
  `${v.value} (${v.status === "recorded" ? `recorded in CRM — ${v.source.label}` : `${v.status.toUpperCase()}${isSettledStatus(v.status) ? "" : " by the customer, NOT confirmed by us"} — ${v.source.label}`})`;

/** Adds the profile to the context as facts (so answers can cite it), with each value's status. */
function profileFacts(ctx: AiContext, p: RequirementProfile) {
  for (const e of p.entries.filter((e) => e.status !== "missing"))
    ctx.fact(`Requirement — ${e.label}`, e.status === "conflict" ? `CONFLICTING: ${e.values.map(claimText).join(" vs ")}` : e.values.map(claimText).join("; "), e.values[0].source.ref);
  ctx.fact("Missing before a quotation", p.missingForQuote.length ? p.missingForQuote.map((f) => REQUIREMENT_LABELS[f]).join(", ") : "nothing");
  ctx.fact("Mentioned but not confirmed", p.unconfirmedForQuote.length ? p.unconfirmedForQuote.map((f) => REQUIREMENT_LABELS[f]).join(", ") : "nothing");
}

/** Values the customer asked for / discussed but that nobody confirmed — drafts may acknowledge, never confirm, them. */
const unconfirmedValues = (p: RequirementProfile) => p.entries.flatMap((e) => e.values.filter((v) => !isSettledStatus(v.status)).map((v) => v.value));

const MISSING_QUESTIONS: Partial<Record<RequirementField, string>> = {
  product: "Which product and grade do you need?",
  quantity: "What quantity do you need (per shipment / per month)?",
  destination: "What is the destination port?",
  incoterm: "Which Incoterm do you prefer?",
  packaging: "What packaging do you need?",
  paymentTerms: "What payment terms do you expect?",
  deliveryTimeline: "When do you need delivery?",
};

/* ----------------------------------------------------- answer post-checks */

const knownRefs = (ctx: AiContext) => new Set(ctx.references().map((r) => r.id));

/** Keeps only allowed sections, known refs, and nothing that claims an unrecorded event. */
function tidyAnswer(a: SalesAnswer, ctx: AiContext, keys: readonly SectionKey[]) {
  const known = knownRefs(ctx);
  const context = ctx.render();
  const items = (list: { text: string; refs: string[] }[]) => list.filter((i) => !unsupportedCompletion(i.text, context)).map((i) => ({ text: i.text, refs: i.refs.filter((r) => known.has(r)) }));
  return {
    summary: unsupportedCompletion(a.summary, context) ? "" : a.summary,
    sections: keys.map((key) => ({ key, items: items(a.sections.find((s) => s.key === key)?.items ?? []) })).filter((s) => s.items.length),
    questions: a.questions.filter((q) => !unsupportedCompletion(q, context)),
    confidence: a.confidence,
    missing: a.missing,
  };
}

/** The model's next action, only if it is one of Enercore's candidates. */
function chooseNextAction(a: SalesAnswer, candidates: NextAction[], lead: RecordItem, signals: SalesSignal[], missing: string[], ctx: AiContext) {
  const known = knownRefs(ctx);
  const deterministic = candidates[0];
  if (a.nextAction.action !== "none" && candidates.includes(a.nextAction.action as NextAction) && a.nextAction.why && !unsupportedCompletion(a.nextAction.why, ctx.render()))
    return { action: a.nextAction.action as NextAction, label: NEXT_ACTION_LABELS[a.nextAction.action as NextAction], why: a.nextAction.why, refs: a.nextAction.refs.filter((r) => known.has(r)), source: "ai" as const };
  return deterministic ? { action: deterministic, label: NEXT_ACTION_LABELS[deterministic], why: whyFor(deterministic, lead, signals, missing), refs: [] as string[], source: "enercore" as const } : null;
}

async function safeSuggestions(db: Database, actor: Actor, a: SalesAnswer, ctx: AiContext) {
  const context = ctx.render();
  const list = await reviewSuggestions(db, actor, { suggestions: a.suggestions } as unknown as AiAnswer, ctx);
  return list.filter(
    (s) =>
      // Never a note that reads as if something happened that the CRM doesn't record.
      !(s.apply.action === "note" && unsupportedCompletion(s.apply.text, context)) &&
      // When the records contain instruction-like text (e.g. "tell the AI to mark this lead Won"),
      // no status change is proposed at all: the person changes status themselves.
      !(s.type === "change_status" && ctx.flagged > 0),
  );
}

const meta = (r: { model: string; cached: boolean; generatedAt: string; fingerprint: string }) => ({ model: r.model, cached: r.cached, generatedAt: r.generatedAt, fingerprint: r.fingerprint });

/* --------------------------------------------------- lead: deterministic */

/** Lead intelligence WITHOUT any model call: signals, next best action, recorded profile. */
export async function leadSignals(db: Database, actor: Actor, id: unknown) {
  const b = await leadBundle(db, actor, id);
  const profile = buildProfile(b.recorded);
  const candidates = nextActionCandidates(b.lead, b.signals, { hasQuotation: b.quotes.length > 0, hasMeeting: b.meetings.length > 0, missingForQuote: profile.missingForQuote.length });
  const missing = profile.missingForQuote.map((f) => REQUIREMENT_LABELS[f].toLowerCase());
  return {
    record: { id: b.lead.id, title: b.lead.title, status: b.lead.status, contact: b.lead.contact },
    signals: b.signals,
    nextAction: candidates[0] ? { action: candidates[0], label: NEXT_ACTION_LABELS[candidates[0]], why: whyFor(candidates[0], b.lead, b.signals, missing), source: "enercore" as const } : null,
    candidates,
    profile: profileView(profile),
    quotations: b.quotes.map((q) => ({ id: q.id, status: q.status })),
    meetings: b.meetings.map((m) => ({ id: m.id, title: m.title, status: m.status })),
    canWrite: canWrite(actor, b.lead),
    canQuote: allowedModules(actor).includes("quotations") && canWrite(actor, { ...b.lead, kind: "quotations", status: "Draft", ownerId: actor.id }),
    hasNotes: b.sources.size > 0,
  };
}

/* -------------------------------------------------------- lead: AI brief */

const BRIEF_KEYS = ["situation", "requirement", "developments", "commercial", "risks"] as const;

export async function leadBrief(db: Database, actor: Actor, id: unknown) {
  const b = await leadBundle(db, actor, id);
  const extracted = await extractRequirements(db, actor, b);
  const profile = buildProfile([...b.recorded, ...extracted.kept]);
  const missing = profile.missingForQuote.map((f) => REQUIREMENT_LABELS[f].toLowerCase());
  const candidates = nextActionCandidates(b.lead, b.signals, { hasQuotation: b.quotes.length > 0, hasMeeting: b.meetings.length > 0, missingForQuote: profile.missingForQuote.length });
  profileFacts(b.ctx, profile);
  b.ctx.fact("ALLOWED NEXT ACTIONS", actionList(candidates));
  if (canWrite(actor, b.lead)) b.ctx.allowSuggestionsFor(b.leadRef, "leads", b.lead.id);

  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "primary",
    instructions: `Brief the salesperson on this lead so they can act in under a minute. Sections: "situation" (stage, value, where it stands), "requirement" (what the customer needs — only from the Requirement facts; say plainly when something is missing or conflicting), "developments" (recent notes, meetings and quotations), "commercial" (quotation status, values from FACTS only), "risks" (overdue, quiet, conflicts, missing information).
Choose "nextAction" from ALLOWED NEXT ACTIONS only, with a one-sentence why from the facts.
Suggest at most 2 CRM changes for ${b.leadRef} only when the facts clearly support them: "set_follow_up" (value YYYY-MM-DD, today or later) or "change_status" (value one of: ${stages.leads.join(", ")}). Do not suggest notes.

${salesFormat(BRIEF_KEYS, { questions: false, nextAction: true, suggestions: true })}`,
    prompt: `CONTEXT:\n${b.ctx.render()}`,
    schema: salesAnswerSchema,
    jsonSchema: salesAnswerJsonSchema,
    prepare: prepareSales,
    flagged: b.ctx.flagged,
  });
  return {
    task: "lead-brief",
    record: { id: b.lead.id, title: b.lead.title },
    answer: tidyAnswer(r.data, b.ctx, BRIEF_KEYS),
    nextAction: chooseNextAction(r.data, candidates, b.lead, b.signals, missing, b.ctx),
    signals: b.signals,
    profile: profileView(profile),
    extraction: { kept: extracted.kept.length, rejected: extracted.rejected },
    suggestions: await safeSuggestions(db, actor, r.data, b.ctx),
    references: b.ctx.references(),
    figures: b.ctx.figures(),
    flaggedText: b.ctx.flagged,
    ...meta(r),
  };
}

/* ------------------------------------------------ quotation preparation */

export async function quotationPreparation(db: Database, actor: Actor, id: unknown) {
  const b = await leadBundle(db, actor, id);
  const extracted = await extractRequirements(db, actor, b);
  const profile = buildProfile([...b.recorded, ...extracted.kept]);
  const fields: RequirementField[] = ["product", "grade", "quantity", "destination", "incoterm", "packaging", "paymentTerms", "deliveryTimeline", "targetPrice"];
  const canQuote = allowedModules(actor).includes("quotations") && canWrite(actor, { ...b.lead, kind: "quotations", status: "Draft", ownerId: actor.id });
  const ready = canStartQuotation(profile);
  return {
    task: "quote-prep",
    record: { id: b.lead.id, title: b.lead.title, contact: b.lead.contact },
    customer: b.lead.title,
    entries: profileView(profile).entries.filter((e) => fields.includes(e.field)),
    /** The four readiness buckets. */
    readiness: {
      confirmed: QUOTE_REQUIRED.filter((f) => profile.entries.find((e) => e.field === f)!.status === "confirmed").map((f) => REQUIREMENT_LABELS[f]),
      requested: profile.unconfirmedForQuote.map((f) => REQUIREMENT_LABELS[f]),
      missing: profile.missingForQuote.map((f) => REQUIREMENT_LABELS[f]),
      conflicting: profile.conflicts.map((c) => REQUIREMENT_LABELS[c.field]),
    },
    missing: profile.missingForQuote.map((f) => REQUIREMENT_LABELS[f]),
    conflicts: profile.conflicts.map((c) => REQUIREMENT_LABELS[c.field]),
    /** Never prepared by AI: the seller sets these on the quotation. */
    setByYou: ["Price", "Freight", "Availability / stock", "Quotation validity"],
    canCreate: canQuote && ready,
    blockedBecause: !canQuote ? "You can't create quotations." : !ready ? (profile.conflicts.some((c) => ["product", "quantity"].includes(c.field)) ? "Product or quantity information conflicts — review it first." : "Product and quantity must be known first.") : null,
    prefill: canQuote && ready ? { leadId: b.lead.id, ...quotationPrefill(b.lead, profile) } : null,
    extraction: { kept: extracted.kept.length, rejected: extracted.rejected },
    references: b.ctx.references(),
    generatedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- drafts */

export const DRAFT_CHANNELS = ["email", "whatsapp", "message"] as const;
export const DRAFT_TONES = ["professional", "concise", "warm"] as const;
export const DRAFT_PURPOSES = ["follow_up", "missing_info", "quotation_follow_up", "meeting_follow_up"] as const;
export type DraftRequest = { id: string; channel: (typeof DRAFT_CHANNELS)[number]; tone: (typeof DRAFT_TONES)[number]; purpose: (typeof DRAFT_PURPOSES)[number] };

const CHANNEL_RULES = {
  email: "An email: a short subject line and a body of 4–8 short lines with a greeting and sign-off placeholder \"[Your name]\".",
  whatsapp: "A WhatsApp message: 2–4 short conversational lines, no subject (\"\"), no formal sign-off.",
  message: "A short general message: 2–5 lines, no subject (\"\").",
};
const TONE_RULES = { professional: "Professional and courteous.", concise: "As brief as possible while still clear.", warm: "Friendly and warm, still professional." };

export async function draftMessage(db: Database, actor: Actor, req: DraftRequest) {
  const record = await readableRecord(db, actor, req.id);
  if (!["leads", "quotations", "customers"].includes(record.kind)) throw new AiError(404, "Record not found.");
  let ctx: AiContext;
  let missing: string[] = [];
  let unconfirmed: string[] = [];
  if (record.kind === "leads") {
    const b = await leadBundle(db, actor, record.id);
    // Every draft reads the notes' requirements (cached extraction), so it knows what is only a request.
    const profile = buildProfile([...b.recorded, ...(await extractRequirements(db, actor, b)).kept]);
    profileFacts(b.ctx, profile);
    missing = [...profile.missingForQuote, ...(req.purpose === "missing_info" ? profile.unconfirmedForQuote.filter((f) => COMMERCIAL_TERMS.includes(f)) : [])].map((f) => REQUIREMENT_LABELS[f]);
    unconfirmed = unconfirmedValues(profile);
    ctx = b.ctx;
  } else {
    ctx = new AiContext(`${record.kind === "quotations" ? "Quotation" : "Customer"} ${record.title}`);
    const ref = describe(ctx, record);
    if (record.contact) ctx.fact("Contact", record.contact, ref);
    if (record.kind === "quotations") {
      const idle = lastActivity(record);
      ctx.fact("Quotation", `${record.id}, ${record.status}${record.due ? `, valid until ${record.due}` : ""}`, ref);
      if (idle) ctx.fact("Last activity", `${dayDiff(businessDateOf(idle), gstToday())} day(s) ago`, ref);
      for (const l of (record.lines ?? []).slice(0, 5)) ctx.fact("Line", `${l.description}, ${l.quantity} ${record.unit}${l.packaging ? `, ${l.packaging}` : ""}`, ref);
      if (record.amount) ctx.fact("Quotation total", money(record.amount, record.currency), ref);
      for (const s of recordSignals(record, gstToday())) ctx.fact("Signal", s.label, ref);
    }
    for (const n of (record.notes ?? []).slice(-4)) ctx.text("note", `${n.at ? businessDateOf(n.at) : ""} ${n.actor ?? ""}: ${n.text}`, ref);
  }
  const purpose = {
    follow_up: "a polite follow-up to keep the conversation moving, referring to the latest facts",
    missing_info: `a request for the information still missing before a quotation can be prepared: ${missing.length ? missing.join(", ") : "(nothing is missing — say so and write a short follow-up instead)"}`,
    quotation_follow_up: "a follow-up on the quotation: ask whether they have reviewed it and whether they have questions",
    meeting_follow_up: "a thank-you after the meeting that restates only the agreed points recorded in CONTEXT",
  }[req.purpose];
  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "fast",
    instructions: `Draft ${purpose}, from ${actor.name} to the customer contact ${record.contact ? `(${record.contact})` : "(name unknown — use a neutral greeting)"}.
${CHANNEL_RULES[req.channel]} ${TONE_RULES[req.tone]} British English.
Use only facts from CONTEXT. Never promise or confirm stock, availability, delivery dates, prices, discounts or payment terms; never mention an amount that isn't in CONTEXT. Prefer "we are reviewing your requirement" to any commitment.
Values marked REQUESTED, PREFERRED, DISCUSSED or PROPOSED are the customer's asks, NOT agreed terms: you may acknowledge them ("We noted your request for LC at sight"), never confirm, accept or agree to them. It is a DRAFT for the employee to review and send themselves.

${DRAFT_FORMAT}`,
    prompt: `CONTEXT:\n${ctx.render()}`,
    schema: draftSchema,
    jsonSchema: draftJsonSchema,
    flagged: ctx.flagged,
  });
  const context = ctx.render();
  const body = draftSafety(r.data.body, context, unconfirmed);
  const subject = req.channel === "email" ? draftSafety(r.data.subject, context, unconfirmed) : { text: "", removed: [] as string[] };
  // A small model sometimes leaves the subject empty: a factual default, never invented content.
  if (req.channel === "email" && !subject.text.trim())
    subject.text = `${{ follow_up: "Following up", missing_info: "Information needed for your quotation", quotation_follow_up: `Our quotation ${record.kind === "quotations" ? record.id : ""}`.trim(), meeting_follow_up: "Following our meeting" }[req.purpose]} — ${record.product?.trim() || record.title}`.slice(0, 160);
  if (!body.text.trim()) throw new AiError(502, "The draft couldn't be made safely from what's in Enercore. Try again or write it yourself.");
  return {
    task: "draft",
    record: { id: record.id, kind: record.kind, title: record.title, contact: record.contact },
    draft: { channel: req.channel, tone: req.tone, purpose: req.purpose, subject: subject.text, body: body.text },
    removed: [...subject.removed, ...body.removed],
    references: ctx.references(),
    ...meta(r),
  };
}

/* -------------------------------------------- customer brief / Customer 360 */

const CUSTOMER_KEYS = {
  "360": ["relationship", "opportunities", "meetings", "quotations", "orders", "products", "open_actions", "timeline"],
  precall: ["relationship", "opportunities", "meetings", "quotations", "orders", "open_actions"],
} as const;

export async function customerBrief(db: Database, actor: Actor, id: unknown, mode: "360" | "precall") {
  const base = await customerContext(db, actor, id);
  const { context: ctx, related, record: customer, customerRef } = base;
  const today = gstToday();
  const ids = new Set([customer.id, ...related.map((r) => r.id)]);
  const meetings = (await visibleMeetings(db, actor)).filter((m) => m.relatedRecordId && ids.has(m.relatedRecordId));
  for (const m of meetings.slice(0, 6)) {
    const ref = ctx.ref(`Meeting: ${m.title}`, { type: "meeting", id: m.id, view: m.status === "ended" ? "report" : "details" });
    const when = m.startedAt ?? m.scheduledAt;
    ctx.fact(`Meeting "${m.title}"`, `${m.status}${when ? `, ${businessStamp(when)}` : ""}`, ref);
  }
  const products = [...new Set(related.map((r) => r.product?.trim()).filter(Boolean))];
  ctx.fact("Products in related records", products.length ? products.join("; ") : "none recorded");
  const signals = related.flatMap((r) => recordSignals(r, today, meetings.map(toSignalMeeting)).map((s) => ({ s, r })));
  for (const { s, r } of signals.slice(0, 8)) ctx.fact(`Open action — ${r.title} (${r.id})`, s.label);
  // A factual timeline: dated events only, newest first.
  const events = [
    ...related.map((r) => ({ at: r.createdAt, text: `${r.kind === "leads" ? "Lead" : r.kind === "quotations" ? "Quotation" : r.kind === "orders" ? "Order" : r.kind === "accounts" ? "Invoice" : r.kind === "logistics" ? "Shipment" : r.kind} ${r.id} created` })),
    ...related.flatMap((r) => (r.notes ?? []).map((n) => ({ at: n.at, text: `Note on ${r.id} by ${n.actor ?? "someone"}` }))),
    ...meetings.map((m) => ({ at: (m.endedAt ?? m.startedAt ?? m.scheduledAt ?? m.createdAt).toISOString(), text: `Meeting "${m.title}" ${m.status}` })),
  ]
    .filter((e) => e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  for (const e of events) ctx.fact(`Timeline ${businessDateOf(e.at)}`, e.text);
  const lastEvent = events[0];
  ctx.fact("Last interaction", lastEvent ? `${businessDateOf(lastEvent.at)} — ${lastEvent.text}` : "none recorded", customerRef);

  const keys = CUSTOMER_KEYS[mode];
  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "primary",
    instructions: `${mode === "precall" ? "Prepare the employee for a call with this customer — readable in under a minute." : "Give a 360° view of this customer for the account team."} Quote FACTS exactly (money stays per currency). Related records are linked by NAME ONLY (see "Relationship basis") — never present them as a confirmed or complete history.
Sections: ${keys.map((k) => `"${k}"`).join(", ")}.${mode === "precall" ? ` "questions": up to 6 useful questions to ask, about things CONTEXT does not answer.` : ""}

${salesFormat(keys, { questions: mode === "precall", nextAction: false, suggestions: false })}`,
    prompt: `CONTEXT:\n${ctx.render()}`,
    schema: salesAnswerSchema,
    jsonSchema: salesAnswerJsonSchema,
    prepare: prepareSales,
    flagged: ctx.flagged,
  });
  return {
    task: mode === "precall" ? "customer-brief" : "customer-360",
    record: { id: customer.id, title: customer.title },
    answer: tidyAnswer(r.data, ctx, keys),
    scope: base.scope,
    references: ctx.references(),
    figures: ctx.figures(),
    flaggedText: ctx.flagged,
    ...meta(r),
  };
}

/* ------------------------------------------------------ meeting preparation */

const PREP_KEYS = ["objective", "known", "gaps", "recent_activity"] as const;

export async function meetingPreparation(db: Database, actor: Actor, id: unknown) {
  const record = await readableRecord(db, actor, id);
  let ctx: AiContext;
  let deterministicQuestions: string[] = [];
  let scope: string | null = null;
  if (record.kind === "leads") {
    const b = await leadBundle(db, actor, record.id);
    const profile = buildProfile([...b.recorded, ...(await extractRequirements(db, actor, b)).kept]);
    profileFacts(b.ctx, profile);
    deterministicQuestions = [
      ...profile.conflicts.map((c) => `Confirm the ${REQUIREMENT_LABELS[c.field].toLowerCase()}: ${c.values.map((v) => v.value).join(" or ")}?`),
      ...profile.missingForQuote.map((f) => MISSING_QUESTIONS[f]).filter((q): q is string => !!q),
      // Asked for, not agreed: a question to settle it — never an assumption.
      ...profile.entries
        .filter((e) => e.status === "requested" && COMMERCIAL_TERMS.includes(e.field))
        .map((e) => `The customer ${e.values[0].status === "discussed" ? "asked about" : "requested"} ${e.values[0].value} for ${e.label.toLowerCase()} — can we agree it?`),
    ];
    ctx = b.ctx;
  } else if (record.kind === "customers") {
    const base = await customerContext(db, actor, record.id);
    ctx = base.context;
    scope = base.scope;
  } else throw new AiError(404, "Record not found.");
  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    // Synthesis over requirements and conflicts: the primary model (the fast one misstated conflicts in testing).
    tier: "primary",
    instructions: `Prepare the employee for an upcoming meeting with this ${record.kind === "leads" ? "lead" : "customer"}. Sections: "objective" (what the meeting should achieve, from the stage and open items), "known" (what CONTEXT already establishes), "gaps" (commercial information missing or conflicting), "recent_activity". "questions": up to 6 questions to clarify — suggestions only.

${salesFormat(PREP_KEYS, { questions: true, nextAction: false, suggestions: false })}`,
    prompt: `CONTEXT:\n${ctx.render()}`,
    schema: salesAnswerSchema,
    jsonSchema: salesAnswerJsonSchema,
    prepare: prepareSales,
    flagged: ctx.flagged,
  });
  const answer = tidyAnswer(r.data, ctx, PREP_KEYS);
  const questions = [...new Set([...deterministicQuestions, ...answer.questions])].slice(0, 8);
  return { task: "meeting-prep", record: { id: record.id, title: record.title }, answer: { ...answer, questions }, scope, references: ctx.references(), figures: ctx.figures(), flaggedText: ctx.flagged, ...meta(r) };
}

/* ------------------------------------------------------ post-meeting review */

const REVIEW_KEYS = ["what_happened", "decisions", "requirements_mentioned", "action_items"] as const;
export const NO_TRANSCRIPT = "No transcript is available. This summary uses meeting details and Meeting Chat.";
const PROFILE_EDITABLE: RequirementField[] = ["product", "quantity", "destination", "incoterm", "packaging", "paymentTerms"];

export async function meetingReview(db: Database, actor: Actor, id: unknown) {
  const base = await meetingContext(db, actor, id);
  const { meeting, context: ctx } = base;
  const meetingRef = "R1";
  // The related lead, if the person may read it.
  let lead: RecordItem | null = null;
  let leadRef: string | null = null;
  if (meeting.relatedRecordId) {
    try {
      const r = await readableRecord(db, actor, meeting.relatedRecordId, "leads");
      lead = r;
      leadRef = ctx.references().find((x) => x.target.type === "record" && x.target.id === r.id)?.id ?? null;
    } catch {
      lead = null;
    }
  }
  const sources = new Map<string, Source>();
  const chatText = ctx.sourceText(meetingRef);
  if (chatText.trim()) sources.set(meetingRef, { label: `Meeting chat · ${meeting.title}`, kind: "meeting_chat", text: chatText });

  let kept: { field: RequirementField; value: RequirementValue }[] = [];
  if (sources.size) {
    const x = await generateStructured({
      db,
      actor,
      feature: "sales",
      tier: "primary",
      instructions: `${EXTRACT_INSTRUCTIONS}\n\n${EXTRACTION_FORMAT}`,
      prompt: `CONTEXT:\n${ctx.render()}`,
      schema: extractionSchema,
      jsonSchema: extractionJsonSchema,
      prepare: prepareExtraction,
      flagged: ctx.flagged,
    });
    kept = verifyExtracted(x.data.items, sources).kept;
  }
  const signals = lead ? recordSignals(lead, gstToday()) : [];
  const recordedProfile = lead ? buildProfile(recordedValues(lead, [])) : null;
  const candidates: NextAction[] = lead ? [...new Set<NextAction>(["set_follow_up", ...nextActionCandidates(lead, signals, { hasQuotation: false, hasMeeting: true, missingForQuote: recordedProfile?.missingForQuote.length ?? 0 })])] : [];
  if (lead && leadRef) ctx.fact("ALLOWED NEXT ACTIONS", actionList(candidates));

  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "primary",
    instructions: `Review this meeting's outcome from the meeting chat. ${NO_TRANSCRIPT} Sections: "what_happened", "decisions" (only decisions the chat states), "requirements_mentioned" (only requirements the chat states), "action_items" (with who, if named). Never write that someone "said" or "discussed" anything that isn't in the chat text; never imply audio or video was analysed.
${lead && leadRef ? `"nextAction": one of ALLOWED NEXT ACTIONS. Suggest at most 2 changes for ${leadRef}: "set_follow_up" (YYYY-MM-DD) or "change_status" (one of: ${stages.leads.join(", ")}) — only if the chat supports it.` : `"nextAction": {"action": "none", "why": "", "refs": []}; "suggestions": [].`}

${salesFormat(REVIEW_KEYS, { questions: false, nextAction: !!lead, suggestions: !!lead })}`,
    prompt: `CONTEXT:\n${ctx.render()}`,
    schema: salesAnswerSchema,
    jsonSchema: salesAnswerJsonSchema,
    prepare: prepareSales,
    flagged: ctx.flagged,
  });
  const answer = tidyAnswer(r.data, ctx, REVIEW_KEYS);
  const suggestions: Suggestion[] = [];
  if (lead && canWrite(actor, lead)) {
    // 1. The outcome note — composed by Enercore from the reviewed sections, labelled by source.
    const lines = answer.sections.flatMap((s) => (["what_happened", "decisions", "action_items"].includes(s.key) ? s.items.map((i) => `- ${i.text}`) : []));
    if (lines.length)
      suggestions.push({
        id: "outcome-note",
        type: "add_note",
        record: { id: lead.id, kind: lead.kind, title: lead.title, status: lead.status, due: lead.due },
        label: `Add the meeting outcome to ${lead.title}`,
        reason: "Records what the meeting chat shows.",
        apply: { action: "note", id: lead.id, text: `Meeting outcome — ${meeting.title} (from the meeting chat; no transcript):\n${lines.join("\n").slice(0, 1800)}\n\n(Suggested by Enercore AI, reviewed by ${actor.name}.)` },
        defaultSelected: true,
      });
    // 2. Follow-up / status, checked exactly like Phase 1 suggestions.
    for (const s of await safeSuggestions(db, actor, r.data, ctx)) suggestions.push({ ...s, defaultSelected: s.type !== "change_status" });
    // 3. Requirement profile: stated in the chat, verified, and different from the lead's fields.
    const changes: { field: string; from: string; to: string; source: string }[] = [];
    const values: Record<string, unknown> = {};
    const attributes: Record<string, string> = {};
    for (const field of PROFILE_EDITABLE) {
      const stated = kept.filter((k) => k.field === field);
      if (stated.length !== 1) continue; // several different values → the person reviews them, nothing is proposed
      // A commercial term the customer only asked for must never become a recorded term.
      if (COMMERCIAL_TERMS.includes(field) && !isSettledStatus(stated[0].value.status)) continue;
      const to = stated[0].value.value;
      const from = settled(recordedProfile!, field) ?? "";
      if (from && buildProfile([{ field, value: stated[0].value }, ...recordedValues(lead, []).filter((v) => v.field === field)]).conflicts.length === 0) continue;
      if (field === "quantity") {
        const n = Number(to.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
        if (!n) continue;
        values.quantity = n;
        const unit = to.match(/\b(MT|kg|litre|drum|pail|piece)s?\b/i)?.[1];
        if (unit) values.unit = unit.toLowerCase() === "mt" ? "MT" : unit.toLowerCase();
      } else if (field === "product") values.product = to;
      else if (field === "destination") values.destination = to;
      else if (field === "incoterm") {
        const code = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"].find((c) => new RegExp(`\\b${c}\\b`, "i").test(to));
        if (!code) continue;
        attributes.incoterm = code;
      } else attributes[field] = to;
      changes.push({ field: REQUIREMENT_LABELS[field], from: from || "not set", to, source: `${stated[0].value.source.label} · ${CLAIM_LABELS[stated[0].value.status]}` });
    }
    const validDue = /^\d{4}-\d{2}-\d{2}$/.test(lead.due || "");
    if (changes.length && validDue && ["USD", "AED", "EUR", "SGD"].includes(lead.currency))
      suggestions.push({
        id: "profile-update",
        type: "update_profile",
        record: { id: lead.id, kind: lead.kind, title: lead.title, status: lead.status, due: lead.due },
        label: `Update the requirement on ${lead.title}: ${changes.map((c) => `${c.field} → ${c.to}`).join("; ")}`,
        reason: "Stated in the meeting chat.",
        changes,
        apply: {
          action: "edit",
          id: lead.id,
          expectedUpdatedAt: lead.updatedAt,
          values: {
            kind: lead.kind,
            company: lead.company,
            branch: lead.branch,
            title: lead.title,
            contact: lead.contact ?? "",
            product: lead.product ?? "",
            quantity: lead.quantity ?? 0,
            unit: lead.unit ?? "",
            amount: lead.amount ?? 0,
            currency: lead.currency,
            due: lead.due,
            detail: lead.detail ?? "",
            source: lead.source ?? "",
            ...(lead.email ? { email: lead.email } : {}),
            ...(lead.phone ? { phone: lead.phone } : {}),
            ...(lead.destination ? { destination: lead.destination } : {}),
            ...values,
            ...(Object.keys(attributes).length ? { attributes } : {}),
          },
        },
        defaultSelected: true,
      });
  }
  const candidateLead = lead;
  return {
    task: "meeting-review",
    meeting: { id: meeting.id, title: meeting.title, status: meeting.status },
    record: candidateLead ? { id: candidateLead.id, title: candidateLead.title } : null,
    answer,
    nextAction: candidateLead ? chooseNextAction(r.data, candidates, candidateLead, signals, [], ctx) : null,
    requirements: kept.map((k) => ({ field: k.field, label: REQUIREMENT_LABELS[k.field], value: k.value.value, source: k.value.source.label, claim: k.value.status, claimLabel: CLAIM_LABELS[k.value.status] })),
    suggestions,
    scope: NO_TRANSCRIPT,
    references: ctx.references(),
    flaggedText: ctx.flagged,
    ...meta(r),
  };
}

/* ------------------------------------------------------------ priorities */

async function scopedDeals(db: Database, actor: Actor, scope: "mine" | "team") {
  const deals = await readableRecords(db, actor, ["leads", "quotations"].filter((k) => allowedModules(actor).includes(k as "leads")) as ("leads" | "quotations")[]);
  return scope === "mine" ? deals.filter((r) => r.ownerId === actor.id) : deals;
}

/** Today's priorities — deterministic, no model call. */
export async function todayPriorities(db: Database, actor: Actor, scope: "mine" | "team") {
  const today = gstToday();
  const records = await scopedDeals(db, actor, scope);
  const meetings = (await visibleMeetings(db, actor)).map(toSignalMeeting);
  const priorities = salesPriorities(records, today, meetings, 10);
  const all = records.flatMap((r) => recordSignals(r, today, meetings));
  const counts = Object.fromEntries([...new Set(all.map((s) => s.type))].map((t) => [t, all.filter((s) => s.type === t).length]));
  return { today, scope, priorities, counts, total: new Set(all.map((s) => s.recordId)).size };
}

/** "What should I work on today?" — Enercore ranks; the model explains why each matters. */
export async function explainPriorities(db: Database, actor: Actor, scope: "mine" | "team") {
  const base = await todayPriorities(db, actor, scope);
  if (!base.priorities.length) return { ...base, notes: [], references: [] as Reference[], generatedAt: new Date().toISOString(), cached: false, model: null };
  const records = new Map((await scopedDeals(db, actor, scope)).map((r) => [r.id, r]));
  const ctx = new AiContext(`${actor.name.split(" ")[0]}'s priorities for ${base.today}`);
  const byRef = new Map<string, { id: string; allowed: NextAction[] }>();
  for (const p of base.priorities) {
    const record = records.get(p.record.id)!;
    const ref = describe(ctx, record);
    const allowed = [...new Set(p.signals.map((s) => s.action))];
    byRef.set(ref, { id: p.record.id, allowed });
    ctx.fact(`Priority ${ref}`, `${p.signals.map((s) => s.label).join("; ")}${p.record.value ? `; value ${p.record.value}` : ""}${p.lastActivity ? `; last activity ${p.lastActivity}` : ""}; allowed actions: ${actionList(allowed)}`, ref);
  }
  const r = await generateStructured({
    db,
    actor,
    feature: "sales",
    tier: "fast",
    instructions: `For each priority, say in one sentence why it matters today and pick its action from that priority's allowed actions. Use only its facts; do not re-rank, add or drop priorities.

${PRIORITY_FORMAT}`,
    prompt: `CONTEXT:\n${ctx.render()}`,
    schema: priorityNotesSchema,
    jsonSchema: priorityNotesJsonSchema,
  });
  const context = ctx.render();
  const notes = r.data.items
    .filter((i) => byRef.has(i.ref) && !unsupportedCompletion(i.why, context))
    .map((i) => {
      const target = byRef.get(i.ref)!;
      const action = target.allowed.includes(i.action) ? i.action : target.allowed[0];
      return { recordId: target.id, why: i.why, action, label: NEXT_ACTION_LABELS[action] };
    })
    .filter((n, idx, all) => all.findIndex((x) => x.recordId === n.recordId) === idx);
  return { ...base, notes, references: ctx.references(), ...meta(r) };
}

/** Lookups used by routes and tests. */
export const isNextAction = (v: string): v is NextAction => (NEXT_ACTIONS as readonly string[]).includes(v);
