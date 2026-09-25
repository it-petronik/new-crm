/**
 * One way to write money.
 *
 * Values were appearing as `$358.0k`, `USD 358000` and `358K USD` in different
 * places, which makes two figures impossible to compare at a glance. Every
 * amount in the CRM now goes through here.
 *
 * Currency is always the record's own. Amounts in different currencies are
 * never added together, because there is no conversion model in the system and
 * inventing one would produce a confident wrong number.
 */

const compact = (currency: string, value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: value >= 10_000_000 ? 2 : 1,
  }).format(value);

const exact = (currency: string, value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

/**
 * Full precision. Use wherever the exact figure matters — a row, an invoice,
 * a quotation line.
 */
export const formatMoney = (value: number, currency = "USD") =>
  exact(currency, Number.isFinite(value) ? value : 0);

/**
 * Shortened, for headline figures where the magnitude is the point and the
 * last few digits are not. Small values are written out in full, because
 * "$0.9k" is harder to read than "$900".
 */
export const formatMoneyCompact = (value: number, currency = "USD") => {
  const amount = Number.isFinite(value) ? value : 0;
  return Math.abs(amount) < 10_000 ? exact(currency, amount) : compact(currency, amount);
};

export type MoneyTotal = { currency: string; value: number };

/**
 * Totals per currency, never across them.
 *
 * Returns one entry per currency present, largest first, so a caller can show
 * "USD 1.2M · AED 480k" rather than a single meaningless sum.
 */
export function totalsByCurrency(
  records: { amount?: number; currency?: string }[],
): MoneyTotal[] {
  const totals = new Map<string, number>();
  for (const record of records) {
    const amount = Number(record.amount) || 0;
    if (!amount) continue;
    const currency = record.currency || "USD";
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  return [...totals.entries()]
    .map(([currency, value]) => ({ currency, value }))
    .sort((a, b) => b.value - a.value);
}

/** `USD 1.2M · AED 480k`, or `—` when there is nothing to show. */
export const describeTotals = (totals: MoneyTotal[]) =>
  totals.length ? totals.map((t) => formatMoneyCompact(t.value, t.currency)).join(" · ") : "—";
