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
  features: Record<AiFeature, boolean>;
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
