// Writes a test-only wrangler config for the Collaboration Hub suite: the
// real `env.live` bindings (D1, COLLAB_HUB, Durable Object migration) copied
// verbatim, with absolute paths, a local-only name, no routes, and APP_URL
// pointed at the local test origin. Living in a scratch directory means the
// developer's .dev.vars is not loaded, and the real wrangler.jsonc is never
// modified.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const out = process.argv[2];
const source = readFileSync(resolve(root, "wrangler.jsonc"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");
const control = randomUUID();
writeFileSync(resolve(dirname(out), "control-token"), control, { mode: 0o600 });
const config = JSON.parse(source);
const live = config.env.live;
const test = {
  name: "enercore-crm-collab-test",
  main: resolve(root, "scripts/collab-test-entry.ts"),
  compatibility_date: config.compatibility_date,
  compatibility_flags: config.compatibility_flags,
  assets: { ...config.assets, directory: resolve(root, config.assets.directory) },
  d1_databases: live.d1_databases.map((d) => ({ ...d, migrations_dir: resolve(root, d.migrations_dir) })),
  durable_objects: live.durable_objects,
  migrations: live.migrations,
  // Local R2 (miniflare) under the production binding name; nothing remote.
  // Bound here even while production has no bucket yet, so the file
  // features stay covered; COLLAB_TEST_NO_R2=1 runs without it, as live does.
  ...(process.env.COLLAB_TEST_NO_R2 === "1"
    ? {}
    : { r2_buckets: live.r2_buckets ?? [{ binding: "COLLAB_FILES", bucket_name: "enercore-collab-files" }] }),
  vars: {
    ...live.vars,
    APP_URL: "http://localhost:8788",
    COLLAB_TEST_CONTROL: control,
    // Presence expiry in seconds rather than minutes, so the suite can watch
    // a dead tab expire. Production uses the defaults in collab-hub.ts.
    COLLAB_PRESENCE_HEARTBEAT_MS: "1500",
    COLLAB_PRESENCE_STALE_MS: "5000",
    COLLAB_PRESENCE_TTL_MS: "6000",
    // Meetings against a LiveKit dev server on this machine, started by
    // collab-test-server.sh. "devkey"/"secret" are the dev server's public
    // defaults, not credentials; production reads its own Worker secrets.
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "secret-for-local-livekit-dev-server-only",
  },
};
if (test.vars.APP_MODE !== "production") throw new Error("env.live must be production mode");
// Live binds Workers AI as `AI`. Tests bind the same name to a local fake
// named entrypoint (scripts/fake-ai-worker.ts) in this same test-only Worker.
// One runtime owns D1 — no inference, no quota, and every prompt is
// kept in the test D1 so the suite can check what reached the model.
if (!live.ai || live.ai.binding !== "AI") throw new Error("env.live must bind Workers AI as AI");
if (config.ai) throw new Error("preview (top level) must not bind Workers AI");
test.services = [{ binding: "AI", service: test.name, entrypoint: "FakeAi" }];
writeFileSync(out, JSON.stringify(test, null, 2));
