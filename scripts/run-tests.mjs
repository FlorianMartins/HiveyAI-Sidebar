// Run the unit tests on every Node this project claims to support.
//
// `node --test tests/` looked like the obvious call and is not portable: what a positional argument
// MEANS to the test runner changed between releases — a directory under Node 20, a path or a glob
// from Node 22, where `tests/` alone matches nothing and the run fails with "test failed" before a
// single test has started. A literal glob is no answer either: npm runs scripts through `cmd.exe` on
// Windows, which does not expand one.
//
// So the files are enumerated here and passed explicitly. An explicit list of paths has meant the
// same thing in every version of the runner, on every platform.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { argv, execPath, exit } from "node:process";

const dir = argv[2] ?? "tests";

/** Every test file, in a stable order so a failure is reported in the same place twice. */
function tests(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...tests(path));
    else if (entry.name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

const files = tests(dir);
if (!files.length) {
  console.error(`No tests in ${dir}.`);
  exit(1);
}

// `execPath` rather than "node": the runner must be the Node running this script.
const run = spawnSync(execPath, ["--test", ...files], { stdio: "inherit" });
exit(run.status ?? 1);
