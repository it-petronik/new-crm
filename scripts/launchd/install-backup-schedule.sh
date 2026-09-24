#!/usr/bin/env bash
#
# Installs (or removes) the daily production-backup schedule for the current
# user. Writes only to ~/Library/LaunchAgents and ~/Library/Logs.
#
#   scripts/launchd/install-backup-schedule.sh install
#   scripts/launchd/install-backup-schedule.sh uninstall
#   scripts/launchd/install-backup-schedule.sh status
#   scripts/launchd/install-backup-schedule.sh run      # trigger once, now
#
set -euo pipefail

LABEL="ae.enercore.crm.backup"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
PLIST="$AGENTS/$LABEL.plist"
TEMPLATE="$REPO/scripts/launchd/$LABEL.plist.template"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }
    NODE_BIN="$(dirname "$(command -v node)")"
    mkdir -p "$AGENTS" "$LOG_DIR"
    sed -e "s#__REPO__#$REPO#g" -e "s#__NODE_BIN__#$NODE_BIN#g" -e "s#__LOG_DIR__#$LOG_DIR#g" \
      "$TEMPLATE" > "$PLIST"
    plutil -lint "$PLIST" >/dev/null || { echo "generated plist is invalid" >&2; exit 1; }
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $LABEL (daily 02:30). Logs: $LOG_DIR/enercore-backup.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL. Existing backups were not touched."
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|last exit|program" || echo "$LABEL is not loaded."
    echo "--- recent log ---"
    tail -5 "$LOG_DIR/enercore-backup.log" 2>/dev/null || echo "(no log yet)"
    ;;
  run)
    launchctl kickstart -k "$DOMAIN/$LABEL" && echo "Triggered. Check: $0 status"
    ;;
  *)
    echo "usage: $0 {install|uninstall|status|run}" >&2; exit 2 ;;
esac
