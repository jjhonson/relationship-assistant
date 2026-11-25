# Relationship Agent data foundation (personal alpha)

Status: **first-stage database bridge, not a completed application migration**. Related: [Issue #54](https://github.com/jjhonson/relationship-assistant/issues/54).

## Decision

Use managed PostgreSQL on Supabase for the eventual private personal-alpha data store. For the initial transition, keep the existing application-facing JSON-v1 structure intact while moving its four top-level collections into relational tables under a **non-exposed** `ra_private` schema. Keep the existing JSON store as the running application's source of truth until a separate, tested, explicitly accepted cutover.

This is intentional: a large full normalization would require rebuilding source-aware extraction, correction, and connection domain behavior before we have a safe replacement store. The JSONB payloads are a lossless bridge, not the final query model. A normalized relational schema for interests, observations, and evidence links can be introduced after durability is proven and based on actual access patterns.

## Live development database

Supabase project ref: `nvtgwwfzhzuwqpvaycnk` (development only, us-east-1).
Migration history: `20261124235124_relationship_agent_private_json_v1_bridge`.
Do not store credentials, private relationship data, or backup content in GitHub.

The first migration creates:

- `ra_private.datasets`: per-owner source version and unknown root-level properties.
- `ra_private.relationships`: stable UUID and JSONB payload, indexed person label and last-known interaction.
- `ra_private.captures`, `ra_private.moments`: stable UUID, original JSONB payload.
- `ra_private.connection_journeys`: stable UUID plus relationship foreign key and original JSONB payload.

A per-collection `ordinal` preserves array ordering. `owner_id` is an internal synthetic namespace in this first pass, **not yet tied to Supabase Auth**. Records preserve source references, corrections, suggestions dismissed, facts, and nested history without discarding unknown fields. The importer rejects existing owner namespaces, invalid UUIDs, missing IDs, duplicate IDs, and orphaned journey references. `export_store` reconstructs JSON-v1.

Older v1 files may omit optional collections. The export includes their empty arrays, so older omission is normalized but record payloads are preserved. Only formally supported JSON-v1 documents should be imported.

## Security

- No public or browser-facing data tables; `ra_private` is outside the Supabase Data API exposed schemas.
- No schema/table grants to `anon`, `authenticated`, `service_role` or `public`.
- RLS enabled on all five tables with **no allow policies**. This intentionally blocks ordinary roles.
- Import/export are `SECURITY INVOKER` functions; no privileged bypass in public schema.
- Future Next.js server access must be engineered with a deliberately scoped, authenticated DB role or an equally reviewed authorization boundary. Do **not** add a service-role key to client code, expose this schema publicly, or use a superuser DB password as a quick browser integration.
- No real relationship data has been imported.

Supabase's informational `rls_enabled_no_policy` finding is expected for this closed schema; revisit before granting application access.

## Executed verification

- Supabase migration applied successfully and appears in migration history.
- Five tables have RLS enabled; schema USAGE checks for `anon`, `authenticated`, `service_role` all return false.
- Fictional Judy relationship, capture, personal moment, and connection journey imported and exported to an **identical JSONB document**, including corrected memory and extra root field.
- A second import of the same owner failed as expected.
- An invalid structure was rejected without leaving data behind.
- The successful test was wrapped in a transaction and rolled back. Database was queried afterward and confirmed to have **zero** dataset/relationship/capture/moment/journey rows.
- Security advisor returned informational no-policy findings only.

Verification of **real application write/read paths, failure recovery, independent backup and clean-environment restore is NOT complete**. Passing the synthetic DB roundtrip is not a production recovery drill.

## Remaining implementation phases (no silent cutover)

1. **Server-only adapter:** introduce a data-access abstraction around `src/lib/relationship-store.ts` so that all existing call sites and atomic multi-event semantics retain their contracts. Configure a restricted server identity with credentials stored outside Git. Do not use a browser data client for personal memories. Add tests covering concurrency, idempotence, conflict handling and unavailable database.
2. **Synthetic application test:** isolated fictional dataset end-to-end through Next.js with read/write of every collection, reloading, corrections, moment matching, and connection outcome learning. Validate no raw third-party transcripts persist.
3. **Independent backup/export:** create an encrypted, user-controlled backup outside Supabase/Codespace, then restore a separate **fresh environment** with a new owner namespace and compare canonical exported data and source references. Test corrupt input / partial failure and recovery; provider point-in-time backups alone do not satisfy this.
4. **Guarded real-data migration:** preserve original current JSON and hashes, confirm expected record counts/source references, write a reversible snapshot, receive user approval for private migration, import once, verify, and only then switch the app store. Never overwrite/delete the original source until restore is demonstrated.
5. **Future normalized model:** expand to explicitly typed observations, interests, evidence, and relationship graph only where retrieval/query needs justify it. Keep source uncertainty and correction audit semantics.

## Why not SQLite or plain JSON forever?

SQLite on a user-controlled device could work for a single-device personal system but adds a multi-device sync/hosting requirement. Plain JSON plus off-site backups is cheap but does not address concurrent server writes and future querying as cleanly. Supabase PostgreSQL offers independent hosting and a portable relational core. The provider choice should not force an immediate multiuser SaaS, billing, or automatic ingestion.

## Safety and workflow

ChatGPT develops through GitHub and Supabase connectors; the owner starts Codespace and performs browser acceptance. Keep proposed application changes in draft PRs until explicit merge approval. Real private records, secrets, and backups remain outside the public repository.
