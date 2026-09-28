#!/usr/bin/env bash
#
# Off-platform backup of the production D1 database.
#
# READ-ONLY with respect to production: `wrangler d1 export` only reads.
# Nothing in this script writes to, restores, or deletes remote D1. Restoring
# is a separate, deliberate, destructive act — see docs/DEPLOYMENT.md.
#
#   npm run db:backup
#
# Configuration (all optional, all via environment):
#   D1_DATABASE        database to export           (default: enercore-crm)
#   BACKUP_DIR         local backup directory       (default: <repo>/backups)
#   BACKUP_MIRROR_DIR  off-device copy destination  (default: none)
#   BACKUP_KEEP        successful backups to retain (default: 30)
#
# Output is deliberately metadata only: filename, timestamp, size, database,
# result. Database contents are never printed or logged.
#
set -euo pipefail
umask 077

# Absolute repo root, so the script behaves identically from cron/launchd,
# where the working directory is not the repo.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load an optional, gitignored env file so scheduled runs can supply
# CLOUDFLARE_API_TOKEN without it living in this file or in the repo.
if [ -f "$REPO_ROOT/.backup.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.backup.env"; set +a
fi

DB="${D1_DATABASE:-enercore-crm}"
DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
KEEP="${BACKUP_KEEP:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

SCHEMA="${BACKUP_SCHEMA_VERSION:-phase6}"
[[ "$DB" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Invalid backup database name" >&2; exit 1; }

mkdir -p "$DIR"
# Canonical absolute path. Every later path check compares against this, so a
# symlinked or relative BACKUP_DIR cannot widen the deletion scope below.
DIR="$(cd "$DIR" && pwd -P)"

OUT="$DIR/${DB}-${STAMP}.sql"
TMP="$OUT.partial"
VALIDATION="$TMP.validation.json"

fail() { echo "BACKUP FAILED  db=$DB  at=$STAMP  reason=$1" >&2; rm -f "$TMP" "$VALIDATION"; exit 1; }

# --- export ---------------------------------------------------------------
# Wrangler's own output can include a signed download URL, so it is captured
# rather than echoed, including on failure. Logs contain metadata only.
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
if ! npx --no-install wrangler d1 export "$DB" --remote --env live --output "$TMP" >"$LOG" 2>&1; then
  fail "wrangler export returned non-zero"
fi

# --- validate -------------------------------------------------------------
# A partial export is worse than no export, because it looks like a backup.
[ -f "$TMP" ] || fail "no output file produced"
[ -s "$TMP" ] || fail "output file is empty"

# Rehearse the export in memory and validate the selected migration profile,
# every expected index/trigger, all relationship guards, FK and integrity checks.
# pre-phase6 is explicit for the backup immediately BEFORE migration 0013.
if ! python3 scripts/d1-recovery.py validate "$TMP" --schema "$SCHEMA" --report "$VALIDATION" >"$LOG" 2>&1; then
  fail "export failed schema/data/relationship validation"
fi
read -r TABLES INSERTS < <(python3 - "$VALIDATION" <<'PYREPORT'
import json,sys
r=json.load(open(sys.argv[1]))
print(len(r['tables']),sum(t['rows'] for t in r['tables'].values()))
PYREPORT
)

# Promote only once fully validated, so a failed run never leaves a file that
# retention could later mistake for a good backup.
mv "$TMP" "$OUT"
mv "$VALIDATION" "$OUT.validation.json"
SIZE=$(wc -c < "$OUT" | tr -d ' ')

echo "BACKUP OK  db=$DB  at=$STAMP  file=$(basename "$OUT")  bytes=$SIZE  tables=$TABLES  rows=$INSERTS"

# --- optional off-device copy --------------------------------------------
# A copy failure must never cost us the local backup, so this cannot abort the
# script and never deletes anything.
if [ -n "${BACKUP_MIRROR_DIR:-}" ]; then
  if mkdir -p "$BACKUP_MIRROR_DIR" 2>/dev/null && cp "$OUT" "$OUT.validation.json" "$BACKUP_MIRROR_DIR/" 2>/dev/null; then
    echo "MIRROR OK  file=$(basename "$OUT")"
  else
    echo "MIRROR FAILED  file=$(basename "$OUT")  (local backup retained)" >&2
  fi
else
  echo "MIRROR SKIPPED  set BACKUP_MIRROR_DIR to keep an off-device copy"
fi

# --- retention ------------------------------------------------------------
# Deletes only inside $DIR, only regular files, only names this script
# produces, and never the newest. Anything else is left alone.
if [ "$KEEP" -gt 0 ]; then
  # macOS ships bash 3.2, which has no `mapfile`, so the list is built with a
  # portable read loop. Names are timestamped UTC, so a reverse sort is
  # newest-first.
  ALL=()
  while IFS= read -r line; do
    ALL[${#ALL[@]}]="$line"
  done < <(find "$DIR" -maxdepth 1 -type f -name "${DB}-*.sql" ! -name '*.partial' | sort -r)

  removed=0
  i=$KEEP
  while [ "$i" -lt "${#ALL[@]}" ]; do
    f="${ALL[$i]}"
    i=$((i + 1))
    [ "$f" = "${ALL[0]}" ] && continue              # never the newest
    [ "$f" = "$OUT" ] && continue                   # never the one just made
    [ -f "$f" ] && [ ! -L "$f" ] || continue        # regular files, no symlinks
    parent="$(cd "$(dirname "$f")" && pwd -P)"
    [ "$parent" = "$DIR" ] || continue              # must resolve inside $DIR
    case "$(basename "$f")" in "${DB}-"*".sql") ;; *) continue ;; esac
    rm -f "$f" && removed=$((removed + 1))
    [ ! -L "$f.validation.json" ] && rm -f "$f.validation.json"
  done
  [ "$removed" -gt 0 ] && echo "RETENTION  kept=$KEEP  removed=$removed"
fi

echo "BACKUP COMPLETE  db=$DB  dir=$DIR"
