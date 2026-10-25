# Building Hivey AI from source

These are the instructions to rebuild, from this source code, an exact copy of the add-on package
submitted to addons.mozilla.org.

## What the build does

Nothing is compiled, transpiled, bundled or minified. The add-on's own code — `src/**`,
`manifest.json`, `icons/`, `rules/` — is hand-written and shipped as it is. The build only
**copies** those files, together with the unmodified third-party libraries of `vendor/`, into a zip.

The only minified files are the third-party libraries in `vendor/`. They are the official releases,
downloaded from npm (through jsDelivr, which mirrors npm 1:1) at pinned versions and checked against
a SHA-256 fingerprint by `scripts/fetch-vendor.sh`:

| File in `vendor/` | Package | Version |
|---|---|---|
| `marked.min.js` | marked | 12.0.2 |
| `purify.min.js` | dompurify | 3.4.14 |
| `browser-polyfill.min.js` | webextension-polyfill | 0.12.0 |
| `mermaid.min.js` | mermaid | 10.9.1 |
| `pdf.min.js`, `pdf.worker.min.js` | pdfjs-dist (legacy build) | 3.11.174 |
| `transformers/transformers.min.js` | @xenova/transformers | 2.17.2 |
| `transformers/ort-wasm-simd.wasm` | onnxruntime-web | 1.14.0 |
| `jszip.min.js` | jszip | 3.10.1 |

`vendor/fonts/` holds the interface fonts (Inter, DM Sans, Figtree, Plus Jakarta Sans, Manrope, Outfit — WOFF2 files from Google Fonts, under the SIL Open Font License), also unmodified.

## Requirements

**Operating system:** Linux (tested on Ubuntu 24.04 LTS and 22.04 LTS) or macOS 13 or later.
On Windows, use WSL 2 with Ubuntu.

**Programs** (no npm packages, no compiler):

| Program | Version | Used for |
|---|---|---|
| bash | 4.0 or later | the build scripts |
| python3 | 3.8 or later (tested: 3.12.3) | writing the zip, reading the version |
| rsync | 3.x (tested: 3.2.7) | copying the files |
| curl | any recent version (tested: 8.5) | downloading `vendor/` |
| sha256sum (coreutils) or shasum | any | verifying `vendor/` |

Node.js and npm are **not** needed for the build. (They run the test suite and maintenance
scripts only: `npm test` needs Node.js 20 or later.)

**Installing them** — `scripts/setup-build.sh` does it on Ubuntu/Debian (apt), Fedora (dnf) and
macOS (Homebrew). By hand, on Ubuntu or Debian:

```sh
sudo apt-get update && sudo apt-get install -y python3 rsync curl coreutils
```

## Step by step

From the root of the unpacked source code:

1. **Install the programs and the third-party libraries** — one script runs every preliminary step
   (installs the programs above if missing, then downloads every file of `vendor/` from its
   official source and verifies its SHA-256):

   ```sh
   bash scripts/setup-build.sh
   ```

   It ends with `All vendor libraries verified.` To only check the `vendor/` files already present,
   without downloading: `bash scripts/fetch-vendor.sh --check`.

2. **Build:**

   ```sh
   bash scripts/build.sh
   ```

   It writes, at the root of the source:
   - `ai-sidebar-<version>-firefox.zip` — **the Firefox package submitted to addons.mozilla.org**;
   - `ai-sidebar-chrome-<version>.zip` — the Chromium package (not used by Firefox).

   `<version>` is the `version` of `manifest.json`.

3. **Compare with the submitted package** (optional):

   ```sh
   python3 scripts/compare-packages.py <submitted-package>.zip ai-sidebar-<version>-firefox.zip
   ```

   It prints `IDENTICAL — N files, same names and same content`.

The zip is deterministic: entries in sorted order, one fixed date, fixed permissions. Two builds on
the same machine produce byte-identical files. On another machine, the zip bytes can still differ
if its zlib compresses differently, but the files inside are the same, which is what
`compare-packages.py` checks.

## Where things are

- `manifest.json` — the Firefox manifest (`manifest.chrome.json` is Chromium's).
- `src/background/` — the background script.
- `src/sidebar/` — the sidebar (HTML, CSS, JS).
- `src/options/` — the settings page.
- `src/content/` — the content scripts.
- `src/lib/` — shared modules (providers, privacy, MCP client, i18n…).
- `vendor/` — third-party libraries, unmodified (see the table above).
- `scripts/build.sh`, `scripts/build-chrome.sh`, `scripts/zip-dir.py` — the build.
- `scripts/fetch-vendor.sh` — downloads and verifies `vendor/`.

## Note for the reviewer

> Hivey AI ships its own code as hand-written, readable source (`src/**`), without any compilation,
> bundling or minification. The minified files are all in `vendor/`, and they are unmodified
> official releases of open-source libraries at pinned versions (marked, DOMPurify,
> webextension-polyfill, mermaid, pdf.js, transformers.js / onnxruntime-web, jszip).
> `scripts/fetch-vendor.sh` downloads each one from npm (through jsDelivr) and verifies its SHA-256.
>
> To rebuild the package (Linux or macOS, with bash, python3 ≥ 3.8, rsync and curl — no npm install):
> `bash scripts/setup-build.sh`, then `bash scripts/build.sh`. The Firefox package is
> `ai-sidebar-<version>-firefox.zip`.
> `python3 scripts/compare-packages.py <submitted>.zip ai-sidebar-<version>-firefox.zip` confirms
> that the files are identical. Full details are in BUILD.md.
>
> The "innerHTML" and "eval / Function" warnings all point to these `vendor/` libraries. Our own
> code turns sanitized HTML (DOMPurify) into DOM nodes through `DOMParser` (`src/lib/dom.js`) and
> never evaluates strings as code.
