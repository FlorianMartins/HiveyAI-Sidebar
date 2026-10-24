// A key written twice in one language: the second silently replaces the first, and the text the
// user sees is whichever came last. CodeQL caught it once; this catches it on every commit.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("no translation key is written twice in the same language", () => {
  for (const [path, names] of [["src/lib/i18n.js", ["EN", "FR"]], ["src/lib/i18n-langs.js", ["ES", "DE", "IT", "PT"]]]) {
    const s = readFileSync(path, "utf8");
    for (const n of names) {
      const start = s.search(new RegExp(`(export )?const ${n} = \\{\\n`));
      const after = s.slice(start + 1);
      const end = after.search(/\n(export )?const [A-Z]+ = \{/);
      const body = end >= 0 ? after.slice(0, end) : after;
      const keys = [...body.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
      const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
      assert.deepEqual(dup, [], `${path} ${n}`);
    }
  }
});
