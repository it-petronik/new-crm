#!/usr/bin/env bash
# A real local Worker/session/database, not browser-only preview. Each new
# run gets a separate directory unless --resume is supplied. Nothing is deleted or applied remotely.
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1 WRANGLER_SEND_METRICS=false
REVIEW_RESUME=""
if [[ "${1:-}" == "--resume" && -n "${2:-}" && $# == 2 ]]; then
  REVIEW_RESUME=$(cd "$2" && pwd -P)
  case "$REVIEW_RESUME" in
    "$PWD"/.wrangler/manual-review.*) ;;
    *) echo "Resume requires a local .wrangler/manual-review.* directory." >&2; exit 1 ;;
  esac
  [[ -f "$REVIEW_RESUME/wrangler.test.json" && -d "$REVIEW_RESUME/state" ]] || { echo "Saved review configuration or data is missing." >&2; exit 1; }
elif [[ $# != 0 ]]; then
  echo "Usage: npm run dev:review -- [--resume .wrangler/manual-review.NAME]" >&2
  exit 1
fi
if lsof -nP -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8788 is already in use. Keep that workspace, or stop it before starting another." >&2
  exit 1
fi
if ! command -v livekit-server >/dev/null; then
  echo "Local LiveKit is required for meeting testing. Install it before continuing." >&2
  exit 1
fi
if lsof -nP -iTCP:7880 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Local LiveKit port 7880 is already in use; no existing service was changed." >&2
  exit 1
fi
npm run cf:build
mkdir -p .wrangler
REVIEW_DIR=${REVIEW_RESUME:-$(mktemp -d "$PWD/.wrangler/manual-review.XXXXXX")}
REVIEW_CONFIG="$REVIEW_DIR/wrangler.test.json"
node scripts/collab-test-config.mjs "$REVIEW_CONFIG"
npx wrangler d1 migrations apply enercore-crm --local --config "$REVIEW_CONFIG" --persist-to "$REVIEW_DIR/state"
if [[ -z "$REVIEW_RESUME" ]]; then
  npx tsx scripts/collab-test-seed.ts > "$REVIEW_DIR/seed.sql"
  npx wrangler d1 execute enercore-crm --local --config "$REVIEW_CONFIG" --persist-to "$REVIEW_DIR/state" --file "$REVIEW_DIR/seed.sql" >/dev/null
fi
LOCAL_DESIGN_FIXTURE=1 npx tsx scripts/design-test-seed.ts > "$REVIEW_DIR/design.sql"
npx wrangler d1 execute enercore-crm --local --config "$REVIEW_CONFIG" --persist-to "$REVIEW_DIR/state" --file "$REVIEW_DIR/design.sql" >/dev/null
npx wrangler d1 execute enercore-crm --local --config "$REVIEW_CONFIG" --persist-to "$REVIEW_DIR/state" --file scripts/mail-test-fixture.sql >/dev/null
livekit-server --config scripts/livekit-dev.yaml > "$REVIEW_DIR/livekit.log" 2>&1 &
REVIEW_LIVEKIT_PID=$!
trap 'kill "$REVIEW_LIVEKIT_PID" 2>/dev/null || true' EXIT
echo "Local review: http://localhost:8788/login"
echo "Users: cmsales@collab.test / cmsales2@collab.test / cmmd@collab.test"
echo "All-company design review: studio@collab.test (fictional MD, same local password)"
echo "Fictional password: Collab-Test-Password-1"
echo "Data retained in: $REVIEW_DIR (nothing will be deleted on exit)"
echo "Reopen later: npm run dev:review -- --resume '$REVIEW_DIR'"
echo "Email captured locally; AI and Apollo are fictional; file storage is local. No production connection."
node scripts/collab-test-worker.mjs "$REVIEW_CONFIG" "$REVIEW_DIR/state"
