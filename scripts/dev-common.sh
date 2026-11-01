#!/usr/bin/env bash
# Shared helpers for dev-start.sh / dev-stop.sh. Runs on the Mac host.
# Source this file; do not execute it.

RA_REPO="${RA_REPO:-jjhonson/relationship-assistant}"
RA_PORT="${RA_PORT:-3000}"
RA_REMOTE_DIR="${RA_REMOTE_DIR:-/workspaces/relationship-assistant}"
RA_STATE_DIR="${RA_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/relationship-assistant}"
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
  case "$RA_PORT" in ''|*[!0-9]*) fail "invalid port: $RA_PORT" ;; esac
  [ "$RA_PORT" -ge 1 ] && [ "$RA_PORT" -le 65535 ] || fail "invalid port: $RA_PORT"
  case "$RA_REMOTE_DIR" in /*) ;; *) fail "RA_REMOTE_DIR must be an absolute path" ;; esac
  case "$RA_REMOTE_DIR" in *[!A-Za-z0-9._/-]*) fail "RA_REMOTE_DIR contains unsupported characters" ;; esac
  if [ -n "$RA_CODESPACE" ]; then
    case "$RA_CODESPACE" in *[!A-Za-z0-9._-]*) fail "invalid Codespace name: $RA_CODESPACE" ;; esac
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
  case "$RA_CODESPACE" in *[!A-Za-z0-9._-]*) fail "unexpected Codespace name: $RA_CODESPACE" ;; esac
  RA_STATE="$(printf '%s' "$rows" | cut -f2)"
}

# Run remote-dev.sh inside the Codespace: remote_run ACTION.
# `gh codespace ssh -c NAME -- CMD...` hands CMD to ssh as the remote command; the script is
# piped on stdin to `bash -s`, so nothing needs to be installed in the Codespace.
remote_run() {
  gh codespace ssh -c "$RA_CODESPACE" -- bash -s -- "$1" "$RA_REMOTE_DIR" "$RA_PORT" "${RA_FORCE:-0}" "${2:-}" < "$RA_REMOTE_SCRIPT"
}

# Local port-forward ownership. A recorded forward is reused/signalled only if ALL hold:
# the PID is alive, its start time equals the recorded one (guards PID reuse), and its command
# line ends with exactly "codespace ports forward PORT:PORT -c CODESPACE" for this Codespace/port.
# Any mismatch fails closed (the record is dropped, the process is never signalled).
forward_meta_file() { printf '%s/forward-%s.meta' "$RA_STATE_DIR" "$RA_CODESPACE"; }

proc_start() { ps -p "$1" -o lstart= 2>/dev/null | sed 's/^ *//; s/ *$//'; }

forward_pid_if_ours() {
  local f pid start port cs cmd
  f="$(forward_meta_file)"
  [ -f "$f" ] || return 1
  pid="$(sed -n 's/^pid=//p' "$f" | head -n1)"
  start="$(sed -n 's/^start=//p' "$f" | head -n1)"
  cs="$(sed -n 's/^codespace=//p' "$f" | head -n1)"
  port="$(sed -n 's/^port=//p' "$f" | head -n1)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$cs" = "$RA_CODESPACE" ] && [ "$port" = "$RA_PORT" ] || return 1
  [ -n "$start" ] && [ "$(proc_start "$pid")" = "$start" ] || return 1
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$cmd" in
    "gh codespace ports forward $RA_PORT:$RA_PORT -c $RA_CODESPACE"|*/gh\ codespace\ ports\ forward\ "$RA_PORT:$RA_PORT"\ -c\ "$RA_CODESPACE")
      printf '%s' "$pid"; return 0 ;;
  esac
  return 1
}

# Record a forward we just launched (PID $1).
record_forward() {
  local start
  start="$(proc_start "$1")"
  [ -n "$start" ] || return 1
  printf 'pid=%s\nstart=%s\ncodespace=%s\nport=%s\n' "$1" "$start" "$RA_CODESPACE" "$RA_PORT" >"$(forward_meta_file)"
}

local_port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$RA_PORT") 2>/dev/null
}
