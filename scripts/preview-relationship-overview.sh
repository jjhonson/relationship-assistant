#!/usr/bin/env bash
# Mac-only, temporary fictional UI acceptance harness. No real-data access.
set -eu
CS=unhallowed-spell-q744p45v99734pgg
REPO=jjhonson/relationship-assistant
PORT=3002
RUN="overview-preview-$$-$(date +%s)"
FORWARD=""
REMOTE_ATTEMPTED=0
command -v gh >/dev/null
command -v open >/dev/null
command -v lsof >/dev/null
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fp >/dev/null 2>&1; then
  echo "Local preview port 3002 is already in use. Close its existing preview first." >&2
  exit 1
fi
umask 077
LOG="$(mktemp -t relationship-overview-preview)"
cleanup() {
  status=$?
  trap - EXIT INT TERM HUP
  if [ -n "$FORWARD" ] && jobs -pr | grep -Fxq "$FORWARD"; then
    kill -TERM "$FORWARD" 2>/dev/null || true
    wait "$FORWARD" 2>/dev/null || true
  fi
  if [ "$REMOTE_ATTEMPTED" = 1 ]; then
    state="$(gh codespace list --repo "$REPO" --json name,state --jq '.[] | select(.name == "unhallowed-spell-q744p45v99734pgg") | .state' 2>/dev/null || true)"
    if [ "$state" = Available ]; then
      gh codespace ssh -c "$CS" -- bash -s -- "$RUN" <<'STOP_REMOTE' || echo "Preview cleanup could not be verified. Personal server was not stopped." >&2
set -eu
dir=/workspaces/relationship-agent-preview-7c3476a
if [ -d "$dir" ] && [ "$(git -C "$dir" rev-parse HEAD)" = 7c3476ac55e215b7efa3c5d0f24611e969fd283a ]; then
  RA_PID_FILE=/tmp/relationship-agent-preview-7c3476a.pid \
    RA_LOG_FILE=/tmp/relationship-agent-preview-7c3476a.log \
    bash "$dir/scripts/remote-dev.sh" stop-start "$dir" 3002 0 "$1"
fi
STOP_REMOTE
    fi
  fi
  echo "Preview closed. Your personal application and saved data were not modified."
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

echo "[Preview] Waking the existing private Codespace..."
ready=0
for attempt in 1 2 3 4 5 6; do
  if gh codespace ssh -c "$CS" -- true >/dev/null 2>&1; then ready=1; break; fi
  echo "[Preview] SSH is not ready yet ($attempt/6)"
  sleep 5
done
[ "$ready" = 1 ] || { echo "Could not wake the existing Codespace." >&2; exit 1; }

check_private_port() {
  visibility="$(gh codespace ports -c "$CS" --json sourcePort,visibility --jq '[.[] | select(.sourcePort == 3002) | (.visibility // "unknown" | ascii_downcase)] | if length == 0 then "absent" elif all(. == "private") then "private" else "unsafe" end' 2>/dev/null)" || return 1
  [ "$visibility" = private ] || [ "$visibility" = absent ]
}
check_private_port || { echo "Preview port privacy could not be verified." >&2; exit 1; }

echo "[Preview] Preparing isolated fictional checkout..."
REMOTE_ATTEMPTED=1
gh codespace ssh -c "$CS" -- bash -s -- "$RUN" <<'START_REMOTE'
set -eu
run="$1"
repo=/workspaces/relationship-assistant
dir=/workspaces/relationship-agent-preview-7c3476a
head=7c3476ac55e215b7efa3c5d0f24611e969fd283a
cd "$repo"
git fetch --quiet --no-tags origin refs/heads/feature/relationship-overview
git cat-file -e "$head^{commit}"
if [ ! -e "$dir" ]; then
  git worktree add --detach "$dir" "$head"
fi
[ ! -L "$dir" ] && [ "$(git -C "$dir" rev-parse --show-toplevel)" = "$dir" ] &&
  [ "$(git -C "$dir" rev-parse HEAD)" = "$head" ] || {
  echo "Unexpected preview checkout; nothing was overwritten." >&2; exit 1;
}
cd "$dir"
git diff --quiet --cached HEAD --
git diff --quiet HEAD -- . ':(exclude)next-env.d.ts'
[ -z "$(git ls-files --others --exclude-standard)" ] || {
  echo "Unexpected preview working-tree edits; nothing was overwritten." >&2; exit 1;
}
if ! git diff --quiet HEAD -- next-env.d.ts; then
  git show HEAD:next-env.d.ts | cmp -s - <(sed 's#\.next/dev/types/#.next/types/#g' next-env.d.ts) ||
    { echo "Unexpected generated-file edits; nothing was overwritten." >&2; exit 1; }
fi
# No personal .env file, network storage or model credentials in the preview.
for file in .env .env.local .env.development .env.development.local .data/personal.env; do
  [ ! -e "$file" ] && [ ! -L "$file" ] || { echo "Unexpected preview configuration; refusing to run." >&2; exit 1; }
done
export RA_DATASET_MODE=fictional RA_STORAGE_BACKEND=json OPENAI_API_KEY=""
unset RA_PERSONAL_DATA_ENABLED RA_PERSONAL_DB_OWNER_ID RA_PERSONAL_SUPABASE_URL RA_PERSONAL_SUPABASE_SECRET_KEY
unset RA_DB_OWNER_ID RA_SUPABASE_URL RA_SUPABASE_SECRET_KEY NODE_ENV
umask 077
[ ! -L .data ] || exit 1
mkdir -p .data
[ ! -L .data/relationships.json ] || exit 1
if [ ! -e .data/relationships.json ]; then
  echo "[Preview] Loading three invented relationships..."
  node --input-type=module <<'FIXTURE'
import { writeFileSync } from "node:fs";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ago = (n) => new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0,10);
function person(id, name, last, older) {
  const source = "pasted:preview-" + id;
  const previous = "pasted:previous-" + id;
  return {
    id, personLabel: name, personLabelAuthority:"user-confirmed",
    createdAt: older + "T12:00:00Z", updatedAt: last + "T12:00:00Z",
    lastInteractionAt: last, classification:"Professional contact", relationshipContexts:[],
    relationshipRoles:[], intention:null, labelAuthority:"user-confirmed",
    inferredRelationshipContexts:[{value:"Former colleague",sourceIds:[source],lastSuggestedAt:last,verification:"Unverified"}],
    inferredRelationshipRoles:[], disposition:"Relationship worth managing", currentState:"Active",
    tags:[], history:{earliestObservedMeaningfulInteraction:older,latestObservedMeaningfulInteraction:last,pattern:"Fictional past colleagues",evidenceIds:[previous,source]},
    openLoops:[], actionableMemoryFeedback:[], dismissedConnectionSubjects:[], reasonsToEngage:[],
    unknowns:[], confidence:"Low", identities:[], durableFacts:[], activeThreads:[], stewardshipOpportunities:[],
    sources:[
      {id:previous,source:"manual",observedAt:older,label:"Fictional earlier catch-up"},
      {id:source,source:"manual",observedAt:last,label:"Fictional conversation"},
    ]
  };
}
function fact(p,id,category,label,value,day=p.lastInteractionAt,source=p.sources[1].id){
  p.durableFacts.push({id,category,label,value,sourceIds:[source],firstObservedAt:day,lastObservedAt:day});
}
const a=person("00000000-0000-4000-8000-000000000081","Avery Morgan (fictional)",ago(4),ago(400));
fact(a,"company","Work","Employer","Example Software");
fact(a,"title","Work","Job title","Engineering Director");
fact(a,"home","Location","Home","Lives in Fort Collins near the foothills.");
fact(a,"birthday","Personal","Birthday","March 12");
fact(a,"email","Personal","Email","avery@example.com");
fact(a,"family","Family","Family","Children are still in school.");
fact(a,"interest","Interest","Woodworking","Enjoys making furniture.");
fact(a,"past","Personal","Shared history","Previously worked together at a fictional software company.",ago(400),a.sources[0].id);
a.activeThreads.push({id:"career",topic:"Next career chapter",state:"Considering a career change and relocation in a few years, after the children finish school.",whyItMatters:"Long-term possibilities",nextChangeSignal:"Several years from now",sourceIds:[a.sources[1].id],lastObservedAt:a.lastInteractionAt});
const b=person("00000000-0000-4000-8000-000000000082","Riley Ellis (fictional)",ago(220),ago(480));
fact(b,"interest","Interest","Hobby","Interested in architecture and urban design.");
const d=person("00000000-0000-4000-8000-000000000083","Casey Park (fictional)",ago(2),ago(250));
d.openLoops.push({commitment:"Send the article about garden design",owner:"User",status:"Open",sourceIds:[d.sources[1].id]});
writeFileSync(".data/relationships.json",JSON.stringify({version:1,relationships:[a,b,d],captures:[],moments:[],connectionJourneys:[]},null,2),{flag:"wx",mode:0o600});
FIXTURE
fi
if [ ! -d node_modules ] || [ ! -f node_modules/.ra-preview-deps ]; then
  echo "[Preview] Installing locked dependencies for the separate checkout (first use only)..."
  npm ci </dev/null
  touch node_modules/.ra-preview-deps
fi
echo "[Preview] Starting the fictional application on port 3002..."
RA_PID_FILE=/tmp/relationship-agent-preview-7c3476a.pid \
  RA_LOG_FILE=/tmp/relationship-agent-preview-7c3476a.log \
  RA_REMOTE_SHELL_FLAGS=-c \
  bash "$dir/scripts/remote-dev.sh" start "$dir" 3002 0 "$run"
START_REMOTE

check_private_port || { echo "Preview port privacy could not be verified." >&2; exit 1; }
echo "[Preview] Connecting your Mac to the isolated application..."
gh codespace ports forward "$PORT:$PORT" -c "$CS" >"$LOG" 2>&1 </dev/null &
FORWARD=$!
ready=0
for attempt in {1..30}; do
  if ! kill -0 "$FORWARD" 2>/dev/null; then
    echo "Preview tunnel exited. Its local log is at $LOG" >&2; exit 1
  fi
  listeners="$(lsof -nP -a -iTCP:"$PORT" -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | sort -u || true)"
  if [ "$listeners" = "$FORWARD" ] &&
     [ "$(curl --noproxy '*' -s -o /dev/null -m 8 -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)" = 200 ]; then
    ready=1; break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "Could not verify the preview browser connection." >&2; exit 1; }
check_private_port || { echo "Preview port privacy could not be verified." >&2; exit 1; }
echo "Fictional preview ready: http://localhost:3002"
echo "Leave this Terminal open during the preview. Press Control+C here when finished."
open "http://localhost:3002"
wait "$FORWARD"
