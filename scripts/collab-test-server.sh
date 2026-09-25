#!/usr/bin/env bash
# Runs the BUILT Worker (worker.ts + .open-next) locally in live mode for the
# Collaboration Hub suite, with a throwaway local D1 and local Durable Objects
# under .wrangler/collab-test. Everything is --local: nothing remote is read,
# created or modified. Requires `npm run cf:build` first.
set -euo pipefail
cd "$(dirname "$0")/.."

PERSIST=.wrangler/collab-test
export CI=1 WRANGLER_SEND_METRICS=false

if [ ! -f .open-next/worker.js ]; then
  echo "Run npm run cf:build first." >&2
  exit 1
fi

rm -rf "$PERSIST"
mkdir -p "$PERSIST"
# Test config: env.live's bindings, APP_URL = this local origin, so origin
# checks run exactly as in production against the address the tests use.
CONFIG="$PERSIST/wrangler.test.json"
node scripts/collab-test-config.mjs "$CONFIG"

npx wrangler d1 migrations apply enercore-crm --local --config "$CONFIG" --persist-to "$PERSIST/state"
npx tsx scripts/collab-test-seed.ts > "$PERSIST/seed.sql"
npx wrangler d1 execute enercore-crm --local --config "$CONFIG" --persist-to "$PERSIST/state" --file "$PERSIST/seed.sql" > /dev/null

exec npx wrangler dev --local --port 8788 --config "$CONFIG" \
  --persist-to "$PERSIST/state" \
  --show-interactive-dev-session=false
