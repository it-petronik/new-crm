import test from "node:test";
import assert from "node:assert/strict";
import {
  tableWorkbook,
  tableExportFilename,
  listExportData,
} from "../src/lib/table-export";
import { demoAnswer } from "../src/lib/ai/demo-answer";
import { makePreview, previewActor, demoAccounts } from "../src/lib/fixtures";
import { readFileSync } from "node:fs";
test("workbooks use literal strings, typed numbers/dates, theme, filters and author metadata", () => {
  const bytes = tableWorkbook({
    title: "Customer register",
    exportedBy: "Alex Morgan",
    at: new Date("2026-10-21T10:00:00Z"),
    headers: ["Name", "Quantity", "Amount", "Date"],
    rows: [['=HYPERLINK("bad")', 12, 12.5, new Date("2026-10-20")]],
  });
  const xml = new TextDecoder().decode(bytes);
  assert.ok(bytes[0] === 80 && bytes[1] === 75);
  assert.ok(xml.includes('t="inlineStr"'));
  assert.ok(!xml.includes("<f>"));
  assert.ok(xml.includes("<v>12</v>"));
  assert.ok(xml.includes("Alex Morgan"));
  assert.ok(xml.includes('autoFilter ref="A5:D6"'));
  assert.ok(xml.includes('ySplit="5"'));
  assert.ok(xml.includes("Arial"));
});
test("export filenames use Gulf business date, table and exporter with path-safe characters", () => {
  assert.equal(
    tableExportFilename(
      "Sales pipeline",
      "Alex Morgan",
      new Date("2026-10-20T22:00:00Z"),
    ),
    "Enercore_Sales-pipeline_2026-10-21_Alex-Morgan.xlsx",
  );
  assert.ok(!tableExportFilename("../../Table", "A/B").includes("/"));
});
test("generic list exports never serialize access settings, credential or nested payloads", () => {
  const result = listExportData(
    [
      {
        id: "secret-id",
        name: "Leila",
        passwordHash: "private",
        moduleAccess: { hr: "all" },
        token: "private-token",
        active: true,
        companies: ["Petronik"],
        notes: "=1+1",
      },
    ],
    "Users",
  );
  assert.deepEqual(result.headers, ["Name", "Active", "Companies", "Notes"]);
  assert.equal(result.rows.length, 1);
});
test("customer exports follow their actual profile, not irrelevant default quantity or amount fields", () => {
  const rows = makePreview().records.filter((r) => r.kind === "customers"),
    result = listExportData(rows, "Customers");
  assert.ok(result.headers.includes("Reference"));
  assert.ok(!result.headers.includes("Quantity"));
  assert.ok(!result.headers.includes("Amount"));
  assert.ok(result.headers.includes("Email"));
  assert.equal(result.rows.length, rows.length);
});
test("demo chat is explicitly fictional, read only and permission scoped", () => {
  const hr = demoAccounts.find((a) => a.actor.role === "HR Manager")!.actor;
  const result = demoAnswer("How many invoices?", hr, makePreview().records);
  assert.match(result.scope!, /fictional/);
  assert.equal(result.model, null);
  assert.equal(result.figures[0].value, "0");
  assert.deepEqual(result.suggestions, []);
});
test("the supplied Petronex symbol is used intact and cannot execute scripts", () => {
  const source = readFileSync("public/brands/petronex-symbol.svg", "utf8");
  assert.match(source, /viewBox="0 0 263 372"/);
  assert.doesNotMatch(source, /<script|<foreignObject|\bonload=/i);
  assert.ok(source.includes("</svg>"));
});
