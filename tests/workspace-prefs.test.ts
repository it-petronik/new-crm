import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recentRecords, rememberRecord, pinnedIds, togglePin, isPinned, resolveVisible,
} from "../src/lib/workspace-prefs";

// A minimal localStorage, so the module can be exercised outside a browser.
const store = new Map<string, string>();
beforeEach(() => store.clear());
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
};

const rec = (id: string, over: Record<string, string> = {}) =>
  ({ id, title: `Record ${id}`, kind: "leads", company: "Petronik", ...over });

test("recent records are newest first, deduplicated and bounded", () => {
  for (let i = 1; i <= 12; i++) rememberRecord("u1", rec(`r${i}`));
  const recent = recentRecords("u1");
  assert.equal(recent.length, 10, "the list stays short");
  assert.equal(recent[0].id, "r12", "newest first");

  // Revisiting moves a record up rather than duplicating it.
  rememberRecord("u1", rec("r5"));
  const after = recentRecords("u1");
  assert.equal(after[0].id, "r5");
  assert.equal(after.filter((r) => r.id === "r5").length, 1);
});

test("preferences are per person", () => {
  rememberRecord("u1", rec("mine"));
  togglePin("u1", "mine");
  assert.equal(recentRecords("u2").length, 0, "another user sees nothing of theirs");
  assert.equal(pinnedIds("u2").length, 0);
  assert.equal(isPinned("u1", "mine"), true);
});

test("pinning toggles and is bounded", () => {
  assert.deepEqual(togglePin("u1", "a"), ["a"]);
  assert.deepEqual(togglePin("u1", "b"), ["b", "a"]);
  assert.deepEqual(togglePin("u1", "a"), ["b"], "pinning again removes it");
  for (let i = 0; i < 30; i++) togglePin("u1", `p${i}`);
  assert.ok(pinnedIds("u1").length <= 20);
});

test("a stored id grants no access; it is resolved against what is visible", () => {
  const visible = [rec("seen"), rec("also-seen")];
  // An id the person can no longer see simply drops out.
  assert.deepEqual(
    resolveVisible(["seen", "secret", "also-seen"], visible).map((r) => r.id),
    ["seen", "also-seen"],
  );
  assert.deepEqual(resolveVisible(["secret"], visible), []);
  // Order follows the stored list, not the visible list.
  assert.deepEqual(resolveVisible(["also-seen", "seen"], visible).map((r) => r.id), ["also-seen", "seen"]);
});

test("unusable storage degrades to empty rather than throwing", () => {
  const broken = {
    localStorage: {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
    },
  };
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = broken;
  assert.deepEqual(recentRecords("u1"), []);
  assert.deepEqual(pinnedIds("u1"), []);
  assert.doesNotThrow(() => rememberRecord("u1", rec("x")));
  assert.doesNotThrow(() => togglePin("u1", "x"));
  (globalThis as { window?: unknown }).window = original;
});
