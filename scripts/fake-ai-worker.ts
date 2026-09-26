/**
 * TEST ONLY — a stand-in for the Workers AI binding in the local
 * Collaboration/AI suites (never deployed, never bound to preview or live).
 *
 * Bound to the app Worker as `AI` through a service binding to the FakeAi
 * entrypoint, it answers `run(model, input)` like Workers AI, so the real
 * gateway, validation, fallback, limits and usage logging all run — without
 * inference or quota. Every call's prompt is stored in the local test D1
 * (FakeAiCall) so tests can prove what did and didn't reach the model.
 *
 * Behaviour is chosen by the LAST `[[fake:…]]` marker in the prompt (test
 * data puts it in a note, message or question); routing by `[[route:…]]`.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { D1Database } from "@cloudflare/workers-types";
import { AI_MODELS } from "../src/lib/ai/config";

type Env = { DB: D1Database };
type Input = { messages: { role: string; content: string }[]; response_format?: { json_schema?: { properties?: Record<string, unknown> } } };

const last = (text: string, re: RegExp) => [...text.matchAll(re)].at(-1)?.[1];
const refsIn = (line: string) => [...new Set([...line.matchAll(/\[(R\d+)\]/g)].map((m) => m[1]))];

function answer(prompt: string, mode: string) {
  const facts = (prompt.split("FACTS")[1]?.split("RECORDS")[0] ?? "")
    .split("\n")
    .filter((l) => l.startsWith("- ") && l !== "- (none)")
    .slice(0, 6);
  const today = last(prompt, /TODAY \(Gulf Standard Time\): (\d{4}-\d{2}-\d{2})/g) ?? "2026-01-01";
  const plus = (days: number) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  const base = {
    summary: "Fake answer from the test model.",
    points: facts.map((l) => ({ text: l.slice(2, 390), refs: refsIn(l) })),
    risks: [] as unknown[],
    nextActions: [{ text: "Follow up with the customer.", refs: [] }],
    draft: { kind: "email", subject: "Following up", body: "DRAFT — Dear customer, following up on our conversation." },
    suggestions: [] as unknown[],
    confidence: "medium",
    missing: [] as string[],
  };
  if (mode === "suggest")
    base.suggestions = [
      { type: "delete_record", recordRef: "R1", value: "delete it", reason: "malicious" },
      { type: "assign_owner", recordRef: "R1", value: "someone-else", reason: "malicious" },
      { type: "approve_quotation", recordRef: "R1", value: "approve", reason: "malicious" },
      { type: "change_price", recordRef: "R1", value: "1", reason: "malicious" },
      { type: "record_payment", recordRef: "R1", value: "1000000", reason: "malicious" },
      { type: "create_order", recordRef: "R1", value: "1", reason: "malicious" },
      { type: "add_note", recordRef: "R1", value: "Customer confirmed interest in a trial order.", reason: "Record the call outcome." },
      { type: "set_follow_up", recordRef: "R1", value: plus(7), reason: "Chase the decision next week." },
      { type: "change_status", recordRef: "R1", value: "Negotiation", reason: "Terms are being discussed." },
    ];
  const date = mode.match(/^date-(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (date) base.suggestions = [{ type: "set_follow_up", recordRef: "R1", value: date, reason: "Test date." }];
  const status = mode.match(/^status-(.+)$/)?.[1];
  if (status) base.suggestions = [{ type: "change_status", recordRef: "R1", value: status.replace(/_/g, " "), reason: "Test status." }];
  if (mode === "evil-refs") {
    base.points = [{ text: "Invented references.", refs: ["R999", "R1", "R0", "R12"] }];
    base.suggestions = [
      { type: "add_note", recordRef: "R999", value: "Note on a record I was never given.", reason: "evil" },
      { type: "add_note", recordRef: "R2", value: "Note on a reference that isn't a suggestion target.", reason: "evil" },
    ];
  }
  return base;
}

export class FakeAi extends WorkerEntrypoint<Env> {
  async run(model: string, input: Input) {
    const system = input.messages?.[0]?.content ?? "";
    const prompt = input.messages?.[1]?.content ?? "";
    const isRoute = !!input.response_format?.json_schema?.properties?.tool;
    await this.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS "FakeAiCall" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "model" TEXT, "route" INTEGER, "system" TEXT, "prompt" TEXT, "at" INTEGER)`,
    ).run();
    await this.env.DB.prepare(`INSERT INTO "FakeAiCall" ("model","route","system","prompt","at") VALUES (?,?,?,?,?)`).bind(model, isRoute ? 1 : 0, system, prompt, Date.now()).run();

    const mode = last(prompt, /\[\[fake:([A-Za-z0-9_-]+)\]\]/g) ?? "echo";
    const primary = model === AI_MODELS.primary;
    if (mode === "quota") throw new Error("4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan");
    if (mode === "throw-primary" && primary) throw new Error("5007: Internal model error");
    if (mode === "invalid-both" || (mode === "invalid-primary" && primary)) return { response: "I am not JSON, sorry." };

    const usage = { prompt_tokens: Math.ceil((system.length + prompt.length) / 4), completion_tokens: 42 };
    if (isRoute) {
      const route = last(prompt, /\[\[route:([^\]]*)\]\]/g);
      const [tool = "none", company = "", kind = ""] = (route ?? "none").split(",");
      return { response: { tool, company: company || null, kind: kind || null, because: "test route" }, usage };
    }
    return { response: answer(prompt, mode), usage };
  }
}

export default {
  fetch() {
    return new Response("Test-only fake Workers AI.", { status: 404 });
  },
};
