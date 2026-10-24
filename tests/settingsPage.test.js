// The settings page: its Quick access switches write the same keys, with the same meaning, as the
// detailed controls and the sidebar; and the page still offers every setting it used to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUICK_TOGGLES, quickState, quickPatch } from "../src/lib/quick-toggles.js";
import { DEFAULTS } from "../src/lib/storage.js";

test("anonymisation: off remembers the level, on brings it back — like the sidebar's cloud badge", () => {
  let s = { ...DEFAULTS, privacyLevel: "strict" };
  assert.equal(quickState("anon", s), true);
  let p = quickPatch("anon", false, s);
  assert.deepEqual(p, { privacyLevel: "off", privacyLevelOn: "strict" });
  s = { ...s, ...p };
  assert.equal(quickState("anon", s), false);
  p = quickPatch("anon", true, s);
  assert.deepEqual(p, { privacyLevel: "strict" });
  // Never switched off before: "on" falls back to the default level.
  assert.deepEqual(quickPatch("anon", true, { privacyLevel: "off" }), { privacyLevel: "balanced" });
  // Already in the asked state: nothing to write.
  assert.deepEqual(quickPatch("anon", true, { privacyLevel: "balanced" }), {});
});

test("light theme and back restores the dark theme and its custom colours", () => {
  const s0 = { theme: "modern", themeColors: { accent: "#ff0066" } };
  const on = quickPatch("light", true, s0);
  assert.equal(on.theme, "light");
  assert.deepEqual(on.themeColors, {});
  const s1 = { ...s0, ...on };
  assert.equal(quickState("light", s1), true);
  assert.deepEqual(quickPatch("light", false, s1), { theme: "modern", themeColors: { accent: "#ff0066" } });
  // Light from the start: "off" lands on the default dark theme.
  assert.deepEqual(quickPatch("light", false, { theme: "light" }), { theme: "dark", themeColors: {} });
});

test("each boolean switch reads its setting with the setting's own default", () => {
  for (const q of QUICK_TOGGLES.filter((x) => x.key)) {
    assert.ok(q.key in DEFAULTS, `${q.id}: ${q.key} is not a known setting`);
    const def = DEFAULTS[q.key];
    assert.equal(quickState(q.id, DEFAULTS), def === true || (q.def && def !== false), `${q.id} default state`);
    assert.deepEqual(quickPatch(q.id, true, DEFAULTS), { [q.key]: true });
    assert.deepEqual(quickPatch(q.id, false, DEFAULTS), { [q.key]: false });
  }
  assert.deepEqual(quickPatch("railRight", true, {}), { railSide: "right" });
});

test("every switch has a label in the dictionary and a detailed control when it names one", async () => {
  const { DICT } = await import("../src/lib/i18n.js");
  const html = readFileSync("src/options/options.html", "utf8");
  for (const q of QUICK_TOGGLES) {
    assert.ok(DICT.en[q.labelKey], q.labelKey);
    if (q.ctl) assert.match(html, new RegExp(`id="${q.ctl}"`), `${q.id} → #${q.ctl}`);
  }
});

test("the page still has a control for every setting it saves", () => {
  // collectSettings() reads these ids; a missing one would silently save a default over the
  // user's value.
  const html = readFileSync("src/options/options.html", "utf8");
  const js = readFileSync("src/options/options.js", "utf8");
  const body = js.slice(js.indexOf("function collectSettings()"), js.indexOf("// Persist theme + custom colours IMMEDIATELY"));
  const ids = [...new Set([...body.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 30, `only ${ids.length} ids found — the scan is broken`);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `#${id} is gone from the page`);
});
