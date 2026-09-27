import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkItems, verifyChunk } from "../src/lib/ai/tools/meeting-intelligence";
import { meetingExtractionSchema, prepareMeetingExtraction } from "../src/lib/ai/meeting-schema";
import { noteInput, requirementText } from "../src/lib/meeting-notes";

type Item = Parameters<typeof verifyChunk>[1] extends Map<string, infer V> ? V : never;
const item = (key: string, text: string, speaker: string, guest = false, kind: "chat" | "note" = "chat", noteKind = ""): Item => ({
  key,
  text,
  source: { kind, id: key, label: kind === "note" ? `Meeting note (${noteKind}) · ${speaker} · 10:40 am` : `Meeting Chat · ${speaker}${guest ? " (Guest)" : ""} · 10:32 am`, speaker, guest, at: "2026-09-27T06:32:00.000Z" },
});

const refs = new Map<string, Item>([
  ["R2", item("chat-1", "We require Base Oil SN500, around 500 MT per month.", "Ahmed", true)],
  ["R3", item("chat-2", "Can you do CIF Mombasa?", "Ahmed", true)],
  ["R4", item("chat-3", "We can review CIF Mombasa.", "Pranav")],
  ["R5", item("chat-4", "Can you accept LC at sight?", "Ahmed", true)],
  ["R6", item("chat-5", "I need to confirm that with accounts. Maybe we should offer FOB instead.", "Pranav")],
  ["R7", item("chat-6", "Actually our first shipment may be 800 MT.", "Ahmed", true)],
  ["R8", item("note-1", "Prepare the revised quotation", "Pranav", false, "note", "decision")],
  ["R9", item("chat-7", "Pranav will send the revised offer by 2026-10-02. Let's follow up on 2026-10-06.", "Pranav")],
]);

const raw = (x: Partial<Record<string, unknown>>) =>
  meetingExtractionSchema.parse(
    prepareMeetingExtraction({ summary: "", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], nextSteps: [], requirements: [], followUp: { date: null, ref: null }, ...x }),
  );

test("the example sales conversation: request, question, review, change — nothing becomes agreed", () => {
  const v = verifyChunk(
    raw({
      requirements: [
        { field: "product", value: "Base Oil SN500", evidence: "We require Base Oil SN500", ref: "R2", status: "agreed" },
        { field: "quantity", value: "500 MT per month", evidence: "around 500 MT per month", ref: "R2", status: "agreed" },
        { field: "incoterm", value: "CIF", evidence: "Can you do CIF Mombasa", ref: "R3", status: "agreed" },
        { field: "incoterm", value: "CIF", evidence: "We can review CIF Mombasa", ref: "R4", status: "agreed" },
        { field: "paymentTerms", value: "LC at sight", evidence: "Can you accept LC at sight", ref: "R5", status: "agreed" },
        { field: "quantity", value: "800 MT", evidence: "our first shipment may be 800 MT", ref: "R7", status: "agreed" },
      ],
    }),
    refs,
  );
  assert.deepEqual(
    v.requirements.map((r) => [r.field, r.value.value, r.value.status]),
    [
      ["product", "Base Oil SN500", "requested"],
      ["quantity", "500 MT per month", "requested"],
      ["incoterm", "CIF", "discussed"],
      ["incoterm", "CIF", "discussed"],
      ["paymentTerms", "LC at sight", "discussed"],
      ["quantity", "800 MT", "discussed"],
    ],
  );
  assert.ok(v.requirements.every((r) => !["agreed", "confirmed"].includes(r.value.status)));
});

test("decisions need support: hedges are dropped, a Decision note counts, invented refs vanish", () => {
  const v = verifyChunk(
    raw({
      decisions: [
        { text: "Offer FOB instead.", refs: ["R6"] },
        { text: "Prepare the revised quotation.", refs: ["R8"] },
        { text: "Invented decision.", refs: ["R99"] },
        { text: "Pranav will send the revised offer.", refs: ["R9"] },
      ],
    }),
    refs,
  );
  assert.deepEqual(v.decisions.map((d) => d.text), ["Prepare the revised quotation.", "Pranav will send the revised offer."]);
});

test("action owners and dates only when the text names them", () => {
  const v = verifyChunk(
    raw({
      actionItems: [
        { task: "Send the revised offer", owner: "Pranav", due: "2026-10-02", refs: ["R9"] },
        { task: "Confirm LC at sight with accounts", owner: "Maya Finance", due: "2026-10-01", refs: ["R6"] },
        { task: "Unsourced task", owner: null, due: null, refs: [] },
      ],
      followUp: { date: "2026-10-06", ref: "R9" },
    }),
    refs,
  );
  assert.deepEqual(v.actionItems.map((a) => [a.task, a.owner, a.due]), [
    ["Send the revised offer", "Pranav", "2026-10-02"],
    ["Confirm LC at sight with accounts", null, null],
  ]);
  assert.deepEqual(v.followUp, { date: "2026-10-06", key: "chat-7" });
});

test("no event claims the record doesn't contain", () => {
  const v = verifyChunk(raw({ summary: "The customer agreed to the price.", keyPoints: [{ text: "Quotation was sent to the customer.", refs: ["R2"] }] }), refs);
  assert.equal(v.summary, "");
  assert.deepEqual(v.keyPoints, []);
});

test("chunks keep whole items, stay within budget and keep the newest", () => {
  const items = Array.from({ length: 40 }, (_, n) => ({ text: `message ${n} ${"x".repeat(500)}` }));
  const { chunks, truncated } = chunkItems(items, 2_000, 3);
  assert.equal(chunks.length, 3);
  assert.equal(truncated, true);
  assert.ok(chunks.every((c) => c.length >= 1 && c.reduce((n, i) => n + i.text.length, 0) <= 2_000 + 600));
  assert.equal(chunks.at(-1)!.at(-1)!.text.startsWith("message 39"), true);
  const small = chunkItems(items.slice(0, 3), 6_000);
  assert.deepEqual([small.chunks.length, small.truncated], [1, false]);
});

test("meeting notes: typed kinds, requirement status defaults to requested", () => {
  const n = noteInput.parse({ kind: "requirement", fields: { product: "SN500", quantity: "500 MT" } });
  assert.equal(n.kind === "requirement" && n.status, "requested");
  assert.equal(requirementText({ product: "SN500", quantity: "500 MT", destination: "" }), "Product: SN500 · Quantity: 500 MT");
  assert.throws(() => noteInput.parse({ kind: "requirement", fields: {} }));
  assert.throws(() => noteInput.parse({ kind: "decision", text: "" }));
  assert.throws(() => noteInput.parse({ kind: "requirement", status: "approved", fields: { product: "x" } }));
  assert.throws(() => noteInput.parse({ kind: "action", text: "x", due: "next week" }));
});
