import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, recordsToCsv, exportColumns, exportFilename } from "../src/lib/export";
import { makePreview } from "../src/lib/fixtures";
import type { RecordItem } from "../src/lib/domain";

test("fields are quoted only when the format requires it", () => {
  const csv = toCsv([
    ["plain", "has,comma", 'has"quote', "has\nnewline", "", null, 42],
  ]);
  assert.equal(csv, 'plain,"has,comma","has""quote","has\nnewline",,,42');
  // RFC 4180 line endings.
  assert.equal(toCsv([["a"], ["b"]]), "a\r\nb");
});

test("spreadsheet formulas in record data are neutralised", () => {
  // A website enquiry supplies its own contact name, so this is untrusted
  // text. Excel executes a cell starting with = + - @.
  for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "=HYPERLINK(\"http://x\")"]) {
    const [cell] = toCsv([[dangerous]]).split(",");
    assert.ok(
      cell.startsWith("'") || cell.startsWith('"\''),
      `${dangerous} must not stay executable, got ${cell}`,
    );
  }
  // Ordinary values are untouched.
  assert.equal(toCsv([["Acme Ltd"]]), "Acme Ltd");
  assert.equal(toCsv([["1-2"]]), "1-2", "a leading digit is not a formula");
});

test("an export carries every record's columns, not only the first record's", () => {
  const records = makePreview().records.filter((r) => r.kind === "leads");
  assert.ok(records.length > 0, "fixture must contain leads");
  const labels = exportColumns(records);
  assert.ok(labels.length > 0);
  assert.equal(new Set(labels).size, labels.length, "columns must not repeat");

  const csv = recordsToCsv(records);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, records.length + 1, "one header plus one row each");
  for (const lead of ["Reference", "Status", "Company", "Branch", "Created"])
    assert.ok(lines[0].includes(lead), `header must include ${lead}`);
});

test("an empty selection produces a header-only file rather than throwing", () => {
  const csv = recordsToCsv([] as RecordItem[]);
  assert.equal(csv.split("\r\n").length, 1);
  assert.ok(csv.startsWith("Reference,Status,Company,Branch,Created"));
});

test("filenames are safe, dated and derived from the scope", () => {
  const at = new Date("2026-09-25T10:00:00Z");
  assert.equal(exportFilename("Petronik", "Sales pipeline", at), "petronik-sales-pipeline-2026-09-25.csv");
  // No path traversal or separators survive.
  const hostile = exportFilename("../../etc", "a/b c", at);
  assert.ok(!hostile.includes("/") && !hostile.includes(".."), hostile);
});
