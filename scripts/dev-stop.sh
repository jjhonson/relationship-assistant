#!/usr/bin/env bash
# Run on the Mac host. Stops only what dev-start.sh launched, then stops the Codespace.
usage() {
  cat <<'USAGE'
Usage: scripts/dev-stop.sh [--name CODESPACE] [--force] [--dry-run]

Gracefully stops the dev server started by dev-start.sh (SIGTERM; --force escalates to SIGKILL),
closes the recorded port forward, restores generated next-env.d.ts if it only has generated
changes, then stops the Codespace. Other processes and Codespaces are never touched.
Manual recovery:
  Mac:       kill "$(cat ~/.local/state/relationship-assistant/forward.pid)"
  Codespace: gh codespace ssh -c NAME -- 'kill -TERM -- -$(cat /tmp/relationship-assistant-dev.pid)'
  Stop:      gh codespace stop -c NAME
USAGE
}
set -u
RA_FORCE=0
. "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
parse_common_args "$@"
require_tools

resolve_codespace
status=0
if [ "$RA_STATE" = "Available" ]; then
  log "[Codespace] Stopping dev server..."
  if [ "$RA_DRY_RUN" = "1" ]; then
    log "[dry-run] gh codespace ssh -c $RA_CODESPACE -- bash -s -- stop $RA_REMOTE_DIR $RA_PORT"
  else
    remote_run stop || { log "WARNING: remote stop reported a problem; Codespace will NOT be stopped so nothing is orphaned. See --help for recovery."; status=1; }
  fi
else
  log "[Codespace] Not running ($RA_STATE); nothing to stop remotely."
fi

if pid="$(forward_pid_if_ours)"; then
  log "[Mac] Closing port forward (pid $pid)"
  run_mutating kill -TERM "$pid"
fi
[ "$RA_DRY_RUN" = "1" ] || rm -f "$RA_FORWARD_PID_FILE"

if [ "$status" -ne 0 ]; then exit "$status"; fi
if [ "$RA_STATE" = "Available" ] || [ "$RA_STATE" = "Starting" ]; then
  log "[Mac] Stopping Codespace $RA_CODESPACE"
  run_mutating gh codespace stop -c "$RA_CODESPACE" || fail "could not stop Codespace; run: gh codespace stop -c $RA_CODESPACE"
fi
log "Done."
