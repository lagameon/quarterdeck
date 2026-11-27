#!/usr/bin/env bash
# Cut a release: regenerate the screenshots, tag the version in package.json and publish a GitHub release whose
# notes are the commit subjects since the previous tag (they are written as full sentences for this reason).
#
#   scripts/release.sh            dry run: print the notes
#   scripts/release.sh --publish  tag, push the tag, create the GitHub release (needs the gh CLI, on main, clean tree)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ver="v$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
prev="$(git describe --tags --abbrev=0 2>/dev/null || true)"
range="${prev:+$prev..}HEAD"
notes="$(git log --no-merges --format='- %s' "$range" | grep -viE '^- (README|Docs?):' || true)"
echo "## $ver"; echo; echo "${notes:-(no changes)}"
[ "${1:-}" = "--publish" ] || { echo; echo "(dry run — add --publish to tag and release)"; exit 0; }
[ "$(git branch --show-current)" = "main" ] || { echo "not on main" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }
git rev-parse "$ver" >/dev/null 2>&1 && { echo "tag $ver already exists — bump the version in package.json" >&2; exit 1; }
git tag -a "$ver" -m "$ver"; git push origin "$ver"
gh release create "$ver" --title "$ver" --notes "$notes"
