#!/usr/bin/env bash
# Copies the logged-in agent-browser GitHub profile to .e2e-profile/ for the Playwright e2e tests.
# Refuses while a browser holds the source profile (close the agent-browser session first:
#   agent-browser --session pierre-gh close).
# The copy contains GitHub session cookies: it is git-ignored; delete it when done (rm -rf .e2e-profile).
set -euo pipefail

SRC="${PIERRE_E2E_SOURCE_PROFILE:-$HOME/.agent-browser/profiles/github}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/.e2e-profile"

if [ ! -d "$SRC/Default" ]; then
  echo "e2e-profile: no Chrome profile at $SRC" >&2
  exit 1
fi

lock="$SRC/SingletonLock"
if [ -L "$lock" ]; then
  target="$(readlink "$lock")"          # "<hostname>-<pid>"
  pid="${target##*-}"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "e2e-profile: $SRC is in use by Chrome pid $pid; close that agent-browser session first" >&2
    echo "  e.g. agent-browser --session pierre-gh close" >&2
    exit 2
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
# Skip locks and caches (large, and not needed for the login state).
tar -C "$SRC" \
  --exclude='Singleton*' --exclude='*Cache*' --exclude='Cache' --exclude='Code Cache' \
  --exclude='optimization_guide_model_store' --exclude='annotated_page_contents_db' \
  --exclude='BrowserMetrics*' --exclude='Crashpad' \
  -cf - . | tar -C "$DEST" -xf -
chmod 700 "$DEST"
echo "e2e-profile: copied $SRC -> $DEST ($(du -sh "$DEST" | cut -f1))"
