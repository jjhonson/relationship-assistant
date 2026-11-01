#!/usr/bin/env bash
# Runs INSIDE the Codespace (Linux), piped over `gh codespace ssh ... bash -s -- ACTION DIR PORT FORCE`.
# Do not run on the Mac. It only signals the process group it launched itself, and only after
# re-verifying it against the launch record (PID, kernel start time, session/group leader,
# working directory, command line, port). Any mismatch fails closed: nothing is signalled.
set -u
ACTION="${1:-}"; DIR="${2:-}"; PORT="${3:-3000}"; FORCE="${4:-0}"
PIDFILE="${RA_PID_FILE:-/tmp/relationship-assistant-dev.pid}"
LOG="${RA_LOG_FILE:-/tmp/relationship-assistant-dev.log}"

die() { echo "ERROR: $*" >&2; exit 1; }
meta_get() { sed -n "s/^$1=//p" "$PIDFILE" 2>/dev/null | head -n1; }
port_listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# proc_field PID INDEX: field of /proc/PID/stat after "comm"; 0=state 1=ppid 2=pgrp 3=session 19=starttime
proc_field() {
  local s f
  s="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  read -ra f <<<"${s##*) }"
  printf '%s' "${f[$2]:-}"
}

owned_pid() {
  local pid start cmd
  [ -f "$PIDFILE" ] || return 1
  pid="$(meta_get pid)"; start="$(meta_get start)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$(meta_get dir)" = "$DIR" ] && [ "$(meta_get port)" = "$PORT" ] || return 1
  [ -n "$start" ] && [ "$(proc_field "$pid" 19)" = "$start" ] || return 1
  [ "$(proc_field "$pid" 2)" = "$pid" ] && [ "$(proc_field "$pid" 3)" = "$pid" ] || return 1
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$(readlink -f "$DIR")" ] || return 1
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)"
  case "$cmd" in *npm*" run dev ") ;; *) return 1 ;; esac
  printf '%s' "$pid"
}

# Gracefully stop the verified process group; $1=1 escalates to SIGKILL.
stop_owned() {
  local pid i
  pid="$(owned_pid)" || return 2
  kill -TERM -- "-$pid" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 1
  done
  if [ "$1" = "1" ] && owned_pid >/dev/null; then kill -KILL -- "-$pid" 2>/dev/null; return 0; fi
  return 1
}

# Restore the Next.js-generated next-env.d.ts only when ALL hold: it was identical to HEAD
# (nothing staged or unstaged) when this workflow started the server, nothing is staged now,
# and every unstaged changed line is a generated import/reference line.
restore_next_env() {
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  git diff --quiet HEAD -- next-env.d.ts 2>/dev/null && return 0
  if [ "$(meta_get nextenv_clean)" != "1" ]; then
    echo "NOTE: next-env.d.ts was not clean at start (or start unrecorded); leaving it unchanged."
  elif ! git diff --cached --quiet -- next-env.d.ts; then
    echo "WARNING: next-env.d.ts has staged changes; leaving it unchanged."
  elif git diff -U0 -- next-env.d.ts | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
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
    if pid="$(owned_pid)"; then
      port_listening || die "recorded dev server (pid $pid) is not listening on $PORT; run dev-stop.sh and retry"
      echo "Dev server already running (pid $pid); reusing."; echo "RA_STATUS=reused"; exit 0
    fi
    rm -f "$PIDFILE" "$PIDFILE.launch"
    port_listening && die "port $PORT already in use by a process this workflow did not start."
    [ -d node_modules ] || npm install </dev/null || die "npm install failed"
    clean=0
    if git rev-parse --git-dir >/dev/null 2>&1 && git diff --quiet HEAD -- next-env.d.ts 2>/dev/null; then clean=1; fi
    # New session + group leader; login shell so node/npm from the user's profile are on PATH.
    setsid bash "${RA_REMOTE_SHELL_FLAGS:--lc}" 'echo $$ > "$1"; exec npm run dev' _ "$PIDFILE.launch" >"$LOG" 2>&1 </dev/null &
    launched=$!
    pid=""
    for i in 1 2 3 4 5 6 7 8 9 10; do
      [ -s "$PIDFILE.launch" ] && { pid="$(cat "$PIDFILE.launch")"; break; }
      sleep 1
    done
    rm -f "$PIDFILE.launch"
    case "$pid" in ''|*[!0-9]*) kill -TERM "$launched" 2>/dev/null; die "could not determine dev server pid; see $LOG" ;; esac
    sleep 1
    start="$(proc_field "$pid" 19)"
    if [ -z "$start" ] || [ "$(proc_field "$pid" 2)" != "$pid" ] || [ "$(proc_field "$pid" 3)" != "$pid" ]; then
      kill -TERM "$launched" 2>/dev/null
      die "dev server exited immediately or did not start as its own session; see $LOG"
    fi
    printf 'pid=%s\nstart=%s\ndir=%s\nport=%s\nnextenv_clean=%s\n' "$pid" "$start" "$DIR" "$PORT" "$clean" >"$PIDFILE"
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if port_listening; then echo "Dev server listening on $PORT."; echo "RA_STATUS=started"; exit 0; fi
      owned_pid >/dev/null || { rm -f "$PIDFILE"; die "dev server exited early; see $LOG"; }
      sleep 2
    done
    stop_owned 1 >/dev/null
    rm -f "$PIDFILE"
    die "dev server not listening after 30s (stopped it); see $LOG"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      stop_owned "$FORCE"
      rc=$?
      if [ "$rc" -eq 0 ]; then echo "Dev server stopped."
      elif [ "$rc" -eq 1 ]; then die "dev server did not exit within 15s; re-run with --force"
      else echo "Recorded dev server is not running or does not match this workspace/port; not signalling anything."
      fi
    else
      echo "No dev server record; nothing to stop."
    fi
    restore_next_env
    rm -f "$PIDFILE"
    ;;
  *) die "unknown action '$ACTION'" ;;
esac
