// Writes a test-only wrangler config for the Collaboration Hub suite: the
// real `env.live` bindings (D1, COLLAB_HUB, Durable Object migration) copied
// verbatim, with absolute paths, a local-only name, no routes, and APP_URL
// pointed at the local test origin. Living in a scratch directory means the
// developer's .dev.vars is not loaded, and the real wrangler.jsonc is never
// modified.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = process.argv[2];
const source = readFileSync(resolve(root, "wrangler.jsonc"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");
const config = JSON.parse(source);
const live = config.env.live;
const test = {
  name: "enercore-crm-collab-test",
  main: resolve(root, config.main),
  compatibility_date: config.compatibility_date,
  compatibility_flags: config.compatibility_flags,
  assets: { ...config.assets, directory: resolve(root, config.assets.directory) },
  d1_databases: live.d1_databases.map((d) => ({ ...d, migrations_dir: resolve(root, d.migrations_dir) })),
  durable_objects: live.durable_objects,
  migrations: live.migrations,
  vars: { ...live.vars, APP_URL: "http://localhost:8788" },
};
if (test.vars.APP_MODE !== "production") throw new Error("env.live must be production mode");
writeFileSync(out, JSON.stringify(test, null, 2));
