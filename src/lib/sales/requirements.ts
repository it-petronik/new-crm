import type { RecordItem } from "../domain";

/**
 * The Commercial Requirement Profile of a lead — derived, never stored.
 *
 * Values come from two kinds of source:
 *   - "recorded": structured CRM fields (the lead, its quotations). Facts.
 *   - "stated":   text people wrote (notes, meeting chat), as extracted by the
 *                 AI — kept ONLY when the quoted evidence is actually found in
 *                 the cited source text. Nothing is ever guessed.
 * Different values for the same field are shown as a conflict with every
 * source; none is silently chosen.
 */

export const REQUIREMENT_FIELDS = [
  "product",
  "grade",
  "quantity",
  "destination",
  "incoterm",
  "packaging",
  "targetPrice",
  "paymentTerms",
  "deliveryTimeline",
  "buyingTimeline",
  "quotationRequested",
  "sampleRequested",
  "documentsRequested",
] as const;
export type RequirementField = (typeof REQUIREMENT_FIELDS)[number];

export const REQUIREMENT_LABELS: Record<RequirementField, string> = {
  product: "Product",
  grade: "Grade / specification",
  quantity: "Quantity",
  destination: "Destination / port",
  incoterm: "Incoterm",
  packaging: "Packaging",
  targetPrice: "Target price",
  paymentTerms: "Payment terms",
  deliveryTimeline: "Delivery timeline",
  buyingTimeline: "Buying timeline",
  quotationRequested: "Quotation requested",
  sampleRequested: "Sample requested",
  documentsRequested: "Documents requested",
};

/** What a quotation needs before it can be prepared (price is always the seller's to set). */
export const QUOTE_REQUIRED: RequirementField[] = ["product", "quantity", "destination", "incoterm", "packaging", "paymentTerms", "deliveryTimeline"];

export type RequirementSource = { label: string; ref?: string; kind: "field" | "quotation" | "note" | "meeting_chat" | "meeting_note" | "message" | "description" };
/**
 * What a value's source actually says about it. "recorded" = a CRM field or
 * our own quotation; the rest describe person-written text. Only recorded,
 * confirmed and agreed values count as settled; everything else is a request
 * or a discussion — never Enercore's acceptance.
 */
export const CLAIM_STATUSES = ["recorded", "confirmed", "agreed", "requested", "preferred", "proposed", "discussed", "unknown"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
/** Statuses the model may give an extracted value (never "recorded"). */
export const STATED_STATUSES = ["confirmed", "agreed", "requested", "preferred", "proposed", "discussed", "unknown"] as const;
export const CLAIM_LABELS: Record<ClaimStatus, string> = {
  recorded: "Recorded in CRM",
  confirmed: "Confirmed",
  agreed: "Agreed",
  requested: "Requested — not confirmed",
  preferred: "Preferred — not confirmed",
  proposed: "Proposed — not confirmed",
  discussed: "Discussed — not confirmed",
  unknown: "Mentioned — not confirmed",
};
export const isSettledStatus = (s: ClaimStatus) => s === "recorded" || s === "confirmed" || s === "agreed";
const RANK: Record<ClaimStatus, number> = { unknown: 0, discussed: 1, requested: 2, preferred: 2, proposed: 2, confirmed: 3, agreed: 3, recorded: 4 };

export type RequirementValue = { value: string; source: RequirementSource; confidence: "recorded" | "high" | "medium"; status: ClaimStatus };
export type ProfileEntry = {
  field: RequirementField;
  label: string;
  /** confirmed = recorded/confirmed/agreed; requested = only asked/discussed so far. */
  status: "confirmed" | "requested" | "missing" | "conflict";
  values: RequirementValue[];
};
export type RequirementProfile = {
  entries: ProfileEntry[];
  conflicts: ProfileEntry[];
  missingForQuote: RequirementField[];
  /** Needed for a quotation and mentioned, but not confirmed. */
  unconfirmedForQuote: RequirementField[];
};

export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP", "CPT", "CIP", "DPU", "FAS"] as const;

/** Structured values from the lead and its quotations (authoritative CRM data). */
export function recordedValues(lead: RecordItem, quotations: RecordItem[], refs: { lead?: string; quotation?: (q: RecordItem) => string | undefined } = {}) {
  const out: { field: RequirementField; value: RequirementValue }[] = [];
  const field = (label: string): RequirementSource => ({ label: `Lead field · ${label}`, ref: refs.lead, kind: "field" });
  if (lead.product?.trim()) out.push({ field: "product", value: { value: lead.product.trim(), source: field("Product / Grade"), confidence: "recorded", status: "recorded" } });
  if (lead.quantity > 0) out.push({ field: "quantity", value: { value: `${lead.quantity} ${lead.unit || ""}`.trim(), source: field("Quantity"), confidence: "recorded", status: "recorded" } });
  const destination = [lead.destination?.trim(), lead.attributes?.country?.trim()].filter(Boolean).join(", ");
  if (destination) out.push({ field: "destination", value: { value: destination, source: field("Destination"), confidence: "recorded", status: "recorded" } });
  for (const [attr, f] of [["incoterm", "incoterm"], ["packaging", "packaging"], ["paymentTerms", "paymentTerms"]] as const) {
    const v = lead.attributes?.[attr]?.trim();
    if (v && v !== "Not specified") out.push({ field: f, value: { value: v, source: field(REQUIREMENT_LABELS[f]), confidence: "recorded", status: "recorded" } });
  }
  for (const q of quotations) {
    const src: RequirementSource = { label: `Quotation · ${q.id}`, ref: refs.quotation?.(q), kind: "quotation" };
    const inc = q.attributes?.incoterm?.trim();
    if (inc && inc !== "Not specified") out.push({ field: "incoterm", value: { value: inc, source: src, confidence: "recorded", status: "recorded" } });
    const pay = q.attributes?.paymentTerms?.trim();
    if (pay) out.push({ field: "paymentTerms", value: { value: pay, source: src, confidence: "recorded", status: "recorded" } });
    for (const line of q.lines ?? []) if (line.packaging?.trim()) out.push({ field: "packaging", value: { value: line.packaging.trim(), source: src, confidence: "recorded", status: "recorded" } });
    out.push({ field: "quotationRequested", value: { value: `Yes — quotation ${q.id} (${q.status})`, source: src, confidence: "recorded", status: "recorded" } });
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[\s .,;:'"`()\-–—/]+/g, " ").trim();

/** True when `evidence` really appears in `text` (case/space/punctuation-insensitive). */
export function evidenceFound(evidence: string, text: string) {
  const e = squash(evidence);
  return e.length >= 3 && squash(text).includes(e);
}

/** The first number in a value, for comparing quantities ("500 MT" vs "500MT/month"). */
const number = (s: string) => {
  const m = s.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** Whether two values for a field say the same thing. */
export function sameValue(field: RequirementField, a: string, b: string) {
  if (field === "quantity" || field === "targetPrice") {
    const [x, y] = [number(a), number(b)];
    if (x !== null && y !== null) return x === y;
  }
  if (field === "incoterm") {
    const code = (s: string) => INCOTERMS.find((t) => new RegExp(`\\b${t}\\b`, "i").test(s)) ?? squash(s);
    return code(a) === code(b);
  }
  const [x, y] = [squash(a), squash(b)];
  return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)));
}

export type Extracted = { field: string; value: string; evidence: string; ref: string; status?: string };

/** The sentence of `text` that contains `evidence` (so the claim is read in context). */
export function sentenceOf(evidence: string, text: string) {
  const e = squash(evidence);
  return text.split(/(?<=[.!?])\s+|\n+/).find((s) => squash(s).includes(e)) ?? evidence;
}

/**
 * What a sentence says about a value, from its wording alone — the ceiling
 * for the model's status. A question or a request can never be "agreed".
 */
export function statusFromSentence(sentence: string): ClaimStatus {
  const s = sentence.toLowerCase();
  const negatedAgreement = /\b(?:not|never|no|cannot|can't|won't|didn't|did not|haven't|has not|hasn't|yet to)\b[^.?!]{0,25}\b(?:agree|agreed|confirm|confirmed|accept|accepted|approve|approved)\b/.test(s);
  const question = /\?\s*$/.test(sentence.trim()) || /^\s*(?:can|could|would|will|do|does|is|are|may)\s+(?:you|we|it|they)\b/.test(s) || /\b(?:is it possible|any chance|whether)\b/.test(s);
  if (!negatedAgreement && !question && /\b(?:agreed|we agree|both agree|signed|finali[sz]ed|accepted|approved|deal (?:is )?(?:done|closed))\b/.test(s)) return "agreed";
  if (!negatedAgreement && !question && /\b(?:confirmed|confirms|we confirm|confirmation)\b/.test(s)) return "confirmed";
  if (question) return "discussed";
  if (/\b(?:we offer|we propose|we can offer|our offer|we quoted|proposal)\b/.test(s)) return "proposed";
  if (/\b(?:prefer|preferred|preference|would like|ideally|rather)\b/.test(s)) return "preferred";
  if (/\b(?:require|required|requires|requirement|need|needs|needed|must|want|wants|looking for|target|budget|asked for|request|requests|requested|enquir|inquir)/.test(s)) return "requested";
  if (negatedAgreement) return "discussed";
  return "discussed";
}

/** The model's status, never above what the sentence itself supports. */
export function claimStatus(modelStatus: string | undefined, sentence: string): ClaimStatus {
  const ceiling = statusFromSentence(sentence);
  const m = (STATED_STATUSES as readonly string[]).includes(modelStatus ?? "") ? (modelStatus as ClaimStatus) : ceiling;
  return RANK[m] > RANK[ceiling] ? ceiling : m === "unknown" && RANK[ceiling] > 0 ? ceiling : m;
}

/**
 * Keeps an AI-extracted value only if: the field is known, the reference was
 * handed out, and the evidence is found in THAT reference's source text.
 */
export function verifyExtracted(items: Extracted[], sources: Map<string, { label: string; kind: RequirementSource["kind"]; text: string }>) {
  const kept: { field: RequirementField; value: RequirementValue }[] = [];
  const rejected: Extracted[] = [];
  for (const i of items) {
    const src = sources.get(i.ref);
    const field = (REQUIREMENT_FIELDS as readonly string[]).includes(i.field) ? (i.field as RequirementField) : null;
    const value = i.value?.trim();
    if (!src || !field || !value || value.length > 160 || !evidenceFound(i.evidence ?? "", src.text)) {
      rejected.push(i);
      continue;
    }
    // The value must itself be supported by the evidence (no "evidence: 'SN500', value: '800 MT'").
    const supported = field === "quantity" || field === "targetPrice" ? number(value) !== null && (i.evidence.replace(/,/g, "").includes(String(number(value))) || squash(i.evidence).includes(squash(value))) : sameValue(field, value, i.evidence) || squash(i.evidence).includes(squash(value));
    if (!supported) {
      rejected.push(i);
      continue;
    }
    const status = claimStatus(i.status, sentenceOf(i.evidence, src.text));
    kept.push({ field, value: { value, source: { label: src.label, ref: i.ref, kind: src.kind }, confidence: evidenceFound(value, src.text) ? "high" : "medium", status } });
  }
  return { kept, rejected };
}

export function buildProfile(values: { field: RequirementField; value: RequirementValue }[]): RequirementProfile {
  const entries = REQUIREMENT_FIELDS.map((field): ProfileEntry => {
    const all = values.filter((v) => v.field === field).map((v) => v.value);
    // One entry per distinct value (sources of the same value merged, recorded first).
    const distinct: RequirementValue[] = [];
    for (const v of all.sort((a, b) => (a.confidence === "recorded" ? -1 : 0) - (b.confidence === "recorded" ? -1 : 0))) {
      if (!distinct.some((d) => sameValue(field, d.value, v.value) && d.source.label === v.source.label)) distinct.push(v);
    }
    const groups: RequirementValue[][] = [];
    for (const v of distinct) {
      const g = groups.find((g) => sameValue(field, g[0].value, v.value));
      if (g) g.push(v);
      else groups.push([v]);
    }
    // Different values conflict; one value is "confirmed" only if some source settles it.
    const status = !groups.length ? "missing" : groups.length > 1 ? "conflict" : distinct.some((v) => isSettledStatus(v.status)) ? "confirmed" : "requested";
    // Settled sources first, so the value shown first is the strongest one.
    distinct.sort((a, b) => RANK[b.status] - RANK[a.status]);
    return { field, label: REQUIREMENT_LABELS[field], status, values: distinct };
  });
  const of = (f: RequirementField) => entries.find((e) => e.field === f)!.status;
  return {
    entries,
    conflicts: entries.filter((e) => e.status === "conflict"),
    missingForQuote: QUOTE_REQUIRED.filter((f) => of(f) === "missing"),
    unconfirmedForQuote: QUOTE_REQUIRED.filter((f) => of(f) === "requested"),
  };
}

/** Commercial terms: a customer's request for these is never taken as Enercore's acceptance. */
export const COMMERCIAL_TERMS: RequirementField[] = ["incoterm", "paymentTerms", "targetPrice", "deliveryTimeline"];

/**
 * A single, unambiguous value for a field — or null. By default only settled
 * values (recorded / confirmed / agreed); `allowRequested` also accepts what
 * the customer asked for (right for WHAT to quote: product, quantity,
 * destination, packaging — never for commercial terms).
 */
export const settled = (p: RequirementProfile, field: RequirementField, options: { allowRequested?: boolean } = {}) => {
  const e = p.entries.find((x) => x.field === field)!;
  if (e.status === "confirmed") return e.values[0].value;
  if (e.status === "requested" && options.allowRequested && !COMMERCIAL_TERMS.includes(field)) return e.values[0].value;
  return null;
};

/**
 * What a quotation draft may be pre-filled with: never a price (the unit
 * price stays blank), never anything conflicting. What to quote (product,
 * quantity, destination, packaging) may follow the customer's request; the
 * commercial terms (Incoterm, payment terms) only when recorded or agreed.
 */
export function quotationPrefill(lead: RecordItem, p: RequirementProfile) {
  const ask = { allowRequested: true };
  const qty = settled(p, "quantity", ask);
  const qn = qty ? number(qty) : null;
  const unitMatch = qty?.match(/\b(MT|kg|litre|drum|pail|piece)s?\b/i)?.[1];
  const incoterm = settled(p, "incoterm");
  const code = incoterm ? INCOTERMS.find((t) => new RegExp(`\\b${t}\\b`, "i").test(incoterm)) : undefined;
  return {
    product: settled(p, "product", ask) ?? "",
    quantity: qn ?? 0,
    unit: unitMatch ? (unitMatch.toLowerCase() === "mt" ? "MT" : unitMatch.toLowerCase()) : lead.unit || "MT",
    destination: settled(p, "destination", ask) ?? "",
    incoterm: code && ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"].includes(code) ? code : "",
    packaging: settled(p, "packaging", ask) ?? "",
    paymentTerms: settled(p, "paymentTerms") ?? "",
  };
}

/** A quotation draft may be started once the product and quantity are known (recorded, or requested by the customer) and not conflicting. */
export const canStartQuotation = (p: RequirementProfile) => !!settled(p, "product", { allowRequested: true }) && !!settled(p, "quantity", { allowRequested: true });
