import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makePreview } from "../src/lib/fixtures";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { DocumentTemplate } from "../src/components/pdf/DocumentTemplate";
import type { RecordItem } from "../src/lib/domain";

test("quotation and proforma watermarks use only the issuing company's logo", () => {
  const quote = makePreview().records.find(r => r.kind === "quotations")!;
  for (const [company, file] of Object.entries({ Petronik: "petronik.png", Petronex: "petronex.svg", Afrilube: "afrilube.png", Istanegry: "istanergy.svg" })) {
    const data = quotationData({ ...quote, company: company as RecordItem["company"] });
    for (const type of ["quotation", "proforma"] as const) {
      const html = renderToStaticMarkup(createElement(DocumentTemplate, { type, data }));
      assert.match(html, /class="pdf-brand-watermark" aria-hidden="true"/);
      assert.match(html, new RegExp(`src="/brands/${file}"`));
      assert.match(html, /overflow:hidden/);
      assert.equal((html.match(/class="pdf-brand-watermark[" ]/g) || []).length, 1);
      assert.match(html, /class="pdf-company-logo/);
      assert.equal(data.signatory.approvedSealUrl, undefined);
    }
  }
});

test("missing branding is omitted without inventing another brand; other document types are unchanged", () => {
  const quote = makePreview().records.find(r => r.kind === "quotations")!;
  const data = quotationData(quote);
  const html = renderToStaticMarkup(createElement(DocumentTemplate, { type: "quotation", data: { ...data, from: { ...data.from, logoUrl: undefined } } }));
  assert.ok(!html.includes("pdf-brand-watermark"));
  assert.ok(!renderToStaticMarkup(createElement(DocumentTemplate, { type: "deliveryNote", data })).includes("pdf-brand-watermark"));
});
