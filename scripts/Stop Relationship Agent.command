#!/usr/bin/env bash
# Save any unsaved browser input before double-clicking.
set -u
if [ "$(uname -s)" != Darwin ] && [ "${1:-}" != --dry-run ]; then
  echo "Run this launcher on your Mac, not inside the Codespace." >&2
  exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
exec bash "$(dirname "$0")/dev-stop.sh" --personal "$@"
