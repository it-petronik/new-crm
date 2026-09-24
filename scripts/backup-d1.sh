#!/usr/bin/env bash
#
# Off-platform backup of the production D1 database.
#
# Read-only: `wrangler d1 export` only reads. Nothing here writes to, restores
# or deletes remote D1. Restoring is a separate, deliberate, destructive act —
# see docs/DEPLOYMENT.md.
#
# Usage:  npm run db:backup
#
set -euo pipefail

DB="${D1_DATABASE:-enercore-crm}"
DIR="${BACKUP_DIR:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${DIR}/${DB}-${STAMP}.sql"

mkdir -p "$DIR"

echo "Exporting ${DB} (remote, read-only) -> ${OUT}"
npx wrangler d1 export "$DB" --remote --output "$OUT"

# An export that failed part-way is worse than none, because it looks like a
# backup. Refuse to leave one behind.
if [ ! -s "$OUT" ]; then
  echo "ERROR: export produced an empty file; removing it." >&2
  rm -f "$OUT"
  exit 1
fi

if ! grep -qi "CREATE TABLE" "$OUT"; then
  echo "ERROR: export contains no schema; treating as failed." >&2
  exit 1
fi

echo "OK  $(wc -c < "$OUT" | tr -d ' ') bytes  ${OUT}"
echo "Tables: $(grep -ci '^CREATE TABLE' "$OUT")  Rows(INSERT): $(grep -ci '^INSERT INTO' "$OUT")"
echo
echo "Copy this file somewhere outside Cloudflare. It is gitignored on purpose."
