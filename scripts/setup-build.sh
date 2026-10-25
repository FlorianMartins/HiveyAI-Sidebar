#!/usr/bin/env bash
# One-time setup before building the add-on: installs the few programs the build needs, then
# downloads the third-party libraries of vendor/ from their official sources at the pinned versions
# and verifies each against its SHA-256 (scripts/fetch-vendor.sh).
#
# The build needs NO npm install, no compiler, no bundler: bash, python3 (>= 3.8), rsync, curl and a
# SHA-256 tool. Node.js is only used by the test suite and the maintenance scripts, not the build.
#
# Supported: Ubuntu / Debian (apt), Fedora (dnf), macOS (Homebrew or the system tools).
# Windows: use WSL 2 with Ubuntu.
#
# Usage:  bash scripts/setup-build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need=()
for bin in python3 rsync curl; do command -v "$bin" >/dev/null 2>&1 || need+=("$bin"); done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || need+=("coreutils")

if ((${#need[@]})); then
  echo "Installing: ${need[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y python3 rsync curl coreutils
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y python3 rsync curl coreutils
  elif command -v brew >/dev/null 2>&1; then
    brew install python rsync curl
  else
    echo "Please install manually: ${need[*]}" >&2
    exit 1
  fi
fi

python3 - <<'PY'
import sys
if sys.version_info < (3, 8):
    sys.exit(f"python3 >= 3.8 is required (found {sys.version.split()[0]})")
PY
echo "Tools:"
echo "  bash    $BASH_VERSION"
echo "  python3 $(python3 -c 'import platform;print(platform.python_version())')"
echo "  rsync   $(rsync --version | head -1 | awk '{print $3}')"
echo "  curl    $(curl --version | head -1 | awk '{print $2}')"

echo "Third-party libraries (vendor/): download from the official sources and verify:"
bash scripts/fetch-vendor.sh
echo "Setup done. Build with:  bash scripts/build.sh"
