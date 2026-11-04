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
- If start fails or is interrupted, it attempts to clean up only what *that run* launched, including a just-created forward whose metadata could not be published. Termination is verified before matching metadata is removed; if the process cannot be safely verified or stopped, any existing record is preserved and a warning is printed. A Codespace already running beforehand is left alone.
- If remote ownership verification fails, start saves a small private, allowlisted predicate report in `RA_STATE_DIR` (outside the repository) before cleanup. It contains numeric process IDs/state and match statuses only—not commands, environments, logs, or application data. If validation or writing fails, the controller says so and continues safe cleanup.
- It never switches, pulls or merges branches (it prints the current branch/status), and never touches Gmail. Connect/disconnect Gmail manually.

### Process ownership

- Local forward: the PID, process start time, selected Codespace, port and launch ID are recorded in `~/.local/state/relationship-assistant/forward-<codespace>.meta`. The launch ID is also inherited by the process. It is reused or signalled only if the record, process start time, owner environment and exact command details match. Stop waits for exit before removing the record; `--force` escalates only after re-verifying identity. Failed-start cleanup verifies its in-memory launch identity even if record creation failed. An unchanged, correctly scoped record is removed without signalling only after its original process is definitively gone; live mismatches and malformed or out-of-scope records are retained for inspection.
- Local start/stop share an atomic lock at `~/.local/state/relationship-assistant/lifecycle.lock`. Remote start/stop also share a lock beside the PID record, protecting calls from different Mac terminals. Concurrent commands fail clearly rather than queue or replace ownership metadata. If a machine or shell is killed while holding a lock, inspect that no matching operation remains before manually removing the stale lock.
- Remote dev server: launched via `setsid` as its own session/group; `/tmp/relationship-assistant-dev.pid` records the PID, kernel start time, physical workspace path, port, unique inherited launch token and start-run ID. Launch handoff files are invocation-specific. Before signalling or reusing the server, the script verifies the handoff PID's start time, group/session, workdir, configured port and owner marker, plus every live group member. It does not depend on the process title, which npm/Next may change during startup. Before publishing ownership, the temporary record is checked for complete expected content; interruption or write/publication failure triggers bounded cleanup of only the verified in-flight launch.
- Mismatches fail closed: nothing is signalled and the record is retained for safe inspection. Stop waits for the entire verified group to exit; `--force` escalates to SIGKILL only after re-verifying the remaining group. Failed-start cleanup only stops a remote server whose run ID matches that start invocation, and only stops Codespace compute when that invocation woke a previously shut-down Codespace.

### `next-env.d.ts`

Next.js may rewrite this tracked file. Shutdown **never restores or edits it automatically**. If it changed, the script reports that staged and unstaged content was left untouched. Review `git diff HEAD -- next-env.d.ts` in the Codespace, then manually discard only changes you have confirmed are generated; automatic cleanup is deferred to avoid losing user edits.

### Manual recovery

- Mac forward: inspect `~/.local/state/relationship-assistant/forward-NAME.meta`, then use `scripts/dev-stop.sh --name NAME --force` to re-verify ownership before escalation.
- Codespace server: use `scripts/dev-stop.sh --name NAME --force`; do not signal a PID copied from a possibly stale record without verifying its identity.
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
- `src/app/pilot/page.tsx` – fictional-only, consent-gated contextual relationship pilot
- `src/lib/contacts.ts` – fictional sample data and lookups (swap this module to change the data source later)
- `src/lib/format.ts` – date/initials helpers
- `src/components/` – small shared UI components
- `src/lib/gmail/discovery.ts` – deterministic, metadata-only candidate ranking and exclusions

## Stage 2 fictional relationship-inference benchmark

Issue #18 moves beyond the prewritten Stage 1 briefs without using real Gmail content. The benchmark lives in `src/lib/inference-benchmark.ts` and contains six wholly fictional cases with independent ground truth: an active personal relationship, completed one-time service transaction, recruiter with an ambiguous outcome, new coworker, dormant meaningful professional relationship, and deliberately ambiguous acquaintance.

The Stage 2 contract:
- gives the model only the selected fictional messages plus an explicit as-of date;
- requires structured JSON with classification, relationship disposition, current state, tags, observed history, open loops, reasons to engage, unknowns, confidence, and supporting fictional thread IDs;
- excludes the user's **This feels right / I want to stay better connected** goal from model inference;
- validates citations against the supplied fictional thread IDs;
- evaluates classification/disposition/state, exact normalized tag/open-loop/reason matches, observed dates, and invalid citations while retaining explicit human-review checks for things the model must not infer.

`src/lib/inference-prompt.ts` contains the provider-neutral prompt contract. It does not include benchmark ground truth.

### Stage 2D OpenAI benchmark adapter

The draft Stage 2 branch includes a local-development-only OpenAI adapter in `src/lib/openai-inference.ts` and a POST-only runner at `/api/inference-benchmark`.

- Default model: `gpt-6.1-sol` (override with `OPENAI_RELATIONSHIP_MODEL`).
- Authentication: `OPENAI_API_KEY` loaded server-side from `.env.local`; never expose it in client code or commit it.
- API: OpenAI Responses API with `store: false`.
- Output: strict JSON Schema Structured Outputs, followed by the benchmark's independent local validation and evaluator.
- Scope: one selected fictional case or all six fictional cases. No real Gmail content, contact identity, OAuth change, database, analytics or deployment.
- Failures: provider response bodies are not echoed into application errors; refusals and malformed responses become controlled benchmark failures.

The endpoint is disabled in production. A POST with an empty JSON body runs all six fictional cases. A body such as `{"caseId":"dormant-professional"}` runs one case. Do not add a real API key until the branch has passed tests/lint/typecheck/build.


## Gmail read-only proof of concept

Server-side OAuth (authorization code + PKCE) requesting only `https://www.googleapis.com/auth/gmail.readonly`. The `/gmail` proof of concept samples up to 50 messages. `/discover` is a separate, on-demand experiment with a bounded two-stage metadata sample (`GMAIL_DISCOVERY_SAMPLE_SIZE`, 1–200 total message fetches). Stage 1 samples Sent mail (`in:sent`, no drafts) in two passes: a breadth pass takes the newest Sent message of each calendar month for up to 10 years (so a sparse, long-running correspondent is not crowded out by busy quarters), then a depth pass spends any remaining budget on calendar quarters with an adaptive quota. This costs up to 120 + 40 cheap list calls but never more than the detail ceiling in message fetches. The account owner's own Gmail profile address is suppressed from candidates. Stage 2 looks up a few incoming messages for the most frequent single-recipient Sent contacts, to look for evidence of replies. It requests headers and labels only, then applies deterministic rules (bulk/list headers, group mail, generic automated addresses) to surface up to 10 possible direct contacts; lone inbound messages are not recommended, and one-way sent contacts stay labeled "Possible". Sampling remains biased and incomplete, so a missing contact may reflect sampling limits, another account, or filtering; the page shows count-only diagnostics (sent/received examined, exclusions by category, months covered) to help tell these apart. If bounded sampling is too sparse, a larger Sent-seeded first stage followed by bounded per-contact enrichment is the intended next step. The page distinguishes viable candidates from the displayed top ten. In `npm run dev` only (never in production builds), a positive-control panel lets you privately enter the address of a known correspondent and reports whether it was displayed, viable but below the cutoff, sampled but excluded (with the reason), not sampled, or inconclusive, using the same filtering and ranking code as discovery. The address travels in a POST body, is only compared in memory, and is never displayed, logged or stored. An optional bounded lookup (one list call, at most 10 header fetches) checks whether Gmail has matching metadata; an empty or capped result does not prove absence or relationship quality. Known limitation / follow-up: other past aliases of the owner and multiple addresses of one person are not merged; a safe design would let the user confirm aliases explicitly, per session, rather than infer them from names. Results are not persisted, and feedback remains in page memory only. Message contents are not fetched, stored, logged, or sent to any third party.

The discovery page distinguishes observed message metadata from unverified assumptions. Counts, dates, and addresses do not establish identity, occupation, relationship, or meaningfulness; this prototype does not use email bodies or AI.

## Contextual relationship pilot: Stage 1 (fictional only)

Open `/pilot` to select one of five invented contact scenarios and review at most three bundled fictional threads. The UI previews the count and date range, then requires a separate unchecked-by-default confirmation before displaying the thread text and **prewritten fictional example brief**. This is a Stage 1 wireframe only: relationship labels, evidence references, significance, maintenance, recommendations, and confidence are authored fixture text. The application does not interpret the messages or demonstrate AI relationship understanding. Each example also shows categories, multiple shared-context tags, observed relationship history within the sample, current state, a separate **relationship disposition** (Relationship worth managing / Background only / Unclear), current or unclear open loops (commitment, owner, status, last mention), potential correspondence-derived reasons to engage, a reserved field for developments observed since the last interaction, and unknowns, each citing fictional threads where applicable; insufficient evidence is shown as unknown rather than forced. Clearly past dated plans and vague social suggestions are not treated as current obligations. Only contacts whose effective disposition is **Relationship worth managing** receive the two-state user goal, **This feels right** (record kept in the background, no prompts to increase contact) or **I want to stay better connected** (grounded reasons to reconnect are surfaced). **Background only** contacts remain searchable but receive no relationship-management prompts unless the user overrides the disposition. Current/unclear commitments can still surface independently of nurturing. Corrections to the suggested classification, state, and disposition are shown as the effective interpretation. Corrections and the goal are held in page memory only.

### Architecture and data boundaries

- The pilot route uses local fixtures and deterministic code only. It makes no Gmail/API request, does not call `/discover`, and has no database, browser storage, analytics, server log of messages, AI provider, or outreach action. No fictional content leaves the local development app. It can be reviewed without Google or provider credentials. All fixture text is bundled in client code before the checkbox; the checkbox only controls displaying fiction and is not a security or authorization boundary.
- The fixture fields are date, fictional sender/recipient labels, subject, and body text. The bounded set demonstrates context and uncertainty; it does not represent live message retrieval. The brief keeps classification, significance, maintenance, recommendation, confidence, and unknowns separate, cites local fictional thread IDs, and provides user corrections.
- The existing Gmail POC requests the restricted `gmail.readonly` OAuth scope and stores encrypted credentials in an `httpOnly` cookie for up to 30 days; disconnect deletes the local cookie but does not revoke Google's grant. The pilot neither changes that scope nor reads bodies. For a live pilot, stop before any content request and obtain a separate, explicit user decision. Review Google's then-current restricted-scope verification and security-assessment obligations before enabling real data, especially for any server-side storage or transfer. No production deployment is proposed.
- For a future approved live test, the proposed minimum is only the selected person's user-reviewed, bounded set (no more than three threads), with message date, sender/recipient, subject, and necessary plain-text body text. Exclude attachments and unrelated headers; cap size, redact irrelevant quoted/forwarded text, and show exactly which thread IDs/date range and fields are included before reading. Keep fetched content ephemeral and never put it in logs, fixtures, GitHub, analytics, or persistent storage. Errors should be generic and must not echo tokens or message content. This proposal is not implemented or authorized by this prototype.

### Threat, consent, provider, and retention review

- **Consent gate:** Stage 1 only reviews prewritten fiction. Before any live message metadata/body retrieval, Stage 2 must enforce a server-side, per-contact, pre-retrieval consent gate. A client-side checkbox, hidden UI, or consent value sent by the browser alone is not a security boundary. The server must authenticate the user, validate an explicit and unexpired consent record bound to that user, the selected contact, and the disclosed retrieval scope, and reject the request before making any Gmail request if the check fails. The consent record must be created only after the user reviews the exact thread count/date range/fields, purpose, destinations, retention, and estimated cost; the live retrieval endpoint must independently re-check it. Require separate affirmative consent before any provider transfer. Consent must be revocable by abandoning the flow, and contacts must never be scanned automatically.
- **Minimization and local access:** No real message text or contact identity is used here. If live access is approved, fetch only necessary threads for the chosen contact, omit attachments, minimize quoted text, and present evidence locally for review. The address, message contents, and any corrections must remain transient and out of logs and persistent storage.
- **Provider choice and data flow:** There is no provider integration or provider choice in Stage 1, so no message data leaves the local development environment. A ChatGPT subscription or linked Gmail experience is not an application API credential or authorization to transfer Gmail data. Any later provider requires the user's separate choice, separate API credentials/configuration, explicit transfer consent, and current pricing review; costs can depend on input size and retries. Do not silently enable a provider or assume credentials exist.
- **Tokens and browser session:** The current Gmail POC's encrypted `httpOnly` credential cookie can remain for up to 30 days and contains credentials including a refresh token; cookie deletion on disconnect is not Google-side revocation. The fictional pilot creates no session or persistent data. For a live experiment, ask whether the user wants Gmail connected, set a short pilot-specific retention window, clear transient content at completion/abort, and explain how to disconnect and revoke at Google.
- **Failure handling and policy gate:** Stage 1 has no network/data retrieval failure path. A live implementation must fail closed on consent, auth, size, or provider errors, never log or display raw provider errors containing content or credentials, and offer a retry only after reviewing scope again. Before any real-body test, confirm OAuth verification/security-assessment requirements for the planned access and processing, provider terms, user eligibility/testing configuration, and whether separate Google/provider credentials are needed.
- **User choices required before Stage 2:** Explicit approval for selected-contact body retrieval; an accepted thread/size cap and retention period; whether content may go to an AI provider; which provider (if any), API credentials, and budget; and review of Google/provider policy requirements. No such approval is implied by using `/pilot`.

### Qualitative evaluation

For this Stage 1 UI, review whether the prewritten examples make uncertainty and the consent/data boundary understandable; this does not evaluate model classification accuracy. A later Stage 2 evaluation must feed unfamiliar, wholly fictional exchanges into the real interpretation pipeline (or a separately approved AI provider), compare generated classifications/facts/actions with independently prepared fictional ground truth, and measure false positives, uncertainty, usefulness, and privacy/cost burden. Do not use real message content for evaluation without the separate live-data gates and approvals. Do not judge success by message count or shortlist rank; do not infer objective relationship strength or generate outgoing messages.

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
