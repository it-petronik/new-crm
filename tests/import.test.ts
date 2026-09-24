import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, readHeaders, CsvError, CSV_LIMITS } from "../src/lib/csv";
import {
  planImport, templateCsv, importColumns, naturalKey, failureCsv,
  IMPORTABLE_KINDS, isImportable,
} from "../src/lib/import";
import { previewActor } from "../src/lib/fixtures";

const ctx = { company: "Petronik", branch: "Main", actor: previewActor };
const head = importColumns("leads").map((c) => c.key).join(",");
const leadRow = (over: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    title: "Acme Trading", contact: "Sara", product: "Base oil", amount: "1000",
    currency: "USD", quantity: "5", unit: "MT", due: "2026-12-01",
    source: "Manual", email: "sara@acme.test", phone: "123", ...over,
  };
  return importColumns("leads").map((c) => values[c.key] ?? "").join(",");
};

test("standard CSV, BOM, quoting and line endings all parse", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("﻿a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv('a,b\n"x,y",2'), [["a", "b"], ["x,y", "2"]]);
  assert.deepEqual(parseCsv('a,b\n"line\nbreak",2'), [["a", "b"], ["line\nbreak", "2"]]);
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [["a"], ['say "hi"']]);
  // Optional values may be empty.
  assert.deepEqual(parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]]);
});

test("malformed and abusive files are rejected, not guessed at", () => {
  assert.throws(() => parseCsv(""), CsvError);
  assert.throws(() => parseCsv("   "), CsvError);
  assert.throws(() => parseCsv('a,b\n"unterminated,2'), CsvError, "unclosed quote");
  assert.throws(() => parseCsv(`a\n${"x".repeat(CSV_LIMITS.cell + 1)}`), CsvError, "oversized cell");
  assert.throws(() => parseCsv("a,b\n" + "1,2\n".repeat(CSV_LIMITS.rows + 2)), CsvError, "too many rows");
  assert.throws(() => readHeaders([["name", "Name"]]), CsvError, "duplicate headers");
  assert.throws(() => readHeaders([["", ""]]), CsvError, "no headers at all");
  assert.throws(() => readHeaders([Array.from({ length: CSV_LIMITS.columns + 1 }, (_, i) => `c${i}`)]), CsvError);
  // Control characters are stripped rather than carried into a record.
  assert.equal(parseCsv("a\nx\u0000y")[1][0], "xy");
});

test("a valid row becomes exactly a create payload, with scope from the workspace", () => {
  const plan = planImport("leads", `${head}\n${leadRow()}`, ctx);
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
  assert.equal(plan.valid.length, 1);
  const payload = plan.valid[0].payload;
  assert.equal(payload.kind, "leads");
  assert.equal(payload.title, "Acme Trading");
  assert.equal(payload.quantity, 5, "numbers are numbers, not strings");
  // Scope and ownership are never taken from the file.
  assert.equal(payload.company, "Petronik");
  assert.equal(payload.branch, "Main");
  assert.ok(!("ownerId" in payload) && !("owner" in payload) && !("status" in payload));
});

test("every invalid field is reported with its row, field and reason", () => {
  const rows = [
    leadRow({ title: "" }),
    leadRow({ email: "not-an-email" }),
    leadRow({ currency: "GBP" }),
    leadRow({ quantity: "abc" }),
    leadRow({ due: "01/02/2026" }),
    leadRow({ amount: "-5" }),
  ];
  const plan = planImport("leads", `${head}\n${rows.join("\n")}`, ctx);
  assert.equal(plan.valid.length, 0, "no invalid row may be imported");
  const at = (row: number) => plan.errors.find((e) => e.row === row);
  assert.equal(at(2)?.field, "title");
  assert.match(String(at(3)?.reason), /valid email/);
  assert.match(String(at(4)?.reason), /not one of/);
  assert.match(String(at(5)?.reason), /not a number/);
  assert.match(String(at(6)?.reason), /YYYY-MM-DD/);
  assert.match(String(at(7)?.reason), /at least 0/);
});

test("unexpected and dangerous columns cannot reach a record", () => {
  const plan = planImport(
    "leads",
    `${head},ownerId,__proto__,nonsense\n${leadRow()},someone-else,polluted,junk`,
    ctx,
  );
  assert.equal(plan.valid.length, 1);
  const payload = plan.valid[0].payload as Record<string, unknown>;
  assert.equal(payload.ownerId, undefined, "a file must not choose ownership");
  assert.equal((payload as { nonsense?: unknown }).nonsense, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, "no prototype pollution");
  for (const c of ["ownerId", "__proto__", "nonsense"])
    assert.ok(plan.unknownColumns.includes(c), `${c} must be reported as ignored`);
});

test("formula-like values stay plain data and survive re-export inert", () => {
  const plan = planImport("leads", `${head}\n${leadRow({ title: "=cmd|calc" })}`, ctx);
  assert.equal(plan.valid.length, 1);
  assert.equal(plan.valid[0].payload.title, "=cmd|calc", "stored verbatim, never evaluated");
  // The failure report is a CSV too, so it must neutralise on the way out.
  const csv = failureCsv([{ row: 2, field: "title", reason: "=HYPERLINK(\"x\")" }]);
  assert.ok(!/,=HYPERLINK/.test(csv), csv);
});

test("duplicates are detected but never merged or overwritten", () => {
  const twice = `${head}\n${leadRow()}\n${leadRow({ title: "Acme Trading Ltd" })}`;
  const plan = planImport("leads", twice, ctx);
  assert.equal(plan.valid.length, 1, "the second row shares an email");
  assert.equal(plan.duplicatesInFile.length, 1);
  assert.equal(plan.duplicatesInFile[0].row, 3);

  // Against records already in the workspace.
  const existing = [{ kind: "leads", email: "sara@acme.test" }] as never;
  const against = planImport("leads", `${head}\n${leadRow()}`, ctx, existing);
  assert.equal(against.valid.length, 0);
  assert.equal(against.duplicatesExisting.length, 1);
});

test("a missing required column fails the file rather than importing partial rows", () => {
  const without = importColumns("leads").filter((c) => c.key !== "title");
  const csv = `${without.map((c) => c.key).join(",")}\n${without.map(() => "x").join(",")}`;
  const plan = planImport("leads", csv, ctx);
  assert.equal(plan.valid.length, 0);
  assert.ok(plan.errors.some((e) => e.field === "title" && /missing/.test(e.reason)));
});

test("templates exist for every importable module and round-trip cleanly", () => {
  for (const kind of IMPORTABLE_KINDS) {
    const csv = templateCsv(kind);
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0], importColumns(kind).map((c) => c.key));
    assert.equal(rows.length, 2, `${kind} template has one example row`);
    assert.ok(!/@(?!example\.invalid)/.test(csv), "no real address in a template");
  }
  // Only modules whose records are genuinely creatable stand-alone.
  for (const unsupported of ["quotations", "orders", "logistics", "accounts"])
    assert.equal(isImportable(unsupported), false, `${unsupported} must not claim import support`);
});

test("natural keys identify a business entity per module", () => {
  assert.equal(naturalKey("leads", { email: "A@B.test" }), "a@b.test");
  assert.equal(naturalKey("products", { "attributes.sku": "SKU-1" }), "sku-1");
  assert.equal(naturalKey("leads", {}), "", "no key means no duplicate claim");
});
