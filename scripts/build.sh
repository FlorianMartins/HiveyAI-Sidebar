#!/usr/bin/env bash
# One-shot, reproducible build of the AI Sidebar add-on packages from source.
#
# There is NO compilation/transpilation/minification of the add-on's own code: the
# build simply assembles the hand-written source files (src/**, icons, manifest) plus
# the unmodified third-party libraries in vendor/ into a .zip per browser.
#
# Output:
#   ai-sidebar-<version>-firefox.zip   (Firefox / Gecko — uses manifest.json)
#   ai-sidebar-chrome-<version>.zip    (Chromium       — uses manifest.chrome.json)
#
# Usage:  bash scripts/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for bin in node rsync python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required but not installed."; exit 1; }
done

VER="$(node -p "require('./manifest.json').version")"
echo "Building AI Sidebar v$VER"
echo "  node $(node --version) · npm $(npm --version 2>/dev/null || echo n/a)"

# ----- Firefox package ------------------------------------------------------
# .build is a clean, curated copy of exactly what ships (no node_modules, no dev files).
rm -rf .build
mkdir -p .build
rsync -a --delete src icons vendor rules .build/
cp LICENSE README.md CHANGELOG.md manifest.json .build/

FX_ZIP="ai-sidebar-${VER}-firefox.zip"
python3 - .build "$FX_ZIP" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in sorted(os.walk(src)):
        for f in sorted(files):
            if f == ".DS_Store":
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, src))
PY
echo "  -> $FX_ZIP"

# ----- Chromium package -----------------------------------------------------
bash scripts/build-chrome.sh

echo "Done."
