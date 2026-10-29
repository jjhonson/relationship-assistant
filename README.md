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
