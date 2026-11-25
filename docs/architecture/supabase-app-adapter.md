# Server-side Supabase adapter (draft, fictional development only)

Parent: [database foundation PR #72](https://github.com/jjhonson/relationship-assistant/pull/72), Issue #54. This change is **not a completed data migration, independent backup, or real-contact cutover**.

## What changes

The existing four JSON-v1 collections (relationships, captures, moments, connection journeys) and their source references stay unchanged for callers of `src/lib/relationship-store.ts`.

`RA_STORAGE_BACKEND=json` (the default) continues to read and write `.data/relationships.json` in the Codespace. No code or environment change silently switches backends. `RA_STORAGE_BACKEND=supabase` selects a server-only adapter that calls the two versioned RPC operations `ra_store_read` and `ra_store_write`. The backend never silently falls back to local JSON if remote storage fails.

The second migration `20261125154752_relationship_agent_atomic_server_gateway` adds an integer revision for each dataset and narrowly granted service-only RPC calls, while keeping actual records in the unexposed `ra_private` schema. Data updates are one PostgreSQL transaction. Concurrent writers are detected by a revision mismatch; the Node adapter retries the entire domain mutation against freshly read state. A corruption, orphaned connection journey, or invalid UUID aborts the transaction without partial changes.

**Why the JSONB bridge:** A first-stage compatibility layer avoids rewriting extraction, source provenance, corrected memories, and multi-event domain logic while switching persistence. Normalized observation/interest tables are a later design decision, not a prerequisite for recoverable data.

## Opt-in synthetic test configuration

Use a *separate fictitious test namespace* on the development Supabase project. Configure only in a private server environment such as Codespace `.env.local`:

- `RA_STORAGE_BACKEND=supabase`
- `RA_SUPABASE_URL=https://<your-project>.supabase.co`
- `RA_SUPABASE_SECRET_KEY=<server-side sb_secret_ key>`
- `RA_DB_OWNER_ID=<random UUID reserved for fictional testing>`

Never show credentials in a screenshot or share them in chat. Do not use `NEXT_PUBLIC_` for any of these. The secret key has broad database privileges despite the limited public RPC surface. It is acceptable **only in the protected server-side fictional alpha environment**, not in a browser or a publicly deployed unauthenticated app.

The project has **no Supabase Auth-based end-user isolation yet**. Real-person data cannot be imported or used until ownership, server access, off-site backup, and recovery are independently reviewed and verified. Never copy a private `.data` file to Supabase as part of merely enabling the backend.

## Tests and acceptance

- `supabase/tests/fictional_json_v1_roundtrip.sql`: original migration round trip.
- `supabase/tests/fictional_atomic_server_gateway.sql`: service-role read/write, conflict rejection, malformed record rollback, browser-role denial. Runs inside `BEGIN ... ROLLBACK`, leaving no data behind.
- `src/lib/supabase-document-store.test.ts`: outbound RPC contract, missing configuration, revision retry, and fail-closed behavior.
- `src/lib/supabase-relationship-store.test.ts`: fictional actual application domain calls against a mocked Supabase gateway.
- GitHub Actions: lint, Vitest, production build, TypeScript. Passing CI does **not** establish a live network integration.

**Live acceptance is still required:** user may enable the backend in the private Codespace with a brand-new synthetic owner ID, create/reopen fictional people, save moments, record a two-event interaction, correct memory, reload, then verify data survives restarts. Test backend outage with no local JSON overwrite. This requires a one-time safe, private environment setup and is not yet authorized for real data.

**Before declaring #54 complete:** build an encrypted export outside the Codespace and Supabase, restore it in a genuinely separate fresh environment, compare IDs and sources, verify integrity and rollback, then obtain explicit approval for any real-data migration. Supabase Free does not provide independent database backups for this use case. Preserve original private JSON and any parked backups until the owner approves final cutover.

## Current constraints

This is a low-volume personal alpha adapter. Full-document replacement is atomic, but not optimized for many users or large datasets. The server-side Supabase secret key bypasses RLS and must be restricted to the server. Multiuser authentication, commercial SaaS, passive integrations, and live deployment remain out of scope.
