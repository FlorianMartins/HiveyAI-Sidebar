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

for bin in rsync python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required but not installed."; exit 1; }
done

VER="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
echo "Building AI Sidebar v$VER"
echo "  python $(python3 -c 'import platform;print(platform.python_version())') · $(rsync --version | head -1)"

# ----- Firefox package ------------------------------------------------------
# .build is a clean, curated copy of exactly what ships (no node_modules, no dev files).
rm -rf .build
mkdir -p .build
rsync -a --delete src icons vendor rules .build/
cp LICENSE README.md CHANGELOG.md manifest.json .build/

FX_ZIP="ai-sidebar-${VER}-firefox.zip"
# Deterministic zip (sorted entries, fixed dates): the same source gives the same package.
python3 scripts/zip-dir.py .build "$FX_ZIP"

# ----- Chromium package -----------------------------------------------------
bash scripts/build-chrome.sh

echo "Done."
