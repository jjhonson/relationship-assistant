#!/usr/bin/env bash
# Run on the Mac host. Starts the Codespace, `npm run dev` inside it, and a localhost port forward.
usage() {
  cat <<'USAGE'
Usage: scripts/dev-start.sh [--name CODESPACE] [--dry-run]

Starts (or reuses) the repository's Codespace, the Next.js dev server inside it, and a
Mac-local port forward so http://localhost:3000 works (Gmail OAuth callback unchanged).
Never switches, pulls or merges branches; never touches .env.local.
If startup fails, everything this run launched (forward, server, and a Codespace this run
started) is cleaned up; anything that was already running is left alone.
Env: RA_CODESPACE, RA_REPO, RA_PORT, RA_REMOTE_DIR, RA_STATE_DIR, RA_DRY_RUN=1
USAGE
}
set -u
. "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
parse_common_args "$@"
require_tools
mkdir -p "$RA_STATE_DIR"

STARTED_CS=0
STARTED_SERVER=0
STARTED_FWD=""

cleanup_failed_start() {
  trap - INT TERM
  log "Start failed; cleaning up what this run launched..."
  if [ -n "$STARTED_FWD" ]; then
    kill -TERM "$STARTED_FWD" 2>/dev/null || true
    rm -f "$(forward_meta_file)"
  fi
  if [ "$STARTED_CS" = "1" ]; then
    remote_run stop >/dev/null 2>&1 || true
    gh codespace stop -c "$RA_CODESPACE" >/dev/null 2>&1 \
      || log "WARNING: could not stop Codespace; run: gh codespace stop -c $RA_CODESPACE"
  elif [ "$STARTED_SERVER" = "1" ]; then
    remote_run stop >/dev/null 2>&1 || log "WARNING: could not stop dev server; run scripts/dev-stop.sh"
  fi
}
start_fail() {
  printf 'ERROR: %s\n' "$*" >&2
  cleanup_failed_start
  exit 1
}

resolve_codespace
log "[Mac] Codespace: $RA_CODESPACE ($RA_STATE)"
trap 'start_fail "interrupted"' INT TERM
if [ "$RA_STATE" != "Available" ]; then
  log "[Mac] Starting Codespace..."
  if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] gh codespace start -c $RA_CODESPACE"
  else
    STARTED_CS=1
    gh codespace start -c "$RA_CODESPACE" || start_fail "could not start Codespace $RA_CODESPACE"
  fi
else
  log "[Mac] Codespace already running; reusing."
fi

log "[Codespace] Starting dev server (reuses an existing one)..."
if [ "$RA_DRY_RUN" = "1" ]; then
  log "[dry-run] gh codespace ssh -c $RA_CODESPACE -- bash -s -- start $RA_REMOTE_DIR $RA_PORT 0 < remote-dev.sh"
else
  out="$(remote_run start)" || { printf '%s\n' "$out"; start_fail "remote start failed. Log: gh codespace ssh -c $RA_CODESPACE -- tail -n 50 /tmp/relationship-assistant-dev.log"; }
  printf '%s\n' "$out"
  case "$out" in *RA_STATUS=started*) STARTED_SERVER=1 ;; esac
fi

if pid="$(forward_pid_if_ours)"; then
  log "[Mac] Port forward already running (pid $pid); reusing."
else
  rm -f "$(forward_meta_file)"
  if local_port_in_use; then
    start_fail "localhost:$RA_PORT is already in use by a process this workflow did not start (or by a forward for another Codespace). Free it and retry."
  fi
  log "[Mac] Forwarding localhost:$RA_PORT -> Codespace:$RA_PORT"
  if [ "$RA_DRY_RUN" = "1" ]; then
    log "[dry-run] gh codespace ports forward $RA_PORT:$RA_PORT -c $RA_CODESPACE"
  else
    nohup gh codespace ports forward "$RA_PORT:$RA_PORT" -c "$RA_CODESPACE" >"$RA_STATE_DIR/forward-$RA_CODESPACE.log" 2>&1 </dev/null &
    STARTED_FWD=$!
    sleep 1
    record_forward "$STARTED_FWD" || start_fail "port forward exited immediately; see $RA_STATE_DIR/forward-$RA_CODESPACE.log"
  fi
fi

if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] would check http://localhost:$RA_PORT"; exit 0; fi
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:$RA_PORT/" 2>/dev/null || true)"
  case "$code" in 2??|3??) trap - INT TERM; log "OK: http://localhost:$RA_PORT responded ($code). Connect Gmail manually at /gmail."; exit 0 ;; esac
  sleep 2
done
start_fail "no response from http://localhost:$RA_PORT (forward log: $RA_STATE_DIR/forward-$RA_CODESPACE.log)"
