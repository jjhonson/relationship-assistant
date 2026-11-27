#!/usr/bin/env bash
# Mac-only, temporary fictional UI acceptance harness. No real-data access.
set -eu
CS=unhallowed-spell-q744p45v99734pgg
REPO=jjhonson/relationship-assistant
PORT=3002
RUN="overview-preview-$$-$(date +%s)"
FORWARD=""
REMOTE_ATTEMPTED=0
PREVIEW_READY=0
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
if [ -d "$dir" ] && [ "$(git -C "$dir" rev-parse HEAD)" = b17a61c12a13e3eb1a45f591d6a9ca9e6809f0bf ]; then
  RA_PID_FILE=/tmp/relationship-agent-preview-7c3476a.pid \
    RA_LOG_FILE=/tmp/relationship-agent-preview-7c3476a.log \
    bash "$dir/scripts/remote-dev.sh" stop-start "$dir" 3002 0 "$1"
fi
STOP_REMOTE
    fi
  fi
  if [ "$PREVIEW_READY" = 1 ]; then
    echo "Preview closed. Your personal application and saved data were not modified."
  else
    echo "Preview did not start. Your personal application and saved data were not modified." >&2
    [ "$status" != 0 ] || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

echo "[Preview] Waking the existing private Codespace..."
ready=0
for attempt in 1 2 3 4 5 6; do
  if gh codespace ssh -c "$CS" -- true </dev/null >/dev/null 2>&1; then ready=1; break; fi
  echo "[Preview] SSH is not ready yet ($attempt/6)"
  sleep 5
done
[ "$ready" = 1 ] || { echo "Could not wake the existing Codespace." >&2; exit 1; }

check_private_port() {
  visibility="$(gh codespace ports -c "$CS" --json sourcePort,visibility --jq '[.[] | select(.sourcePort == 3002) | (.visibility // "unknown" | ascii_downcase)] | if length == 0 then "absent" elif all(. == "private") then "private" else "unsafe" end' </dev/null 2>/dev/null)" || return 1
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
head=b17a61c12a13e3eb1a45f591d6a9ca9e6809f0bf
cd "$repo"
GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin refs/heads/feature/relationship-overview </dev/null
git cat-file -e "$head^{commit}"
# Reuse the isolated checkout and its dependencies, not the personal checkout.
[ -z "$(ss -H -ltn 'sport = :3002')" ] || {
  echo "An earlier preview is still running. Close its Terminal with Control+C first." >&2; exit 1;
}
if [ ! -e "$dir" ]; then
  git worktree add --detach "$dir" "$head"
fi
[ ! -L "$dir" ] && [ "$(git -C "$dir" rev-parse --show-toplevel)" = "$dir" ] || {
  echo "Unexpected preview checkout; nothing was overwritten." >&2; exit 1;
}
cd "$dir"
prior="$(git rev-parse HEAD)"
case "$prior" in
  "$head"|7c3476ac55e215b7efa3c5d0f24611e969fd283a|279caa35bbb9d3a35dfdbf71ad0bb171f4b8bf0b) ;;
  *) echo "Unexpected preview version; nothing was overwritten." >&2; exit 1 ;;
esac
if git symbolic-ref -q HEAD >/dev/null; then
  echo "Preview checkout is no longer detached; nothing was overwritten." >&2; exit 1
fi
git diff --quiet --cached HEAD --
git diff --quiet HEAD -- . ':(exclude)next-env.d.ts'
[ -z "$(git ls-files --others --exclude-standard)" ] || {
  echo "Unexpected preview working-tree edits; nothing was overwritten." >&2; exit 1;
}
if ! git diff --quiet HEAD -- next-env.d.ts; then
  git show HEAD:next-env.d.ts | cmp -s - <(sed 's#\.next/dev/types/#.next/types/#g' next-env.d.ts) ||
    { echo "Unexpected generated-file edits; nothing was overwritten." >&2; exit 1; }
fi
if [ "$prior" != "$head" ]; then
  echo "[Preview] Updating the isolated checkout to the revised relationship page..."
  git switch --detach "$head"
fi
[ "$(git rev-parse HEAD)" = "$head" ] || exit 1
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
echo "[Preview] Adding the new fictional relationship if not already present..."
node --input-type=module <<'PORTRAIT_FIXTURE'
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
const file = ".data/relationships.json";
const store = JSON.parse(readFileSync(file, "utf8"));
const known = new Set(["00000000-0000-4000-8000-000000000081", "00000000-0000-4000-8000-000000000082", "00000000-0000-4000-8000-000000000083", "00000000-0000-4000-8000-000000000084"]);
if (store.version !== 1 || !Array.isArray(store.relationships) ||
    !store.relationships.every((p) => known.has(p.id) && p.personLabel.endsWith(" (fictional)")) ||
    store.captures?.length || store.moments?.length || store.connectionJourneys?.length || store.raDatasetPurpose === "personal") {
  throw new Error("Unexpected preview data; not modifying it.");
}
const id = "00000000-0000-4000-8000-000000000084";
if (!store.relationships.some(p => p.id === id)) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone:"America/Denver", year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
  const ago = n => new Date(Date.parse(today+"T00:00:00Z")-n*86400000).toISOString().slice(0,10);
  const recent = ago(4), older = ago(920), note = ago(350), shared = ago(1900);
  const sources = [
    {id:"pasted:rowan-recent",source:"manual",observedAt:recent,label:"Fictional recent catch-up"},
    {id:"pasted:rowan-older",source:"manual",observedAt:older,label:"Fictional earlier catch-up"},
    {id:"manual:rowan-note",source:"manual",observedAt:note,label:"Fictional contact details supplied by the user"},
    {id:"manual:rowan-shared",source:"manual",observedAt:shared,label:"Fictional shared-history recollection"},
    {id:"gmail:rowan-old",source:"gmail",observedAt:older,label:"Fictional email metadata from previous work address"},
  ];
  for (let i=0;i<10;i++) sources.push({
    id:"gmail:rowan-new-"+i,source:"gmail",observedAt:ago(5+i),
    label:"Fictional observed email address in metadata"
  });
  const fact = (id, category, label, value, source, date) => ({
    id,category,label,value,sourceIds:[source],firstObservedAt:date,lastObservedAt:date,
  });
  const p = {
    id,personLabel:"Rowan Taylor (fictional)",personLabelAuthority:"user-confirmed",
    createdAt:shared+"T12:00:00Z",updatedAt:recent+"T12:00:00Z",
    lastInteractionAt:recent,classification:"Professional contact",relationshipContexts:[],
    relationshipRoles:[],intention:null,labelAuthority:"user-confirmed",
    inferredRelationshipContexts:[{value:"Former colleague",sourceIds:["pasted:rowan-recent"],lastSuggestedAt:recent,verification:"Unverified"}],
    inferredRelationshipRoles:[],disposition:"Relationship worth managing",currentState:"Active",tags:[],
    history:{earliestObservedMeaningfulInteraction:older,latestObservedMeaningfulInteraction:recent,pattern:"Fictional prior colleagues",evidenceIds:["pasted:rowan-older","pasted:rowan-recent"]},
    openLoops:[],actionableMemoryFeedback:[],dismissedConnectionSubjects:[],reasonsToEngage:[],unknowns:[],confidence:"Low",
    identities:[
      {id:"rowan-new",kind:"email",value:"rowan@example-software.example",source:"gmail",label:"Fictional metadata",confirmed:false,sourceIds:sources.filter(s=>s.id.startsWith("gmail:rowan-new-")).map(s=>s.id)},
      {id:"rowan-old",kind:"email",value:"rowan@previous-company.example",source:"gmail",label:"Fictional earlier identity",confirmed:true,sourceIds:["gmail:rowan-old"]},
    ],
    durableFacts:[
      fact("rowan-employer","Work","Company","Example Software","pasted:rowan-recent",recent),
      fact("rowan-old-employer","Work","Company","Previous Company","pasted:rowan-older",older),
      fact("rowan-title","Work","Role","Product Engineering Director","pasted:rowan-recent",recent),
      fact("rowan-city","Location","City","Fort Collins, Colorado","pasted:rowan-recent",recent),
      fact("rowan-personal-email","Personal","Email","rowan@personal.example","manual:rowan-note",note),
      fact("rowan-birthday","Personal","Birthday","September 18","manual:rowan-note",note),
      fact("rowan-woodwork","Interest","Woodworking","Enjoys building furniture in the garage.","pasted:rowan-recent",recent),
      fact("rowan-music","Interest","Music","Enjoys live jazz and going to small concerts.","pasted:rowan-recent",recent),
      fact("rowan-family","Family","Children","Two children in college; family visits are a priority.","pasted:rowan-recent",recent),
      fact("rowan-shared","Personal","Shared history","Played on a recreational soccer team together when we worked at the same company.","manual:rowan-shared",shared),
      fact("rowan-fishing","Interest","Former interest","Used to go fly fishing regularly; said in the recent catch-up that they no longer fish.","pasted:rowan-recent",recent),
      fact("rowan-work","Work","Current project","Leading a new product platform initiative.","pasted:rowan-recent",recent),
    ],
    activeThreads:[{id:"rowan-plan",topic:"A future career chapter",state:"Considering a move and a new career direction in a few years, after the children graduate.",whyItMatters:"Long-term possibilities",nextChangeSignal:"Several years from now",sourceIds:["pasted:rowan-recent"],lastObservedAt:recent}],
    stewardshipOpportunities:[],sources,
  };
  store.relationships.push(p);
  const temp = file + ".portrait-preview.tmp";
  if (existsSync(temp)) throw new Error("Unexpected temporary fixture file; not modifying it.");
  writeFileSync(temp, JSON.stringify(store,null,2), {flag:"wx",mode:0o600});
  renameSync(temp,file);
}
// Add five explicitly fictional recorded conversations to demonstrate the
// activity chart. Never overwrite existing preview records or preferences.
const updated = JSON.parse(readFileSync(file,"utf8"));
const rowan = updated.relationships.find(p => p.id === id);
const anchor = rowan.sources.find(source => source.id === "pasted:rowan-recent");
if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor.observedAt)) throw new Error("Unexpected preview history; refusing to modify it.");
const base = Date.parse(anchor.observedAt + "T00:00:00Z");
const episodes = [
  [32,"Caught up about the product platform"],
  [35,"Talked about a family visit"],
  [100,"Discussed a woodworking project"],
  [164,"Caught up over coffee"],
  [290,"Talked about a recent concert"]
];
let added = false;
for (const [i,[offset,label]] of episodes.entries()) {
  const sourceId = "pasted:rowan-fictional-activity-" + (i+1);
  if (!rowan.sources.some(source => source.id === sourceId)) {
    rowan.sources.push({id:sourceId,source:"manual",observedAt:new Date(base-offset*86400000).toISOString().slice(0,10),label:"Fictional conversation: "+label});
    added = true;
  }
}
if (added) {
  const temp = file + ".activity-preview.tmp";
  if (existsSync(temp)) throw new Error("Unexpected temporary fixture file; not modifying it.");
  writeFileSync(temp,JSON.stringify(updated,null,2),{flag:"wx",mode:0o600});
  renameSync(temp,file);
}
PORTRAIT_FIXTURE
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
PREVIEW_READY=1
echo "Fictional preview ready: http://localhost:3002"
echo "Open Rowan Taylor (fictional) for the unified conversation entry, quieter portrait and connection activity."
echo "Leave this Terminal open during the preview. Press Control+C here when finished."
open "http://localhost:3002/relationships/00000000-0000-4000-8000-000000000084"
wait "$FORWARD"
