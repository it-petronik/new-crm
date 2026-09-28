import { z } from "zod";
import {
  canRead,
  canWrite,
  allowedModules,
  type Actor,
  type RecordItem,
} from "../domain";
import { CommercialError } from "../commercial/model";

export const id = z.string().trim().min(1).max(100);
const short = z.string().trim().max(300).default("");
export const decimal = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/,
    "Use a positive decimal with up to six decimal places.",
  );
export const currencies = [
  "USD",
  "AED",
  "EUR",
  "GBP",
  "INR",
  "SAR",
  "CNY",
  "SGD",
] as const;
export const currency = z.enum(currencies);
export const units = ["MT", "KG", "L", "DRUM", "IBC", "UNIT"] as const;
export const unit = z.enum(units);
const date = z
  .string()
  .refine(
    (s) =>
      !s ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(`${s}T00:00:00Z`)) &&
        new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s),
    "Use a valid date.",
  )
  .default("");
export const rfqStatuses = [
  "Draft",
  "Prepared",
  "Sent externally",
  "Responded",
  "Closed",
] as const;
export const rfqInput = z
  .object({
    grade: short,
    quantity: decimal,
    unit,
    destination: short,
    requestedIncoterm: short,
    incotermState: z
      .enum([
        "requested",
        "preferred",
        "proposed",
        "confirmed",
        "agreed",
        "unknown",
      ])
      .default("requested"),
    packaging: short,
    deliveryRequirement: short,
    notes: z.string().max(3000).default(""),
    followUpDate: date,
  })
  .strict();
export const offerInput = z
  .object({
    grade: short,
    quantity: decimal,
    unit,
    moq: decimal.optional(),
    moqUnit: unit.optional(),
    price: decimal,
    currency,
    priceUnit: unit,
    incoterm: short,
    origin: short,
    loadingPort: short,
    packaging: short,
    paymentTerms: short,
    leadTime: short,
    validUntil: date,
    availability: short,
    notes: z.string().max(3000).default(""),
    receivedAt: date,
  })
  .strict();
export const costKinds = [
  "freight",
  "insurance",
  "handling",
  "bank",
  "commission",
  "other",
] as const;
export const scenarioInput = z
  .object({
    quotationValidUntil: date,
    name: z.string().trim().min(1).max(100),
    quantity: decimal,
    unit,
    currency,
    sellPrice: decimal,
    sellUnit: unit,
    costs: z
      .array(
        z
          .object({
            kind: z.enum(costKinds),
            amount: decimal,
            currency,
            basis: z.enum(["total", "per-unit"]),
            unit: unit.optional(),
          })
          .strict(),
      )
      .max(6)
      .refine(
        (rows) => new Set(rows.map((row) => row.kind)).size === rows.length,
        "Use one reviewed total per cost category.",
      ),
    fx: z
      .array(
        z
          .object({
            fromCurrency: currency,
            toCurrency: currency,
            rate: decimal,
          })
          .strict(),
      )
      .max(7),
    incoterm: short,
    packaging: short,
    paymentTerms: short,
    deliveryRequirement: short,
    notes: z.string().max(2000).default(""),
  })
  .strict();
export type RFQDetails = z.infer<typeof rfqInput>;
export type OfferDetails = z.infer<typeof offerInput>;
export type ScenarioInput = z.infer<typeof scenarioInput>;
export type ScenarioDetails = ScenarioInput & {
  fxActor: string;
  fxEnteredAt: string;
};
export function canProspect(a: Actor) {
  return (
    [
      "MD",
      "Group Manager",
      "Branch Manager",
      "Sales Manager",
      "Sales Executive",
    ].includes(a.role) &&
    allowedModules(a).includes("leads") &&
    allowedModules(a).includes("customers") &&
    a.moduleAccess?.leads !== "read" &&
    a.moduleAccess?.customers !== "read"
  );
}
export function canBuyCosts(a: Actor, lead: RecordItem) {
  return (
    ["MD", "Group Manager", "Branch Manager"].includes(a.role) &&
    canRead(a, lead) &&
    allowedModules(a).includes("suppliers")
  );
}
export function canExecute(a: Actor, lead: RecordItem) {
  return canBuyCosts(a, lead) && canWrite(a, lead);
}
export const fail = (message: string): never => {
  throw new CommercialError(400, message);
};

// Fixed six-place inputs; all products/conversions use rational BigInt arithmetic.
// Round each extended cost component to currency cents, half away from zero;
// sum those cents, and round the displayed margin percentage to two places.
const SCALE = 1_000_000n;
function fixed(s: string): bigint {
  decimal.parse(s);
  const [whole, fraction = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function round(n: bigint, d: bigint): bigint {
  return n < 0n ? -round(-n, d) : (n + d / 2n) / d;
}
export function centsText(n: bigint) {
  return `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, "0")}`;
}
const checked = (n: bigint) => {
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    fail("The calculated amount exceeds the safe financial range.");
  return n;
};
export function calculateScenario(raw: ScenarioInput, offer: OfferDetails) {
  const {
    fxActor: _actor,
    fxEnteredAt: _at,
    ...inputs
  } = raw as ScenarioDetails;
  const s = scenarioInput.parse(inputs);
  offerInput.parse(offer);
  const qty = fixed(s.quantity);
  if (!qty) fail("Quantity must be above zero.");
  if (
    s.unit !== offer.priceUnit ||
    s.unit !== s.sellUnit ||
    s.unit !== offer.unit
  )
    fail(
      "Quantity and price units must match. Record a reviewed compatible offer first.",
    );
  if (fixed(offer.quantity) < qty)
    fail("Scenario quantity exceeds the supplier offer quantity.");
  if (
    offer.moq &&
    (!offer.moqUnit || offer.moqUnit !== s.unit || fixed(offer.moq) > qty)
  )
    fail("Check the supplier minimum quantity and unit.");
  const seen = new Set<string>();
  for (const fx of s.fx) {
    if (
      !fixed(fx.rate) ||
      fx.fromCurrency === fx.toCurrency ||
      fx.toCurrency !== s.currency ||
      seen.has(fx.fromCurrency)
    )
      fail(
        "Use one positive manual FX rate per source currency into the scenario currency.",
      );
    seen.add(fx.fromCurrency);
  }
  const convert = (
    amount: string,
    from: (typeof currencies)[number],
    perUnit: boolean,
  ) => {
    let n = fixed(amount) * (perUnit ? qty : SCALE) * 100n;
    let d = SCALE * SCALE;
    if (from !== s.currency) {
      const fx = s.fx.find(
        (f) => f.fromCurrency === from && f.toCurrency === s.currency,
      );
      if (!fx) fail(`Enter a manual FX rate from ${from} to ${s.currency}.`);
      n *= fixed(fx!.rate);
      d *= SCALE;
    }
    return checked(round(n, d));
  };
  const components = [
    { kind: "supplier", cents: convert(offer.price, offer.currency, true) },
  ];
  for (const c of s.costs) {
    if (c.basis === "per-unit" && c.unit !== s.unit)
      fail("A per-unit cost must use the scenario quantity unit.");
    components.push({
      kind: c.kind,
      cents: convert(c.amount, c.currency, c.basis === "per-unit"),
    });
  }
  const landed = checked(components.reduce((n, c) => n + c.cents, 0n));
  const revenue = convert(s.sellPrice, s.currency, true);
  if (!revenue) fail("Reviewed selling price must be above zero.");
  const margin = checked(revenue - landed);
  return {
    currency: s.currency,
    components: components.map((c) => ({
      kind: c.kind,
      amount: centsText(c.cents),
    })),
    landedCost: centsText(landed),
    sellingTotal: centsText(revenue),
    marginAmount: centsText(margin),
    marginPercent: centsText(round(margin * 10_000n, revenue)),
    landedUnitCost: centsText(round(landed * SCALE, qty)),
    rounding:
      "Each extended cost rounded to cents, half away from zero. Margin = (selling total − landed cost) / selling total.",
  };
}
export function quotationPrice(s: ScenarioInput) {
  if (!["USD", "AED", "EUR", "SGD"].includes(s.currency))
    fail(
      "The quotation module supports USD, AED, EUR and SGD. Create a reviewed scenario in a supported currency using explicit FX.",
    );
  const exact = fixed(s.sellPrice) * 100n;
  if (exact % SCALE)
    fail(
      "Quotation unit prices support two decimal places. Review the scenario selling price before preparing a quotation.",
    );
  const cents = checked(exact / SCALE);
  const q = fixed(s.quantity);
  // Existing quotation calculation must agree exactly at the handoff boundary.
  const amountCents = checked(round(cents * q, SCALE));
  if (
    cents > 100_000_000n ||
    q > 1_000_000n * SCALE ||
    amountCents > 100_000_000_000n
  )
    fail(
      "This scenario exceeds the quotation quantity or price limits. Review the commercial terms.",
    );
  const quantity = Number(s.quantity),
    unitPriceCents = Number(cents);
  if (Math.round(quantity * unitPriceCents) !== Number(amountCents))
    fail(
      "This quantity and price cannot be represented safely by the quotation module.",
    );
  return { quantity, unitPriceCents, amount: Number(amountCents) / 100 };
}
export function offerValidity(
  until: string,
  today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10),
) {
  if (!until) return "Not specified";
  const days = Math.floor((Date.parse(until) - Date.parse(today)) / 86400000);
  return days < 0 ? "Expired" : days <= 7 ? "Expiring soon" : "Valid";
}
export function comparisonKey(o: OfferDetails) {
  return `${o.currency}/${o.priceUnit}/${o.incoterm || "Unspecified Incoterm"}`;
}
