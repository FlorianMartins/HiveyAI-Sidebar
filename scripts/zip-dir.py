#!/usr/bin/env python3
"""Deterministic zip of a directory — the same files always give the same archive, byte for byte.

Used by build.sh / build-chrome.sh so that anyone (an addons.mozilla.org reviewer included) who
builds from the same source gets an identical package: entries in sorted order, one fixed date
(1980-01-01, the zip format's epoch), fixed permissions, no OS-specific extra fields.

Usage: python3 scripts/zip-dir.py <source-dir> <out.zip>
"""
import os
import sys
import zipfile

FIXED_DATE = (1980, 1, 1, 0, 0, 0)
SKIP = {".DS_Store", "Thumbs.db"}


def main(src, out):
    files = []
    for root, dirs, names in os.walk(src):
        dirs.sort()
        for name in sorted(names):
            if name not in SKIP:
                full = os.path.join(root, name)
                files.append((os.path.relpath(full, src).replace(os.sep, "/"), full))
    files.sort()
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for arc, full in files:
            info = zipfile.ZipInfo(arc, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3  # Unix, whatever the building OS
            info.external_attr = 0o100644 << 16
            with open(full, "rb") as fh:
                z.writestr(info, fh.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    print(f"  -> {out} ({len(files)} files, {os.path.getsize(out)} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: zip-dir.py <source-dir> <out.zip>")
    main(sys.argv[1], sys.argv[2])
