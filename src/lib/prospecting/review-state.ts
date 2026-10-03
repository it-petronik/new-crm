/**
 * How a staged Apollo prospect is presented for adding to Enercore. The
 * matching itself is the server's (authorized, deterministic); these only
 * decide which of three plain states a salesperson sees.
 */
export type ProspectState = "ready" | "existing" | "review";
type Match = { id: string; reasons: string[] };

/** The customer this prospect was already added as, from Apollo. */
export const alreadyAdded = (matches: Match[]) =>
  matches.find((m) => m.reasons.includes("Same Apollo company reference"))?.id || "";

/**
 * One prospect: using an existing customer, needing a decision between the
 * possible matches, or ready to add as new ("separate" confirms new despite
 * matches).
 */
export function prospectState(matches: Match[], chosenCustomerId: string, separate: boolean): ProspectState {
  if (chosenCustomerId) return "existing";
  return matches.length && !separate ? "review" : "ready";
}

/**
 * One row of a bulk import: it needs review until the person decides; then
 * it is "existing" when it uses a customer, otherwise "ready".
 */
export function bulkState(item: { needsReview: boolean }, decided: boolean, customerId?: string): ProspectState {
  if (item.needsReview && !decided) return "review";
  return customerId ? "existing" : "ready";
}
