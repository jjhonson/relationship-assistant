#!/usr/bin/env bash
# Runs INSIDE the Codespace, piped over `gh codespace ssh ... bash -s -- ACTION DIR PORT FORCE RUN_ID`.
# Do not run on the Mac. It signals only the process group recorded by this workflow after
# verifying its launch token, kernel start time, session/group, workspace and configured port.
set -u
exec 3>&1
ACTION="${1:-}"; DIR="${2:-}"; PORT="${3:-3000}"; FORCE="${4:-0}"; RUN_ID="${5:-}"
PIDFILE="${RA_PID_FILE:-/tmp/relationship-assistant-dev.pid}"
LOG="${RA_LOG_FILE:-/tmp/relationship-assistant-dev.log}"
LOCK_DIR="${PIDFILE}.lock"
LOCK_TOKEN="remote-$$-${RANDOM}${RANDOM}"

die() { echo "ERROR: $*" >&2; exit 1; }
meta_get() { sed -n "s/^$1=//p" "$PIDFILE" 2>/dev/null | head -n1; }
port_listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

emit_owned_diagnostic() {
  local code="$1" pid="$2" member_pid="$3" state="$4"
  local record="${5:-unknown}" session="${6:-unknown}" group="${7:-unknown}"
  local start="${8:-unknown}" cwd="${9:-unknown}" owner="${10:-unknown}"
  local port="${11:-unknown}" command="${12:-unknown}" enumeration="${13:-unknown}"
  case "$pid" in ''|*[!0-9]*) pid=unknown ;; esac
  case "$member_pid" in ''|*[!0-9]*) member_pid=unknown ;; esac
  case "$state" in R|S|D|T|t|Z|X|I) ;; *) state=unknown ;; esac
  printf 'RA_DIAG v=1 code=%s pid=%s member_pid=%s state=%s record=%s session=%s group=%s start=%s cwd=%s owner=%s port=%s command=%s enumeration=%s\n' \
    "$code" "$pid" "$member_pid" "$state" "$record" "$session" "$group" "$start" "$cwd" "$owner" "$port" "$command" "$enumeration" >&3
}

record_invalid() {
  OWNED_DIAG_CODE="$1"
  return 1
}

pid_record_valid() {
  local content lines pid start dir port owner run_id expected
  OWNED_DIAG_CODE=record_valid
  if [ ! -f "$PIDFILE" ]; then record_invalid record_missing; return 1; fi
  if [ -L "$PIDFILE" ]; then record_invalid record_symlink; return 1; fi
  lines="$(wc -l <"$PIDFILE" 2>/dev/null | tr -d '[:space:]')" || { record_invalid record_unreadable; return 1; }
  [ "$lines" = "6" ] || { record_invalid record_line_count; return 1; }
  content="$(cat "$PIDFILE" 2>/dev/null)" || { record_invalid record_unreadable; return 1; }
  pid="$(meta_get pid)"; start="$(meta_get start)"; dir="$(meta_get dir)"
  port="$(meta_get port)"; owner="$(meta_get owner)"; run_id="$(meta_get run_id)"
  case "$pid" in ''|*[!0-9]*) record_invalid record_malformed; return 1 ;; esac
  case "$start" in ''|*[!0-9]*) record_invalid record_malformed; return 1 ;; esac
  case "$owner" in ''|*[!A-Za-z0-9._-]*) record_invalid record_malformed; return 1 ;; esac
  case "$run_id" in ''|*[!A-Za-z0-9._-]*) record_invalid record_malformed; return 1 ;; esac
  [ "$dir" = "$DIR" ] || { record_invalid workspace_mismatch; return 1; }
  [ "$port" = "$PORT" ] || { record_invalid port_mismatch; return 1; }
  expected="$(printf 'pid=%s\nstart=%s\ndir=%s\nport=%s\nowner=%s\nrun_id=%s' "$pid" "$start" "$dir" "$port" "$owner" "$run_id")"
  [ "$content" = "$expected" ] || { record_invalid record_content_mismatch; return 1; }
}

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
  GROUP_DIAG_CODE=group_member_not_found
  GROUP_DIAG_PID=""
  GROUP_DIAG_STATE=""
  GROUP_DIAG_SESSION=unknown
  GROUP_DIAG_GROUP=unknown
  GROUP_DIAG_CWD=unknown
  GROUP_DIAG_OWNER=unknown
  GROUP_DIAG_PORT=unknown
  GROUP_DIAG_ENUMERATION=unknown
  for stat in /proc/[0-9]*/stat; do
    [ -r "$stat" ] || continue
    pid="${stat#/proc/}"; pid="${pid%/stat}"
    member_group="$(proc_field "$pid" 2)"
    [ -n "$member_group" ] || continue
    [ "$member_group" = "$group" ] || continue
    GROUP_DIAG_GROUP=match
    GROUP_DIAG_ENUMERATION=match
    GROUP_DIAG_PID="$pid"
    member_session="$(proc_field "$pid" 3)"
    if [ -z "$member_session" ]; then
      GROUP_DIAG_CODE=member_inspection_unknown
      [ -e "/proc/$pid" ] || GROUP_DIAG_CODE=member_disappeared
      return 1
    fi
    if [ "$member_session" != "$group" ]; then
      GROUP_DIAG_CODE=member_session_mismatch
      GROUP_DIAG_SESSION=mismatch
      return 1
    fi
    GROUP_DIAG_SESSION=match
    state="$(proc_field "$pid" 0)"
    case "$state" in Z|X|'') continue ;; esac
    GROUP_DIAG_STATE="$state"
    member_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)"
    if [ -z "$member_cwd" ]; then
      GROUP_DIAG_CODE=member_inspection_unknown
      [ -e "/proc/$pid" ] || GROUP_DIAG_CODE=member_disappeared
      return 1
    fi
    if [ "$member_cwd" != "$dir" ]; then
      GROUP_DIAG_CODE=member_cwd_mismatch
      GROUP_DIAG_CWD=mismatch
      return 1
    fi
    GROUP_DIAG_CWD=match
    if [ ! -r "/proc/$pid/environ" ]; then
      GROUP_DIAG_CODE=member_environment_unreadable
      return 1
    fi
    if ! has_env "$pid" RA_DEV_OWNER "$owner"; then
      GROUP_DIAG_CODE=member_owner_mismatch
      GROUP_DIAG_OWNER=mismatch
      return 1
    fi
    GROUP_DIAG_OWNER=match
    if ! has_env "$pid" PORT "$port"; then
      GROUP_DIAG_CODE=member_port_mismatch
      GROUP_DIAG_PORT=mismatch
      return 1
    fi
    GROUP_DIAG_PORT=match
    found=1
  done
  if [ "$found" != "1" ]; then
    GROUP_DIAG_CODE=group_member_not_found
    GROUP_DIAG_ENUMERATION=mismatch
    return 1
  fi
  return 0
}

owned_group() {
  local pid start dir port owner cmd diagnose="${1:-}" actual_start diag_start reason
  if ! pid_record_valid; then
    [ "$diagnose" = "diagnose" ] &&
      emit_owned_diagnostic "$OWNED_DIAG_CODE" "$(meta_get pid)" unknown unknown mismatch unknown unknown unknown unknown unknown unknown unknown unknown
    return 1
  fi
  pid="$(meta_get pid)"; start="$(meta_get start)"
  dir="$(meta_get dir)"; port="$(meta_get port)"; owner="$(meta_get owner)"
  case "$pid" in ''|*[!0-9]*)
    [ "$diagnose" = "diagnose" ] && emit_owned_diagnostic record_malformed unknown unknown unknown mismatch unknown unknown unknown unknown unknown unknown unknown unknown
    return 1 ;;
  esac
  if ! group_members_valid "$pid" "$owner" "$dir" "$port"; then
    diag_start=unknown
    actual_start="$(proc_field "$pid" 19)"
    if [ -n "$actual_start" ]; then
      diag_start=mismatch
      [ "$actual_start" = "$start" ] && diag_start=match
    fi
    [ "$diagnose" = "diagnose" ] &&
      emit_owned_diagnostic "$GROUP_DIAG_CODE" "$pid" "${GROUP_DIAG_PID:-unknown}" "${GROUP_DIAG_STATE:-unknown}" match "${GROUP_DIAG_SESSION:-unknown}" "${GROUP_DIAG_GROUP:-unknown}" "$diag_start" "${GROUP_DIAG_CWD:-unknown}" "${GROUP_DIAG_OWNER:-unknown}" "${GROUP_DIAG_PORT:-unknown}" unknown "${GROUP_DIAG_ENUMERATION:-unknown}"
    return 1
  fi
  if [ "$(proc_field "$pid" 19)" = "$start" ] &&
     [ "$(proc_field "$pid" 2)" = "$pid" ] && [ "$(proc_field "$pid" 3)" = "$pid" ] &&
     [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$dir" ] &&
     has_env "$pid" RA_DEV_OWNER "$owner" && has_env "$pid" PORT "$port"; then
    cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | sed 's/[[:space:]]*$//')"
    if [ -z "$cmd" ]; then
      reason=process_inspection_unknown
      [ -e "/proc/$pid" ] || reason=process_disappeared
      [ "$diagnose" = "diagnose" ] &&
        emit_owned_diagnostic "$reason" "$pid" unknown "$(proc_field "$pid" 0)" match match match match match match match unknown unknown match
      return 1
    fi
    case "$cmd" in
      *npm*" run dev") printf '%s' "$pid"; return 0 ;;
    esac
    [ "$diagnose" = "diagnose" ] &&
      emit_owned_diagnostic leader_command_mismatch "$pid" unknown "$(proc_field "$pid" 0)" match match match match match match match mismatch unknown match
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

launch_process_matches() {
  local pid="$1" start="$2" owner="$3" dir="$4" port="$5" cmd
  [ -n "$start" ] || return 1
  [ "$(proc_field "$pid" 19)" = "$start" ] || return 1
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$dir" ] || return 1
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)" || return 1
  case "$cmd" in *"env RA_DEV_OWNER=$owner PORT=$port bash"*"npm run dev"*) return 0 ;; esac
  return 1
}

launch_pending_matches() {
  local pid="$1" start="$2" owner="$3" dir="$4"
  [ -n "$start" ] || return 1
  [ "$(proc_field "$pid" 19)" = "$start" ] || return 1
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$dir" ] || return 1
  has_env "$pid" RA_DEV_OWNER "$owner"
}

launch_identity_exited() {
  local pid="$1" start="$2" current state
  if [ ! -e "/proc/$pid" ]; then return 0; fi
  [ -r "/proc/$pid/stat" ] || return 1
  current="$(proc_field "$pid" 19)"
  [ -n "$current" ] || return 1
  if [ -n "$start" ] && [ "$current" != "$start" ]; then return 0; fi
  [ -n "$start" ] || return 1
  state="$(proc_field "$pid" 0)"
  case "$state" in Z|X|'') return 0 ;; esac
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
  local pid="$1" start="$2" owner="$3" i target=""
  for i in {1..50}; do
    [ -n "$start" ] || start="$(proc_field "$pid" 19)"
    if group_has_live_members "$pid" && group_members_valid "$pid" "$owner" "$DIR" "$PORT"; then
      target=group
      break
    fi
    if launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT"; then
      target=pid
      break
    fi
    if ! group_has_live_members "$pid" && launch_identity_exited "$pid" "$start"; then return 0; fi
    launch_pending_matches "$pid" "$start" "$owner" "$DIR" || return 2
    sleep 0.1
  done
  case "$target" in
    group) kill -TERM -- "-$pid" 2>/dev/null || true ;;
    pid) kill -TERM "$pid" 2>/dev/null || true ;;
    *) return 2 ;;
  esac
  for i in {1..5}; do
    if ! group_has_live_members "$pid" && launch_identity_exited "$pid" "$start"; then return 0; fi
    if group_has_live_members "$pid"; then
      if ! group_members_valid "$pid" "$owner" "$DIR" "$PORT" &&
         ! launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT" &&
         ! launch_pending_matches "$pid" "$start" "$owner" "$DIR"; then
        return 2
      fi
    elif ! launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT" &&
         ! launch_pending_matches "$pid" "$start" "$owner" "$DIR"; then
      launch_identity_exited "$pid" "$start" && return 0
      return 2
    fi
    sleep 1
  done
  if group_has_live_members "$pid" && group_members_valid "$pid" "$owner" "$DIR" "$PORT"; then
    kill -KILL -- "-$pid" 2>/dev/null || true
  elif launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT"; then
    kill -KILL "$pid" 2>/dev/null || true
  elif ! group_has_live_members "$pid" && launch_identity_exited "$pid" "$start"; then
    return 0
  else
    return 2
  fi
  for i in {1..5}; do
    if ! group_has_live_members "$pid" && launch_identity_exited "$pid" "$start"; then return 0; fi
    if group_has_live_members "$pid"; then
      if ! group_members_valid "$pid" "$owner" "$DIR" "$PORT" &&
         ! launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT" &&
         ! launch_pending_matches "$pid" "$start" "$owner" "$DIR"; then
        return 2
      fi
    elif ! launch_process_matches "$pid" "$start" "$owner" "$DIR" "$PORT" &&
         ! launch_pending_matches "$pid" "$start" "$owner" "$DIR"; then
      launch_identity_exited "$pid" "$start" && return 0
      return 2
    fi
    sleep 1
  done
  if group_has_live_members "$pid" || ! launch_identity_exited "$pid" "$start"; then return 1; fi
  return 0
}

report_next_env() {
  if git rev-parse --git-dir >/dev/null 2>&1 &&
     [ -n "$(git status --porcelain -- next-env.d.ts 2>/dev/null)" ]; then
    echo "NOTE: next-env.d.ts has staged or unstaged changes; it was left untouched. Review with: git diff HEAD -- next-env.d.ts"
  fi
}

cd "$DIR" 2>/dev/null || die "directory $DIR not found in Codespace (set RA_REMOTE_DIR)"
DIR="$(pwd -P)"
case "$PORT" in ''|*[!0-9]*) die "invalid port '$PORT'" ;; esac
case "$RUN_ID" in *[!A-Za-z0-9._-]*) [ "$ACTION" = "stop" ] || die "invalid launch run id" ;; esac

mkdir -p "$(dirname "$PIDFILE")" || die "could not create process-record directory"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  die "another dev start/stop is in progress (or a stale lock needs inspection): $LOCK_DIR"
fi
if ! printf '%s\n' "$LOCK_TOKEN" >"$LOCK_DIR/owner"; then
  rmdir "$LOCK_DIR" 2>/dev/null || true
  die "could not record remote lifecycle lock ownership"
fi
release_remote_lock() {
  [ -f "$LOCK_DIR/owner" ] || return 0
  [ "$(cat "$LOCK_DIR/owner" 2>/dev/null)" = "$LOCK_TOKEN" ] || return 0
  rm -f "$LOCK_DIR/owner"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

LAUNCH_PID=""
LAUNCH_START=""
LAUNCH_OWNER=""
LAUNCH_FILE=""
LAUNCH_SERVER_PID=""
LAUNCH_SERVER_START=""
LAUNCH_HANDED_OFF=0
LAUNCHING=0
LAUNCH_IDENTITY_READY=0
PENDING_SIGNAL=""
RECORD_TMP=""
RECORD_TMP_OWNED=0

remove_launch_record() {
  local before after
  [ -n "$LAUNCH_SERVER_PID" ] && [ -n "$LAUNCH_SERVER_START" ] || return 0
  [ -f "$PIDFILE" ] || return 0
  before="$(cat "$PIDFILE" 2>/dev/null)" || return 1
  if [ "$(meta_get pid)" != "$LAUNCH_SERVER_PID" ] ||
     [ "$(meta_get start)" != "$LAUNCH_SERVER_START" ] ||
     [ "$(meta_get dir)" != "$DIR" ] ||
     [ "$(meta_get port)" != "$PORT" ] ||
     [ "$(meta_get owner)" != "$LAUNCH_OWNER" ] ||
     [ "$(meta_get run_id)" != "$RUN_ID" ]; then
    return 0
  fi
  pid_record_valid || return 1
  after="$(cat "$PIDFILE" 2>/dev/null)" || return 1
  [ "$before" = "$after" ] || return 1
  rm -f "$PIDFILE"
}

remove_launch_file() {
  local content handoff_pid
  [ -n "$LAUNCH_FILE" ] && [ -f "$LAUNCH_FILE" ] || return 0
  content="$(cat "$LAUNCH_FILE" 2>/dev/null)" || return 1
  handoff_pid="${content%%:*}"
  case "$handoff_pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$content" = "$handoff_pid:$LAUNCH_OWNER" ] || return 1
  rm -f "$LAUNCH_FILE"
}

remote_exit_cleanup() {
  local status=$? launch_cleanup_ok=0 handoff_content handoff_pid
  trap - EXIT INT TERM
  if [ -n "$LAUNCH_PID" ] && [ "$LAUNCH_HANDED_OFF" != "1" ]; then
    if cleanup_launch "$LAUNCH_PID" "$LAUNCH_START" "$LAUNCH_OWNER"; then
      launch_cleanup_ok=1
      if [ -z "$LAUNCH_SERVER_PID" ] && [ -f "$LAUNCH_FILE" ]; then
        handoff_content="$(cat "$LAUNCH_FILE" 2>/dev/null)"
        handoff_pid="${handoff_content%%:*}"
        case "$handoff_pid" in ''|*[!0-9]*) handoff_pid="" ;; esac
        if [ -n "$handoff_pid" ] && [ "$handoff_content" = "$handoff_pid:$LAUNCH_OWNER" ]; then
          LAUNCH_SERVER_PID="$handoff_pid"
          LAUNCH_SERVER_START="$(proc_field "$handoff_pid" 19)"
        fi
      fi
      remove_launch_record || echo "WARNING: could not safely remove this launch's ownership record." >&2
    else
      echo "WARNING: interrupted or failed launch could not be verified as terminated; inspect $LOG. Remote lifecycle lock left in place: $LOCK_DIR" >&2
      [ "$status" -ne 0 ] || status=1
    fi
  fi
  if [ "$LAUNCH_HANDED_OFF" = "1" ] || [ "$launch_cleanup_ok" = "1" ]; then
    remove_launch_file || echo "WARNING: could not verify this launch's handoff file; it was retained: $LAUNCH_FILE" >&2
  fi
  if [ "$RECORD_TMP_OWNED" = "1" ] && [ -n "$RECORD_TMP" ]; then
    rm -f "$RECORD_TMP" || echo "WARNING: could not remove this launch's temporary ownership record: $RECORD_TMP" >&2
  fi
  if [ "$LAUNCH_HANDED_OFF" = "1" ] || [ "$launch_cleanup_ok" = "1" ] || [ -z "$LAUNCH_PID" ]; then
    release_remote_lock
  fi
  exit "$status"
}

remote_signal() {
  if [ "$LAUNCHING" = "1" ] && [ "$LAUNCH_IDENTITY_READY" != "1" ]; then
    PENDING_SIGNAL="$1"
    return 0
  fi
  case "$1" in INT) exit 130 ;; TERM) exit 143 ;; esac
}

trap remote_exit_cleanup EXIT
trap 'remote_signal INT' INT
trap 'remote_signal TERM' TERM

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
      pid_record_valid || die "existing dev server record is malformed or mismatched; it was retained for inspection"
      old_pid="$(meta_get pid)"
      old_start="$(meta_get start)"
      old_current_start="$(proc_field "$old_pid" 19)"
      if group_has_live_members "$old_pid" || [ "$old_current_start" = "$old_start" ]; then
        die "an existing recorded process group is still active or ambiguous; ownership record retained"
      fi
      old_record="$(cat "$PIDFILE" 2>/dev/null)" || die "could not inspect existing process record; it was retained"
      [ "$(cat "$PIDFILE" 2>/dev/null)" = "$old_record" ] || die "existing process record changed during stale cleanup; it was retained"
      rm -f "$PIDFILE" || die "could not remove the unchanged stale process record"
    fi
    port_listening && die "port $PORT already in use by a process this workflow did not start."
    [ -d node_modules ] || npm install </dev/null || die "npm install failed"
    umask 077
    LAUNCH_OWNER="$(printf '%s-%s-%s' "$RUN_ID" "$$" "$RANDOM$RANDOM")"
    LAUNCH_FILE="$PIDFILE.launch.$RUN_ID.$$"
    if [ -e "$LAUNCH_FILE" ] || [ -L "$LAUNCH_FILE" ]; then
      die "this invocation's unique launch handoff path already exists; it was left untouched: $LAUNCH_FILE"
    fi
    LAUNCHING=1
    RA_DEV_OWNER="$LAUNCH_OWNER" setsid env RA_DEV_OWNER="$LAUNCH_OWNER" PORT="$PORT" bash "${RA_REMOTE_SHELL_FLAGS:--lc}" 'set -o noclobber; printf "%s:%s\n" "$$" "$RA_DEV_OWNER" > "$1" || exit 1; exec npm run dev' _ "$LAUNCH_FILE" >"$LOG" 2>&1 </dev/null 3>&- &
    LAUNCH_PID=$!
    LAUNCH_START="$(proc_field "$LAUNCH_PID" 19)"
    LAUNCH_IDENTITY_READY=1
    LAUNCHING=0
    [ -z "$PENDING_SIGNAL" ] || remote_signal "$PENDING_SIGNAL"
    pid=""
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if [ -s "$LAUNCH_FILE" ]; then
        handoff_content="$(cat "$LAUNCH_FILE")"
        handoff_pid="${handoff_content%%:*}"
        if [ "$handoff_content" = "$handoff_pid:$LAUNCH_OWNER" ]; then pid="$handoff_pid"; fi
        break
      fi
      sleep 1
    done
    LAUNCH_SERVER_PID="$pid"
    case "$pid" in
      ''|*[!0-9]*)
        die "could not determine dev server pid; see $LOG"
        ;;
    esac
    sleep 1
    start="$(proc_field "$pid" 19)"
    LAUNCH_SERVER_START="$start"
    if [ -z "$start" ] || [ "$(proc_field "$pid" 2)" != "$pid" ] || [ "$(proc_field "$pid" 3)" != "$pid" ]; then
      die "dev server exited immediately or did not start as its own session; see $LOG"
    fi
    record_tmp="$(mktemp "${PIDFILE}.tmp.XXXXXX")" || die "could not create unique ownership-record temp file; launch cleanup will be attempted; see $LOG"
    RECORD_TMP="$record_tmp"
    RECORD_TMP_OWNED=1
    record_expected="$(printf 'pid=%s\nstart=%s\ndir=%s\nport=%s\nowner=%s\nrun_id=%s' \
      "$pid" "$start" "$DIR" "$PORT" "$LAUNCH_OWNER" "$RUN_ID")"
    if ! printf '%s\n' "$record_expected" >"$record_tmp"; then
      die "could not write complete dev server ownership record; launch cleanup will be attempted; see $LOG"
    fi
    record_actual="$(cat "$record_tmp" 2>/dev/null)" || record_actual=""
    record_lines="$(wc -l <"$record_tmp" 2>/dev/null | tr -d '[:space:]')"
    if [ "$record_actual" != "$record_expected" ] || [ "$record_lines" != "6" ]; then
      die "temporary dev server ownership record was incomplete or invalid; launch cleanup will be attempted; see $LOG"
    fi
    if ! ln "$record_tmp" "$PIDFILE"; then
      die "a process record appeared during launch; this launch was stopped without replacing it"
    fi
    if ! cmp -s "$record_tmp" "$PIDFILE"; then
      die "published dev server ownership record did not match the validated temporary record; launch cleanup will be attempted; see $LOG"
    fi
    verified_pid="$(owned_group diagnose)" || verified_pid=""
    if [ "$verified_pid" != "$pid" ]; then
      die "published dev server ownership record could not be verified; launch cleanup will be attempted; see $LOG"
    fi
    rm -f "$record_tmp" || die "could not remove this launch's temporary ownership record"
    RECORD_TMP=""
    RECORD_TMP_OWNED=0
    remove_launch_file || die "could not verify removal of this launch's handoff file"
    LAUNCH_HANDED_OFF=1
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      if port_listening; then echo "Dev server listening on $PORT."; echo "RA_STATUS=started"; exit 0; fi
      if ! group_has_live_members "$pid"; then
        remove_launch_record || die "dev server exited early but its record changed; it was retained for inspection"
        die "dev server exited early; see $LOG"
      fi
      owned_group diagnose >/dev/null || die "dev server launch group could not be verified; ownership record retained"
      sleep 2
    done
    if stop_owned 1; then
      remove_launch_record || die "server stopped but its ownership record changed; it was retained for inspection"
      die "dev server not listening after 30s (stopped it); see $LOG"
    fi
    die "dev server did not stop cleanly; ownership record retained for safe recovery"
    ;;
  stop|stop-start)
    expected_run=""
    [ "$ACTION" = "stop-start" ] && expected_run="$RUN_ID"
    if [ -f "$PIDFILE" ]; then
      pid_record_valid || die "recorded dev server metadata is malformed or mismatched; not signalling or removing it."
      old_record="$(cat "$PIDFILE" 2>/dev/null)" || die "could not inspect server record; not signalling or removing it."
      if [ -n "$expected_run" ] && [ "$(meta_get run_id)" != "$expected_run" ]; then
        echo "No server started by this run; leaving the recorded server untouched."
        exit 0
      fi
      stop_owned "$FORCE"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        [ "$(cat "$PIDFILE" 2>/dev/null)" = "$old_record" ] || die "server record changed during shutdown; leaving it untouched."
        echo "Dev server stopped."
        rm -f "$PIDFILE" || die "server stopped but its ownership record could not be removed."
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
