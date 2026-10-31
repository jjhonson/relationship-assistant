#!/usr/bin/env bash
# Shared helpers for dev-start.sh / dev-stop.sh. Runs on the Mac host.
# Source this file; do not execute it.

RA_REPO="${RA_REPO:-jjhonson/relationship-assistant}"
RA_PORT="${RA_PORT:-3000}"
RA_REMOTE_DIR="${RA_REMOTE_DIR:-/workspaces/relationship-assistant}"
RA_STATE_DIR="${RA_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/relationship-assistant}"
RA_FORWARD_PID_FILE="$RA_STATE_DIR/forward.pid"
RA_FORWARD_LOG="$RA_STATE_DIR/forward.log"
RA_CODESPACE="${RA_CODESPACE:-}"
RA_DRY_RUN="${RA_DRY_RUN:-0}"
RA_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RA_REMOTE_SCRIPT="$RA_SCRIPT_DIR/remote-dev.sh"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
run_mutating() {
  if [ "$RA_DRY_RUN" = "1" ]; then log "[dry-run] $*"; return 0; fi
  "$@"
}

parse_common_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) [ $# -ge 2 ] || fail "--name needs a value"; RA_CODESPACE="$2"; shift 2 ;;
      --dry-run) RA_DRY_RUN=1; shift ;;
      --force) RA_FORCE=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown argument: $1 (try --help)" ;;
    esac
  done
}

require_tools() {
  command -v gh >/dev/null 2>&1 || fail "GitHub CLI (gh) not found. Install it and run 'gh auth login'."
}

# Sets RA_CODESPACE (explicit name, or the single Codespace of this repository) and RA_STATE.
resolve_codespace() {
  local rows count
  if [ -n "$RA_CODESPACE" ]; then
    rows="$(gh codespace list --repo "$RA_REPO" --json name,state --jq '.[] | [.name,.state] | @tsv' 2>/dev/null)" \
      || fail "could not list Codespaces (is 'gh auth status' OK?)"
    RA_STATE="$(printf '%s\n' "$rows" | awk -F'\t' -v n="$RA_CODESPACE" '$1==n {print $2}')"
    [ -n "$RA_STATE" ] || fail "Codespace '$RA_CODESPACE' not found for $RA_REPO"
    return
  fi
  rows="$(gh codespace list --repo "$RA_REPO" --json name,state --jq '.[] | [.name,.state] | @tsv' 2>/dev/null)" \
    || fail "could not list Codespaces (is 'gh auth status' OK?)"
  count="$(printf '%s' "$rows" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then fail "no Codespace found for $RA_REPO. Create one first."; fi
  if [ "$count" -gt 1 ]; then
    printf '%s\n' "$rows" >&2
    fail "multiple Codespaces for $RA_REPO; choose one with --name NAME or RA_CODESPACE=NAME"
  fi
  RA_CODESPACE="$(printf '%s' "$rows" | cut -f1)"
  RA_STATE="$(printf '%s' "$rows" | cut -f2)"
}

# Run remote-dev.sh inside the Codespace: remote_run ACTION
remote_run() {
  gh codespace ssh -c "$RA_CODESPACE" -- bash -s -- "$1" "$RA_REMOTE_DIR" "$RA_PORT" "${RA_FORCE:-0}" < "$RA_REMOTE_SCRIPT"
}

# A forward is "ours" only if the recorded PID is alive and is a 'gh codespace ports forward'.
forward_pid_if_ours() {
  local pid cmd
  [ -f "$RA_FORWARD_PID_FILE" ] || return 1
  pid="$(cat "$RA_FORWARD_PID_FILE" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$cmd" in *"codespace ports forward"*) printf '%s' "$pid"; return 0 ;; esac
  return 1
}

local_port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$RA_PORT") 2>/dev/null
}
