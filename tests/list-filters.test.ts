import { test } from "node:test";
import assert from "node:assert/strict";
import {
  queryList,
  emptyQuery,
  searchText,
  mixedCurrencies,
  columnSort,
  sortDirection,
  nextSort,
} from "../src/lib/list-query";
import { localISO, windowStart } from "../src/lib/domain";
import { companyName } from "../src/lib/company-name";
import { chartSegments } from "../src/components/insight-chart";
import { salaryTotal } from "../src/lib/salary";
import { detailFields } from "../src/lib/record-profiles";
import { makePreview } from "../src/lib/fixtures";

const rows = [
  { id: "REC-1", title: "Diesel order", status: "Confirmed", amount: 900, currency: "AED", createdAt: "2026-09-01", due: "2026-03-01" },
  { id: "REC-2", title: "Base oil order", status: "Confirmed", amount: 100, currency: "USD", createdAt: "2026-09-02", due: "2026-01-05" },
  { id: "REC-3", title: "Lubricant order", status: "Cancelled", amount: 500, currency: "USD", createdAt: "2026-09-03", due: "2026-02-01" },
];

test("search matches stored values, not field names or bookkeeping keys", () => {
  // The old JSON.stringify search matched every row for any field name.
  assert.equal(queryList(rows, { ...emptyQuery, search: "status" }).length, 0);
  assert.equal(queryList(rows, { ...emptyQuery, search: "currency" }).length, 0);
  assert.equal(queryList(rows, { ...emptyQuery, search: "createdAt" }).length, 0);
  assert.equal(queryList(rows, { ...emptyQuery, search: "diesel" }).length, 1);
  assert.equal(queryList(rows, { ...emptyQuery, search: "  DIESEL  " }).length, 1);
  assert.equal(queryList(rows, { ...emptyQuery, search: "REC-2" })[0].id, "REC-2");
  // Booleans and excluded keys never become searchable text.
  assert.ok(!searchText({ active: true, deletedAt: "2026-01-01" }).includes("true"));
  assert.ok(!searchText({ active: true, deletedAt: "2026-01-01" }).includes("2026"));
});

test("amount ordering groups each currency instead of ranking across them", () => {
  const ordered = queryList(rows, { ...emptyQuery, sort: "amount-desc" });
  assert.deepEqual(ordered.map((r) => r.currency), ["AED", "USD", "USD"]);
  // AED 900 never outranks USD 100 as though the numbers were comparable.
  assert.deepEqual(ordered.filter((r) => r.currency === "USD").map((r) => r.amount), [500, 100]);
  assert.deepEqual(
    queryList(rows, { ...emptyQuery, sort: "amount" }).filter((r) => r.currency === "USD").map((r) => r.amount),
    [100, 500],
  );
  assert.equal(mixedCurrencies(rows), true);
  assert.equal(mixedCurrencies([rows[1], rows[2]]), false);
});

test("column sorting orders by the heading that was clicked", () => {
  assert.deepEqual(
    queryList(rows, { ...emptyQuery, sort: columnSort("due", "asc") }).map((r) => r.id),
    ["REC-2", "REC-3", "REC-1"],
  );
  assert.deepEqual(
    queryList(rows, { ...emptyQuery, sort: columnSort("due", "desc") }).map((r) => r.id),
    ["REC-1", "REC-3", "REC-2"],
  );
  assert.deepEqual(
    queryList(rows, { ...emptyQuery, sort: columnSort("status", "asc") }).map((r) => r.status),
    ["Cancelled", "Confirmed", "Confirmed"],
  );
  // The creation date still drives newest/oldest for views without columns.
  assert.deepEqual(
    queryList(rows, { ...emptyQuery, sort: "newest" }).map((r) => r.id),
    ["REC-3", "REC-2", "REC-1"],
  );
});

test("a column heading cycles ascending, descending, then back to default", () => {
  assert.equal(nextSort("default", "due"), "col:due:asc");
  assert.equal(nextSort("col:due:asc", "due"), "col:due:desc");
  assert.equal(nextSort("col:due:desc", "due"), "default");
  // Clicking a different column starts that column at ascending.
  assert.equal(nextSort("col:due:desc", "amount"), "col:amount:asc");
  assert.equal(sortDirection("col:due:asc", "due"), "asc");
  assert.equal(sortDirection("col:due:asc", "amount"), "");
  // The card dropdown writes the same specs, so both stay in step.
  assert.equal(sortDirection("name", "name"), "asc");
  assert.equal(sortDirection("amount-desc", "amount"), "desc");
  assert.equal(sortDirection("default", "name"), "");
});

test("chart segments are filtered before they are capped at four", () => {
  const withZero = [
    { name: "A", value: 0, count: 0 },
    { name: "B", value: 5, count: 1 },
    { name: "C", value: 4, count: 1 },
    { name: "D", value: 3, count: 1 },
    { name: "E", value: 2, count: 1 },
  ];
  // Slicing first dropped E and returned only three drawable segments.
  assert.deepEqual(chartSegments(withZero).map((r) => r.name), ["B", "C", "D", "E"]);
  assert.equal(chartSegments([{ name: "A", value: 9, count: 1 }]).length, 0);
  assert.equal(chartSegments([{ name: "A", value: 0, count: 0 }]).length, 0);
});

test("dashboard ranges use the local calendar, not the UTC day", () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.equal(localISO(now), expected);
  assert.equal(windowStart(1), expected, "Today must resolve to the local today");
  assert.ok(windowStart(7) < expected);
  assert.equal(localISO(new Date(2026, 0, 5)), "2026-01-05");
  // A 7 day window spans 7 distinct local days, inclusive of today.
  const start = new Date(windowStart(7) + "T00:00:00");
  const end = new Date(expected + "T00:00:00");
  assert.equal(Math.round((end.getTime() - start.getTime()) / 86400000), 6);
});

test("company labels are presentation only and spell Istanergy correctly", () => {
  assert.equal(companyName("Istanegry"), "Istanergy");
  assert.equal(companyName("Petronik"), "PETRONIK FZCO");
  assert.equal(companyName("Afrilube"), "Afrilube");
  assert.equal(companyName("Petronex"), "Petronex");
});

test("the monthly salary total is derived for display and legacy records survive", () => {
  assert.equal(salaryTotal({ basicSalary: "8000", allowance: "1250.75" }), "9250.75");
  // A stale stored total is ignored in favour of the components.
  assert.equal(salaryTotal({ basicSalary: "8000", allowance: "0", monthlySalary: "99999" }), "8000");
  // Records predating the split keep showing their own total.
  assert.equal(salaryTotal({ monthlySalary: "5000" }), "5000");
  assert.equal(salaryTotal({}), "");
  // Invalid input falls back rather than throwing in a read-only view.
  assert.equal(salaryTotal({ basicSalary: "abc", monthlySalary: "5000" }), "5000");
});

test("employee detail shows basic, allowance and the derived total", () => {
  const employee = {
    ...makePreview().records.find((r) => r.kind === "hr")!,
    attributes: { basicSalary: "8000", allowance: "1250.75", salaryCurrency: "AED" },
  };
  const rows = detailFields(employee);
  const labels = rows.map(([label]) => label);
  assert.ok(labels.includes("Basic salary"));
  assert.ok(labels.includes("Allowance"));
  assert.deepEqual(rows.find(([label]) => label === "Monthly total"), ["Monthly total", "9250.75 AED"]);
  // The total sits with the components rather than at the end of the list.
  assert.equal(labels.indexOf("Monthly total"), labels.indexOf("Salary currency") + 1);
  // Non-HR records gain no salary row.
  const order = makePreview().records.find((r) => r.kind === "orders")!;
  assert.ok(!detailFields(order).some(([label]) => label === "Monthly total"));
});
