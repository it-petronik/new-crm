import { test } from "node:test";
import assert from "node:assert/strict";
import { companyName } from "../src/lib/company-name";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { makePreview } from "../src/lib/fixtures";

test("legal company label does not change persisted record/access keys", () => {
  const quote = makePreview().records.find(
    (r) => r.kind === "quotations" && r.company === "Petronik",
  )!;
  const doc = quotationData(quote);
  assert.equal(companyName(quote.company), "PETRONIK FZCO");
  assert.equal(doc.from.name, "PETRONIK FZCO");
  assert.equal(doc.signatory.companyName, "PETRONIK FZCO");
  assert.equal(quote.company, "Petronik");
  assert.equal(companyName("Afrilube"), "Afrilube");
  assert.equal(
    quotationData({ ...quote, attributes: { senderName: "Petronik" } }).from
      .name,
    "PETRONIK FZCO",
  );
});
