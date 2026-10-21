import test from "node:test";
import assert from "node:assert/strict";
import { makePreview, previewActor } from "../src/lib/fixtures";
import { dashboardTrend } from "../src/lib/dashboard-trend";
import { roleAiExamples, roleAiFocus } from "../src/lib/ai/role-focus";
import { keywordRoute } from "../src/lib/ai/tools/management";
import type { Actor, RecordItem } from "../src/lib/domain";

test("activity trend counts authorized creation months in GST, fills gaps, and ignores deleted records", () => {
  const base = makePreview().records[0];
  const rows: RecordItem[] = [
    { ...base, id: "one", kind: "leads", company: "Petronik", branch: "Main", createdAt: "2026-09-30T22:00:00Z" },
    { ...base, id: "two", kind: "leads", company: "Petronik", branch: "Main", createdAt: "2026-10-03T10:00:00Z" },
    { ...base, id: "hidden", company: "Afrilube", createdAt: "2026-11-01T00:00:00Z" },
    { ...base, id: "deleted", company: "Petronik", deletedAt: "2026-10-10", createdAt: "2026-12-01T00:00:00Z" },
  ];
  const actor: Actor = { ...previewActor, role: "MD", companies: ["Petronik"], branches: [] };
  const points = dashboardTrend(actor, rows);
  assert.equal(points.length, 6);
  assert.equal(points.at(-1)!.month, "2026-10");
  assert.equal(points.at(-1)!.count, 2);
  assert.equal(points.slice(0, -1).reduce((n, p) => n + p.count, 0), 0);
  assert.deepEqual(dashboardTrend(actor, []), []);
});
test("AI starters and deterministic routing reflect each role without granting tools", () => {
  for (const [role, kind] of [["Accountant", "accounts"], ["HR Manager", "hr"], ["Logistics Manager", "logistics"], ["Marketing Manager", "marketing"], ["IT Administrator", "it"]] as const) {
    const actor: Actor = { ...previewActor, role };
    assert.ok(roleAiFocus(actor).length > 20);
    const question = roleAiExamples(actor).find(q => /status/.test(q))!;
    assert.ok(question);
    assert.equal(keywordRoute(question, actor).kind, kind);
  }
  assert.equal(keywordRoute("How many support tickets are in each status?", { ...previewActor, role: "HR Manager" }).tool, "none");
});
