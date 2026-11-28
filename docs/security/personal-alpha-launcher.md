# Private personal-alpha Mac launcher

The existing fictional development scripts remain available. Use the explicit personal launchers for real relationship data.

## Everyday use

On the Mac, double-click `scripts/Start Relationship Agent.command` from a reviewed local repository checkout, or run `bash scripts/dev-start.sh --personal`. It wakes the existing Codespace when needed, verifies the reviewed merged main tree and protected personal configuration, reuses the production build when possible, starts/reuses only its own personal process group, checks private port visibility, forwards remote 3000 to Mac-local 3001 (loopback only), verifies the forwarding process and HTTP response, then opens the browser. The Terminal can close; the verified background processes are managed separately.

Save any pending browser input and double-click `scripts/Stop Relationship Agent.command` (or run `bash scripts/dev-stop.sh --personal`). It stops the verified personal process group and its recorded local tunnel, then stops the selected Codespace to conserve compute. It does not delete the Codespace, its data, or any relationship records. The database remains independent of Codespace availability.

Normal Codespace inactivity shutdown still applies; the launcher is a convenience, not always-on hosting or a keepalive workaround. The first launch after code/dependency changes may rebuild. Fixed progress messages identify private configuration checks, dependency installation, compilation, cached build reuse and browser connection. Raw build/runtime output stays in private logs. Subsequent starts reuse the build when its reviewed tree, dependency lock, and build ID match. No automatic branch switches, merges, new infrastructure, or billing changes.

## Safety boundaries

- No public or organization-visible port is accepted. An absent web-forward registration is allowed for the authenticated loopback CLI tunnel; GitHub's default web forwarding is private. The existing GitHub authentication boundary still applies.
- Personal startup clears inherited storage overrides and loads the existing ignored mode-0600 `.data/personal.env` and `.env.local`; it never writes them or prints their secrets. Builds use fictional JSON mode, not the personal profile.
- A checkout that differs from merged main, or has unexpected edits, fails closed. The only allowed generated-file change is Next's normal development type import path. Do not overwrite work or automatically pull to resolve this.
- Both modes use the same remote lifecycle lock and process ownership record, with distinct run identities. Personal and fictional local forward records are separate. A different mode or unowned listener is refused, not killed. Old pre-launcher scripts do not understand the new mode guard; update the Mac launcher checkout before using them.
- Startup validates process group, listener, reviewed tree and profile fingerprint; shutdown verifies process ownership. The fingerprint is not an authentication credential. The shared Supabase credential still has broad service privileges; this is single-owner accident prevention, not credential-level isolation.
- A legacy manually started server/forward is not adopted. For the one-time transition, save all input, stop the old manual tunnel and explicitly stop the existing Codespace via GitHub, then start the launcher. Do not signal unknown processes. A failed personal start may leave the Codespace awake; inspect the message before stopping it.
- Runtime/build logs remain private; do not paste raw logs or real correspondence into GitHub/chat. No secret or dataset identifier is printed by the launcher.

## One-time installation and acceptance

Update the local Mac launcher checkout and the Codespace checkout deliberately to reviewed code. The launch scripts are executed on the Mac; the remote management script is piped over authenticated SSH. A draft launcher can be tested with already-merged application code in the Codespace, without installing unmerged application code into personal mode. For browser acceptance, use read-only verification that the existing personal data remains present, not new fictional writes to the personal dataset. Test start, repeat start, stop, start after stop, and confirm the same relationship list. Do not claim Mac acceptance from Linux CI alone.

GitHub CLI references: https://cli.github.com/manual/gh_codespace_ports and https://cli.github.com/manual/gh_codespace_ports_forward .
