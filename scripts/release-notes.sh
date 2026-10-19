#!/bin/sh
# Prints a release's notes: the body of its CHANGELOG.md section (`## 0.3.0 (date)` for tag v0.3.0), without the
# heading or surrounding blank lines. Exits 1, printing nothing, when the section is missing or empty.
# Wrapped lines are joined (a list item or paragraph becomes one line): GitHub shows a release body's line breaks.
# Usage: scripts/release-notes.sh <tag> [changelog]
set -eu
version=${1#v}
changelog=${2:-CHANGELOG.md}
awk -v version="$version" '
  function flush() {
    if (line == "") return
    if (blanks && printed) print ""
    blanks = 0
    print line
    printed = 1
    line = ""
  }
  /^## / {
    if (inside) exit
    inside = ($2 == version)
    next
  }
  !inside { next }
  /^[[:space:]]*$/ { flush(); blanks++; next }
  /^(#|[-*] |[0-9]+\. )/ { flush(); line = $0; next }
  {
    text = $0
    sub(/^[[:space:]]+/, "", text)
    line = line == "" ? text : line " " text
  }
  END { flush(); exit printed ? 0 : 1 }
' "$changelog"
