#!/usr/bin/env bash
# Copies the logged-in agent-browser GitHub profile to .e2e-profile/ for the Playwright e2e tests.
# Refuses while a browser holds the source profile (close the agent-browser session first:
#   agent-browser --session pierre-gh close), or while a browser (e.g. `npm run e2e:token`) holds .e2e-profile.
#
# Re-running it REFRESHES the copy (cookies, login) but KEEPS the extension storage already in .e2e-profile:
#   Default/Local Extension Settings  (chrome.storage.local: the GitHub token saved via Pierre's TokenPrompt,
#                                      see `npm run e2e:token`)
#   Default/Sync Extension Settings   (chrome.storage.sync: display settings)
# so the token pasted once survives cookie refreshes. `--fresh` wipes everything, token included.
# The copy contains GitHub session cookies (and possibly the token): it is git-ignored, chmod 700.
set -euo pipefail

FRESH=0
if [ "${1:-}" = "--fresh" ]; then FRESH=1; fi

SRC="${PIERRE_E2E_SOURCE_PROFILE:-$HOME/.agent-browser/profiles/github}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/.e2e-profile"

if [ ! -d "$SRC/Default" ]; then
  echo "e2e-profile: no Chrome profile at $SRC" >&2
  exit 1
fi

# Exits 2 when a live Chrome holds the profile directory $1.
refuse_if_in_use() {
  local lock="$1/SingletonLock" target pid
  if [ -L "$lock" ]; then
    target="$(readlink "$lock")"          # "<hostname>-<pid>"
    pid="${target##*-}"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "e2e-profile: $1 is in use by Chrome pid $pid; close that browser first" >&2
      echo "  e.g. agent-browser --session pierre-gh close" >&2
      exit 2
    fi
  fi
}
refuse_if_in_use "$SRC"
refuse_if_in_use "$DEST"

KEEP_LOCAL='Local Extension Settings'
KEEP_SYNC='Sync Extension Settings'

if [ "$FRESH" = 1 ] || [ ! -d "$DEST/Default" ]; then
  rm -rf "$DEST"
  mkdir -p "$DEST/Default"
  kept="nothing kept"
else
  # Refresh: delete everything except the extension storage directories.
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name Default -exec rm -rf {} +
  find "$DEST/Default" -mindepth 1 -maxdepth 1 ! -name "$KEEP_LOCAL" ! -name "$KEEP_SYNC" -exec rm -rf {} +
  kept="extension storage kept"
fi
# Skip locks and caches (large, and not needed for the login state), and the source's extension storage
# (the destination's own extension storage is kept above).
tar -C "$SRC" \
  --exclude='Singleton*' --exclude='*Cache*' --exclude='Cache' --exclude='Code Cache' \
  --exclude='optimization_guide_model_store' --exclude='annotated_page_contents_db' \
  --exclude='BrowserMetrics*' --exclude='Crashpad' \
  --exclude="$KEEP_LOCAL" --exclude="$KEEP_SYNC" \
  -cf - . | tar -C "$DEST" -xf -
chmod 700 "$DEST"
echo "e2e-profile: copied $SRC -> $DEST ($(du -sh "$DEST" | cut -f1); $kept)"
