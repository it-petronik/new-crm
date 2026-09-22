import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardInsights } from "../src/lib/dashboard-insights";
import { makePreview, previewActor } from "../src/lib/fixtures";
const base = makePreview().records[0];
const order = {
  ...base,
  id: "one",
  kind: "orders" as const,
  status: "Confirmed",
  amount: 100,
  currency: "USD",
  company: "Petronik",
  product: "Base oil",
  createdAt: "2026-09-20T00:00:00Z",
  lines: undefined,
};
test("country sales rank line products, normalize case and disclose missing countries without guessing ports", () => {
  const r = dashboardInsights(
    previewActor,
    [
      {
        ...order,
        attributes: { country: " Vietnam " },
        lines: [{ description: "Bitumen", quantity: 2, unitPriceCents: 5000 }],
      },
      { ...order, id: "two", attributes: { country: "vietnam" } },
      { ...order, id: "three", destination: "Mombasa", attributes: {} },
      {
        ...order,
        id: "four",
        status: "Cancelled",
        attributes: { country: "Kenya" },
      },
    ],
    "USD",
  );
  assert.equal(r.countries.length, 1);
  assert.equal(r.countries[0].value, 200);
  assert.equal(r.countries[0].count, 2);
  assert.equal(r.countries[0].products.length, 2);
  assert.equal(r.missingCountry, 1);
});
test("sales rankings exclude cancelled orders, invoices, foreign currency and inaccessible companies", () => {
  const actor = { ...previewActor, companies: ["Petronik"] };
  const result = dashboardInsights(
    actor,
    [
      order,
      { ...order, id: "cancel", status: "Cancelled" },
      { ...order, id: "invoice", kind: "accounts" },
      { ...order, id: "eur", currency: "EUR" },
      { ...order, id: "foreign", company: "Afrilube" },
    ],
    "USD",
  );
  assert.equal(result.orderValue, 100);
  assert.equal(result.orders.length, 1);
  assert.equal(result.cancelled, 1);
});
test("line values count products correctly without double-counting repeated product lines", () => {
  const r = dashboardInsights(
    previewActor,
    [
      {
        ...order,
        lines: [
          { description: "Base oil", quantity: 2, unitPriceCents: 2500 },
          { description: "Base oil", quantity: 2, unitPriceCents: 2500 },
        ],
      },
    ],
    "USD",
  );
  assert.equal(r.sold[0].value, 100);
  assert.equal(r.sold[0].count, 1);
  assert.equal(r.people[0].value, 100);
});
test("demand excludes closed leads and loss metrics are separate from orders", () => {
  const r = dashboardInsights(
    previewActor,
    [
      { ...order, kind: "leads", status: "New" },
      { ...order, id: "lost", kind: "leads", status: "Lost" },
      { ...order, id: "won", kind: "leads", status: "Won" },
    ],
    "USD",
  );
  assert.equal(r.demand[0].count, 1);
  assert.equal(r.lostCount, 1);
  assert.equal(r.winRate, 50);
  assert.equal(r.orderValue, 0);
});
test("period and module restrictions produce honest empty results", () => {
  assert.equal(
    dashboardInsights(previewActor, [order], "USD", 30, new Date("2027-01-01"))
      .orders.length,
    0,
  );
  assert.equal(
    dashboardInsights(
      { ...previewActor, moduleAccess: { orders: "none" } },
      [order],
      "USD",
    ).orders.length,
    0,
  );
  assert.equal(dashboardInsights(previewActor, [], "USD").winRate, null);
});
test("missing product data is reported rather than ranked as a product", () => {
  const r = dashboardInsights(
    previewActor,
    [
      { ...order, product: "" },
      { ...order, id: "lead", kind: "leads", status: "New", product: "" },
    ],
    "USD",
  );
  assert.equal(r.sold.length, 0);
  assert.equal(r.unclassifiedSales, 100);
  assert.equal(r.missingDemand, 1);
  assert.equal(r.demand.length, 0);
});
