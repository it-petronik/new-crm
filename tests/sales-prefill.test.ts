import { test } from "node:test";
import assert from "node:assert/strict";
import { quotationSources } from "../src/lib/sales-prefill";
import { makePreview, previewActor } from "../src/lib/fixtures";
test("quotation catalog excludes foreign company, branch, currency and unit", () => {
  const product = makePreview().records.find(
    (r) => r.kind === "products" && r.company === "Petronik",
  )!;
  const records = [
    product,
    { ...product, id: "other-company", company: "Afrilube" },
    { ...product, id: "other-branch", branch: "Restricted" },
    { ...product, id: "other-currency", currency: "AED" },
    { ...product, id: "other-unit", unit: "kg" },
  ];
  assert.deepEqual(
    quotationSources(
      records,
      previewActor,
      "Petronik",
      "Main",
      "USD",
      "MT",
    ).products.map((p) => p.id),
    [product.id],
  );
});
test("quotation sources respect actor access and omit inactive customers", () => {
  const customer = makePreview().records.find(
    (r) => r.kind === "customers" && r.company === "Petronik",
  )!;
  const records = [
    customer,
    { ...customer, id: "on-hold", status: "Credit Hold" },
  ];
  assert.equal(
    quotationSources(records, previewActor, "Petronik", "Main", "USD", "MT")
      .customers.length,
    1,
  );
  assert.equal(
    quotationSources(
      records,
      { ...previewActor, companies: ["Afrilube"] },
      "Petronik",
      "Main",
      "USD",
      "MT",
    ).customers.length,
    0,
  );
});
