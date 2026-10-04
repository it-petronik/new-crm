import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFields } from "../src/lib/entry-layout";
import { recordProfiles, cashEntryProfile } from "../src/lib/record-profiles";
import type { Kind } from "../src/lib/domain";

test("simple entry never hides required fields or drops optional fields", () => {
  for (const [kind, profile] of Object.entries(recordProfiles)) {
    const { basic, additional } = entryFields(kind as Kind, profile.fields, false);
    assert.ok(basic.every((f) => !additional.includes(f)));
    assert.equal(basic.length + additional.length, profile.fields.length);
    assert.ok(profile.fields.filter((f) => f.required).every((f) => basic.includes(f)));
  }
});
test("leads show just the requirement and next follow-up before optional detail", () => {
  const result = entryFields("leads", recordProfiles.leads.fields, false);
  assert.deepEqual(result.basic.map((f) => f.name), ["product", "due"]);
});
test("editing retains every field and cashbook retains required accounting inputs", () => {
  for (const [kind, profile] of Object.entries(recordProfiles)) {
    assert.deepEqual(entryFields(kind as Kind, profile.fields, true).basic, profile.fields);
  }
  const { basic } = entryFields("accounts", cashEntryProfile.fields, false);
  assert.ok(cashEntryProfile.fields.filter((f) => f.required).every((f) => basic.includes(f)));
});
