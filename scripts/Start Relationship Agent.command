#!/usr/bin/env bash
# Double-click in Finder, or run this file from the Mac Terminal.
set -u
if [ "$(uname -s)" != Darwin ] && [ "${1:-}" != --dry-run ]; then
  echo "Run this launcher on your Mac, not inside the Codespace." >&2
  exit 1
fi
# Finder Terminal normally inherits a login PATH. Include standard Homebrew locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
exec bash "$(dirname "$0")/dev-start.sh" --personal "$@"
