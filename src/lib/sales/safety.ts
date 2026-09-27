/**
 * Deterministic safety for AI-written text — checked on the server after the
 * model answers, so it holds whatever the model does.
 *
 * Drafts must never commit the company (stock, guaranteed delivery, confirmed
 * price, accepted payment terms) or quote an amount Enercore didn't supply.
 * Suggestions must never read as if something already happened.
 */

const COMMITMENTS: [RegExp, string][] = [
  [/\b(?:in stock|(?:we|i) (?:have|hold|carry|keep) (?:the )?(?:stock|inventory|material|product|quantity)|stock (?:is )?(?:available|ready|confirmed)|(?:product|material|quantity) is available)\b/i, "stock or availability"],
  [/\bguarantee(?:d|s)?\b|\bwe (?:will|can) (?:definitely|certainly|surely) deliver\b|\bdelivery (?:is|will be) (?:confirmed|assured)\b/i, "guaranteed delivery"],
  [/\b(?:we|i) (?:can |hereby )?confirm (?:the |our |your )?(?:price|pricing|rate|offer|availability|delivery|shipment|order)\b|\b(?:price|pricing|rate) (?:is|has been) (?:confirmed|fixed|final)\b|\bfirm (?:price|offer)\b/i, "a confirmed price or offer"],
  [/\b(?:we|i) (?:accept|agree to|approve) (?:your |the )?(?:payment|terms|credit|price|conditions)\b|\b(?:payment )?terms (?:are|have been) (?:accepted|agreed|approved)\b/i, "accepted payment terms"],
  // Commercial terms presented as accepted: "we confirm LC at sight", "we agree on CIF", "CIF works for us".
  [/\b(?:we|i) (?:can |hereby |will |are happy to |are pleased to )?(?:confirm|accept|agree(?: to| on)?|approve)\b.{0,50}\b(?:LC|L\/C|letter of credit|advance|credit|net \d+|days|CIF|CFR|FOB|EXW|FCA|DAP|DDP|CPT|CIP|incoterms?|payment|terms|price|rate|delivery|discount)\b/i, "accepted commercial terms"],
  [/\b(?:LC|L\/C|letter of credit|CIF|CFR|FOB|EXW|DAP|DDP|payment terms?|price|delivery date)\b.{0,30}\b(?:is|are) (?:fine|acceptable|ok|okay|agreed|confirmed)\b|\bworks for us\b/i, "accepted commercial terms"],
];

/** Words that turn a mention into our acceptance. */
const ACCEPTANCE = /\b(?:confirm|confirmed|accept|accepted|agree|agreed|approve|approved|guarantee|can do|can offer|will provide|will supply|is fine|is acceptable|works for us|no problem|go ahead with)\b/i;
const squashText = (s: string) => s.toLowerCase().replace(/[\s\u00a0.,;:'"()\-/]+/g, " ").trim();

/** Money in a text: "$48,000", "USD 800", "800 USD", "AED 12,000.50", "800/MT". */
const AMOUNT = /(?:(?:US)?\$|USD|AED|EUR|€|SGD|£)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|AED|EUR|SGD)\b/gi;
const digits = (s: string) => s.replace(/[^\d.]/g, "").replace(/\.0+$/, "").replace(/^0+(?=\d)/, "");

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

/**
 * Removes sentences that commit the company or quote amounts absent from the
 * context. Returns the cleaned text and what was removed (shown to the user).
 */
export function draftSafety(text: string, context: string, unconfirmed: string[] = []) {
  // Only MONEY amounts in the context count — a quantity like "800 MT" must
  // never make "$800" look supported.
  const known = new Set((context.match(AMOUNT) ?? []).map(digits));
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = sentences(line);
    if (!parts.length) {
      kept.push("");
      continue;
    }
    const good = parts.filter((s) => {
      // Acknowledging, reviewing or deferring is not accepting ("we noted your request for LC at sight").
      const deferring = /\b(?:noted|note your|received your|your request|reviewing|we will review|once|shortly|as soon as|revert|get back to you|after (?:we|our)|when (?:we|our))\b/i.test(s);
      const commitment = COMMITMENTS.find(([re, what]) => re.test(s) && !(what === "accepted commercial terms" && deferring));
      if (commitment) {
        removed.push(`Removed a statement about ${commitment[1]} that Enercore can't confirm: "${s.trim().slice(0, 120)}"`);
        return false;
      }
      // A value the customer only asked for / discussed, presented as accepted by us.
      const asked = unconfirmed.find((v) => v.trim().length >= 2 && squashText(s).includes(squashText(v)));
      if (asked && ACCEPTANCE.test(s) && !/\b(?:noted|note your|received your|your request|reviewing|we will review|considering|we will check|checking)\b/i.test(s)) {
        removed.push(`Removed a sentence presenting "${asked}" (requested, not confirmed) as accepted: "${s.trim().slice(0, 120)}"`);
        return false;
      }
      const unknown = (s.match(AMOUNT) ?? []).filter((a) => !known.has(digits(a)));
      if (unknown.length) {
        removed.push(`Removed an amount that isn't in the CRM (${unknown.join(", ")}).`);
        return false;
      }
      return true;
    });
    if (good.length) kept.push(good.join(" "));
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Wording that presents an action or decision as already done. */
const COMPLETED = /\b(?:(?:e-?mail|message|quotation|quote|offer|sample|proposal|follow-?up)s? (?:was |has been |were )?(?:sent|delivered|shared|submitted)|(?:customer|client|buyer|they|he|she) (?:has |have )?(?:agreed|accepted|approved|confirmed|signed|paid|placed (?:an |the )?order)|(?:called|emailed|messaged|spoke (?:to|with)|met with) (?:the )?(?:customer|client|buyer)|deal (?:is |was )?(?:closed|won)|payment (?:was |has been )?(?:received|made))\b/i;

export const claimsCompletedEvent = (text: string) => COMPLETED.test(text);

/**
 * True when a "completed" claim in model text is NOT backed by the context
 * (e.g. "Email sent" when no note says so) — such suggestions are dropped.
 */
export function unsupportedCompletion(text: string, context: string) {
  const m = text.match(COMPLETED);
  if (!m) return false;
  return !context.toLowerCase().includes(m[0].toLowerCase());
}
