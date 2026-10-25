#!/usr/bin/env python3
"""Compare two add-on packages file by file (names and SHA-256 of each file's content).

The zip bytes themselves can differ between machines (another zlib compresses differently); what a
reviewer checks is that the FILES are identical. Exit code 0 when they are.

Usage: python3 scripts/compare-packages.py <submitted.zip> <rebuilt.zip>
"""
import hashlib
import sys
import zipfile


def digest(path):
    with zipfile.ZipFile(path) as z:
        return {i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist() if not i.is_dir()}


def main(a, b):
    da, db = digest(a), digest(b)
    only_a, only_b = sorted(set(da) - set(db)), sorted(set(db) - set(da))
    changed = sorted(f for f in set(da) & set(db) if da[f] != db[f])
    for f in only_a:
        print(f"only in {a}: {f}")
    for f in only_b:
        print(f"only in {b}: {f}")
    for f in changed:
        print(f"different content: {f}")
    if only_a or only_b or changed:
        print("DIFFERENT")
        return 1
    print(f"IDENTICAL — {len(da)} files, same names and same content")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: compare-packages.py <submitted.zip> <rebuilt.zip>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
