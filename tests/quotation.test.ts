import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, quotationError } from "../src/lib/quotation";
import { transition } from "../src/lib/workflow";
import { makePreview, previewActor } from "../src/lib/fixtures";
test("amount words are calculated from minor units, including fractions and supported currencies", () => {
  assert.equal(
    amountInWords(28500000, "USD"),
    "Two hundred eighty-five thousand US dollars only",
  );
  assert.equal(
    amountInWords(10025, "AED"),
    "One hundred UAE dirhams and twenty-five fils only",
  );
  assert.equal(amountInWords(0, "EUR"), "Zero euros only");
  assert.equal(amountInWords(-1, "USD"), "");
});
test("quotation validity and line amounts are checked", () => {
  const lines = [{ quantity: 1, unitPriceCents: 100 }];
  assert.ok(quotationError(lines, "2026-09-22", "2026-09-21"));
  assert.ok(quotationError(lines, "2026-02-30", "2026-09-22"));
  assert.ok(
    quotationError(
      [{ quantity: 1000000, unitPriceCents: 100000000 }],
      "2026-09-22",
      "2026-09-23",
    ),
  );
  assert.ok(quotationError([], "2026-09-22", "2026-09-23"));
  assert.equal(quotationError(lines, "2026-09-22", "2026-09-23"), "");
});
test("accepted quotations preserve country, parties and packaging in downstream records", () => {
  const record = {
    ...makePreview().records.find((r) => r.kind === "quotations")!,
    status: "Approved",
    attributes: { country: "Vietnam", customerAddress: "Test address" },
    lines: [
      {
        description: "Bitumen",
        quantity: 500,
        unitPriceCents: 57000,
        packaging: "Steel drums / MT",
      },
    ],
  };
  const result = transition(
    { records: [record], audit: [] },
    previewActor,
    record.id,
    "Accepted",
  );
  for (const r of result.records.filter((r) => r.id !== record.id)) {
    assert.equal(r.attributes?.country, "Vietnam");
    assert.equal(r.lines?.[0].packaging, "Steel drums / MT");
  }
  assert.equal(result.records.length, 4);
});
