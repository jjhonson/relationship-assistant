# Personal-alpha access and privacy gate

**Status:** database permission audit passed; owner confirmed forwarded port 3000 is Private on Nov 26. Signed-out access test, data isolation acceptance, backup cadence and real-data authorization remain outstanding. This does not authorize real data.

## Trust boundaries

1. **Codespaces is the current website authentication boundary.** Private forwarded ports require GitHub login by the Codespace owner. Public ports let anyone access the URL without a login. Port 3000 MUST be **Private**. The assistant's GitHub repository connection cannot inspect the live Codespace port setting; the owner must verify it in the VS Code Ports panel.
2. **The Next.js app has no independent owner login.** A visitor who reaches the server could access the one fixed database owner via server actions and rendered pages. Never deploy the current app publicly or change the forwarded port to Public or Organization. Development mode is not a security boundary.
3. **Supabase is server-only.** src/lib/supabase-document-store.ts uses server-only, a private sb_secret_ key from .env.local and a fixed RA_DB_OWNER_ID; these are NOT browser identity claims. Never put secrets in NEXT_PUBLIC variables, screenshots, commits or messages.
4. **Database permissions independently checked on 2026-11-26.** All five ra_private tables have RLS enabled; anon and authenticated roles lack private-schema USAGE and SELECT. The two public ra_store_* RPC functions are executable only by service_role. Security advisor's five INFO no-policy findings are expected for this non-exposed private schema; no public grants were added.
5. **External services are opt-in.** Real Gmail reading must have separate explicit user consent. Production use would require app-level sign-in, per-request authorization, and strong owner isolation. The current GitHub-private-port approach is temporary for one owner only.

## Gate before any real contacts

- [x] Owner confirms forwarded port 3000 visibility is Private (Nov 26). Repository connector cannot independently inspect live forwarding.
- [ ] Check that a signed-out browser cannot load the forwarded app without GitHub authentication.
- [ ] Confirm there is no public deployment and server-only secrets remain protected, without pasting them.
- [x] Actual encrypted fictional backup left the Codespace and Supabase; the downloaded offsite file was restored into an isolated fresh PostgreSQL environment with exact digest, private access and occupied-destination checks (Nov 26, PR #77). This does not certify a full platform cutover.
- [ ] Create a distinct real-data owner namespace separate from fictional test data, with an independently restorable recovery plan.
- [ ] Obtain explicit owner authorization before entering real contacts. No passive ingestion or automatic communications.

**Reference:** GitHub Codespaces Security, https://docs.github.com/en/codespaces/reference/security-in-github-codespaces ; Supabase Securing Your Data, https://supabase.com/docs/guides/database/secure-data.
## Guarded application profiles

Fictional development remains the default and uses the existing `RA_DB_OWNER_ID` and configuration. Do not modify or delete its records. Personal alpha is a separate, explicitly enabled, production-runtime profile. After review and owner opt-in, use an ignored mode-0600 `.data/personal.env` containing the following **placeholders**, not real values:

```
RA_DATASET_MODE=personal
RA_STORAGE_BACKEND=supabase
RA_PERSONAL_DATA_ENABLED=yes
RA_PERSONAL_SUPABASE_URL=https://<approved-project>.supabase.co
RA_PERSONAL_SUPABASE_SECRET_KEY=<private-server-secret>
RA_PERSONAL_DB_OWNER_ID=<new-distinct-UUID>
```

Keep existing `.env.local` for fictional development. Never put personal activation variables into it or export them globally. Use a reviewed build (built with fictional configuration), stop the fictional runtime, and explicitly launch the personal runtime with `npm run personal` in the private Codespace. Normal `npm run dev` stays fictional; it refuses personal storage. Do not run simultaneous servers on the same forwarded port. The header identifies the active mode. No browser mode toggle. After stopping the personal runtime, resume ordinary fictional development. Verify the new namespace is empty before activating it.

The server selects distinct owner IDs and profile credentials, refuses matching UUIDs and mode mismatches, and marks a newly initialized personal document. Existing unmarked snapshots are fictional-only; a personal snapshot is never relabeled as fictional by the adapter. Automated tests clear inherited dataset settings, permit only fixture endpoints in the adapter, and refuse unmocked Supabase network requests. The backup CLI uses the same profile selection and checks the snapshot marker before export. To back up the selected personal dataset, use `npm run backup:personal -- --output FILE` (loads both private files and refuses to start if the selected profile is not personal). Continue storing the passphrase separately and copying the encrypted backup offsite.

**Limits:** These are application-level accident-prevention controls, not database-enforced credential isolation. A shared service-role key can still directly address all owners, and older code or manual SQL could bypass this guard. The private port, no public deployment, owner-controlled credentials and reviewed builds remain mandatory. Separate hosted projects or scoped database identities would provide stronger separation; neither is provisioned here. Live profile activation, fictional-only end-to-end acceptance, signed-out access verification and explicit permission to use real contacts remain outstanding.
