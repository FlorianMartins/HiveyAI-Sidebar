// The numbers a document claims, checked against the repository.
//
// The README badge said 2.196.0 while the three manifests were at 2.201.0. Nobody lied — a number
// written in prose has no reason to follow the thing it describes. So it is checked, and `--fix`
// rewrites it. The three version fields must also agree with each other: Firefox reads
// manifest.json, Chromium manifest.chrome.json, and the dev toolchain package.json.
//
// A test is a top-level `test(` in a test file, which is what `node:test` reports; counting that is
// cheap enough to run on every commit, where running the suite to count it would not be.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const fix = argv.includes("--fix");
const json = (f) => JSON.parse(readFileSync(f, "utf8"));

function countTests(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countTests(join(dir, entry.name));
    else if (entry.name.endsWith(".test.js")) total += (readFileSync(join(dir, entry.name), "utf8").match(/^test\(/gm) ?? []).length;
  }
  return total;
}

const versions = { "manifest.json": json("manifest.json").version, "manifest.chrome.json": json("manifest.chrome.json").version, "package.json": json("package.json").version };
const truth = { version: versions["manifest.json"], unit: countTests("tests") };

let failed = false;
if (new Set(Object.values(versions)).size !== 1) {
  console.error(`✗ the versions disagree: ${Object.entries(versions).map(([f, v]) => `${f} ${v}`).join(", ")}`);
  failed = true;
}

/** Where a number is claimed, and which one it is. Listed rather than guessed — see the header. */
const CLAIMS = [
  { file: "README.md", pattern: /badge\/version-(\d+\.\d+\.\d+)-/g, of: "version" },
  { file: "README.md", pattern: /\*\*(\d+) tests\*\* \(node:test\)/g, of: "unit" },
];

for (const claim of CLAIMS) {
  let text;
  try { text = readFileSync(claim.file, "utf8"); } catch { continue; }
  const want = String(truth[claim.of]);
  let changed = false;
  const next = text.replace(claim.pattern, (all, said) => {
    if (said === want) return all;
    console.error(`${fix ? "✎" : "✗"} ${claim.file}: says ${said} for ${claim.of}, the repository has ${want}`);
    changed = true;
    return all.replace(said, want);
  });
  if (!changed) continue;
  if (fix) writeFileSync(claim.file, next);
  else failed = true;
}

if (failed) {
  console.error("Run `npm run check:numbers -- --fix` to rewrite the claims (the versions must be aligned by hand).");
  exit(1);
}
console.log(`✓ the documents agree with the repository (version ${truth.version}, ${truth.unit} tests)`);
