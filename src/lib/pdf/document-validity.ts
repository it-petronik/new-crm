/** Derived from the same date fields used by validation; never a second date. */
export function documentValidity(
  issue?: string | null,
  expiry?: string | null,
) {
  if (!issue || !expiry) return "";
  const days = Math.round((Date.parse(expiry) - Date.parse(issue)) / 86400000);
  return Number.isFinite(days) && days >= 0
    ? days === 0
      ? "Valid through the document date"
      : `${days} ${days === 1 ? "day" : "days"}`
    : "";
}

/** Entry uses the reference's validity-in-days field; storage retains one expiry date. */
export function expiryFromValidity(issue: string, days: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue) || !/^\d{1,4}$/.test(days)) return "";
  const start = new Date(`${issue}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== issue) return "";
  start.setUTCDate(start.getUTCDate() + Number(days));
  return start.toISOString().slice(0, 10);
}

export function validityInDays(issue: string, expiry: string) {
  const count = Math.round((Date.parse(expiry) - Date.parse(issue)) / 86400000);
  return Number.isFinite(count) && count >= 0 ? String(count) : "0";
}
