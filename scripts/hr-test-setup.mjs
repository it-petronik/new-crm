/** Generates ONLY a fresh local review config and fictional fixture. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, ".."),
  dir = mkdtempSync(resolve(root, ".wrangler/hr-review.")),
  config = resolve(dir, "wrangler.test.json");
execFileSync(process.execPath, [
  resolve(root, "scripts/collab-test-config.mjs"),
  config,
]);
const c = JSON.parse(readFileSync(config, "utf8"));
c.name = "enercore-hr-local-review";
c.vars.APP_URL = "http://localhost:8789";
c.vars.HR_UPLOADS_ENABLED = "true";
c.r2_buckets = [{ binding: "HR_FILES", bucket_name: "enercore-hr-local-only" }];
c.services = c.services.map((s) => ({ ...s, service: c.name }));
writeFileSync(config, JSON.stringify(c, null, 2));
const seed = execFileSync(
  resolve(root, "node_modules/.bin/tsx"),
  [resolve(root, "scripts/hr-test-seed.ts")],
  { encoding: "utf8", cwd: root },
);
writeFileSync(resolve(dir, "seed.sql"), seed, { mode: 0o600 });
process.stdout.write(dir + "\n");
