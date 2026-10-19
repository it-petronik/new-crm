import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("default local launch is database-backed; lightweight UI demo is explicit", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts.dev, "bash scripts/local-review.sh");
  assert.equal(pkg.scripts["dev:ui"], "next dev --webpack");
  const script = readFileSync("scripts/local-review.sh", "utf8");
  assert.equal(spawnSync("bash", ["-n", "scripts/local-review.sh"]).status, 0);
  assert.ok(script.includes("local-review-current"));
  assert.ok(script.includes("--fresh"));
  assert.ok(!script.includes("--remote"));
  assert.ok(script.includes("livekit-server --config"));
  const seed = script.indexOf("LOCAL_DESIGN_FIXTURE=1");
  const guarded = script.lastIndexOf('if [[ -z "$REVIEW_RESUME" ]]', seed);
  const end = script.indexOf("\nfi", guarded);
  assert.ok(
    guarded >= 0 && end > seed,
    "resuming never reseeds edited design records",
  );
});
test("local Worker configuration keeps production application mode but only fake provider settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "enercore-local-config-"));
  try {
    const target = join(dir, "wrangler.json");
    const child = spawnSync(
      process.execPath,
      [resolve("scripts/collab-test-config.mjs"), target],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OUTBOUND_CONFIG: "must-not-copy",
          OUTBOUND_ENABLED: "true",
          APOLLO_API_KEY: "must-not-copy",
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const config = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(config.vars.APP_MODE, "production");
    assert.equal(config.vars.APP_URL, "http://localhost:8788");
    assert.equal(config.vars.MAIL_MODE, "sandbox");
    assert.equal(config.vars.OUTBOUND_CONFIG, undefined);
    assert.equal(config.vars.OUTBOUND_ENABLED, undefined);
    assert.equal(config.vars.APOLLO_API_KEY, undefined);
    assert.equal(config.vars.MAILBOX_ENCRYPTION_KEY, undefined);
    const keyFile = join(dir, ".dev.vars");
    const savedKey = readFileSync(keyFile, "utf8");
    assert.match(savedKey, /^MAILBOX_ENCRYPTION_KEY=[A-Za-z0-9+/]{43}=\n$/);
    assert.equal(
      spawnSync(process.execPath, [
        resolve("scripts/collab-test-config.mjs"),
        target,
      ]).status,
      0,
    );
    assert.equal(
      readFileSync(keyFile, "utf8"),
      savedKey,
      "restarting preserves the local encryption key",
    );
    assert.equal(config.routes, undefined);
    assert.ok(
      config.services.some(
        (s: { entrypoint: string }) => s.entrypoint === "FakeAi",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
