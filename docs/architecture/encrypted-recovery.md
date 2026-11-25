# Relationship Agent: private backup and recovery

**Stage:** draft recovery engineering for [Issue #54](https://github.com/jjhonson/relationship-assistant/issues/54). This is not yet an approved real-person pilot or a completed disaster-recovery drill.

## Recovery objective

If the current Codespace **and** Supabase project disappear, a separately held encrypted snapshot should allow restoring every relationship, capture, personal moment and connection journey, including stable record IDs, source references, correction history, dismissed suggestions and unknown forward-compatible root fields, into a newly provisioned PostgreSQL/Supabase project.

This is **application-data recovery**, not a full Supabase platform backup. It does not include OAuth credentials, storage objects, Supabase Auth users, remote images, application source history or configuration secrets. Those require separate management if they become part of the product.

## Implementation

The portable backup format lives in `scripts/recovery-crypto.mjs`, with an opt-in CLI `scripts/relationship-recovery.mjs` and built-in Node tests `scripts/recovery.check.mjs`.

- Server-only export calls the existing `ra_store_read` RPC with a private `sb_secret_` key and owner UUID. A missing or malformed source fails closed. The app remains on its current storage backend.
- Backup content is encrypted with **AES-256-GCM** and an authenticated manifest, with a fresh nonce and salt for each export. A user-supplied passphrase is derived using **scrypt** (N=32768, r=8, p=1).
- The source project URL, original owner UUID, source revision, version, document and SHA-256 digest are encrypted. The outer JSON contains only format/version, salt, nonce, authentication tag and ciphertext. Individual people, moments and IDs do not appear in the unencrypted envelope.
- Offline `verify` decrypts and verifies the entire snapshot without contacting Supabase. The passphrase is requested in a terminal without echo, not through CLI arguments or Git history.
- A restore requires a **different Supabase project** and a new empty owner UUID; it refuses the same source project, the original owner, or an occupied destination. It writes the complete document in one transaction using `ra_store_write(...,-1,...)` and reads it back to compare its canonical SHA-256 digest and revision.
- Backups are written to a **new** mode-0600 file; the tool refuses to overwrite an existing backup file. Failed remote requests never fall back to local JSON or claim success.

## Operating steps (after engineering acceptance)

These examples are for a trusted administrator in an existing, private server environment, **not for a visitor to the Relationship Agent site**. Credentials must remain in protected environment configuration. Node 22+ supports `--env-file` for reading local variables without printing them.

**Create a backup:** After choosing an output path outside the public repository, use `node --env-file=.env.local scripts/relationship-recovery.mjs backup --output /path/to/new-backup.raenc`. Enter and confirm a long unique passphrase in the hidden prompt. Save that passphrase in a password manager, separate from the encrypted file.

**Independence requires off-site possession.** Download the resulting encrypted `.raenc` file using the VS Code Codespaces file Explorer, then store it in at least one user-controlled location **outside both Supabase and the Codespace**, preferably with a second copy. Only then is it an independent backup. Files left in a Codespace or only in the same Supabase project do not count.

**Offline integrity check:** `node scripts/relationship-recovery.mjs verify --input /path/to/backup.raenc`. It needs the file and passphrase only, not access to the original project.

**Restore after original project loss:** Create a genuinely separate Supabase project, apply the two reviewed schema migrations, then configure `RA_RECOVERY_TARGET_URL` and `RA_RECOVERY_TARGET_SECRET_KEY` privately for that project. Use `node --env-file=.env.local scripts/relationship-recovery.mjs restore --input /path/to/backup.raenc --target-owner NEW_UUID`. The source project credentials need not work or even exist. The tool refuses to write unless the destination is empty and in another Supabase project. Verify the fresh app manually before redirecting any use to it.

**Never paste a live API secret, a real backup file, or a passphrase into a chat, public GitHub issue, PR, or screenshot.** Do not store the encrypted backup in the public repository, either.

## Evidence so far

- Live private development database currently contains only synthetic `Fictional Judy Test` and one fictional 5K article moment, dataset revision 2; existing source and corrected relationship labels have been verified.
- SQL exercise on November 25 imported the complete current fictional document into another empty owner namespace in the same Supabase project, proved **JSONB equality** and record counts, and rolled the transaction back. This confirms transactional logical restoration but **does not** satisfy separate-project recovery.
- Automated recovery checks cover encryption/decryption, authenticated tamper and wrong-passphrase rejection, exact provenance/correction/unknown-field preservation, destination collision refusal, separate-project simulated RPC restoration and re-read, and file permission/no-overwrite behavior.
- The actual CLI has **not yet exported the Codespace dataset into an off-site file or restored into a separately provisioned PostgreSQL instance**. No separate project has been created, and no real personal data has been imported. Do not check Issue #54's independent recovery acceptance box until that test succeeds.

## Remaining acceptance gate

1. CI green on this draft branch.
2. Perform real encrypted export from the current fictional Supabase dataset using protected server credentials, and move the file outside Codespace/Supabase.
3. Restore the file to a separate **fresh database project**, not merely a new owner namespace. Compare IDs, sources, corrections, moments, captures and journeys.
4. Demonstrate bad-passphrase, corrupt-file and occupied-destination refusal against the actual infrastructure; no unintended write.
5. Decide backup frequency and secure off-site storage for the real-data pilot. Test restore after a simulated loss of access to the source project.
6. Review restricted server identity/authentication before any real-contact use, and obtain explicit owner authorization for merges and private real-data migration.

**Cost:** A second managed Supabase project or paid branch may incur charges or free-plan limitations. Do not provision anything billable without owner approval. An independently hosted local PostgreSQL environment is another valid test destination if it faithfully supports the same migration and recovery workflow.
