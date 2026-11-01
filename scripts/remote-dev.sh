#!/usr/bin/env bash
# Runs INSIDE the Codespace, piped over `gh codespace ssh ... bash -s -- ACTION DIR PORT FORCE RUN_ID`.
# Do not run on the Mac. It signals only the process group recorded by this workflow after
# verifying its launch token, kernel start time, session/group, workspace and configured port.
set -u
ACTION="${1:-}"; DIR="${2:-}"; PORT="${3:-3000}"; FORCE="${4:-0}"; RUN_ID="${5:-}"
PIDFILE="${RA_PID_FILE:-/tmp/relationship-assistant-dev.pid}"
LOG="${RA_LOG_FILE:-/tmp/relationship-assistant-dev.log}"

die() { echo "ERROR: $*" >&2; exit 1; }
meta_get() { sed -n "s/^$1=//p" "$PIDFILE" 2>/dev/null | head -n1; }
port_listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# /proc/PID/stat fields after "comm"; 0=state, 2=pgrp, 3=session, 19=starttime.
proc_field() {
  local s f
  s="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  read -ra f <<<"${s##*) }"
  printf '%s' "${f[$2]:-}"
}

has_env() {
  tr '\0' '\n' <"/proc/$1/environ" 2>/dev/null | grep -Fxq "$2=$3"
}

# Verify every live member of this isolated session/group inherited our launch identity.
group_members_valid() {
  local group="$1" owner="$2" dir="$3" port="$4" stat pid state found=0
  for stat in /proc/[0-9]*/stat; do
    [ -r "$stat" ] || continue
    pid="${stat#/proc/}"; pid="${pid%/stat}"
    [ "$(proc_field "$pid" 2)" = "$group" ] || continue
    [ "$(proc_field "$pid" 3)" = "$group" ] || return 1
    state="$(proc_field "$pid" 0)"
    case "$state" in Z|X|'') continue ;; esac
    [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$dir" ] || return 1
    has_env "$pid" RA_DEV_OWNER "$owner" || return 1
    has_env "$pid" PORT "$port" || return 1
    found=1
  done
  [ "$found" = "1" ]
}

owned_group() {
  local pid start dir port owner cmd
  [ -f "$PIDFILE" ] || return 1
  pid="$(meta_get pid)"; start="$(meta_get start)"
  dir="$(meta_get dir)"; port="$(meta_get port)"; owner="$(meta_get owner)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$dir" = "$DIR" ] && [ "$port" = "$PORT" ] && [ -n "$owner" ] || return 1
  group_members_valid "$pid" "$owner" "$dir" "$port" || return 1
  if [ "$(proc_field "$pid" 19)" = "$start" ] &&
     [ "$(proc_field "$pid" 2)" = "$pid" ] && [ "$(proc_field "$pid" 3)" = "$pid" ] &&
     [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$dir" ] &&
     has_env "$pid" RA_DEV_OWNER "$owner" && has_env "$pid" PORT "$port"; then
    cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | sed 's/[[:space:]]*$//')"
    case "$cmd" in *npm*" run dev") printf '%s' "$pid"; return 0 ;; esac
    return 1
  fi
  # The leader may exit before a child finishes. The surviving group is still attributable
  # only when every live member carries the unpredictable owner token and launch settings.
  printf '%s' "$pid"
}

group_has_live_members() {
  local group="$1" stat pid state
  for stat in /proc/[0-9]*/stat; do
    [ -r "$stat" ] || continue
    pid="${stat#/proc/}"; pid="${pid%/stat}"
    [ "$(proc_field "$pid" 2)" = "$group" ] && [ "$(proc_field "$pid" 3)" = "$group" ] || continue
    state="$(proc_field "$pid" 0)"
    case "$state" in Z|X|'') continue ;; esac
    return 0
  done
  return 1
}

stop_owned() {
  local pid i
  pid="$(meta_get pid)"
  case "$pid" in ''|*[!0-9]*) return 2 ;; esac
  group_has_live_members "$pid" || return 0
  pid="$(owned_group)" || return 2
  kill -TERM -- "-$pid" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    group_has_live_members "$pid" || return 0
    sleep 1
  done
  if [ "$1" = "1" ]; then
    pid="$(owned_group)" || return 2
    kill -KILL -- "-$pid" 2>/dev/null || true
    for i in 1 2 3 4 5; do
      group_has_live_members "$pid" || return 0
      sleep 1
    done
  fi
  return 1
}

cleanup_launch() {
  local pid="$1" start="$2" owner="$3"
  if [ -n "$pid" ] && [ "$(proc_field "$pid" 19)" = "$start" ] &&
     [ "$(proc_field "$pid" 2)" = "$pid" ] && [ "$(proc_field "$pid" 3)" = "$pid" ] &&
     group_members_valid "$pid" "$owner" "$DIR" "$PORT"; then
    kill -TERM -- "-$pid" 2>/dev/null || true
  fi
}

report_next_env() {
  if git rev-parse --git-dir >/dev/null 2>&1 &&
     [ -n "$(git status --porcelain -- next-env.d.ts 2>/dev/null)" ]; then
    echo "NOTE: next-env.d.ts has staged or unstaged changes; it was left untouched. Review with: git diff HEAD -- next-env.d.ts"
  fi
}

cd "$DIR" 2>/dev/null || die "directory $DIR not found in Codespace (set RA_REMOTE_DIR)"
case "$PORT" in ''|*[!0-9]*) die "invalid port '$PORT'" ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) [ "$ACTION" = "stop" ] || die "invalid launch run id" ;; esac

case "$ACTION" in
  start)
    [ -n "$RUN_ID" ] || die "missing launch run id"
    echo "[Codespace] branch/status (no switching or pulling):"
    git status --short --branch 2>/dev/null | head -n 20
    [ -f .env.local ] || echo "NOTE: .env.local missing; Gmail will not work until you create it manually."
    if pid="$(owned_group)"; then
      port_listening || die "recorded dev server (pid $pid) is not listening on $PORT; run dev-stop.sh and retry"
      echo "Dev server already running (pid $pid); reusing."; echo "RA_STATUS=reused"; exit 0
    fi
    if [ -f "$PIDFILE" ]; then
      old_pid="$(meta_get pid)"
      case "$old_pid" in
        ''|*[!0-9]*) rm -f "$PIDFILE" ;;
        *) if group_has_live_members "$old_pid"; then
             die "an existing recorded process group is still active but cannot be verified; ownership record retained"
           fi
           rm -f "$PIDFILE"
           ;;
      esac
    fi
    rm -f "$PIDFILE.launch"
    port_listening && die "port $PORT already in use by a process this workflow did not start."
    [ -d node_modules ] || npm install </dev/null || die "npm install failed"
    umask 077
    owner="$(printf '%s-%s-%s' "$RUN_ID" "$$" "$RANDOM$RANDOM")"
    setsid env RA_DEV_OWNER="$owner" PORT="$PORT" bash "${RA_REMOTE_SHELL_FLAGS:--lc}" 'echo $$ > "$1"; exec npm run dev' _ "$PIDFILE.launch" >"$LOG" 2>&1 </dev/null &
    launched=$!
    launch_start="$(proc_field "$launched" 19)"
    pid=""
    for i in 1 2 3 4 5 6 7 8 9 10; do
      [ -s "$PIDFILE.launch" ] && { pid="$(cat "$PIDFILE.launch")"; break; }
      sleep 1
    done
    rm -f "$PIDFILE.launch"
    case "$pid" in ''|*[!0-9]*) cleanup_launch "$launched" "$launch_start" "$owner"; die "could not determine dev server pid; see $LOG" ;; esac
    sleep 1
    start="$(proc_field "$pid" 19)"
    if [ -z "$start" ] || [ "$(proc_field "$pid" 2)" != "$pid" ] || [ "$(proc_field "$pid" 3)" != "$pid" ]; then
      cleanup_launch "$pid" "$launch_start" "$owner"
      die "dev server exited immediately or did not start as its own session; see $LOG"
    fi
    printf 'pid=%s\nstart=%s\ndir=%s\nport=%s\nowner=%s\nrun_id=%s\n' \
      "$pid" "$start" "$DIR" "$PORT" "$owner" "$RUN_ID" >"$PIDFILE.tmp.$$"
    mv "$PIDFILE.tmp.$$" "$PIDFILE"
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if port_listening; then echo "Dev server listening on $PORT."; echo "RA_STATUS=started"; exit 0; fi
      if ! group_has_live_members "$pid"; then rm -f "$PIDFILE"; die "dev server exited early; see $LOG"; fi
      owned_group >/dev/null || die "dev server launch group could not be verified; ownership record retained"
      sleep 2
    done
    if stop_owned 1; then rm -f "$PIDFILE"; die "dev server not listening after 30s (stopped it); see $LOG"; fi
    die "dev server did not stop cleanly; ownership record retained for safe recovery"
    ;;
  stop|stop-start)
    expected_run=""
    [ "$ACTION" = "stop-start" ] && expected_run="$RUN_ID"
    if [ -f "$PIDFILE" ]; then
      if [ -n "$expected_run" ] && [ "$(meta_get run_id)" != "$expected_run" ]; then
        echo "No server started by this run; leaving the recorded server untouched."
        exit 0
      fi
      stop_owned "$FORCE"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        echo "Dev server stopped."
        rm -f "$PIDFILE"
      elif [ "$rc" -eq 1 ]; then
        die "dev server group did not exit within the grace period; ownership record retained. Re-run with --force."
      else
        die "recorded dev server group could not be verified; not signalling or removing its ownership record."
      fi
    else
      echo "No dev server record; nothing to stop."
    fi
    report_next_env
    ;;
  *) die "unknown action '$ACTION'" ;;
esac
