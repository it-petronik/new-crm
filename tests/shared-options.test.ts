import { test } from "node:test";
import assert from "node:assert/strict";
import { capitalizeOption, optionCatalog, optionKey, canUseCatalog, canManageOption } from "../src/lib/shared-options";
import type { Actor } from "../src/lib/domain";
const actor: Actor = { id: "seller", name: "Seller", role: "Sales Executive", companies: ["Petronik"], branches: ["Main"] };
test("business choices allow customization but protected enums do not", () => {
  assert.equal(optionCatalog("leads", "source"), "leads:source");
  for (const field of ["status", "company", "currency", "role", "attributes.priority"]) assert.equal(optionCatalog("leads", field), null);
});
test("choices respect company, module and read-only permissions", () => {
  assert.ok(canUseCatalog(actor, "Petronik", "leads:source", true));
  assert.equal(canUseCatalog(actor, "Afrilube", "leads:source"), false);
  assert.equal(canUseCatalog(actor, "Petronik", "it:attributes.category", true), false);
  assert.equal(canUseCatalog({ ...actor, moduleAccess: { leads: "read" } }, "Petronik", "leads:source", true), false);
  assert.equal(canUseCatalog(actor, "Petronik", "leads:status", true), false);
});
test("only creator or manager can edit choices", () => {
  assert.ok(canManageOption(actor, "seller"));
  assert.equal(canManageOption(actor, "someone-else"), false);
  assert.ok(canManageOption({ ...actor, role: "MD" }, "someone-else"));
});
test("labels capitalize words without changing acronyms or deduplication semantics", () => {
  assert.equal(capitalizeOption("  partner   referral "), "Partner Referral");
  assert.equal(capitalizeOption("USD / IT"), "USD / IT");
  assert.equal(optionKey(" Partner   REFERRAL "), optionKey("partner referral"));
});
