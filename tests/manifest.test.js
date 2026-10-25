// What addons.mozilla.org checks before a submission is even reviewed (« "/description" must NOT have
// more than 250 characters » blocked the Firefox publication once).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of ["manifest.json", "manifest.chrome.json"]) {
  test(`${file}: parses, and its name and description fit the stores' limits`, () => {
    const m = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.ok(m.description && m.description.length <= 250, `description is ${m.description.length} characters (max 250)`);
    assert.ok(m.name && m.name.length <= 75, `name is ${m.name.length} characters`);
  });
}
