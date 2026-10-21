import { test } from "node:test";
import assert from "node:assert/strict";
import { companies, type Actor, type RecordItem } from "../src/lib/domain";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { initializeLead, leadSummary } from "../src/lib/lead-desk";
import { leadAccountabilityCsv, leadReportGroups, leadReportMetrics } from "../src/lib/lead-report";

const at = "2026-10-21T08:00:00.000Z";
const sales: Actor = { ...previewActor, id: "sales-report", name: "Same Name", role: "Sales Executive", companies: ["Petronik"] };
const marketing = { ...sales, id: "marketing-report", name: "Fictional Marketing", role: "Marketing Manager" as const };
const manager: Actor = { ...previewActor, companies: [...companies] };
function lead(id: string, patch: Partial<RecordItem> = {}): RecordItem {
  return initializeLead({
    ...makePreview().records.find(r => r.kind === "leads")!,
    id, company: "Petronik", ownerId: sales.id, owner: sales.name,
    status: "New", source: "Website", createdAt: at, updatedAt: at, due: "",
    product: "Base Oil", quantity: 80, unit: "MT", destination: "Durban",
    attributes: { leadType: "Buyer inquiry", grade: "SN500" }, ...patch,
  }, sales);
}
test("weekly report includes brand/product/owner/source summaries and complete commercial details", () => {
  const r = lead("REPORT-1");
  const csv = leadAccountabilityCsv(manager, [r], { asOf: at, brands: [...companies], filters: [["Source filter", "Website"]] });
  for (const text of ["By brand", "By product / grade", "By owner", "By source", "Source filter,Website", "Quantity,Unit,Destination / port", "80,MT,Durban", "Received at,First response at", "Missing qualification details", "Median first response,Unknown", "Needs assignment,0", "All matching leads; not limited to the selected work queue or page"])
    assert.ok(csv.includes(text), text);
  assert.equal(leadReportGroups(manager, [r], "", "", [...companies])[0].groups.length, 5);
  assert.equal(leadReportGroups(manager, [r], "", "", [...companies])[0].groups.find(g => g.id === "Enercore")?.data.inquiries, 0);
});
test("report grouping preserves linked quote/order counts, supplier separation and cohort boundaries", () => {
  const a = lead("A"), old = lead("OLD", { createdAt: "2026-10-19T08:00:00.000Z" });
  const supplier = lead("SUPPLIER", { attributes: { leadType: "Supplier offer" } });
  const quote: RecordItem = { ...a, id: "QUOTE", kind: "quotations", status: "Sent", parentId: a.id };
  const order: RecordItem = { ...a, id: "ORDER", kind: "orders", status: "Confirmed", parentId: quote.id };
  const data = [a, old, supplier, quote, order];
  const groups = leadReportGroups(manager, data, "2026-10-21", "2026-10-21");
  for (const group of groups) {
    assert.equal(group.groups.reduce((n, g) => n + g.data.inquiries, 0), 1, group.title);
    assert.equal(group.groups.reduce((n, g) => n + g.data.converted, 0), 1, group.title);
    assert.equal(group.groups.reduce((n, g) => n + g.data.suppliers, 0), 1, group.title);
  }
  const csv = leadAccountabilityCsv(manager, data, { from: "2026-10-21", to: "2026-10-21" });
  assert.ok(!csv.includes("OLD,"));
  assert.match(csv, /Confirmed conversions,1 · 100%/);
});
test("reports never widen company, owner, module or deleted-record access", () => {
  const mine = lead("MINE");
  const unrelated = initializeLead(lead("SECRET-OWNER", { ownerId: "other" }), { ...sales, id: "other" });
  const records = [mine, unrelated, lead("SECRET-BRAND", { company: "Afrilube" }), lead("SECRET-DELETED", { deletedAt: at })];
  const csv = leadAccountabilityCsv(sales, records, { brands: [...companies] });
  assert.ok(csv.includes("MINE,"));
  assert.ok(!csv.includes("SECRET"));
  assert.equal(leadReportGroups(sales, records, "", "", [...companies])[0].groups.length, 1);
  const restricted = { ...sales, moduleAccess: { quotations: "none" as const, orders: "none" as const } };
  const report = leadAccountabilityCsv(restricted, records);
  assert.match(report, /Quotations sent,Restricted/);
  assert.match(report, /Confirmed conversions,Restricted/);
  assert.match(report, /,Restricted,Restricted,Restricted,/);
  assert.equal(leadSummary({ ...sales, moduleAccess: { leads: "none" } }, records).leads.length, 0);
});
test("employees with identical names have separate owner buckets", () => {
  const groups = leadReportGroups(manager, [lead("A"), lead("B", { ownerId: "other-sales", owner: sales.name })]);
  const owners = groups.find(g => g.title === "By owner")!.groups;
  assert.equal(owners.length, 2);
  assert.deepEqual(owners.map(g => g.id).sort(), ["other-sales", sales.id].sort());
  assert.ok(owners.every(g => g.data.inquiries === 1));
});
test("creator visibility survives handoff and unsafe spreadsheet formulas stay literal", () => {
  const r = initializeLead(lead("FORMULA", { title: '=HYPERLINK("https://invalid.test")' }), marketing);
  r.attributes = { ...r.attributes, leadOwnerRole: "Sales Executive" };
  const csv = leadAccountabilityCsv(marketing, [r]);
  assert.ok(csv.includes("FORMULA,"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.match(csv, /Quotations sent,Restricted/);
  assert.match(csv, /Response samples,0/);
});
test("screen and export share the same KPI labels, assignment count and response basis", () => {
  const r = initializeLead(lead("ASSIGN"), marketing);
  const summary = leadSummary(manager, [r]);
  const metrics = leadReportMetrics(manager, summary);
  const csv = leadAccountabilityCsv(manager, [r]);
  for (const [label, value] of metrics) assert.ok(csv.includes(`${label},${value}`));
  assert.deepEqual(metrics.find(([label]) => label === "Needs assignment"), ["Needs assignment", "1"]);
  assert.deepEqual(metrics.at(-1), ["New inquiries", "1"]);
  assert.match(csv, /elapsed minutes, not business-hour SLA/);
});
