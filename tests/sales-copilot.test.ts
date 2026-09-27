import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordItem } from "../src/lib/domain";
import { nextActionCandidates, recordSignals, salesPriorities, whyFor, type SignalMeeting } from "../src/lib/sales/signals";
import { buildProfile, canStartQuotation, evidenceFound, quotationPrefill, recordedValues, sameValue, verifyExtracted } from "../src/lib/sales/requirements";
import { claimsCompletedEvent, draftSafety, unsupportedCompletion } from "../src/lib/sales/safety";

const TODAY = "2026-09-27";
const at = (date: string) => `${date}T06:00:00.000Z`; // 10:00 GST
const lead = (id: string, extra: Partial<RecordItem> = {}): RecordItem => ({
  id,
  kind: "leads",
  company: "Istanegry",
  branch: "Main",
  title: `Test ${id}`,
  contact: "Test Contact",
  product: "Base Oil SN500",
  quantity: 500,
  unit: "MT",
  amount: 20000,
  currency: "USD",
  status: "Qualified",
  ownerId: "u1",
  owner: "Sam Seller",
  due: "2026-10-05",
  detail: "",
  source: "Test",
  destination: "Mombasa",
  createdAt: at("2026-09-01"),
  updatedAt: at("2026-09-25"),
  ...extra,
});
const types = (r: RecordItem, meetings: SignalMeeting[] = []) => recordSignals(r, TODAY, meetings).map((s) => s.type).sort();

/* --------------------------------------------------------------- signals */

test("follow-up signals: overdue, today, none", () => {
  const overdue = recordSignals(lead("a", { due: "2026-09-24" }), TODAY);
  assert.deepEqual(overdue.map((s) => [s.type, s.label, s.days]), [["FOLLOW_UP_OVERDUE", "Follow-up overdue 3 days", 3]]);
  assert.deepEqual(types(lead("b", { due: TODAY })), ["FOLLOW_UP_TODAY"]);
  assert.deepEqual(types(lead("c")), []);
  // Closed deals never signal.
  assert.deepEqual(types(lead("d", { due: "2026-09-01", status: "Won" })), []);
  assert.deepEqual(types(lead("e", { due: "2026-09-01", deletedAt: at("2026-09-02") })), []);
});

test("gone quiet and stalled negotiation are day counts, not opinions", () => {
  const quiet = recordSignals(lead("q", { updatedAt: at("2026-09-13") }), TODAY);
  assert.deepEqual(quiet.map((s) => [s.type, s.days]), [["LEAD_GONE_QUIET", 14]]);
  assert.deepEqual(types(lead("q2", { updatedAt: at("2026-09-14") })), [], "13 days is not quiet");
  // A recent note is activity.
  assert.deepEqual(types(lead("q3", { updatedAt: at("2026-09-01"), notes: [{ id: "n", text: "call", at: at("2026-09-26"), actor: "x" }] })), []);
  const stalled = recordSignals(lead("n", { status: "Negotiation", updatedAt: at("2026-09-20") }), TODAY);
  assert.deepEqual(stalled.map((s) => [s.type, s.label]), [["NEGOTIATION_STALLED", "Negotiation idle 7 days"]]);
});

test("quotations: waiting, expiring, expired — by validity date, never as follow-ups", () => {
  const q = (extra: Partial<RecordItem>) => lead("qt", { kind: "quotations", status: "Sent", ...extra });
  assert.deepEqual(types(q({ updatedAt: at("2026-09-21"), due: "2026-10-30" })), ["QUOTATION_WAITING"]);
  assert.equal(recordSignals(q({ updatedAt: at("2026-09-21"), due: "2026-10-30" }), TODAY)[0].label, "Quotation awaiting response for 6 days");
  assert.deepEqual(types(q({ updatedAt: at("2026-09-26"), due: "2026-10-01" })), ["QUOTATION_EXPIRING"]);
  assert.deepEqual(types(q({ updatedAt: at("2026-09-26"), due: "2026-09-20" })), ["QUOTATION_EXPIRED"]);
  assert.deepEqual(types(q({ status: "Accepted", due: "2026-09-20" })), []);
});

test("meetings: today, and completed without a logged outcome", () => {
  const r = lead("m");
  const m = (extra: Partial<SignalMeeting>): SignalMeeting => ({ id: "mt", title: "Product discussion", status: "scheduled", scheduledAt: at(TODAY), endedAt: null, relatedRecordId: "m", ...extra });
  assert.deepEqual(types(r, [m({})]), ["MEETING_TODAY"]);
  const ended = m({ status: "ended", scheduledAt: null, endedAt: at("2026-09-26") });
  assert.deepEqual(types(r, [ended]), ["MEETING_OUTCOME_MISSING"]);
  // A note after the meeting ended is the outcome.
  assert.deepEqual(types({ ...r, notes: [{ id: "n", text: "Outcome", at: at("2026-09-26").replace("06:", "09:"), actor: "x" }] }, [ended]), []);
  // Old meetings (beyond the window) stop nagging; other records' meetings don't count.
  assert.deepEqual(types(r, [m({ status: "ended", endedAt: at("2026-09-01") })]), []);
  assert.deepEqual(types(r, [m({ relatedRecordId: "other" })]), []);
});

test("high value with no next action, and incomplete requirement", () => {
  assert.deepEqual(types(lead("h", { amount: 258000, due: "" })), ["HIGH_VALUE_NO_NEXT_ACTION"]);
  assert.deepEqual(types(lead("h2", { amount: 150000, currency: "AED", due: "" })), [], "AED threshold is 180,000");
  const incomplete = recordSignals(lead("i", { destination: "", quantity: 0 }), TODAY);
  assert.deepEqual(incomplete.map((s) => s.label), ["Requirement incomplete: no quantity, destination"]);
});

test("priorities: ranked deterministically and capped", () => {
  const records = [
    lead("quiet", { updatedAt: at("2026-09-01") }),
    lead("overdue", { due: "2026-09-24", amount: 258000 }),
    lead("today", { due: TODAY }),
    lead("fine"),
    lead("quote", { kind: "quotations", status: "Sent", updatedAt: at("2026-09-21"), due: "2026-10-30" }),
    ...Array.from({ length: 12 }, (_, i) => lead(`x${i}`, { updatedAt: at("2026-08-01") })),
  ];
  const p = salesPriorities(records, TODAY);
  assert.equal(p.length, 10);
  assert.deepEqual(p.slice(0, 3).map((x) => x.record.id), ["overdue", "today", "quote"]);
  assert.equal(p[0].action, "send_follow_up");
  assert.equal(p[0].why, "Follow-up overdue 3 days.");
  assert.ok(!p.some((x) => x.record.id === "fine"));
  // Same input, same order.
  assert.deepEqual(salesPriorities([...records].reverse(), TODAY).map((x) => x.record.id), p.map((x) => x.record.id));
});

test("next-best-action candidates come from facts, with a factual why", () => {
  const r = lead("c", { due: "2026-09-24" });
  const signals = recordSignals(r, TODAY);
  const c = nextActionCandidates(r, signals, { hasQuotation: false, hasMeeting: false, missingForQuote: 3 });
  assert.deepEqual(c.slice(0, 3), ["send_follow_up", "request_missing_info", "schedule_meeting"]);
  assert.equal(whyFor("send_follow_up", r, signals, []), "Follow-up overdue 3 days.");
  assert.equal(whyFor("request_missing_info", r, signals, ["incoterm", "packaging"]), "A quotation still needs: incoterm, packaging.");
});

/* ------------------------------------------------------- requirements */

const sources = new Map([
  ["R1", { label: "Lead notes", kind: "note" as const, text: "Customer needs 500 MT/month of Base Oil SN500 CFR Mombasa, in 208L drums. Payment by LC at sight." }],
  ["R2", { label: "Meeting chat · Product discussion", kind: "meeting_chat" as const, text: "Customer now requires 800 MT per month. Delivery before 30 November." }],
]);

test("extracted values are kept only with evidence found in the cited source", () => {
  const { kept, rejected } = verifyExtracted(
    [
      { field: "incoterm", value: "CFR", evidence: "CFR Mombasa", ref: "R1" },
      { field: "packaging", value: "208L drums", evidence: "in 208L drums", ref: "R1" },
      { field: "paymentTerms", value: "LC at sight", evidence: "Payment by LC at sight", ref: "R1" },
      { field: "quantity", value: "800 MT/month", evidence: "now requires 800 MT per month", ref: "R2" },
      // Invented: no such text anywhere.
      { field: "targetPrice", value: "USD 800/MT", evidence: "target price USD 800", ref: "R1" },
      // Evidence exists, but in the OTHER source.
      { field: "deliveryTimeline", value: "Before 30 November", evidence: "Delivery before 30 November", ref: "R1" },
      // Evidence doesn't support the value.
      { field: "quantity", value: "900 MT", evidence: "Customer needs 500 MT/month", ref: "R1" },
      // Unknown field / unknown ref.
      { field: "discount", value: "10%", evidence: "Customer needs", ref: "R1" },
      { field: "incoterm", value: "FOB", evidence: "FOB", ref: "R9" },
    ],
    sources,
  );
  assert.deepEqual(kept.map((k) => [k.field, k.value.value, k.value.source.label]), [
    ["incoterm", "CFR", "Lead notes"],
    ["packaging", "208L drums", "Lead notes"],
    ["paymentTerms", "LC at sight", "Lead notes"],
    ["quantity", "800 MT/month", "Meeting chat · Product discussion"],
  ]);
  assert.equal(rejected.length, 5);
  assert.equal(evidenceFound("cfr  mombasa", "…SN500 CFR Mombasa, in…"), true);
});

test("conflicting values are shown with every source; nothing is chosen", () => {
  const r = lead("p", { quantity: 500, unit: "MT" });
  const recorded = recordedValues(r, [], { lead: "R1" });
  const { kept } = verifyExtracted([{ field: "quantity", value: "800 MT/month", evidence: "now requires 800 MT per month", ref: "R2" }, { field: "incoterm", value: "CFR", evidence: "CFR Mombasa", ref: "R1" }], sources);
  const profile = buildProfile([...recorded, ...kept]);
  const quantity = profile.entries.find((e) => e.field === "quantity")!;
  assert.equal(quantity.status, "conflict");
  assert.deepEqual(quantity.values.map((v) => [v.value, v.source.label]), [
    ["500 MT", "Lead field · Quantity"],
    ["800 MT/month", "Meeting chat · Product discussion"],
  ]);
  assert.deepEqual(profile.conflicts.map((c) => c.field), ["quantity"]);
  // The same value from two sources is not a conflict.
  assert.equal(sameValue("quantity", "500 MT", "500MT/month"), true);
  assert.equal(sameValue("incoterm", "CFR", "CFR Mombasa"), true);
  assert.equal(sameValue("product", "Asphalt 60/70", "Bitumen 80/100"), false);
});

test("missing information and quotation readiness; prefill never includes a price or a conflict", () => {
  const r = lead("g", { product: "Industrial grease NLGI 2", quantity: 12, unit: "pail", destination: "", amount: 99999 });
  let profile = buildProfile(recordedValues(r, []));
  assert.deepEqual(profile.missingForQuote, ["destination", "incoterm", "packaging", "paymentTerms", "deliveryTimeline"]);
  assert.equal(canStartQuotation(profile), true);
  const prefill = quotationPrefill(r, profile);
  assert.deepEqual(prefill, { product: "Industrial grease NLGI 2", quantity: 12, unit: "pail", destination: "", incoterm: "", packaging: "", paymentTerms: "" });
  assert.equal(JSON.stringify(prefill).includes("99999"), false);

  // Conflicting quantity: can't start a draft on it.
  const { kept } = verifyExtracted([{ field: "quantity", value: "800 MT/month", evidence: "now requires 800 MT per month", ref: "R2" }], sources);
  profile = buildProfile([...recordedValues(lead("s"), []), ...kept]);
  assert.equal(canStartQuotation(profile), false);
  assert.equal(quotationPrefill(lead("s"), profile).quantity, 0);

  // Asphalt with no product quantity at all.
  assert.equal(canStartQuotation(buildProfile(recordedValues(lead("a", { product: "Asphalt 60/70", quantity: 0 }), []))), false);
});

test("quotations are recorded sources for incoterm, payment terms and packaging", () => {
  const q = lead("Q-1", { kind: "quotations", status: "Sent", attributes: { incoterm: "CIF", paymentTerms: "30% advance" }, lines: [{ description: "SN500", quantity: 500, unitPriceCents: 1, packaging: "Flexitank" }] });
  const p = buildProfile(recordedValues(lead("l"), [q], { quotation: () => "R2" }));
  const get = (f: string) => p.entries.find((e) => e.field === f)!;
  assert.deepEqual([get("incoterm").values[0].value, get("paymentTerms").values[0].value, get("packaging").values[0].value], ["CIF", "30% advance", "Flexitank"]);
  assert.equal(get("quotationRequested").values[0].value, "Yes — quotation Q-1 (Sent)");
  assert.equal(get("incoterm").values[0].source.ref, "R2");
});

/* --------------------------------------------------------------- safety */

test("drafts lose commitments and invented amounts, keep grounded content", () => {
  const context = "Quotation value: $48,000. Quantity 800 MT. Customer: Zephyr.";
  const draft = [
    "Hello Ahmed,",
    "Following up on our quotation of $48,000 for SN500.",
    "We have the stock ready for immediate shipment.",
    "We guarantee delivery by 30 October.",
    "We can confirm the price of USD 800 per MT.",
    "We accept your payment terms.",
    "Our best price is $790/MT.",
    "We are reviewing your requirement and will revert shortly.",
    "Best regards,",
  ].join("\n");
  const { text, removed } = draftSafety(draft, context);
  assert.equal(text, "Hello Ahmed,\nFollowing up on our quotation of $48,000 for SN500.\nWe are reviewing your requirement and will revert shortly.\nBest regards,");
  assert.equal(removed.length, 5);
  assert.match(removed.join(" "), /stock or availability/);
  assert.match(removed.join(" "), /\$790/);
});

test("suggestions worded as completed events are caught unless the CRM records them", () => {
  for (const bad of ["Follow-up email sent to the customer.", "Customer agreed to the price.", "Called the customer yesterday.", "Quotation was sent.", "Payment received."]) assert.equal(claimsCompletedEvent(bad), true, bad);
  for (const ok of ["Send a follow-up email.", "Ask whether the customer agrees to CFR.", "CRM does not contain a confirmed customer decision.", "Prepare the quotation."]) assert.equal(claimsCompletedEvent(ok), false, ok);
  assert.equal(unsupportedCompletion("Follow-up email sent.", "note: follow-up email sent on 12 Sep"), false);
  assert.equal(unsupportedCompletion("Customer agreed to CFR.", "notes: customer asked about CFR"), true);
});

/* ------------------------------------------------ manager routing & search */

test("manager questions route to the new tools only when the person may use them", async () => {
  const { keywordRoute, searchTerms, toolsFor } = await import("../src/lib/ai/tools/management");
  const { previewActor } = await import("../src/lib/fixtures");
  const md = { ...previewActor, role: "MD" as const };
  const hr = { ...previewActor, role: "HR Manager" as const };
  assert.equal(keywordRoute("Which leads need attention?", md).tool, "leads_attention");
  assert.equal(keywordRoute("Which quotations are waiting for a response?", md).tool, "quotations_waiting");
  assert.equal(keywordRoute("Which high-value opportunities have no next action?", md).tool, "high_value_no_next_action");
  const search = keywordRoute("Find leads for SN500", md);
  assert.deepEqual([search.tool, search.terms], ["search", ["SN500"]]);
  assert.deepEqual(keywordRoute("Which leads are going to Mombasa?", md).terms, ["Mombasa"]);
  assert.equal(keywordRoute("Which customers asked for asphalt?", md).tool, "search");
  assert.equal(keywordRoute("Find leads for SN500", hr).tool, "none");
  assert.deepEqual(toolsFor(hr), []);
  assert.deepEqual(searchTerms("Show me every lead"), ["every"]);
});

test("the sales answer tidy step drops unknown sections and suggestion types, and cuts long text", async () => {
  const { prepareSales, salesAnswerSchema } = await import("../src/lib/ai/sales-schema");
  const raw = {
    summary: "s".repeat(900),
    sections: [
      { key: "situation", items: [{ text: "ok", refs: ["R1", "bad"] }] },
      { key: "hack_the_crm", items: [{ text: "x", refs: [] }] },
    ],
    questions: ["q?"],
    nextAction: { action: "delete_everything", why: "because", refs: [] },
    suggestions: [
      { type: "record_payment", recordRef: "R1", value: "1", reason: "x" },
      { type: "set_follow_up", recordRef: "R1", value: "2026-10-01", reason: "y" },
    ],
    confidence: "certain",
    missing: [],
  };
  const a = salesAnswerSchema.parse(prepareSales(raw));
  assert.equal(a.summary.length, 600);
  assert.deepEqual(a.sections.map((s) => s.key), ["situation"]);
  assert.deepEqual(a.sections[0].items[0].refs, ["R1"]);
  assert.equal(a.nextAction.action, "none");
  assert.deepEqual(a.suggestions.map((s) => s.type), ["set_follow_up"]);
  assert.equal(a.confidence, "medium");
});

/* ------------------------------------------- commercial claim semantics */

test("claim status: a question, a request, a preference and an agreement stay different", async () => {
  const { statusFromSentence, claimStatus } = await import("../src/lib/sales/requirements");
  const cases: [string, string][] = [
    ["Can you do LC at sight?", "discussed"],
    ["We require LC at sight.", "requested"],
    ["We prefer LC at sight.", "preferred"],
    ["We agreed on LC at sight.", "agreed"],
    ["Can you supply 500 MT?", "discussed"],
    ["We require 500 MT per month.", "requested"],
    ["Our monthly requirement is 500 MT.", "requested"],
    ["Our target is USD 800.", "requested"],
    ["We agreed at USD 800.", "agreed"],
    ["We require CIF Mombasa.", "requested"],
    ["We agreed on CIF Mombasa.", "agreed"],
    ["Payment terms were confirmed as 30% advance.", "confirmed"],
    ["We have not agreed on LC at sight yet.", "discussed"],
    ["Is it possible to agree CIF?", "discussed"],
    ["We can offer FOB Jebel Ali.", "proposed"],
  ];
  for (const [sentence, want] of cases) assert.equal(statusFromSentence(sentence), want, sentence);
  // The model may lower a status, never raise it above what the sentence says.
  assert.equal(claimStatus("agreed", "Can you do LC at sight?"), "discussed");
  assert.equal(claimStatus("confirmed", "We require LC at sight."), "requested");
  assert.equal(claimStatus("agreed", "Our target is USD 800."), "requested");
  assert.equal(claimStatus("agreed", "We agreed at USD 800."), "agreed");
  assert.equal(claimStatus("discussed", "We agreed on CIF Mombasa."), "discussed");
  assert.equal(claimStatus("nonsense", "We prefer LC at sight."), "preferred");
});

test("extraction keeps each value's status from its own sentence; readiness separates requested from confirmed", async () => {
  const { verifyExtracted, buildProfile, recordedValues, quotationPrefill, canStartQuotation } = await import("../src/lib/sales/requirements");
  const text = "Can you do LC at sight? We require CIF Mombasa. Our target is USD 800 per MT. We need 208L drums.";
  const src = new Map([["R2", { label: "Meeting chat · Call", kind: "meeting_chat" as const, text }]]);
  // A careless model calls everything "agreed".
  const { kept } = verifyExtracted(
    [
      { field: "paymentTerms", value: "LC at sight", evidence: "Can you do LC at sight", ref: "R2", status: "agreed" },
      { field: "incoterm", value: "CIF", evidence: "We require CIF Mombasa", ref: "R2", status: "agreed" },
      { field: "targetPrice", value: "USD 800 per MT", evidence: "Our target is USD 800 per MT", ref: "R2", status: "agreed" },
      { field: "packaging", value: "208L drums", evidence: "We need 208L drums", ref: "R2", status: "agreed" },
    ],
    src,
  );
  assert.deepEqual(kept.map((k) => [k.field, k.value.status]), [
    ["paymentTerms", "discussed"],
    ["incoterm", "requested"],
    ["targetPrice", "requested"],
    ["packaging", "requested"],
  ]);
  const lead = { ...(await import("../src/lib/fixtures")).makePreview().records.find((r) => r.kind === "leads")!, product: "Base Oil SN500", quantity: 500, unit: "MT", destination: "Mombasa", attributes: {} };
  const p = buildProfile([...recordedValues(lead, []), ...kept]);
  const status = (f: string) => p.entries.find((e) => e.field === f)!.status;
  assert.deepEqual([status("product"), status("quantity"), status("incoterm"), status("paymentTerms"), status("targetPrice")], ["confirmed", "confirmed", "requested", "requested", "requested"]);
  assert.deepEqual(p.unconfirmedForQuote, ["incoterm", "packaging", "paymentTerms"]);
  assert.deepEqual(p.missingForQuote, ["deliveryTimeline"]);
  // A quotation may be started (product + quantity), but requested terms are NOT pre-filled as ours.
  assert.equal(canStartQuotation(p), true);
  const prefill = quotationPrefill(lead, p);
  assert.deepEqual([prefill.incoterm, prefill.paymentTerms, prefill.packaging], ["", "", "208L drums"]);
  // Once agreed, the same term is settled.
  const agreed = verifyExtracted([{ field: "paymentTerms", value: "LC at sight", evidence: "We agreed on LC at sight", ref: "R3", status: "agreed" }], new Map([["R3", { label: "Lead notes", kind: "note" as const, text: "We agreed on LC at sight." }]])).kept;
  const p2 = buildProfile([...recordedValues(lead, []), ...agreed]);
  assert.equal(p2.entries.find((e) => e.field === "paymentTerms")!.status, "confirmed");
  assert.equal(quotationPrefill(lead, p2).paymentTerms, "LC at sight");
});

test("drafts may acknowledge a request, never confirm it", () => {
  const unconfirmed = ["LC at sight", "CIF", "USD 800 per MT"];
  const context = "Requirement — Payment terms: LC at sight (DISCUSSED by the customer, NOT confirmed by us — Meeting chat)";
  const cases: [string, boolean][] = [
    ["We noted your request for LC at sight.", true],
    ["We are reviewing your request for CIF delivery.", true],
    ["We confirm LC at sight.", false],
    ["LC at sight is fine for us.", false],
    ["We can do CIF Mombasa as requested.", false],
    ["We accept your target of USD 800 per MT.", false],
    ["We agree on CIF.", false],
    ["We will confirm the delivery schedule once we have reviewed your requirement.", true],
  ];
  for (const [sentence, kept] of cases) {
    const { text, removed } = draftSafety(sentence, context, unconfirmed);
    assert.equal(text === sentence && removed.length === 0, kept, sentence);
  }
});
