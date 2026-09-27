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
  const leadRef = last(prompt, /^- (R\d+): Lead: /gm) ?? "R1";
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
      { type: "delete_record", recordRef: leadRef, value: "delete it", reason: "malicious" },
      { type: "assign_owner", recordRef: leadRef, value: "someone-else", reason: "malicious" },
      { type: "approve_quotation", recordRef: leadRef, value: "approve", reason: "malicious" },
      { type: "change_price", recordRef: leadRef, value: "1", reason: "malicious" },
      { type: "record_payment", recordRef: leadRef, value: "1000000", reason: "malicious" },
      { type: "create_order", recordRef: leadRef, value: "1", reason: "malicious" },
      { type: "add_note", recordRef: leadRef, value: "Customer confirmed interest in a trial order.", reason: "Record the call outcome." },
      { type: "set_follow_up", recordRef: leadRef, value: plus(7), reason: "Chase the decision next week." },
      { type: "change_status", recordRef: leadRef, value: "Negotiation", reason: "Terms are being discussed." },
    ];
  const date = mode.match(/^date-(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (date) base.suggestions = [{ type: "set_follow_up", recordRef: leadRef, value: date, reason: "Test date." }];
  const status = mode.match(/^status-(.+)$/)?.[1];
  if (status) base.suggestions = [{ type: "change_status", recordRef: leadRef, value: status.replace(/_/g, " "), reason: "Test status." }];
  if (mode === "evil-refs") {
    base.points = [{ text: "Invented references.", refs: ["R999", "R1", "R0", "R12"] }];
    base.suggestions = [
      { type: "add_note", recordRef: "R999", value: "Note on a record I was never given.", reason: "evil" },
      { type: "add_note", recordRef: "R2", value: "Note on a reference that isn't a suggestion target.", reason: "evil" },
    ];
  }
  return base;
}

/** The untrusted blocks of a prompt: ref and text. */
const blocks = (prompt: string) => [...prompt.matchAll(/<untrusted [^>]*ref="(R\d+)"[^>]*>\n([\s\S]*?)\n<\/untrusted>/g)].map((m) => ({ ref: m[1], text: m[2] }));

/** Extraction: reads the text like a (literal) model would; "extract-invent" adds values that aren't there. */
function extraction(prompt: string, mode: string) {
  // A careless model: calls every value "agreed". The server must lower it to what each sentence says.
  const items: { field: string; value: string; evidence: string; ref: string; status: string }[] = [];
  const rules: [string, RegExp][] = [
    ["quantity", /\b\d[\d,]*\s?(?:MT|pails?|drums?)(?:\/month| per month)?/gi],
    ["incoterm", /\b(?:CFR|CIF|FOB|EXW|DAP|DDP)\s+[A-Z][a-z]+/g],
    ["packaging", /\b(?:208L drums|18 kg pails|flexitanks?|in bulk)\b/gi],
    ["paymentTerms", /\b(?:LC at sight|\d+% advance)\b/gi],
    ["targetPrice", /\bUSD \d+(?: per MT)?\b/g],
    ["deliveryTimeline", /\bdelivery before \d+ [A-Z][a-z]+/gi],
    ["product", /\b(?:Base Oil SN\d+|Asphalt \d+\/\d+|Industrial grease NLGI \d)\b/g],
  ];
  for (const b of blocks(prompt))
    for (const [field, re] of rules)
      for (const m of b.text.matchAll(re)) {
        const value = field === "incoterm" ? m[0].split(/\s+/)[0] : field === "deliveryTimeline" ? m[0].replace(/^delivery /i, "") : m[0];
        items.push({ field, value, evidence: m[0], ref: b.ref, status: "agreed" });
      }
  if (mode === "extract-invent" || prompt.includes("[[fake:extract-invent]]")) {
    const ref = blocks(prompt)[0]?.ref ?? "R1";
    items.push({ field: "targetPrice", value: "USD 790/MT", evidence: "target price USD 790 per MT", ref, status: "agreed" });
    items.push({ field: "paymentTerms", value: "90 days credit", evidence: "customer accepts 90 days credit", ref, status: "agreed" });
  }
  return { items: items.slice(0, 24) };
}

function salesAnswer(system: string, prompt: string, mode: string) {
  const keys = (system.match(/one object per key, in this order: ([^.]*)\./)?.[1].match(/"([a-z_]+)"/g) ?? []).map((k) => k.replace(/"/g, ""));
  const facts = (prompt.split("FACTS")[1]?.split("RECORDS")[0] ?? "").split("\n").filter((l) => l.startsWith("- ") && l !== "- (none)");
  const allowed = [...(facts.find((f) => f.startsWith("- ALLOWED NEXT ACTIONS:"))?.matchAll(/([a-z_]+) \(/g) ?? [])].map((m) => m[1]);
  const leadRef = last(prompt, /^- (R\d+): Lead: /gm) ?? "R1";
  const today = last(prompt, /TODAY \(Gulf Standard Time\): (\d{4}-\d{2}-\d{2})/g) ?? "2026-01-01";
  const plus = (days: number) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  const sections = keys.map((key, i) => ({ key, items: facts[i] ? [{ text: facts[i].slice(2, 290), refs: refsIn(facts[i]) }] : [] }));
  if (mode === "claims" && sections[0]) sections[0].items.push({ text: "Follow-up email sent to the customer.", refs: [] });
  const action = mode === "nba-invalid" ? "prepare_quotation" : allowed.at(-1) ?? "none";
  return {
    summary: mode === "claims" ? "Customer agreed to the price." : "Fake copilot answer.",
    sections,
    questions: /"questions": up to/.test(system) ? ["Which Incoterm do you prefer?"] : [],
    nextAction: /"nextAction": \{"action": ONE/.test(system) ? { action, why: mode === "claims" ? "Customer agreed to the price." : "Fake reason from the facts.", refs: [leadRef] } : { action: "none", why: "", refs: [] },
    suggestions:
      mode === "suggest" || mode === "suggest-won"
        ? [
            { type: "delete_record", recordRef: leadRef, value: "x", reason: "malicious" },
            { type: "set_follow_up", recordRef: leadRef, value: plus(3), reason: "Follow up after the meeting." },
            { type: "change_status", recordRef: leadRef, value: mode === "suggest-won" ? "Won" : "Negotiation", reason: "Status per the discussion." },
          ]
        : [],
    confidence: "medium",
    missing: [],
  };
}

function draft(system: string, mode: string) {
  const email = /An email:/.test(system);
  const body =
    mode === "draft-confirm"
      ? "Hello,\nWe noted your request for LC at sight.\nWe confirm LC at sight for this order.\nWe are reviewing your requirement and will revert shortly.\n[Your name]"
      : mode === "draft-unsafe"
      ? "Hello,\nFollowing up on your enquiry.\nWe have the stock ready for shipment.\nWe can confirm the price of USD 790 per MT.\nWe guarantee delivery by 30 October.\nWe are reviewing your requirement and will revert shortly.\n[Your name]"
      : "Hello,\nFollowing up on your requirement. We are reviewing it and will revert shortly.\n[Your name]";
  return { subject: email ? "Following up" : "", body };
}

function priorityNotes(prompt: string) {
  const refs = [...prompt.matchAll(/^- Priority (R\d+):/gm)].map((m) => m[1]);
  // Always picks "prepare_quotation": the server must keep only each item's allowed actions.
  return { items: [...refs.map((ref) => ({ ref, why: "It matters today because of its facts.", action: "prepare_quotation" })), { ref: "R99", why: "Invented priority.", action: "call_customer" }] };
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
    const props = input.response_format?.json_schema?.properties ?? {};
    if (isRoute) {
      const route = last(prompt, /\[\[route:([^\]]*)\]\]/g);
      const [tool = "none", company = "", kind = "", terms = ""] = (route ?? "none").split(",");
      return { response: { tool, company: company || null, kind: kind || null, terms: terms ? terms.split("|") : [], because: "test route" }, usage };
    }
    if ("sections" in props) return { response: salesAnswer(system, prompt, mode), usage };
    if ("body" in props) return { response: draft(system, mode), usage };
    if ("items" in props) return { response: /extract the customer's commercial requirements/i.test(system) ? extraction(prompt, mode) : priorityNotes(prompt), usage };
    return { response: answer(prompt, mode), usage };
  }
}

export default {
  fetch() {
    return new Response("Test-only fake Workers AI.", { status: 404 });
  },
};
