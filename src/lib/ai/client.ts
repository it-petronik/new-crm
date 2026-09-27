"use client";

import type { AiFeature } from "./config";
import type { Reference } from "./context";
import type { AiAnswer } from "./schema";
import type { Suggestion } from "./suggestions";

/** Client side of Enercore AI: types and the calls the UI makes. No server code. */

export type AiResult = {
  feature: AiFeature;
  answer: Omit<AiAnswer, "suggestions">;
  suggestions: Suggestion[];
  references: Reference[];
  /** What the answer is (and isn't) based on — set by Enercore, not the model. */
  scope: string | null;
  /** Enercore's computed figures — authoritative; the AI only explains them. */
  figures: { label: string; value: string; ref?: string }[];
  /** How many untrusted blocks looked like instructions (shown, never obeyed). */
  flaggedText: number;
  model: string | null;
  generatedAt: string;
  tool?: string;
};

export type AiStatus = {
  available: boolean;
  model: string;
  features: Record<Exclude<AiFeature, "sales">, boolean> & { sales: boolean };
  tools: { id: string; description: string }[];
  examples: string[];
  limits: { per10Minutes: number; perDay: number };
};

export type { Reference, Suggestion };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Enercore AI couldn't answer right now. Try again.");
  return body;
}

let status: Promise<AiStatus | null> | null = null;
/** Once per page load: is AI on here, and what may this person use? */
export function aiStatus(): Promise<AiStatus | null> {
  status ??= call<AiStatus>("/api/ai").catch(() => {
    status = null;
    return null;
  });
  return status;
}

export const askAi = (feature: Exclude<AiFeature, "ask">, id: string) =>
  call<AiResult>(`/api/ai/${feature}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });

export const askQuestion = (question: string) =>
  call<AiResult>("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });

/**
 * Applies ONE suggestion the person has reviewed and confirmed — through the
 * ordinary records API, which checks their rights and audits it as their
 * own change. Nothing is applied any other way.
 */
export async function applySuggestion(s: Suggestion) {
  await call<unknown>("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s.apply) });
}

/** Opens what a reference points at, through the workspace's normal navigation. */
export function openReference(ref: Reference) {
  const t = ref.target;
  if (t.type === "record") window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind: t.kind, id: t.id } }));
  else if (t.type === "meeting") window.dispatchEvent(new CustomEvent("enercore:open-meeting-page", { detail: { meetingId: t.id, view: t.view ?? "details" } }));
  else window.dispatchEvent(new CustomEvent("enercore:open-conversation-link", { detail: { conversationId: t.id, messageId: t.messageId ?? null } }));
}

/* --------------------------------------------------------- Sales Copilot */

/**
 * A reference as people read it: "Lead · ABC Trading", "Quotation · Q-1042",
 * "Meeting · Product discussion", "Message · Ahmed, 25 Sep". The internal id
 * (R1, R2…) stays in the data.
 */
export function refLabel(ref: Reference) {
  const m = ref.label.match(/^([^:]+):\s*(.*?)(?:\s*\(([^()]+)\))?$/);
  if (!m) return ref.label;
  const [, kind, title, id] = m;
  if (kind === "Quotation" || kind === "Invoice" || kind === "Order" || kind === "Shipment") return `${kind} · ${id ?? title}`;
  if (kind.startsWith("Message from")) return `Message · ${kind.slice(13)}${title ? `, ${title}` : ""}`;
  return `${kind} · ${title}`;
}

export type SalesSignalView = { type: string; recordId: string; label: string; action: string; score: number; days?: number; meetingId?: string };
export type SalesPriorityView = {
  record: { id: string; kind: string; title: string; status: string; company: string; owner: string; ownerId: string; value: string; due: string };
  signals: SalesSignalView[];
  score: number;
  action: string;
  why: string;
  lastActivity: string | null;
  daysIdle: number | null;
  meetingId?: string;
};
export type TodayView = { today: string; scope: "mine" | "team"; priorities: SalesPriorityView[]; counts: Record<string, number>; total: number };
export type PriorityNotes = TodayView & { notes: { recordId: string; why: string; action: string; label: string }[]; generatedAt: string; cached: boolean; model: string | null };
export type NextActionView = { action: string; label: string; why: string; refs?: string[]; source: "ai" | "enercore" } | null;
export type ProfileView = {
  entries: {
    field: string;
    label: string;
    status: "confirmed" | "requested" | "missing" | "conflict";
    values: { value: string; source: string; ref: string | null; confidence: string; claim: string; claimLabel: string }[];
  }[];
  conflicts: string[];
  missingForQuote: string[];
  unconfirmedForQuote: string[];
};
export type LeadSignalsView = {
  record: { id: string; title: string; status: string; contact: string };
  signals: SalesSignalView[];
  nextAction: NextActionView;
  candidates: string[];
  profile: ProfileView;
  quotations: { id: string; status: string }[];
  meetings: { id: string; title: string; status: string }[];
  canWrite: boolean;
  canQuote: boolean;
  hasNotes: boolean;
};
export type SalesAnswerView = {
  summary: string;
  sections: { key: string; items: { text: string; refs: string[] }[] }[];
  questions: string[];
  confidence: string;
  missing: string[];
};
export type SalesResult = {
  task: string;
  record?: { id: string; title: string } | null;
  answer: SalesAnswerView;
  nextAction?: NextActionView;
  signals?: SalesSignalView[];
  profile?: ProfileView;
  requirements?: { field: string; label: string; value: string; source: string; claim: string; claimLabel: string }[];
  suggestions?: Suggestion[];
  scope?: string | null;
  references: Reference[];
  figures?: { label: string; value: string; ref?: string }[];
  flaggedText?: number;
  model: string;
  cached: boolean;
  generatedAt: string;
};
export type QuotePrepView = {
  record: { id: string; title: string; contact: string };
  customer: string;
  entries: ProfileView["entries"];
  readiness: { confirmed: string[]; requested: string[]; missing: string[]; conflicting: string[] };
  missing: string[];
  conflicts: string[];
  setByYou: string[];
  canCreate: boolean;
  blockedBecause: string | null;
  prefill: { leadId: string; product: string; quantity: number; unit: string; destination: string; incoterm: string; packaging: string; paymentTerms: string } | null;
  references: Reference[];
  generatedAt: string;
};
export type DraftView = {
  record: { id: string; kind: string; title: string; contact: string };
  draft: { channel: "email" | "whatsapp" | "message"; tone: string; purpose: string; subject: string; body: string };
  removed: string[];
  references: Reference[];
  generatedAt: string;
  cached: boolean;
};

const post = <T>(task: string, body: unknown) =>
  call<T>(`/api/ai/sales/${task}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const sales = {
  today: (scope: "mine" | "team") => call<TodayView>(`/api/ai/sales/today?scope=${scope}`),
  explainToday: (scope: "mine" | "team") => post<PriorityNotes>("today", { scope }),
  lead: (id: string) => call<LeadSignalsView>(`/api/ai/sales/lead?id=${encodeURIComponent(id)}`),
  leadBrief: (id: string) => post<SalesResult>("lead-brief", { id }),
  quotePrep: (id: string) => post<QuotePrepView>("quote-prep", { id }),
  draft: (body: { id: string; channel: string; tone: string; purpose: string }) => post<DraftView>("draft", body),
  customer360: (id: string) => post<SalesResult>("customer-360", { id }),
  customerBrief: (id: string) => post<SalesResult>("customer-brief", { id }),
  meetingPrep: (id: string) => post<SalesResult>("meeting-prep", { id }),
  meetingReview: (id: string) => post<SalesResult>("meeting-review", { id }),
};

/** Saves a reviewed draft as a note on the record (the ordinary records API). */
export async function saveDraftAsNote(recordId: string, channel: string, text: string) {
  await call<unknown>("/api/records", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "note", id: recordId, text: `Draft ${channel === "whatsapp" ? "WhatsApp message" : channel} prepared (not sent):\n${text}`.slice(0, 5000) }),
  });
}

/* ----------------------------------------------------- Meeting Intelligence */

export type MeetingReportSource = { kind: "chat" | "note" | "meeting"; id: string; label: string; speaker: string | null; guest: boolean; at: string | null };
type CitedView = { text: string; refs: string[] };
export type MeetingReportView = {
  meeting: { id: string; title: string; status: string; ended: boolean };
  transcript: { provider: "none"; available: false };
  canGenerate: boolean;
  canEdit: boolean;
  coverage: { chatMessages: number; notes: number };
  report: null | {
    scope: string;
    coverage: { chatMessages: number; notes: number; analysedMessages: number; truncated: boolean };
    summary: string;
    aiSummary: string;
    edited: { by: string; at: string | null } | null;
    keyPoints: CitedView[];
    decisions: CitedView[];
    actionItems: { task: string; owner: string | null; due: string | null; refs: string[] }[];
    openQuestions: CitedView[];
    nextSteps: CitedView[];
    requirements: { field: string; label: string; value: string; status: string; statusLabel: string; source: string; ref: string; at: string | null }[];
    conflicts: { field: string; label: string; mentions: { value: string; statusLabel: string; source: string; ref: string; at: string | null }[]; latest: { value: string } }[];
    followUp: { date: string; ref: string } | null;
    sources: Record<string, MeetingReportSource>;
    version: number;
    models: string;
    generatedAt: string;
    generatedBy: string;
    stale: boolean;
  };
  lead: null | { id: string; title: string; canWrite: boolean; suggestions: Suggestion[]; unconfirmed: string[] };
};

const reportUrl = (id: string) => `/api/ai/meeting-report/${encodeURIComponent(id)}`;
export const meetingIntelligence = {
  get: (id: string) => call<MeetingReportView>(reportUrl(id)),
  generate: (id: string, regenerate = false) => call<MeetingReportView>(reportUrl(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regenerate }) }),
  edit: (id: string, summary: string) => call<MeetingReportView>(reportUrl(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary }) }),
};

/* ------------------------------------------------------------ meeting notes */

export type MeetingNote = { id: string; kind: "decision" | "action" | "requirement" | "note"; text: string; data: Record<string, string>; author: { id: string; name: string }; createdAt: string; mine: boolean };
const notesUrl = (id: string) => `/api/collab/meetings/${encodeURIComponent(id)}/notes`;
export const meetingNotesApi = {
  list: (id: string) => call<{ notes: MeetingNote[] }>(notesUrl(id)).then((r) => r.notes),
  add: (id: string, body: Record<string, unknown>) => call<{ note: MeetingNote }>(notesUrl(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.note),
  remove: (id: string, noteId: string) => call<unknown>(`${notesUrl(id)}?note=${encodeURIComponent(noteId)}`, { method: "DELETE" }),
};
