#!/usr/bin/env bash
# Compares vendor/herdr-files/ with a checkout of herdrdev/herdr-app.
# Usage: scripts/check-upstream-drift.sh <path to the herdr-app checkout>
# Exits 1 when they differ, 2 when the checkout does not look right.
set -u

upstream="${1:?usage: check-upstream-drift.sh <path to the herdr-app checkout>}"
vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor/herdr-files"
upstream_files="$upstream/defaults/mods/files"

if [ ! -f "$upstream_files/main.js" ]; then
  echo "error: $upstream_files/main.js is missing. Upstream may have moved the files mod." >&2
  exit 2
fi
if [ ! -f "$upstream/LICENSE" ]; then
  echo "error: $upstream/LICENSE is missing." >&2
  exit 2
fi

# These three are not copies of files in upstream's defaults/mods/files/.
# Leave them out of a copy of vendor, so that a file of the same name
# added upstream is still reported.
# The copy and a link to upstream sit side by side, so that diff prints
# short names: "vendor/main.js", "Only in upstream: new.svg".
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/vendor"
cp -R "$vendor/." "$tmp/vendor/"
rm -f "$tmp/vendor/README.md" "$tmp/vendor/LICENSE" "$tmp/vendor/LICENSE-Lucide.txt"
ln -s "$(cd "$upstream_files" && pwd)" "$tmp/upstream"

rc=0

echo "== vendor/herdr-files/ and upstream defaults/mods/files/ =="
if ! (cd "$tmp" && diff -ru vendor/ upstream/); then
  rc=1
fi

echo "== vendor/herdr-files/LICENSE and upstream LICENSE =="
if ! diff -u "$vendor/LICENSE" "$upstream/LICENSE"; then
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  echo "No difference."
else
  echo "vendor/herdr-files/ differs from upstream. See vendor/herdr-files/README.md." >&2
fi
exit "$rc"
