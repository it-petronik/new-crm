import { test } from "node:test";
import assert from "node:assert/strict";
import { statusTone, knownStatuses } from "../src/lib/status";
import { formatMoney, formatMoneyCompact, totalsByCurrency, describeTotals } from "../src/lib/money-format";
import { stages } from "../src/lib/domain";

test("a business status means the same thing everywhere", () => {
  // The whole point of one map: the same status cannot be two colours.
  for (const status of ["Delayed", "Overdue", "Won", "Negotiation"]) {
    const tone = statusTone(status);
    assert.equal(statusTone(status.toLowerCase()), tone, "case must not change meaning");
    assert.equal(statusTone(` ${status} `), tone, "whitespace must not change meaning");
  }
  assert.equal(statusTone("Won"), "success");
  assert.equal(statusTone("Overdue"), "danger");
  assert.equal(statusTone("Delayed"), "danger");
  assert.equal(statusTone("Negotiation"), "warning");
  assert.equal(statusTone("Quote Sent"), "info");
  assert.equal(statusTone("Contacted"), "active");
  assert.equal(statusTone("New"), "neutral");
});

test("an unknown status reads as neutral rather than inventing a colour", () => {
  assert.equal(statusTone("Something Nobody Defined"), "neutral");
  assert.equal(statusTone(""), "neutral");
});

test("every status the CRM can actually produce has a deliberate tone", () => {
  const mapped = new Set(knownStatuses());
  const missing = [...new Set(Object.values(stages).flat())].filter(
    (s) => !mapped.has(s.toLowerCase()),
  );
  assert.deepEqual(missing, [], `these statuses would silently fall back to neutral: ${missing.join(", ")}`);
});

/** Intl separates a currency code from its number with a non-breaking space. */
const plain = (value: string) => value.replace(/\u00a0/g, " ");

test("money is written one way", () => {
  assert.equal(formatMoney(358000, "USD"), "$358,000");
  assert.equal(plain(formatMoney(1234.5, "AED")), "AED 1,234.5");
  assert.equal(formatMoney(Number.NaN, "USD"), "$0", "a bad value is not NaN on screen");

  // Compact only where the magnitude is the point; small values stay exact,
  // because "$0.9k" is harder to read than "$900".
  assert.equal(formatMoneyCompact(900, "USD"), "$900");
  assert.equal(formatMoneyCompact(358000, "USD"), "$358K");
  assert.match(formatMoneyCompact(2_400_000, "USD"), /2\.4M/);
});

test("currencies are never added together", () => {
  const totals = totalsByCurrency([
    { amount: 1000, currency: "USD" },
    { amount: 500, currency: "AED" },
    { amount: 2000, currency: "USD" },
    { amount: 0, currency: "EUR" },
    { amount: undefined, currency: "USD" },
  ]);
  assert.deepEqual(totals, [
    { currency: "USD", value: 3000 },
    { currency: "AED", value: 500 },
  ]);
  assert.match(plain(describeTotals(totals)), /\$3,000 · AED 500/);
  assert.equal(describeTotals([]), "—", "nothing to total reads as nothing, not zero");
});
