import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateScenario,
  quotationPrice,
  offerValidity,
  comparisonKey,
  offerInput,
  scenarioInput,
} from "../src/lib/execution/model";
import { offer, scenario } from "./support/phase7";
test("decimal components, revenue and margin are deterministic", () => {
  const c = calculateScenario(scenario, offer);
  assert.equal(c.landedCost, "11000.00");
  assert.equal(c.sellingTotal, "13000.00");
  assert.equal(c.marginAmount, "2000.00");
  assert.equal(c.marginPercent, "15.38");
  assert.equal(c.landedUnitCost, "550.00");
});
test("manual FX and all supported cost categories round component cents", () => {
  const c = calculateScenario(
    {
      ...scenario,
      currency: "AED",
      sellPrice: "2400",
      fx: [{ fromCurrency: "USD", toCurrency: "AED", rate: "3.6725" }],
      costs: [
        { kind: "freight", amount: "0.005", currency: "AED", basis: "total" },
        {
          kind: "insurance",
          amount: "1.123456",
          currency: "AED",
          basis: "per-unit",
          unit: "MT",
        },
        { kind: "handling", amount: "1", currency: "AED", basis: "total" },
        { kind: "bank", amount: "1", currency: "AED", basis: "total" },
        { kind: "commission", amount: "1", currency: "AED", basis: "total" },
        { kind: "other", amount: "1", currency: "AED", basis: "total" },
      ],
    },
    offer,
  );
  assert.equal(c.components[0].amount, "36725.00");
  assert.equal(c.components[1].amount, "0.01");
  assert.equal(c.components[2].amount, "22.47");
  assert.equal(c.landedCost, "36751.48");
});
for (const [name, input] of Object.entries({
  missingFx: { currency: "EUR" },
  zeroQty: { quantity: "0" },
  zeroSell: { sellPrice: "0" },
  wrongUnit: { unit: "KG" },
  wrongSellUnit: { sellUnit: "L" },
  excessQty: { quantity: "26" },
  negative: { sellPrice: "-1" },
  scientific: { sellPrice: "1e3" },
  tooPrecise: { sellPrice: "1.0000001" },
  unsafe: {
    currency: "AED",
    fx: [{ fromCurrency: "USD", toCurrency: "AED", rate: "999999999999" }],
  },
}))
  test(`reject unsafe scenario: ${name}`, () =>
    assert.throws(() =>
      calculateScenario({ ...scenario, ...input } as never, offer),
    ));
test("MOQ, cost unit and duplicate FX are checked", () => {
  assert.throws(() =>
    calculateScenario(scenario, { ...offer, moq: "21", moqUnit: "MT" }),
  );
  assert.throws(() =>
    calculateScenario(
      {
        ...scenario,
        costs: [
          {
            kind: "freight",
            amount: "1",
            currency: "USD",
            basis: "per-unit",
            unit: "KG",
          },
        ],
      },
      offer,
    ),
  );
  assert.throws(() =>
    calculateScenario(
      {
        ...scenario,
        fx: [
          { fromCurrency: "EUR", toCurrency: "USD", rate: "1" },
          { fromCurrency: "EUR", toCurrency: "USD", rate: "1.1" },
        ],
      },
      offer,
    ),
  );
});
test("negative margin is retained without inventing approval thresholds", () => {
  assert.equal(
    calculateScenario({ ...scenario, sellPrice: "400" }, offer).marginAmount,
    "-3000.00",
  );
});
test("quotation preserves sell price and rejects sub-cent unit price", () => {
  assert.deepEqual(quotationPrice(scenario), {
    quantity: 20,
    unitPriceCents: 65000,
    amount: 13000,
  });
  assert.throws(() => quotationPrice({ ...scenario, sellPrice: "650.001" }));
});
test("validity and comparison prevent unlike raw price ranking", () => {
  assert.equal(offerValidity("2026-09-27", "2026-09-28"), "Expired");
  assert.equal(offerValidity("2026-09-28", "2026-09-28"), "Expiring soon");
  assert.notEqual(
    comparisonKey(offer),
    comparisonKey({ ...offer, incoterm: "CIF" }),
  );
  assert.notEqual(
    comparisonKey(offer),
    comparisonKey({ ...offer, currency: "AED" }),
  );
  assert.throws(() => offerInput.parse({ ...offer, validUntil: "2026-99-99" }));
});

test("quotation rejects unsupported handoff currency and module amount limits", () => {
  assert.throws(() => quotationPrice({ ...scenario, currency: "GBP" }));
  assert.throws(() => quotationPrice({ ...scenario, sellPrice: "1000001" }));
  assert.throws(() => quotationPrice({ ...scenario, quantity: "1000001" }));
});

test("duplicate cost categories cannot disappear when a draft is edited", () => {
  assert.throws(() =>
    calculateScenario(
      { ...scenario, costs: [...scenario.costs, ...scenario.costs] },
      offer,
    ),
  );
});
