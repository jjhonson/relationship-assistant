# Relationship Assistant

Helps people rediscover, understand, and thoughtfully maintain important personal and professional relationships.

This is an **initial prototype**. The dashboard uses fictional, hard-coded sample data only. A separate **Gmail read-only proof of concept** lives at `/gmail` (see below); no database, payments, or AI providers are used.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, Vitest.

## Getting started

Requires Node.js ^22.12.0, ^24.0.0, or >=26.0.0.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Run unit tests (Vitest) |

## Codespaces dev start/stop (run on the Mac host)

Optional convenience scripts (bash + [GitHub CLI](https://cli.github.com/)). **Mac-local:** `scripts/dev-start.sh`, `scripts/dev-stop.sh`, `scripts/dev-common.sh`. **Codespace-only:** `scripts/remote-dev.sh`, which the Mac scripts pipe to `bash -s` over `gh codespace ssh` (never run it on the Mac). The reviewed script is sent from the local checkout; no script is fetched from a URL, and `.env.local` is not read or copied.

### One-time Mac setup

The scripts live in this repository, so the Mac needs a checkout. If your only checkout is the browser Codespace:

1. Wait until the PR containing the scripts is reviewed and merged. Until then they exist only on the PR branch, not on `main`.
2. In Mac Terminal, run `gh auth login` if needed, then `gh repo clone jjhonson/relationship-assistant ~/projects/relationship-assistant`. GitHub CLI authentication stays on the Mac; do not copy credentials or `.env.local` into the repository. The scripts become available on `main` only after review and merge. To use a reviewed PR branch before merge, fetch and check out that branch yourself only after reviewing its diff.
3. Requires a Codespace for this repository with an SSH server (see `gh codespace ssh --help`) and a `.env.local` already present in it. The scripts never read, copy or print `.env.local`.

### Daily use

```bash
cd ~/projects/relationship-assistant
scripts/dev-start.sh [--name CODESPACE] [--dry-run]   # then open http://localhost:3000
scripts/dev-stop.sh  [--name CODESPACE] [--force] [--dry-run]
```

- The Codespace is auto-selected if the repository (`RA_REPO`, default `jjhonson/relationship-assistant`) has exactly one; otherwise pass `--name` or `RA_CODESPACE`. Other overrides: `RA_PORT`, `RA_REMOTE_DIR` (default `/workspaces/relationship-assistant`), `RA_STATE_DIR`.
- Start is idempotent: it reuses a running Codespace, dev server and port forward. For a stopped Codespace it uses `gh codespace ssh -c NAME -- true` to wake/connect, retrying up to 12 times; it does not call an unsupported `gh codespace start` subcommand. It fails clearly if `localhost:3000` is held by something else and finishes by checking `http://localhost:3000`, so the default Gmail callback stays `http://localhost:3000/api/gmail/callback`.
- `RA_PORT` defaults to 3000 and is passed as `PORT` to Next.js. Changing it does not rewrite Gmail OAuth settings; Gmail callback configuration remains manual and may not work on a non-default port.
- If start fails or is interrupted, it cleans up what *that run* launched (forward, server, and a Codespace it started). Anything already running beforehand is left alone.
- It never switches, pulls or merges branches (it prints the current branch/status), and never touches Gmail. Connect/disconnect Gmail manually.

### Process ownership

- Local forward: the PID, process start time, selected Codespace and port are recorded in `~/.local/state/relationship-assistant/forward-<codespace>.meta`. It is reused or signalled only if the PID start time and exact Codespace/port command match.
- Remote dev server: launched via `setsid` as its own session/group; `/tmp/relationship-assistant-dev.pid` records the PID, kernel start time, workspace, port, unique inherited launch token and start-run ID. Before signalling, the script verifies the launch group/session, workdir, configured port and token on every live group member; it also checks the npm command title when the leader remains alive.
- Mismatches fail closed: nothing is signalled and the record is retained for safe inspection. Stop waits for the entire verified group to exit; `--force` escalates to SIGKILL only after re-verifying the remaining group. Failed-start cleanup only stops a remote server whose run ID matches that start invocation, and only stops Codespace compute when that invocation woke a previously shut-down Codespace.

### `next-env.d.ts`

Next.js may rewrite this tracked file. Shutdown **never restores or edits it automatically**. If it changed, the script reports that staged and unstaged content was left untouched. Review `git diff HEAD -- next-env.d.ts` in the Codespace, then manually discard only changes you have confirmed are generated; automatic cleanup is deferred to avoid losing user edits.

### Manual recovery

- Mac forward: `kill "$(sed -n 's/^pid=//p' ~/.local/state/relationship-assistant/forward-NAME.meta)"`
- Codespace server: `gh codespace ssh -c NAME -- 'kill -TERM -- -"$(sed -n s/^pid=//p /tmp/relationship-assistant-dev.pid)"'`
- Compute: `gh codespace stop -c NAME`, then confirm with `gh codespace list`. Server log: `/tmp/relationship-assistant-dev.log` in the Codespace.

### Smoke-test checklist (after review; no Gmail needed)

1. `scripts/dev-start.sh --dry-run`: shows the selected Codespace and planned SSH wake/start/forward commands. Confirm the configured state directory and any existing metadata are unchanged.
2. After reviewing this branch, start with a non-Gmail Codespace; verify `curl -I http://localhost:3000` succeeds. Run start again and confirm the server/forward are reused rather than duplicated.
3. Stop gracefully; verify `gh codespace list` shows the selected Codespace shut down and the local forward is gone. Repeat with a deliberately staged `next-env.d.ts` edit and confirm both its staged and working-tree contents remain unchanged.
4. With `localhost:3000` occupied by an unrelated process, start should fail without signalling it. For a startup failure after wake, verify only that invocation's server/forward are cleaned up and only its newly awakened Codespace is stopped.
5. To recover manually, inspect `scripts/dev-start.sh` / `scripts/dev-stop.sh` and `gh codespace list`; use `scripts/dev-stop.sh --name NAME --force` only after confirming the selected name. Do not use Gmail for this smoke test.

Unit tests (`src/scripts/dev-workflow.test.ts`) use a rejecting fake `gh`, fake `npm`, and isolated local processes. They exercise `gh codespace ssh -c NAME -- bash -s -- ...` argument/stdin handling and process-group lifecycle, but do not contact GitHub or prove behavior on a real Mac/Codespace. The first real-host smoke test remains unperformed and should happen only after review.

## Structure

- `src/app/page.tsx` – "Your Relationships" dashboard
- `src/app/contacts/[id]/page.tsx` – relationship detail page (history, context, recent developments, suggested actions, plan)
- `src/lib/contacts.ts` – fictional sample data and lookups (swap this module to change the data source later)
- `src/lib/format.ts` – date/initials helpers
- `src/components/` – small shared UI components
- `src/lib/gmail/discovery.ts` – deterministic, metadata-only candidate ranking and exclusions

## Gmail read-only proof of concept

Server-side OAuth (authorization code + PKCE) requesting only `https://www.googleapis.com/auth/gmail.readonly`. The `/gmail` proof of concept samples up to 50 messages. `/discover` is a separate, on-demand experiment with a bounded two-stage metadata sample (`GMAIL_DISCOVERY_SAMPLE_SIZE`, 1–200 total message fetches). Stage 1 samples Sent mail (`in:sent`, no drafts) in two passes: a breadth pass takes the newest Sent message of each calendar month for up to 10 years (so a sparse, long-running correspondent is not crowded out by busy quarters), then a depth pass spends any remaining budget on calendar quarters with an adaptive quota. This costs up to 120 + 40 cheap list calls but never more than the detail ceiling in message fetches. The account owner's own Gmail profile address is suppressed from candidates. Stage 2 looks up a few incoming messages for the most frequent single-recipient Sent contacts, to look for evidence of replies. It requests headers and labels only, then applies deterministic rules (bulk/list headers, group mail, generic automated addresses) to surface up to 10 possible direct contacts; lone inbound messages are not recommended, and one-way sent contacts stay labeled "Possible". Sampling remains biased and incomplete, so a missing contact may reflect sampling limits, another account, or filtering; the page shows count-only diagnostics (sent/received examined, exclusions by category, months covered) to help tell these apart. If bounded sampling is too sparse, a larger Sent-seeded first stage followed by bounded per-contact enrichment is the intended next step. The page distinguishes viable candidates from the displayed top ten. In `npm run dev` only (never in production builds), a positive-control panel lets you privately enter the address of a known correspondent and reports whether it was displayed, viable but below the cutoff, sampled but excluded (with the reason), not sampled, or inconclusive, using the same filtering and ranking code as discovery. The address travels in a POST body, is only compared in memory, and is never displayed, logged or stored. An optional bounded lookup (one list call, at most 10 header fetches) checks whether Gmail has matching metadata; an empty or capped result does not prove absence or relationship quality. Known limitation / follow-up: other past aliases of the owner and multiple addresses of one person are not merged; a safe design would let the user confirm aliases explicitly, per session, rather than infer them from names. Results are not persisted, and feedback remains in page memory only. Message contents are not fetched, stored, logged, or sent to any third party.

The discovery page distinguishes observed message metadata from unverified assumptions. Counts, dates, and addresses do not establish identity, occupation, relationship, or meaningfulness; this prototype does not use email bodies or AI.

### Google Cloud setup (manual)

1. In [Google Cloud Console](https://console.cloud.google.com/) create/select a project and enable the **Gmail API**.
2. Configure the **OAuth consent screen** (External, Testing mode) and add the `gmail.readonly` scope. Add your designated test user(s) under **Test users**.
3. Create **Credentials → OAuth client ID → Web application** with this exact **Authorized redirect URI** (local development):

   ```
   http://localhost:3000/api/gmail/callback
   ```

4. Copy `.env.example` to `.env.local` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (must equal the URI above) and `SESSION_SECRET` (32+ random chars, e.g. `openssl rand -base64 32`). Optionally set `GMAIL_SAMPLE_SIZE` (1–50) or `GMAIL_DISCOVERY_SAMPLE_SIZE` (1–200) to reduce each sample. `.env*` files are git-ignored.
5. `npm run dev`, open <http://localhost:3000/gmail>, and click **Connect Gmail**.

### Credential handling and disconnect

Tokens are kept server-side only in an AES-256-GCM encrypted, `httpOnly` cookie (keyed from `SESSION_SECRET`); they are never rendered to the browser or logged. **Disconnect** deletes that cookie. It does not revoke access at Google: to fully revoke, visit <https://myaccount.google.com/permissions> and remove "Relationship Assistant" (or your OAuth app name).

Cancelled consent, expired/revoked sessions, invalid state, and Gmail API errors show friendly messages without details.
