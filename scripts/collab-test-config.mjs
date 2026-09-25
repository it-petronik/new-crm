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
  // Local R2 (miniflare) under the production binding name; nothing remote.
  // Bound here even while production has no bucket yet, so the file
  // features stay covered; COLLAB_TEST_NO_R2=1 runs without it, as live does.
  ...(process.env.COLLAB_TEST_NO_R2 === "1"
    ? {}
    : { r2_buckets: live.r2_buckets ?? [{ binding: "COLLAB_FILES", bucket_name: "enercore-collab-files" }] }),
  vars: {
    ...live.vars,
    APP_URL: "http://localhost:8788",
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
writeFileSync(out, JSON.stringify(test, null, 2));
