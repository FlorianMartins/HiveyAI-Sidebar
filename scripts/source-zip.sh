#!/usr/bin/env bash
# The source code archive for addons.mozilla.org: every file of the repository as it is in this
# working copy (so a version number written by the dev build is included), in a deterministic zip.
# Unpack it anywhere, then follow BUILD.md to rebuild the exact Firefox package.
#
# Output: hivey-ai-sidebar-<version>-source.zip
# Usage:  bash scripts/source-zip.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VER="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT="hivey-ai-sidebar-${VER}-source.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# The tracked files only (no build output, no local caches), with their working-copy content.
git ls-files -z | while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  mkdir -p "$TMP/src/$(dirname "$f")"
  cp -p "$f" "$TMP/src/$f"
done
python3 scripts/zip-dir.py "$TMP/src" "$OUT"
