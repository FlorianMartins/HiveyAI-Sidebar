// Tests for the translations.
//
// A missing key is not a crash — `t()` falls back to English and then to the RAW KEY, so the
// failure mode is silent and purely visual: the user sees `opt.qa.h` printed where a label
// should be, or an interface that is half English. Nothing in the build catches that, which is
// how four of the six advertised languages came to be ~45% translated while still being
// advertised as supported. These tests make the gap fail loudly instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DICT, t } from "../src/lib/i18n.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(p)) out.push(p);
  }
  return out;
}

// Every key the UI actually asks for. Keys built by concatenation (`t("lang." + code)`) leave a
// bare prefix behind, which is not a key — those are dropped rather than reported as missing.
const USED = (() => {
  const keys = new Set();
  for (const f of walk(SRC)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-html|-title|-ph)?="([^"]+)"/g)) keys.add(m[1]);
  }
  return [...keys].filter((k) => !/[._]$/.test(k)).sort();
})();

const LANGS = Object.keys(DICT);

test("the UI asks for a substantial number of keys (the scan itself still works)", () => {
  // Guards the test, not the product: a regex that silently stops matching would make every
  // assertion below pass vacuously.
  assert.ok(USED.length > 500, `only ${USED.length} keys found — the extraction is probably broken`);
});

test("English defines every key the UI asks for", () => {
  // English is the last fallback. A key missing HERE is rendered as its own name on screen.
  const missing = USED.filter((k) => DICT.en[k] == null);
  assert.deepEqual(missing, [], `${missing.length} key(s) would render as raw identifiers`);
});

for (const lang of LANGS) {
  test(`${lang} translates every key the UI asks for`, () => {
    const missing = USED.filter((k) => DICT[lang][k] == null);
    assert.deepEqual(
      missing.slice(0, 12), [],
      `${lang} is missing ${missing.length} key(s) — the interface falls back to English there`,
    );
  });
}

test("no translation is left as an untranslated copy of the English string", () => {
  // Identical strings are legitimate for names and symbols ("Wisebase", "PDF", "↻"), so only
  // flag long prose that was clearly never translated.
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const copies = USED.filter((k) => {
      const en = String(DICT.en[k] ?? "");
      return en.length > 45 && DICT[lang][k] === DICT.en[k];
    });
    assert.deepEqual(copies.slice(0, 5), [], `${lang}: ${copies.length} long string(s) identical to English`);
  }
});

test("every placeholder in a translation exists in the English original", () => {
  // `{n}`, `{lang}`, `{title}`… are substituted by name. A renamed or invented placeholder is
  // printed literally to the user, braces and all.
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const bad = [];
  for (const lang of LANGS.filter((l) => l !== "en")) {
    for (const k of USED) {
      if (DICT[lang][k] == null) continue;
      if (ph(DICT[lang][k]) !== ph(DICT.en[k])) bad.push(`${lang}/${k}: "${ph(DICT[lang][k])}" vs EN "${ph(DICT.en[k])}"`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), []);
});

test("markup inside a translated string is preserved", () => {
  // A few strings carry <b>…</b>. Dropping the tag in translation loses the emphasis; breaking
  // it leaks raw markup into the panel.
  const tags = (s) => (String(s).match(/<\/?[a-z]+>/g) || []).sort().join("");
  for (const lang of LANGS.filter((l) => l !== "en")) {
    for (const k of USED) {
      if (DICT[lang][k] == null || !/[<>]/.test(String(DICT.en[k]))) continue;
      assert.equal(tags(DICT[lang][k]), tags(DICT.en[k]), `${lang}/${k} changed its markup`);
    }
  }
});

test("no dictionary entry is empty", () => {
  for (const lang of LANGS) {
    for (const k of USED) {
      const v = DICT[lang][k];
      if (v == null) continue;
      assert.notEqual(String(v).trim(), "", `${lang}/${k} is empty`);
    }
  }
});

test("t() substitutes variables and leaves unknown ones visible", () => {
  const out = t("search.allHead", { n: 3 });
  assert.match(out, /3/);
  // An unsupplied variable stays as `{x}` rather than becoming "undefined" in the interface.
  assert.match(t("search.allHead", {}), /\{n\}/);
});

test("t() returns the key itself for an unknown key rather than throwing", () => {
  assert.equal(t("this.key.does.not.exist"), "this.key.does.not.exist");
});
