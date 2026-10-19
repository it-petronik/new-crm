"use client";
import {readJsonResponse} from "../client-request";
import type { TaskHistoryItem, TaskView } from "./store";
import type { RuleView } from "./automation";
import type { TaskPriority, TaskStatus, TaskViewName } from "./model";

export type { TaskView, TaskHistoryItem, RuleView };
export type TaskList = {
  scope: "mine" | "team";
  teamAvailable: boolean;
  today: string;
  counts: Record<TaskViewName, number>;
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  items: TaskView[];
};
export type Assignable = { id: string; name: string; role: string };
export type RuleRun = { id: string; at: string; status: "success" | "skipped" | "failed"; message: string; attempts: number; taskId: string | null; record: { id: string; kind: string; title: string } | { restricted: true } | null };
export type RulePreview = {
  enabled: boolean;
  configurationProblem: string;
  mode: "today" | "examples";
  due: string;
  items: { record: { id: string; kind: string; title: string; due: string }; assignee: string | null; outcome: "create" | "skip" | "already"; message: string }[];
  hidden: number;
  total: number;
};

/** Raised after any task change, so every task list on the page refreshes. */
export const TASKS_CHANGED = "enercore:tasks-changed";
export const announceTasksChanged = () => window.dispatchEvent(new CustomEvent(TASKS_CHANGED));

export class TaskRequestError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  } catch {
    throw new TaskRequestError(0, "You appear to be offline. Nothing was saved.");
  }
  const body = await readJsonResponse(response,"Tasks couldn’t load. Please try again.");
  if (!response.ok) throw new TaskRequestError(response.status, body.error || "Something went wrong. Try again.", body.fields);
  return body as T;
}

export type TaskFilters = {
  view: TaskViewName;
  scope: "mine" | "team";
  q: string;
  priority: TaskPriority | "";
  status: TaskStatus | "";
  source: "" | "manual" | "automation";
  sort: "due" | "priority" | "updated" | "title";
  page: number;
  pageSize: number;
  company: string;
};

export const tasksApi = {
  list(f: TaskFilters, signal?: AbortSignal) {
    const p = new URLSearchParams({ view: f.view, scope: f.scope, sort: f.sort, page: String(f.page), pageSize: String(f.pageSize) });
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.priority) p.set("priority", f.priority);
    if (f.status) p.set("status", f.status);
    if (f.source) p.set("source", f.source);
    if (f.company) p.set("company", f.company);
    return call<TaskList>(`/api/tasks?${p}`, { signal });
  },
  detail: (id: string) => call<{ task: TaskView; history: TaskHistoryItem[] }>(`/api/tasks?id=${encodeURIComponent(id)}`),
  forRecord: (recordId: string) => call<{ items: TaskView[] }>(`/api/tasks?recordId=${encodeURIComponent(recordId)}`),
  assignees: (company: string, linkedRecordId: string | null) =>
    call<{ people: Assignable[] }>(`/api/tasks?assignees=1&company=${encodeURIComponent(company)}${linkedRecordId ? `&linkedRecordId=${encodeURIComponent(linkedRecordId)}` : ""}`),
  create: (body: Record<string, unknown>) => call<{ task: TaskView; duplicate: boolean }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  update: (body: Record<string, unknown>) => call<{ task: TaskView }>("/api/tasks", { method: "PATCH", body: JSON.stringify(body) }),
  rules: () => call<{ companies: string[]; rules: RuleView[] }>("/api/automation"),
  saveRule: (body: Record<string, unknown>) => call<{ id: string; version: number }>("/api/automation", { method: "POST", body: JSON.stringify(body) }),
  history: (id: string) => call<{ runs: RuleRun[] }>(`/api/automation?history=${encodeURIComponent(id)}`),
  candidates: (company: string, preset: string) => call<{ people: (Assignable & { branches: string[] })[] }>(`/api/automation?candidates=${encodeURIComponent(company)}&preset=${encodeURIComponent(preset)}`),
  preview: (id: string) => call<RulePreview>(`/api/automation?preview=${encodeURIComponent(id)}`),
};

export const openRecord = (kind: string, id: string) => window.dispatchEvent(new CustomEvent("enercore:open-record", { detail: { kind, id } }));
