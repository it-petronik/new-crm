import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { makePreview, previewActor } from "../src/lib/fixtures";
import {
  canReadDocumentSeal,
  documentSealUrl,
  documentSealSvg,
  PETRONIK_SEAL,
  usesApprovedSeal,
} from "../src/lib/pdf/document-seal";
import { quotationData } from "../src/lib/pdf/quotation-data";
import { proformaData } from "../src/lib/pdf/proforma-data";
import { Signature } from "../src/components/pdf/Signature";
import { waitForSealImages } from "../src/lib/pdf/print-document";
import { migratedDatabase } from "./support/sqlite-d1";

const quote = () =>
  makePreview().records.find(
    (r) => r.kind === "quotations" && r.company === "Petronik",
  )!;
test("approved seal is restricted to connected Petronik quotations and customer proformas", () => {
  const record = quote();
  assert.ok(documentSealUrl(record, true)?.includes(PETRONIK_SEAL.id));
  assert.equal(documentSealUrl(record, false), undefined);
  for (const company of ["Afrilube", "Petronex", "Istanegry"])
    assert.equal(documentSealUrl({ ...record, company }, true), undefined);
  for (const kind of ["leads", "customers", "suppliers", "accounts"] as const)
    assert.equal(usesApprovedSeal({ ...record, kind }), false);
  const proforma = {
    ...record,
    kind: "accounts" as const,
    attributes: { documentType: "proforma" },
  };
  assert.ok(usesApprovedSeal(proforma));
  assert.ok(proformaData(proforma, true).signatory.approvedSealUrl);
  assert.equal(usesApprovedSeal({ ...record, deletedAt: "2026-10-20" }), false);
});
test("document seal enforces existing company, branch and module read permissions", () => {
  const record = quote();
  assert.ok(canReadDocumentSeal(previewActor, record));
  assert.equal(
    canReadDocumentSeal({ ...previewActor, companies: ["Afrilube"] }, record),
    false,
  );
  assert.equal(
    canReadDocumentSeal(
      { ...previewActor, branches: ["Different Branch"] },
      record,
    ),
    false,
  );
  assert.equal(
    canReadDocumentSeal(
      { ...previewActor, moduleAccess: { quotations: "none" } },
      record,
    ),
    false,
  );
  assert.equal(
    canReadDocumentSeal({ ...previewActor, role: "Employee" }, record),
    false,
  );
});
test("seal adds only approved artwork, not a name/client signature, monetary change or status transition", () => {
  const record = quote(),
    before = structuredClone(record);
  const data = quotationData(record, true);
  const html = renderToStaticMarkup(
    createElement(Signature, { doc: data, referenceFieldsOnly: true }),
  );
  assert.match(html, /Approved Petronik signature and company stamp/);
  assert.match(html, /width="140" height="69"/);
  assert.ok(!html.includes("Client Representative"));
  assert.ok(!html.includes("data:image"));
  assert.deepEqual(quotationData(record, false).totals, data.totals);
  assert.deepEqual(record, before);
});
test("tampered or oversized seal bytes are refused instead of rendering an unapproved signature", async () => {
  for (const bad of ["", "a".repeat(200001), 'bad\"/><script>', "aGVsbG8="])
    await assert.rejects(documentSealSvg(bad, bad));
});
test("seal versions are immutable in the database", () => {
  const db = migratedDatabase();
  db.prepare("INSERT INTO ApprovedDocumentSeal VALUES(?,?,?,?,?,?)").run(
    "test-version",
    "Petronik",
    "fixture-signature",
    "fixture-stamp",
    "fixture-hash",
    1,
  );
  assert.throws(
    () =>
      db
        .prepare("UPDATE ApprovedDocumentSeal SET stampPng=? WHERE id=?")
        .run("replacement", "test-version"),
    /immutable/,
  );
  assert.equal(
    (
      db
        .prepare("SELECT stampPng FROM ApprovedDocumentSeal WHERE id=?")
        .get("test-version") as { stampPng: string }
    ).stampPng,
    "fixture-stamp",
  );
  db.close();
});
test("printing waits for seal decode and refuses missing, failed or timed-out images", async () => {
  await waitForSealImages([]);
  await waitForSealImages([
    {
      complete: true,
      naturalWidth: 273,
      decode: async () => {
        throw new Error("Should not decode a ready image");
      },
    },
  ]);
  const pending = {
    complete: false,
    naturalWidth: 0,
    decode: async () => {
      pending.naturalWidth = 273;
    },
  };
  await waitForSealImages([pending]);
  await assert.rejects(
    waitForSealImages([
      {
        complete: true,
        naturalWidth: 0,
        decode: async () => {
          throw new Error("Missing");
        },
      },
    ]),
  );
  await assert.rejects(
    waitForSealImages(
      [
        {
          complete: false,
          naturalWidth: 0,
          decode: () => new Promise(() => {}),
        },
      ],
      5,
    ),
    /timed out/,
  );
});
