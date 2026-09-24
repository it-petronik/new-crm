#!/usr/bin/env bash
#
# Restore a D1 database from a backup produced by scripts/backup-d1.sh.
#
#   scripts/restore-d1.sh <target-database> <backup.sql>
#
# DESTRUCTIVE. It creates tables and inserts rows into the target. Intended for
# a scratch database or a genuine disaster. See docs/DEPLOYMENT.md.
#
# Why this exists rather than a single `wrangler d1 execute --file`:
# a D1 export interleaves each table's CREATE with its INSERTs and emits tables
# alphabetically, so `Session` appears before the `User` rows its foreign key
# points at. The export's `PRAGMA defer_foreign_keys=TRUE` lasts only for one
# transaction, so a straight replay fails twice over — first
# "no such table: main.User", then a FOREIGN KEY constraint failure. This
# script applies the whole schema first, then inserts data parent-tables-first
# using the foreign keys declared in the schema.
#
set -euo pipefail

TARGET="${1:-}"
FILE="${2:-}"
PRODUCTION_DB="${PRODUCTION_DB:-enercore-crm}"

[ -n "$TARGET" ] && [ -n "$FILE" ] || { echo "usage: $0 <target-database> <backup.sql>" >&2; exit 2; }
[ -f "$FILE" ] || { echo "no such backup file: $FILE" >&2; exit 1; }

# Restoring over production destroys current data. It is possible, but never
# by accident.
if [ "$TARGET" = "$PRODUCTION_DB" ] && [ "${I_UNDERSTAND_THIS_DESTROYS_PRODUCTION:-}" != "yes" ]; then
  cat >&2 <<MSG
REFUSING: "$TARGET" is the production database.

Restoring replaces production data and cannot be undone. If that is genuinely
what you intend, take a fresh backup first, then re-run with:

  I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=yes $0 $TARGET $FILE
MSG
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Split into schema and data. The split is SQL-aware about single-quoted
# strings so a JSON payload containing ';' or a newline cannot break it.
python3 - "$FILE" "$WORK/schema.sql" "$WORK/data.sql" <<'PY'
import sys
src, schema_path, data_path = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()

statements, buf, in_string, i = [], [], False, 0
while i < len(text):
    ch = text[i]
    if in_string:
        if ch == "'":
            if i + 1 < len(text) and text[i + 1] == "'":   # escaped quote
                buf.append("''"); i += 2; continue
            in_string = False
        buf.append(ch)
    else:
        if ch == "'":
            in_string = True; buf.append(ch)
        elif ch == ";":
            statements.append("".join(buf).strip()); buf = []
        else:
            buf.append(ch)
    i += 1
if "".join(buf).strip():
    statements.append("".join(buf).strip())

import re
from collections import defaultdict

def table_of(stmt, kind):
    m = re.search(r'%s(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)' % kind,
                  stmt, re.IGNORECASE)
    return m.group(1) if m else None

schema, by_table, deps = [], defaultdict(list), defaultdict(set)
skipped = 0
for stmt in statements:
    if not stmt:
        continue
    if stmt.lstrip().upper().startswith("INSERT"):
        t = table_of(stmt, "INSERT\s+INTO")
        # sqlite_sequence is maintained by SQLite itself. Every id in this
        # schema is application-generated TEXT, so replaying it adds nothing
        # and can fail outright.
        if t == "sqlite_sequence":
            skipped += 1
            continue
        by_table[t].append(stmt + ";")
    else:
        schema.append(stmt + ";")
        t = table_of(stmt, "CREATE\s+TABLE")
        if t:
            deps[t]  # ensure present
            for ref in re.findall(r'REFERENCES\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)', stmt, re.IGNORECASE):
                if ref != t:
                    deps[t].add(ref)

# Parent tables before children, so foreign keys are satisfied as we go.
ordered, seen = [], set()
def visit(t, trail=()):
    if t in seen or t in trail:
        return
    for parent in sorted(deps.get(t, ())):
        visit(parent, trail + (t,))
    seen.add(t)
    ordered.append(t)
for t in sorted(set(list(by_table) + list(deps))):
    visit(t)

data = []
for t in ordered:
    data.extend(by_table.get(t, []))
for t in sorted(by_table):          # any table with no CREATE seen
    if t not in seen:
        data.extend(by_table[t])

open(schema_path, "w", encoding="utf-8").write("\n".join(schema) + "\n")
open(data_path, "w", encoding="utf-8").write("\n".join(data) + "\n")
print(f"SPLIT  schema_statements={len(schema)}  data_statements={len(data)}  "
      f"insert_order={','.join(t for t in ordered if by_table.get(t))}  skipped={skipped}")
PY

echo "RESTORE  target=$TARGET  file=$(basename "$FILE")"

echo "-> applying schema"
npx --no-install wrangler d1 execute "$TARGET" --remote --file "$WORK/schema.sql" >/dev/null 2>&1 \
  || { echo "RESTORE FAILED at schema stage" >&2; exit 1; }

if [ -s "$WORK/data.sql" ] && grep -q "INSERT" "$WORK/data.sql"; then
  echo "-> applying data"
  npx --no-install wrangler d1 execute "$TARGET" --remote --file "$WORK/data.sql" >/dev/null 2>&1 \
    || { echo "RESTORE FAILED at data stage" >&2; exit 1; }
else
  echo "-> no data statements in backup"
fi

echo "RESTORE OK  target=$TARGET"
echo "Verify row counts before trusting this database."
