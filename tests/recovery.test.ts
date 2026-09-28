import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Each recovery case is a distinct unit check, counted once by the main runner.
// Python's standard SQLite library exercises the actual recovery implementation.
const cases: string[] = JSON.parse(execFileSync("python3", ["tests/recovery_test.py", "--list"], { encoding: "utf8" }));
for (const name of cases) {
  test(`recovery: ${name.replace(/^test_/, "").replaceAll("_", " ")}`, () => {
    assert.doesNotThrow(() => execFileSync("python3", ["tests/recovery_test.py", `Recovery.${name}`], { stdio: "pipe" }));
  });
}
