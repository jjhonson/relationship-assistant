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

### Local broader metadata coverage experiment

The existing `/discover` route remains the separate, bounded 200-message comparison sample. In local development only, a second panel is off by default and starts only after the user checks an explicit confirmation and clicks **Start broader scan**. It queries both Sent and non-Sent mail in monthly windows across up to 10 years, distributing the detail budget across the 240 month/direction slots rather than taking a larger newest-only sample. At the default 1,000-detail cap, this is typically 4–5 details per month per direction. It is more historically balanced than the sparse 200-message sample, but remains a very small, search-filtered sample and does not inventory the mailbox.

The server uses Gmail `messages.list` to obtain IDs/thread IDs (normally 240 requests, one for each month/direction slot) and then `messages.get?format=metadata` for at most 1,000 unique message details. The latter is the expensive operation; the code requests only From, To, Cc, Date, list/automation headers, labels, internal dates, and thread IDs—never bodies, snippets, subjects, or attachments. At the current Google quota assumptions of 5 units per `messages.list` and 20 per metadata `messages.get`, a full default run is approximately 1,240 Gmail API requests and 21,200 quota units (`240 × 5 + 1,000 × 20`). The official method, pagination, and quota references are [messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), and [Gmail API quotas](https://developers.google.com/workspace/gmail/api/reference/quota); verify current quotas before a pilot. Pagination is followed, but bounded to two list pages per slot. Each API request has at most three attempts; a conservative full-run ceiling is 4,440 API attempts / 67,200 quota units (1,440 list attempts × 5 plus 3,000 metadata attempts × 20). No extra mailbox-wide listing is performed.

One synchronous Next.js request for all 1,000 details would risk long waits and hide progress. Instead the local page makes 24 sequential, user-initiated requests, each processing at most five months, with at most five concurrent Gmail calls within a batch. It reports progress as each batch returns, permits stopping, retries transient/rate-limit failures with bounded backoff, deduplicates IDs, and marks failed or interrupted runs incomplete. A failed batch is not silently counted as coverage. Expected elapsed time depends on mailbox/API latency and quota throttling and may be several minutes; no background job is launched. The hard detail ceiling is `GMAIL_EXPERIMENT_DETAIL_CAP` (default 1,000; values above 1,000 are clamped, lower values can be used to reduce the experiment). A future 3,000-detail experiment is not enabled by this implementation.

The comparison reports fetched records, dates/years, distinct addresses observed in headers, sent/received direction, surviving direct-contact candidates, API request counts, and incomplete-coverage warnings. Any displayed shortlist is only a heuristic on the scanned metadata, not a relationship-strength ranking. The positive-control field compares the same locally entered address against both the existing sample and the broader records in page memory; only aggregate reports are rendered. Owner aliases may be entered for that page only, and should be explicitly verified by the user. Similar names are never used to merge identities. Addresses and headers are present in the authenticated user's local page only for this discovery UI and are not logged, sent to analytics/AI, or persisted; no experiment result is stored beyond the page lifetime.

`gmail.readonly` is a Google restricted Gmail scope, even when the app requests metadata-only responses. Read-only access is not equivalent to low-sensitivity access: headers can reveal correspondents, group membership, and interaction timing. This local development experiment does not establish production compliance or Google verification/security-assessment eligibility; any broader distribution needs a separate review of Google's [restricted-scope verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) and [API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy). The experiment adds no OAuth scope, database, scheduler, full-mailbox sync, or cloud deployment.

Synthetic tests use fictional mailboxes to exercise bursty-versus-long-running activity, human two-way mail versus newsletters/automation, group-heavy traffic, explicit owner aliases and unresolved multi-address identity, a sparse positive control, list pagination/duplicate IDs, retries, interrupted batches, and detail/request ceilings. These tests demonstrate what additional metadata can change in observed candidate counts and ordering; they cannot validate identity, total distinct exchanges, reciprocity, relationship longevity, depth, quality, or meaning. A Gmail search match count is not treated as a count of one-to-one exchanges.

### Google Cloud setup (manual)

1. In [Google Cloud Console](https://console.cloud.google.com/) create/select a project and enable the **Gmail API**.
2. Configure the **OAuth consent screen** (External, Testing mode) and add the `gmail.readonly` scope. Add your designated test user(s) under **Test users**.
3. Create **Credentials → OAuth client ID → Web application** with this exact **Authorized redirect URI** (local development):

   ```
   http://localhost:3000/api/gmail/callback
   ```

4. Copy `.env.example` to `.env.local` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (must equal the URI above) and `SESSION_SECRET` (32+ random chars, e.g. `openssl rand -base64 32`). Optionally set `GMAIL_SAMPLE_SIZE` (1–50), `GMAIL_DISCOVERY_SAMPLE_SIZE` (1–200), or lower `GMAIL_EXPERIMENT_DETAIL_CAP` (1–1,000) to reduce the local experiment budget. `.env*` files are git-ignored.
5. `npm run dev`, open <http://localhost:3000/gmail>, and click **Connect Gmail**.

### Credential handling and disconnect

Tokens are kept server-side only in an AES-256-GCM encrypted, `httpOnly` cookie (keyed from `SESSION_SECRET`); they are never rendered to the browser or logged. **Disconnect** deletes that cookie. It does not revoke access at Google: to fully revoke, visit <https://myaccount.google.com/permissions> and remove "Relationship Assistant" (or your OAuth app name).

Cancelled consent, expired/revoked sessions, invalid state, and Gmail API errors show friendly messages without details.
