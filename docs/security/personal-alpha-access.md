# Personal-alpha access and privacy gate

**Status:** database permission audit passed; live Codespace port visibility and real-data authorization remain unverified. This does not authorize real data.

## Trust boundaries

1. **Codespaces is the current website authentication boundary.** Private forwarded ports require GitHub login by the Codespace owner. Public ports let anyone access the URL without a login. Port 3000 MUST be **Private**. The assistant's GitHub repository connection cannot inspect the live Codespace port setting; the owner must verify it in the VS Code Ports panel.
2. **The Next.js app has no independent owner login.** A visitor who reaches the server could access the one fixed database owner via server actions and rendered pages. Never deploy the current app publicly or change the forwarded port to Public or Organization. Development mode is not a security boundary.
3. **Supabase is server-only.** src/lib/supabase-document-store.ts uses server-only, a private sb_secret_ key from .env.local and a fixed RA_DB_OWNER_ID; these are NOT browser identity claims. Never put secrets in NEXT_PUBLIC variables, screenshots, commits or messages.
4. **Database permissions independently checked on 2026-11-26.** All five ra_private tables have RLS enabled; anon and authenticated roles lack private-schema USAGE and SELECT. The two public ra_store_* RPC functions are executable only by service_role. Security advisor's five INFO no-policy findings are expected for this non-exposed private schema; no public grants were added.
5. **External services are opt-in.** Real Gmail reading must have separate explicit user consent. Production use would require app-level sign-in, per-request authorization, and strong owner isolation. The current GitHub-private-port approach is temporary for one owner only.

## Gate before any real contacts

- [ ] On the live Codespace PORTS tab, verify port 3000 says Private, not Public or Organization. Check that a new browser session requires GitHub authentication.
- [ ] Confirm there is no public deployment and server-only secrets remain protected, without pasting them.
- [ ] Encrypted backup has left the Codespace and Supabase to owner-controlled storage, and has been restored into an independent clean Postgres environment with ID/source/digest reconciliation and refusal tests.
- [ ] Create a distinct real-data owner namespace separate from fictional test data, with an independently restorable recovery plan.
- [ ] Obtain explicit owner authorization before entering real contacts. No passive ingestion or automatic communications.

**Reference:** GitHub Codespaces Security, https://docs.github.com/en/codespaces/reference/security-in-github-codespaces ; Supabase Securing Your Data, https://supabase.com/docs/guides/database/secure-data.