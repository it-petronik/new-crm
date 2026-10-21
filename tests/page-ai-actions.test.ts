import test from "node:test";
import assert from "node:assert/strict";
import { pageAiActions } from "../src/lib/ai/page-actions";
import { previewActor, makePreview } from "../src/lib/fixtures";
import { keywordRoute } from "../src/lib/ai/tools/management";
import { routeSchema } from "../src/lib/ai/schema";
test("page AI shortcuts match existing read-only tools and never expose ungranted modules", () => {
  const md = previewActor;
  for (const module of [
    "overview",
    "leads",
    "quotations",
    "orders",
    "logistics",
    "accounts",
    "customers",
    "suppliers",
    "products",
    "hr",
    "marketing",
    "it",
    "activity",
    "settings",
    "approvals",
  ] as const) {
    const actions = pageAiActions(md, module);
    assert.ok(actions.length > 0, module);
    for (const a of actions)
      assert.notEqual(keywordRoute(a.question, md).tool, "none", a.question);
  }
  const sales = { ...md, role: "Sales Executive" as const };
  assert.deepEqual(pageAiActions(sales, "hr"), []);
  assert.deepEqual(
    pageAiActions({ ...md, moduleAccess: { accounts: "none" } }, "accounts"),
    [],
  );
  assert.ok(
    !pageAiActions(sales, "overview").some((a) => /invoices/.test(a.label)),
  );
});
test("supplier and product status questions are scoped read-only breakdowns", () => {
  for (const kind of ["suppliers", "products"] as const) {
    assert.equal(
      keywordRoute(`How many ${kind} are in each status?`, previewActor).kind,
      kind,
    );
    assert.equal(
      routeSchema.parse({ tool: "status_breakdown", kind }).kind,
      kind,
    );
  }
  const foreign = { ...makePreview().records[0], company: "Other brand" };
  assert.ok(
    !pageAiActions(previewActor, "suppliers", foreign).some(
      (a) => a.label === "Find related opportunities",
    ),
  );
});
