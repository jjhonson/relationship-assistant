#!/usr/bin/env bash
# Run on the Mac host. Wakes the Codespace over SSH, starts `npm run dev`, and forwards its port.
usage() {
  cat <<'USAGE'
Usage: scripts/dev-start.sh [--name CODESPACE] [--dry-run]

Wakes (or reuses) the repository's Codespace over SSH, starts the Next.js dev server inside it, and a
Mac-local port forward so http://localhost:3000 works (Gmail OAuth callback unchanged).
Never switches, pulls or merges branches; never touches .env.local.
If startup fails, the scripts attempt to clean up only resources this run launched; if ownership
or termination cannot be verified, they retain metadata and report what needs inspection.
Env: RA_CODESPACE, RA_REPO, RA_PORT, RA_REMOTE_DIR, RA_STATE_DIR, RA_DRY_RUN=1
USAGE
}
set -u
. "$(dirname "${BASH_SOURCE[0]}")/dev-common.sh"
parse_common_args "$@"
require_tools

acquire_host_lock
trap release_host_lock EXIT

STARTED_CS=0
STARTED_FWD=""
STARTED_FWD_START=""
RA_RUN_ID="mac-$$-$(date +%s)-${RANDOM}${RANDOM}"

cleanup_failed_start() {
  trap - INT TERM
  log "Start failed; cleaning up what this run launched..."
  if [ "$RA_DRY_RUN" = "1" ]; then return; fi
  if [ -n "$STARTED_FWD" ]; then
    if [ -z "$STARTED_FWD_START" ]; then
      for i in {1..50}; do
        STARTED_FWD_START="$(proc_start "$STARTED_FWD")"
        [ -n "$STARTED_FWD_START" ] && break
        sleep 0.1
      done
    fi
    if stop_forward_identity "$STARTED_FWD" "$STARTED_FWD_START" "$RA_RUN_ID" 0 0; then
      log "[Mac] This run's port forward exited; only its matching ownership record was removed."
    else
      log "WARNING: this run's forward could not be verified as terminated; no mismatched ownership record was changed."
    fi
  fi
  remote_run stop-start "$RA_RUN_ID" >/dev/null 2>&1 \
    || log "WARNING: could not clean up this run's remote server; it was not stopped unless its launch record matched."
  if [ "$STARTED_CS" = "1" ]; then
    gh codespace stop -c "$RA_CODESPACE" >/dev/null 2>&1 \
      || log "WARNING: could not stop Codespace; run: gh codespace stop -c $RA_CODESPACE"
  fi
}

save_remote_diagnostic() {
  local output="$1" diagnostic repo_root state_dir report bytes
  diagnostic="$(printf '%s\n' "$output" | awk '
    function value(field, prefix, pattern) {
      return substr(field, 1, length(prefix)) == prefix && substr(field, length(prefix) + 1) ~ pattern
    }
    NF == 15 && length($0) <= 512 &&
    $1 == "RA_DIAG" && $2 == "v=1" &&
    value($3, "code=", "^(record_missing|record_symlink|record_unreadable|record_line_count|record_malformed|workspace_mismatch|port_mismatch|record_content_mismatch|member_inspection_unknown|member_disappeared|member_session_mismatch|member_cwd_mismatch|member_environment_unreadable|member_owner_mismatch|member_port_mismatch|group_member_not_found|process_disappeared|process_inspection_unknown|start_time_mismatch|process_group_mismatch|process_session_mismatch|process_environment_unreadable|owner_marker_mismatch|port_marker_mismatch|leader_command_mismatch)$") &&
    value($4, "pid=", "^(unknown|[0-9]+)$") &&
    value($5, "member_pid=", "^(unknown|[0-9]+)$") &&
    value($6, "state=", "^(unknown|[A-Zt])$") &&
    value($7, "record=", "^(match|mismatch|unknown)$") &&
    value($8, "session=", "^(match|mismatch|unknown)$") &&
    value($9, "group=", "^(match|mismatch|unknown)$") &&
    value($10, "start=", "^(match|mismatch|unknown)$") &&
    value($11, "cwd=", "^(match|mismatch|unknown)$") &&
    value($12, "owner=", "^(match|mismatch|unknown)$") &&
    value($13, "port=", "^(match|mismatch|unknown)$") &&
    value($14, "command=", "^(match|mismatch|unknown)$") &&
    value($15, "enumeration=", "^(match|mismatch|unknown)$") {
      print
      exit
    }
  ' )"
  if [ -z "$diagnostic" ]; then
    log "WARNING: remote diagnostic capture unavailable; no valid allowlisted fields were received."
    return 1
  fi
  repo_root="$(git -C "$RA_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
    log "WARNING: remote diagnostic capture unavailable; repository location could not be verified."
    return 1
  }
  repo_root="$(cd "$repo_root" 2>/dev/null && pwd -P)" || {
    log "WARNING: remote diagnostic capture unavailable; repository location could not be verified."
    return 1
  }
  state_dir="$(cd "$RA_STATE_DIR" 2>/dev/null && pwd -P)" || {
    log "WARNING: remote diagnostic capture unavailable; state directory could not be verified."
    return 1
  }
  case "$state_dir" in
    "$repo_root"|"$repo_root"/*)
      log "WARNING: remote diagnostic capture unavailable; state directory is inside the repository."
      return 1
      ;;
  esac
  report="$(umask 077; mktemp "$state_dir/dev-start-diagnostic.XXXXXX")" || {
    log "WARNING: remote diagnostic capture unavailable; private report could not be created."
    return 1
  }
  if ! printf '%s\n' "$diagnostic" >"$report" || ! chmod 600 "$report"; then
    rm -f "$report"
    log "WARNING: remote diagnostic capture unavailable; private report could not be secured."
    return 1
  fi
  bytes="$(wc -c <"$report" 2>/dev/null | tr -d '[:space:]')"
  case "$bytes" in ''|*[!0-9]*) bytes=999999 ;; esac
  if [ "$bytes" -gt 1024 ]; then
    rm -f "$report"
    log "WARNING: remote diagnostic capture unavailable; report exceeded the size limit."
    return 1
  fi
  log "Remote ownership diagnostic: $report"
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
  log "[Mac] Waking Codespace over SSH..."
  if [ "$RA_STATE" = "Shutdown" ]; then STARTED_CS=1; fi
  if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] gh codespace ssh -c $RA_CODESPACE -- true"
  else
    ready=0
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if gh codespace ssh -c "$RA_CODESPACE" -- true >/dev/null 2>&1; then ready=1; break; fi
      [ "$i" -eq 12 ] || { log "[Mac] Waiting for Codespace SSH readiness ($i/12)..."; sleep 5; }
    done
    [ "$ready" = "1" ] || start_fail "Codespace SSH did not become ready after 12 attempts"
  fi
else
  log "[Mac] Codespace already running; reusing."
fi

log "[Codespace] Starting dev server (reuses an existing one)..."
if [ "$RA_DRY_RUN" = "1" ]; then
  log "[dry-run] gh codespace ssh -c $RA_CODESPACE -- bash -s -- start $RA_REMOTE_DIR $RA_PORT 0 $RA_RUN_ID < remote-dev.sh"
else
  mkdir -p "$RA_STATE_DIR"
  if out="$(remote_run start "$RA_RUN_ID")"; then
    printf '%s\n' "$out" | sed '/^RA_DIAG /d'
  else
    save_remote_diagnostic "$out" || true
    printf '%s\n' "$out" | sed '/^RA_DIAG /d'
    start_fail "remote start failed. Log: gh codespace ssh -c $RA_CODESPACE -- tail -n 50 /tmp/relationship-assistant-dev.log"
  fi
fi

if pid="$(forward_pid_if_ours)"; then
  log "[Mac] Port forward already running (pid $pid); reusing."
else
  if [ "$RA_DRY_RUN" != "1" ] && [ -f "$(forward_meta_file)" ]; then
    if cleanup_stale_forward_record; then
      log "[Mac] Removed unchanged ownership metadata for a definitively exited forward."
    else
      start_fail "recorded forward is live, mismatched, malformed, or outside this Codespace/port; record retained for inspection at $(forward_meta_file)"
    fi
  fi
  if local_port_in_use; then
    start_fail "localhost:$RA_PORT is already in use by a process this workflow did not start (or by a forward for another Codespace). Free it and retry."
  fi
  log "[Mac] Forwarding localhost:$RA_PORT -> Codespace:$RA_PORT"
  if [ "$RA_DRY_RUN" = "1" ]; then
    log "[dry-run] gh codespace ports forward $RA_PORT:$RA_PORT -c $RA_CODESPACE"
  else
    mkdir -p "$RA_STATE_DIR"
    RA_FORWARD_OWNER="$RA_RUN_ID" nohup env gh codespace ports forward "$RA_PORT:$RA_PORT" -c "$RA_CODESPACE" >"$RA_STATE_DIR/forward-$RA_CODESPACE.log" 2>&1 </dev/null &
    STARTED_FWD=$!
    record_forward "$STARTED_FWD" || start_fail "port forward could not be recorded and verified; its process was independently checked for cleanup; see $RA_STATE_DIR/forward-$RA_CODESPACE.log"
    sleep 1
    forward_pid_if_ours >/dev/null || start_fail "port forward exited or could not be verified; see $RA_STATE_DIR/forward-$RA_CODESPACE.log"
  fi
fi

if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] would check http://localhost:$RA_PORT"; exit 0; fi
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:$RA_PORT/" 2>/dev/null || true)"
  case "$code" in 2??|3??) trap - INT TERM; log "OK: http://localhost:$RA_PORT responded ($code). Connect Gmail manually at /gmail."; exit 0 ;; esac
  sleep 2
done
start_fail "no response from http://localhost:$RA_PORT (forward log: $RA_STATE_DIR/forward-$RA_CODESPACE.log)"
