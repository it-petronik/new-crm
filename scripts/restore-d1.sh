#!/usr/bin/env bash
# Only an empty, explicitly configured isolated recovery target is accepted.
# See docs/DEPLOYMENT.md. No implicit remote mode and no production override.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$REPO_ROOT/scripts/d1-recovery.py" restore "$@"
