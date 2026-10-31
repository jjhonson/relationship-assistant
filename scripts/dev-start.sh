#!/usr/bin/env bash
# Run on the Mac host. Starts the Codespace, `npm run dev` inside it, and a localhost port forward.
usage() {
  cat <<'USAGE'
Usage: scripts/dev-start.sh [--name CODESPACE] [--dry-run]

Starts (or reuses) the repository's Codespace, the Next.js dev server inside it, and a
Mac-local port forward so http://localhost:3000 works (Gmail OAuth callback unchanged).
Never switches, pulls or merges branches; never touches .env.local.
Env: RA_CODESPACE, RA_REPO, RA_PORT, RA_REMOTE_DIR, RA_STATE_DIR, RA_DRY_RUN=1
USAGE
}
set -u
. "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
parse_common_args "$@"
require_tools
mkdir -p "$RA_STATE_DIR"

resolve_codespace
log "[Mac] Codespace: $RA_CODESPACE ($RA_STATE)"
if [ "$RA_STATE" != "Available" ]; then
  log "[Mac] Starting Codespace..."
  run_mutating gh codespace start -c "$RA_CODESPACE" || fail "could not start Codespace $RA_CODESPACE"
else
  log "[Mac] Codespace already running; reusing."
fi

log "[Codespace] Starting dev server (reuses an existing one)..."
if [ "$RA_DRY_RUN" = "1" ]; then
  log "[dry-run] gh codespace ssh -c $RA_CODESPACE -- bash -s -- start $RA_REMOTE_DIR $RA_PORT < remote-dev.sh"
else
  remote_run start || fail "remote start failed. Recovery: gh codespace ssh -c $RA_CODESPACE -- tail -n 50 /tmp/relationship-assistant-dev.log"
fi

if pid="$(forward_pid_if_ours)"; then
  log "[Mac] Port forward already running (pid $pid); reusing."
else
  rm -f "$RA_FORWARD_PID_FILE"
  if local_port_in_use; then
    fail "localhost:$RA_PORT is already in use by a process this workflow did not start. Free it and retry."
  fi
  log "[Mac] Forwarding localhost:$RA_PORT -> Codespace:$RA_PORT"
  if [ "$RA_DRY_RUN" = "1" ]; then
    log "[dry-run] gh codespace ports forward $RA_PORT:$RA_PORT -c $RA_CODESPACE"
  else
    nohup gh codespace ports forward "$RA_PORT:$RA_PORT" -c "$RA_CODESPACE" >"$RA_FORWARD_LOG" 2>&1 </dev/null &
    echo $! >"$RA_FORWARD_PID_FILE"
  fi
fi

if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] would check http://localhost:$RA_PORT"; exit 0; fi
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:$RA_PORT/" 2>/dev/null || true)"
  case "$code" in 2??|3??) log "OK: http://localhost:$RA_PORT responded ($code). Connect Gmail manually at /gmail."; exit 0 ;; esac
  sleep 2
done
fail "no response from http://localhost:$RA_PORT. Check: $RA_FORWARD_LOG and 'gh codespace ssh -c $RA_CODESPACE -- tail -n 50 /tmp/relationship-assistant-dev.log'. Cleanup: scripts/dev-stop.sh"
