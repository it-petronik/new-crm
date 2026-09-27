"use client";

import type { AiResult } from "../ai/client";
import type { RecordItem } from "../domain";
import type { ProactiveSignal } from "./signals";

/** Client side of the Action Center: types and the calls the UI makes. No server code. */

export type { ProactiveSignal };
export type ActionGroup = "all" | "sales" | "operations" | "finance" | "data";
export type ActionScope = "mine" | "team";

export type ActionCenterView = {
  today: string;
  scope: ActionScope;
  group: ActionGroup;
  teamAvailable: boolean;
  sections: Record<"needs_action" | "today" | "waiting" | "data", ProactiveSignal[]>;
  counts: Record<ActionGroup, number>;
  hidden: { snoozed: number; dismissed: number };
  summary: {
    tiles: { id: string; label: string; count: number; detail?: string | null; group: ActionGroup }[];
    overdueFollowUpsByOwner: { owner: string; count: number }[];
    actorRole: string;
  } | null;
};

export type ChangesView = {
  days: 1 | 7;
  since: string;
  facts: { id: string; label: string; count: number }[];
  notable: { recordId: string; kind: string; title: string; change: string; at: string; by: string; value: string }[];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The Action Center couldn't load. Try again.");
  return body;
}
const post = <T>(url: string, body: unknown) => call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patchRecord = (body: unknown) => call<unknown>("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const proactive = {
  center: (scope: ActionScope, group: ActionGroup) => call<ActionCenterView>(`/api/proactive?scope=${scope}&group=${group}`),
  changes: (days: 1 | 7) => call<ChangesView>(`/api/proactive/changes?days=${days}`),
  brief: (kind: "today" | "changes" | "week") => post<AiResult & { cached?: boolean }>("/api/proactive/brief", { kind }),
  snooze: (key: string, until: string) => post<{ ok: true }>("/api/proactive/state", { key, action: "snooze", until }),
  dismiss: (key: string) => post<{ ok: true }>("/api/proactive/state", { key, action: "dismiss" }),
  restore: (key: string) => post<{ ok: true }>("/api/proactive/state", { key, action: "restore" }),
  /** Quick Complete: only the missing details, through the records API (permission, version guard, audit). */
  complete: (id: string, expectedUpdatedAt: string, values: Record<string, unknown>) => patchRecord({ action: "complete", id, expectedUpdatedAt, values }),
  /** The next follow-up, as the person's own note + due date (the same path as the Follow up control). */
  setFollowUp: (id: string, date: string) => patchRecord({ action: "note", id, text: `Next follow-up set for ${date} (Action Center).`, due: date }),
  /** The record as it is now — read through the normal read rule. */
  current: async (id: string) => (await call<{ record: RecordItem }>(`/api/records?id=${encodeURIComponent(id)}`)).record,
};

/** Tomorrow at 06:00 GST (02:00 UTC), as the snooze time. */
export function tomorrowMorning(today: string) {
  const d = new Date(`${today}T02:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Tells open views (Action Center, My Day digest) that CRM data changed. */
export const RECORDS_CHANGED = "enercore:records-changed";
export const announceRecordsChanged = () => window.dispatchEvent(new Event(RECORDS_CHANGED));
