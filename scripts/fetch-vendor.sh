#!/usr/bin/env bash
# Re-download every third-party library in vendor/ from its OFFICIAL source at the
# exact pinned version, and verify each file against a known SHA-256. This proves the
# minified files shipped in vendor/ are the unmodified upstream open-source releases.
#
# These are the ONLY minified/generated files in the add-on. All of the extension's
# own code (src/**, manifest*.json, icons/icon.svg) is hand-written, human-readable
# and is NOT transpiled, concatenated, minified or machine-generated.
#
# Usage:  bash scripts/fetch-vendor.sh           # download + verify
#         bash scripts/fetch-vendor.sh --check    # verify the existing files only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/vendor"

CHECK_ONLY="${1:-}"

# file  →  official source URL (jsDelivr mirrors npm 1:1)
declare -A SRC=(
  [marked.min.js]="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"
  [purify.min.js]="https://cdn.jsdelivr.net/npm/dompurify@3.4.14/dist/purify.min.js"
  [browser-polyfill.min.js]="https://cdn.jsdelivr.net/npm/webextension-polyfill@0.12.0/dist/browser-polyfill.min.js"
  [mermaid.min.js]="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"
  [pdf.min.js]="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js"
  [pdf.worker.min.js]="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js"
  [transformers/transformers.min.js]="https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
  [transformers/ort-wasm-simd.wasm]="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-simd.wasm"
)
# expected SHA-256 of each file
declare -A SHA=(
  [marked.min.js]="15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894"
  [purify.min.js]="c2f26ea4fc0d88141c9aa430eb515ac86fce59418ceebd85fa475b87a8d6c3e6"
  [browser-polyfill.min.js]="918ed891c0e7f9b58b39ac32c9c3133eb2a1fbaaa27f4aa7579ae55e7572cc21"
  [mermaid.min.js]="61b335a46df05a7ce1c98378f60e5f3e77a7fb608a1056997e8a649304a936d6"
  [pdf.min.js]="978fd1b2d134a98e98966186a97777bebf87d8e770dadab1ece3687e21a5aa6c"
  [pdf.worker.min.js]="38cde5311957b86bc3669f93e7d2566de333a90055ed6635bef60d9bf00e96f2"
  [transformers/transformers.min.js]="bcf7cf304e51f470ed59409622b9d6ffbad80dfcf5baf6a40c919e4b9c4ff812"
  [transformers/ort-wasm-simd.wasm]="9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865"
)

fail=0
for f in "${!SRC[@]}"; do
  if [[ "$CHECK_ONLY" != "--check" ]]; then
    echo "Downloading $f  <-  ${SRC[$f]}"
    mkdir -p "$(dirname "$f")"
    curl -fsSL "${SRC[$f]}" -o "$f"
  fi
  got="$(sha256sum "$f" | cut -d' ' -f1)"
  if [[ "$got" == "${SHA[$f]}" ]]; then
    echo "  OK   $f"
  else
    echo "  FAIL $f  expected ${SHA[$f]}  got $got"
    fail=1
  fi
done
[[ "$fail" == 0 ]] && echo "All vendor libraries verified." || { echo "Verification FAILED."; exit 1; }
