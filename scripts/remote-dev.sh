#!/usr/bin/env bash
# Runs INSIDE the Codespace, piped over `gh codespace ssh ... bash -s -- ACTION DIR PORT`.
# Do not run on the Mac. It only manages the process recorded in its own PID file.
set -u
ACTION="${1:-}"; DIR="${2:-}"; PORT="${3:-3000}"; FORCE="${4:-0}"
PIDFILE="${RA_PID_FILE:-/tmp/relationship-assistant-dev.pid}"
LOG=/tmp/relationship-assistant-dev.log

die() { echo "ERROR: $*" >&2; exit 1; }

owned_pid() {
  local pid cmd
  [ -f "$PIDFILE" ] || return 1
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o args= 2>/dev/null)"
  case "$cmd" in *npm*|*next*) printf '%s' "$pid"; return 0 ;; esac
  return 1
}

port_listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# Next.js rewrites the tracked next-env.d.ts. Restore it only if every changed line is a
# generated reference/import line; any other edit is left alone with a warning.
restore_next_env() {
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  git diff --quiet -- next-env.d.ts 2>/dev/null && return 0
  if git diff -U0 -- next-env.d.ts | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
     | grep -qvE '^[+-](import "\./\.next/[A-Za-z0-9_./-]+\.d\.ts";|/// <reference types="[^"]+" />)$'; then
    echo "WARNING: next-env.d.ts has non-generated edits; leaving it unchanged."
  else
    git checkout -- next-env.d.ts && echo "Restored generated next-env.d.ts."
  fi
}

cd "$DIR" 2>/dev/null || die "directory $DIR not found in Codespace (set RA_REMOTE_DIR)"

case "$ACTION" in
  start)
    echo "[Codespace] branch/status (no switching or pulling):"
    git status --short --branch 2>/dev/null | head -n 20
    [ -f .env.local ] || echo "NOTE: .env.local missing; Gmail will not work until you create it manually."
    if pid="$(owned_pid)"; then echo "Dev server already running (pid $pid); reusing."; exit 0; fi
    rm -f "$PIDFILE"
    port_listening && die "port $PORT already in use by a process this workflow did not start."
    [ -d node_modules ] || npm install || die "npm install failed"
    setsid bash -c 'echo $$ > "$1"; exec npm run dev' _ "$PIDFILE" >"$LOG" 2>&1 </dev/null &
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      port_listening && { echo "Dev server listening on $PORT."; exit 0; }
      owned_pid >/dev/null || die "dev server exited early; see $LOG"
      sleep 2
    done
    die "dev server not listening after 30s; see $LOG"
    ;;
  stop)
    if pid="$(owned_pid)"; then
      echo "Stopping dev server (pid $pid)..."
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        if [ "$FORCE" = "1" ]; then kill -KILL -- "-$pid" 2>/dev/null
        else die "dev server (pid $pid) did not exit; re-run with --force"; fi
      fi
    else
      echo "No dev server owned by this workflow is running."
    fi
    rm -f "$PIDFILE"
    restore_next_env
    ;;
  *) die "unknown action '$ACTION'" ;;
esac
