import { test } from "node:test";
import assert from "node:assert/strict";
import { labels } from "../src/lib/domain";
import { moduleHelp, fieldHelp, pageGuides } from "../src/lib/workspace-help";

test("every business module has a short purpose and three practical steps", () => {
  for (const module of Object.keys(labels) as (keyof typeof moduleHelp)[]) {
    assert.ok(moduleHelp[module]?.purpose);
    assert.equal(moduleHelp[module].steps.length, 3);
  }
});
test("help keeps financial and permission distinctions explicit", () => {
  assert.match(fieldHelp.Currency, /does not convert/);
  assert.match(fieldHelp["Employee role"], /does not grant/);
  assert.match(moduleHelp.accounts.steps.join(" "), /Do not record the same invoice payment/);
  assert.match(pageGuides.Prospecting.steps.join(" "), /credit/);
});
