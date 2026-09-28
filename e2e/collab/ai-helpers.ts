import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { addCalendarYears } from "../../src/lib/ai/context";
import type { Client } from "./client";
import { WORKER } from "./people";

/**
 * Enercore AI suite helpers. The fake Workers AI (scripts/fake-ai-worker.ts)
 * stores every prompt in the local test D1; tests read it — and AiUsage /
 * AuditEvent — straight from that throwaway SQLite file.
 */

const D1_DIR = resolve(".wrangler/collab-test/state/v3/d1/miniflare-D1DatabaseObject");

function testDb() {
  const file = readdirSync(D1_DIR).find((n) => n.endsWith(".sqlite") && n !== "metadata.sqlite");
  if (!file) throw new Error("The local test D1 file was not found.");
  const db = new DatabaseSync(join(D1_DIR, file), { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export type FakeCall = { id: number; model: string; route: number; system: string; prompt: string };

/** The newest fake-AI call id so far (0 before the first call). */
export function lastCallId() {
  const db = testDb();
  try {
    const exists = db.prepare(`SELECT name FROM sqlite_master WHERE name = 'FakeAiCall'`).get();
    if (!exists) return 0;
    return Number((db.prepare(`SELECT MAX(id) AS id FROM "FakeAiCall"`).get() as { id: number | null }).id ?? 0);
  } finally {
    db.close();
  }
}

/** Calls made after `since` whose prompt contains `marker` (a unique string of this test). */
export function callsSince(since: number, marker: string): FakeCall[] {
  const db = testDb();
  try {
    return (db.prepare(`SELECT id, model, route, system, prompt FROM "FakeAiCall" WHERE id > ? ORDER BY id`).all(since) as FakeCall[]).filter((c) => c.prompt.includes(marker));
  } finally {
    db.close();
  }
}

export function query<T = Record<string, unknown>>(sql: string, ...params: (string | number)[]): T[] {
  const db = testDb();
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** Expire this fictional snooze through D1, never a second SQLite writer. */
export async function expireSnooze(userId: string, signalKey: string) {
  const response = await fetch(`${WORKER}/__test/expire-snooze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-Control": readFileSync(resolve(".wrangler/collab-test/control-token"), "utf8") },
    body: JSON.stringify({ userId, signalKey }),
  });
  if (!response.ok) throw new Error(`Fixture expiry failed: ${response.status}`);
  await response.json();
}

/** Today in Gulf Standard Time (YYYY-MM-DD). */
export const gstToday = (offsetDays = 0) => new Date(Date.now() + 4 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
export const oneYearFrom = (date: string) => addCalendarYears(date, 1);

export const ai = (client: Client, feature: string, body: unknown, options: { origin?: string | null; cookie?: string | null } = {}) =>
  client.request("POST", `/api/ai/${feature}`, body, options);

/** Adds a note (e.g. a fake-AI marker) through the ordinary records API. */
export async function note(client: Client, id: string, text: string) {
  const r = await client.request("PATCH", "/api/records", { action: "note", id, text });
  if (r.status !== 200) throw new Error(`note ${id}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** The FACTS section of a prompt, as lines. */
export const factsOf = (prompt: string) =>
  (prompt.split("FACTS (computed by Enercore")[1]?.split("RECORDS (")[0] ?? "")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));

/** Record ids that appear anywhere in a prompt. */
export const recordIdsIn = (prompt: string) => [...new Set(prompt.match(/AIT-[A-Z]+\d+/g) ?? [])].sort();
