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

# Absolute repo root, so the script behaves identically from cron/launchd,
# where the working directory is not the repo.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB="${D1_DATABASE:-enercore-crm}"
DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
KEEP="${BACKUP_KEEP:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Load an optional, gitignored env file so scheduled runs can supply
# CLOUDFLARE_API_TOKEN without it living in this file or in the repo.
if [ -f "$REPO_ROOT/.backup.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.backup.env"; set +a
fi

mkdir -p "$DIR"
# Canonical absolute path. Every later path check compares against this, so a
# symlinked or relative BACKUP_DIR cannot widen the deletion scope below.
DIR="$(cd "$DIR" && pwd -P)"

OUT="$DIR/${DB}-${STAMP}.sql"
TMP="$OUT.partial"

fail() { echo "BACKUP FAILED  db=$DB  at=$STAMP  reason=$1" >&2; rm -f "$TMP"; exit 1; }

# --- export ---------------------------------------------------------------
# Wrangler's own output can include a signed download URL, so it is captured
# rather than echoed. It is shown only if the export fails, and even then only
# its last lines, to keep a scheduled log free of anything sensitive.
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
if ! npx --no-install wrangler d1 export "$DB" --remote --output "$TMP" >"$LOG" 2>&1; then
  echo "--- wrangler output (tail) ---" >&2
  tail -5 "$LOG" | sed -E 's#https://[^ ]+#[url redacted]#g' >&2
  fail "wrangler export returned non-zero"
fi

# --- validate -------------------------------------------------------------
# A partial export is worse than no export, because it looks like a backup.
[ -f "$TMP" ] || fail "no output file produced"
[ -s "$TMP" ] || fail "output file is empty"

TABLES=$(grep -c '^CREATE TABLE' "$TMP" || true)
INSERTS=$(grep -c '^INSERT INTO' "$TMP" || true)
[ "$TABLES" -ge 1 ] || fail "export contains no CREATE TABLE statements"

# The application's own tables must be present; an export that parsed but lost
# them is a silent disaster.
for t in User Session BusinessRecord AuditEvent; do
  grep -q "CREATE TABLE[^;]*\"\?$t\"\?" "$TMP" || fail "export is missing table $t"
done

# Promote only once fully validated, so a failed run never leaves a file that
# retention could later mistake for a good backup.
mv "$TMP" "$OUT"
SIZE=$(wc -c < "$OUT" | tr -d ' ')

echo "BACKUP OK  db=$DB  at=$STAMP  file=$(basename "$OUT")  bytes=$SIZE  tables=$TABLES  rows=$INSERTS"

# --- optional off-device copy --------------------------------------------
# A copy failure must never cost us the local backup, so this cannot abort the
# script and never deletes anything.
if [ -n "${BACKUP_MIRROR_DIR:-}" ]; then
  if mkdir -p "$BACKUP_MIRROR_DIR" 2>/dev/null && cp "$OUT" "$BACKUP_MIRROR_DIR/" 2>/dev/null; then
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
  done
  [ "$removed" -gt 0 ] && echo "RETENTION  kept=$KEEP  removed=$removed"
fi

echo "BACKUP COMPLETE  db=$DB  dir=$DIR"
