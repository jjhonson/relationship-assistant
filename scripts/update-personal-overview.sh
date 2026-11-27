#!/usr/bin/env bash
# One-time Mac update for the reviewed private personal alpha.
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cs=unhallowed-spell-q744p45v99734pgg
launcher="$HOME/projects/relationship-agent-launcher-test"
fail() { echo "Update stopped: $*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail "Run on the Mac."
command -v gh >/dev/null || fail "GitHub CLI unavailable."
command -v lsof >/dev/null || fail "Cannot verify local ports."
if lsof -nP -iTCP:3002 -sTCP:LISTEN -Fp >/dev/null 2>&1; then
  fail "Close the fictional preview with Control+C in its Terminal first."
fi
[ -d "$launcher" ] && [ ! -L "$launcher" ] || fail "Existing launcher checkout not found."
case "$(git -C "$launcher" rev-parse HEAD)" in
  8d4a15b8a8dbb8593dce0149f92866d4968391f8|affd46ef5a3376fafb0552b6379346859bc2ec13) ;;
  *) fail "Launcher version is not one of the reviewed versions." ;;
esac
git -C "$launcher" diff --no-ext-diff --quiet HEAD -- scripts || fail "Launcher scripts have local changes."
git -C "$launcher" diff --no-ext-diff --cached --quiet HEAD -- scripts || fail "Launcher scripts have staged changes."
[ -z "$(git -C "$launcher" ls-files --others --exclude-standard -- scripts)" ] || fail "Unexpected launcher files."
export RA_REPO=jjhonson/relationship-assistant RA_REMOTE_DIR=/workspaces/relationship-assistant RA_PORT=3000 RA_PERSONAL_LOCAL_PORT=3001 RA_DRY_RUN=0
echo "[Update] Stopping only the managed personal runtime using the existing launcher."
bash "$launcher/scripts/Stop Relationship Agent.command" --name "$cs" </dev/null || fail "Personal Stop reported a problem. No checkout changes made."
echo "[Update] Waking the existing Codespace to synchronize the reviewed code."
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if gh codespace ssh -c "$cs" -- true </dev/null >/dev/null 2>&1; then ready=1; break; fi
  echo "[Update] Waiting for SSH readiness ($attempt/12)"
  sleep 5
done
[ "$ready" = 1 ] || fail "Could not wake the existing Codespace. No checkout changes made."
gh codespace ssh -c "$cs" -- bash -s <<'REMOTE_UPDATE'
set -eu
fail() { echo "Update stopped: $*" >&2; exit 1; }
repo=/workspaces/relationship-assistant
release=b890d3ca2abbc93fa1a21a7828484112eda7700e
reviewed_tree=ed8ba7441fd862d0ee8817b2d28636a29d9d2129
[ "${CODESPACES:-}" = true ] || fail "Not running in the existing Codespace."
cd "$repo"
[ "$(git rev-parse --show-toplevel)" = "$repo" ] || fail "Unexpected repository."
prior="$(git rev-parse HEAD)"
case "$prior" in
  1815ed98d263b45d276fa844789e3e7da8bd0be7|28910ab281c076576433ad32e30e23d572cf3efd|"$release") ;;
  *) fail "Unexpected checked-out commit; no checkout changes made." ;;
esac
git diff --no-ext-diff --quiet --cached HEAD -- || fail "Staged changes present."
git diff --no-ext-diff --quiet HEAD -- . ':(exclude)next-env.d.ts' || fail "Uncommitted code changes present."
[ -z "$(git ls-files --others --exclude-standard)" ] || fail "Untracked files present; no checkout changes made."
if ! git diff --no-ext-diff --quiet HEAD -- next-env.d.ts; then
  git show HEAD:next-env.d.ts | cmp -s - <(sed 's#\.next/dev/types/#.next/types/#g' next-env.d.ts) ||
    fail "Unexpected generated-file edits; left unchanged."
fi
[ -z "$(ss -H -ltn 'sport = :3000')" ] || fail "Port 3000 is still occupied; no checkout changes made."
[ -z "$(ss -H -ltn 'sport = :3002')" ] || fail "Preview is still running; no checkout changes made."
[ -f .env.local ] && [ ! -L .env.local ] && [ -d .data ] && [ ! -L .data ] &&
  [ -f .data/personal.env ] && [ ! -L .data/personal.env ] &&
  [ -O .data/personal.env ] && [ "$(stat -c %a .data/personal.env)" = 600 ] &&
  git check-ignore -q .env.local && git check-ignore -q .data/personal.env ||
  fail "Protected personal configuration could not be verified."
GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin refs/heads/main </dev/null ||
  fail "Could not fetch merged main."
[ "$(git rev-parse FETCH_HEAD)" = "$release" ] &&
  [ "$(git rev-parse 'FETCH_HEAD^{tree}')" = "$reviewed_tree" ] ||
  fail "Main no longer matches the approved release; nothing switched."
if git ls-tree -r --name-only "$release" | grep -Eq '^(\.env\.local$|\.data/)'; then
  fail "The release unexpectedly tracks a private path."
fi
if [ "$prior" != "$release" ]; then
  git switch --detach "$release" || fail "Git refused the switch; local work retained."
fi
[ "$(git rev-parse HEAD)" = "$release" ] && [ "$(git rev-parse 'HEAD^{tree}')" = "$reviewed_tree" ] ||
  fail "Reviewed release checkout could not be verified."
[ -f .env.local ] && [ -f .data/personal.env ] || fail "Private configuration could not be verified after update."
echo "[Update] Approved release checked out. Saved configuration, data, and local branches were not changed."
REMOTE_UPDATE
echo "[Update] Starting through the existing private personal launcher."
bash "$launcher/scripts/Start Relationship Agent.command" --name "$cs" </dev/null || fail "Start reported a problem. The merged checkout remains in place; do not delete data or configuration."
echo "Personal alpha update complete. Your usual Desktop Start and Stop shortcuts remain valid."
