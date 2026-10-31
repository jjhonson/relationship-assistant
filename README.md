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
- `src/app/pilot/page.tsx` – fictional-only, consent-gated contextual relationship pilot
- `src/lib/contacts.ts` – fictional sample data and lookups (swap this module to change the data source later)
- `src/lib/format.ts` – date/initials helpers
- `src/components/` – small shared UI components
- `src/lib/gmail/discovery.ts` – deterministic, metadata-only candidate ranking and exclusions

## Gmail read-only proof of concept

Server-side OAuth (authorization code + PKCE) requesting only `https://www.googleapis.com/auth/gmail.readonly`. The `/gmail` proof of concept samples up to 50 messages. `/discover` is a separate, on-demand experiment with a bounded two-stage metadata sample (`GMAIL_DISCOVERY_SAMPLE_SIZE`, 1–200 total message fetches). Stage 1 samples Sent mail (`in:sent`, no drafts) in two passes: a breadth pass takes the newest Sent message of each calendar month for up to 10 years (so a sparse, long-running correspondent is not crowded out by busy quarters), then a depth pass spends any remaining budget on calendar quarters with an adaptive quota. This costs up to 120 + 40 cheap list calls but never more than the detail ceiling in message fetches. The account owner's own Gmail profile address is suppressed from candidates. Stage 2 looks up a few incoming messages for the most frequent single-recipient Sent contacts, to look for evidence of replies. It requests headers and labels only, then applies deterministic rules (bulk/list headers, group mail, generic automated addresses) to surface up to 10 possible direct contacts; lone inbound messages are not recommended, and one-way sent contacts stay labeled "Possible". Sampling remains biased and incomplete, so a missing contact may reflect sampling limits, another account, or filtering; the page shows count-only diagnostics (sent/received examined, exclusions by category, months covered) to help tell these apart. If bounded sampling is too sparse, a larger Sent-seeded first stage followed by bounded per-contact enrichment is the intended next step. The page distinguishes viable candidates from the displayed top ten. In `npm run dev` only (never in production builds), a positive-control panel lets you privately enter the address of a known correspondent and reports whether it was displayed, viable but below the cutoff, sampled but excluded (with the reason), not sampled, or inconclusive, using the same filtering and ranking code as discovery. The address travels in a POST body, is only compared in memory, and is never displayed, logged or stored. An optional bounded lookup (one list call, at most 10 header fetches) checks whether Gmail has matching metadata; an empty or capped result does not prove absence or relationship quality. Known limitation / follow-up: other past aliases of the owner and multiple addresses of one person are not merged; a safe design would let the user confirm aliases explicitly, per session, rather than infer them from names. Results are not persisted, and feedback remains in page memory only. Message contents are not fetched, stored, logged, or sent to any third party.

The discovery page distinguishes observed message metadata from unverified assumptions. Counts, dates, and addresses do not establish identity, occupation, relationship, or meaningfulness; this prototype does not use email bodies or AI.

## Contextual relationship pilot: Stage 1 (fictional only)

Open `/pilot` to select one of five invented contact scenarios and review at most three bundled fictional threads. The UI previews the count and date range, then requires a separate unchecked-by-default confirmation before revealing the thread text and brief. Corrections to the relationship classification and assistance recommendation are held in page memory. This is a deterministic demonstration, not an assessment of a real person.

### Architecture and data boundaries

- The pilot route uses local fixtures and deterministic code only. It makes no Gmail/API request, does not call `/discover`, and has no database, browser storage, analytics, server log of messages, AI provider, or outreach action. No fictional content leaves the local development app. It can be reviewed without Google or provider credentials.
- The fixture fields are date, fictional sender/recipient labels, subject, and body text. The bounded set demonstrates context and uncertainty; it does not represent live message retrieval. The brief keeps classification, significance, maintenance, recommendation, confidence, and unknowns separate, cites local fictional thread IDs, and provides user corrections.
- The existing Gmail POC requests the restricted `gmail.readonly` OAuth scope and stores encrypted credentials in an `httpOnly` cookie for up to 30 days; disconnect deletes the local cookie but does not revoke Google's grant. The pilot neither changes that scope nor reads bodies. For a live pilot, stop before any content request and obtain a separate, explicit user decision. Review Google's then-current restricted-scope verification and security-assessment obligations before enabling real data, especially for any server-side storage or transfer. No production deployment is proposed.
- For a future approved live test, the proposed minimum is only the selected person's user-reviewed, bounded set (no more than three threads), with message date, sender/recipient, subject, and necessary plain-text body text. Exclude attachments and unrelated headers; cap size, redact irrelevant quoted/forwarded text, and show exactly which thread IDs/date range and fields are included before reading. Keep fetched content ephemeral and never put it in logs, fixtures, GitHub, analytics, or persistent storage. Errors should be generic and must not echo tokens or message content. This proposal is not implemented or authorized by this prototype.

### Threat, consent, provider, and retention review

- **Consent gate:** Stage 1 only reviews fiction. A later live flow must separately disclose the selected contact, exact thread count/date range/fields, purpose, destinations, retention, and estimated cost; require affirmative consent immediately before retrieval, then separately before any provider transfer. Consent must be revocable by abandoning the flow, and contacts must never be scanned automatically.
- **Minimization and local access:** No real message text or contact identity is used here. If live access is approved, fetch only necessary threads for the chosen contact, omit attachments, minimize quoted text, and present evidence locally for review. The address, message contents, and any corrections must remain transient and out of logs and persistent storage.
- **Provider choice and data flow:** There is no provider integration or provider choice in Stage 1, so no message data leaves the local development environment. A ChatGPT subscription or linked Gmail experience is not an application API credential or authorization to transfer Gmail data. Any later provider requires the user's separate choice, separate API credentials/configuration, explicit transfer consent, and current pricing review; costs can depend on input size and retries. Do not silently enable a provider or assume credentials exist.
- **Tokens and browser session:** The current Gmail POC's encrypted `httpOnly` credential cookie can remain for up to 30 days and contains credentials including a refresh token; cookie deletion on disconnect is not Google-side revocation. The fictional pilot creates no session or persistent data. For a live experiment, ask whether the user wants Gmail connected, set a short pilot-specific retention window, clear transient content at completion/abort, and explain how to disconnect and revoke at Google.
- **Failure handling and policy gate:** Stage 1 has no network/data retrieval failure path. A live implementation must fail closed on consent, auth, size, or provider errors, never log or display raw provider errors containing content or credentials, and offer a retry only after reviewing scope again. Before any real-body test, confirm OAuth verification/security-assessment requirements for the planned access and processing, provider terms, user eligibility/testing configuration, and whether separate Google/provider credentials are needed.
- **User choices required before Stage 2:** Explicit approval for selected-contact body retrieval; an accepted thread/size cap and retention period; whether content may go to an AI provider; which provider (if any), API credentials, and budget; and review of Google/provider policy requirements. No such approval is implied by using `/pilot`.

### Qualitative evaluation

For each fictional archetype, review whether classification is grounded, uncertainty and missing-channel caveats are clear, suggested action is reasonable (including no action needed), and the consent/data boundary is understandable. Note false positives and privacy/cost burden. Do not judge success by message count or shortlist rank; do not infer objective relationship strength or generate outgoing messages.

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
