// Hivey Browser's side panel contract (src/lib/embed.js): `?embed=hivey` hides the workspace rail,
// `#mode=<id>` selects a workspace exactly as a click on its rail tab would. The browser's Hivey bar
// is built on these two promises, so a drift on either side fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { isHiveyEmbed, applyEmbedClass, modeFromHash, bindWorkspaceHash, EMBED_CLASS } from "../src/lib/embed.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// LF everywhere: a Windows checkout has CRLF line ends.
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const HTML = read("src/sidebar/sidebar.html");
const JS = read("src/sidebar/sidebar.js");
const CSS = read("src/sidebar/sidebar.css");
const RAIL_TABS = [...HTML.matchAll(/class="railtab[^"]*" data-mode="([^"]+)"/g)].map((m) => m[1]);
const RAIL_MODES = JSON.parse(/const RAIL_MODES = (\[[^\]]*\]);/.exec(JS)[1]);

const fakeRoot = () => { const set = new Set(); return { classList: { add: (c) => set.add(c), contains: (c) => set.has(c) } }; };

// Run the early classic script as the page would, against a given query string.
function runEarly(search) {
  const root = fakeRoot();
  vm.runInNewContext(read("src/sidebar/embed-early.js"), { location: { search }, document: { documentElement: root }, URLSearchParams });
  return root.classList.contains(EMBED_CLASS);
}

const SEARCHES = ["?embed=hivey", "?tab=1&embed=hivey", "", "?embed=HIVEY", "?embed=other", "?embed=", "?tab=1", "?embedx=hivey"];

test("?embed=hivey — and only that — is the embedded mode", () => {
  assert.equal(isHiveyEmbed("?embed=hivey"), true);
  assert.equal(isHiveyEmbed("?tab=1&embed=hivey"), true);
  for (const s of ["", null, undefined, "?embed=HIVEY", "?embed=other", "?embed=", "?tab=1", "?embedx=hivey"]) {
    assert.equal(isHiveyEmbed(s), false, String(s));
  }
});

test("the embed class goes on the root only when embedded, and twice is harmless", () => {
  const on = fakeRoot();
  assert.equal(applyEmbedClass(on, "?embed=hivey"), true);
  assert.equal(applyEmbedClass(on, "?embed=hivey"), true);
  assert.equal(on.classList.contains("embed-hivey"), true);
  const off = fakeRoot();
  assert.equal(applyEmbedClass(off, ""), false);
  assert.equal(off.classList.contains("embed-hivey"), false);
});

test("the early script sets the same class on the same condition as isHiveyEmbed", () => {
  for (const s of SEARCHES) assert.equal(runEarly(s), isHiveyEmbed(s), s);
});

test("the early script runs before the stylesheets paint, as a classic script (no inline code)", () => {
  const head = HTML.slice(0, HTML.indexOf("</head>"));
  const early = head.indexOf('<script src="embed-early.js"></script>');
  assert.ok(early > 0, "embed-early.js is loaded in <head>");
  assert.ok(early < head.indexOf('rel="stylesheet"'), "before the first stylesheet");
  assert.doesNotMatch(HTML, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline script (CSP: script-src 'self')");
  assert.match(JS, /const IS_EMBED = applyEmbedClass\(document\.documentElement, location\.search\);/);
});

test("embedded, the rail and what only serves it are hidden; the rail never peeks or pins", () => {
  for (const sel of ["#rail", "#railResize", "#railAddMenu", ".rail-confirm"]) {
    assert.match(CSS, new RegExp(`html\\.embed-hivey ${sel.replace(".", "\\.")}[^{]*\\{ display: none !important; \\}`), sel);
  }
  assert.match(JS, /function railPeek\(on\) \{\n {2}if \(IS_EMBED\) return;/);
  assert.match(JS, /classList\.toggle\("rail-pinned", !IS_EMBED && !settings\.railHidden\)/);
  assert.match(JS, /function toggleRail\(\) \{\n {2}if \(IS_EMBED\) return;/, "the saved pin state is not flipped");
});

test("#mode=<id> names a workspace; unknown or empty is ignored", () => {
  assert.equal(modeFromHash("#mode=agent", RAIL_MODES), "agent");
  assert.equal(modeFromHash("mode=web", RAIL_MODES), "web");
  assert.equal(modeFromHash("#mode=mcp&n=2", RAIL_MODES), "mcp", "extra fragment params do not matter");
  for (const h of ["#mode=nope", "#mode=code", "#mode=", "#mode", "#", "", null, undefined, "#chat", "#mode=Chat"]) {
    assert.equal(modeFromHash(h, RAIL_MODES), null, String(h));
  }
});

test("every rail tab can be selected from the fragment", () => {
  assert.deepEqual([...RAIL_TABS].sort(), [...RAIL_MODES].sort(), "RAIL_MODES = the rail's data-mode values");
  for (const m of RAIL_TABS) assert.equal(modeFromHash("#mode=" + m, RAIL_MODES), m);
});

test("the fragment selects on load and on every hashchange, through the given path", () => {
  const listeners = {};
  const win = { location: { hash: "#mode=translate" }, addEventListener: (ev, fn) => { listeners[ev] = fn; } };
  const picked = [];
  assert.equal(bindWorkspaceHash(win, RAIL_MODES, (m) => picked.push(m)), "translate");
  win.location.hash = "#mode=pdf"; listeners.hashchange();
  win.location.hash = "#mode=unknown"; listeners.hashchange();
  win.location.hash = ""; listeners.hashchange();
  win.location.hash = "#mode=web"; listeners.hashchange();
  assert.deepEqual(picked, ["translate", "pdf", "web"]);
  const none = { location: { hash: "" }, addEventListener() {} };
  assert.equal(bindWorkspaceHash(none, RAIL_MODES, () => assert.fail("nothing to select")), null);
});

test("the fragment and a rail tab click take the same selection path", () => {
  assert.match(JS, /b\.addEventListener\("click", \(\) => selectWorkspace\(b\.dataset\.mode\)\);/, "the click goes through selectWorkspace");
  assert.match(JS, /bindWorkspaceHash\(window, RAIL_MODES, \(m\) => selectWorkspace\(m\)\);/, "so does the fragment");
  // selectWorkspace leaves the rail's customization alone: it never writes railOrder / railTabsHidden.
  const body = /selectWorkspace = \(m\) => \{([\s\S]*?)\n {2}\};/.exec(JS)[1];
  assert.doesNotMatch(body, /railOrder|railTabsHidden|setSettings/);
  assert.match(body, /openWebPanel\(\)/);
  assert.match(body, /setMode\(m\)/);
  // The fragment is read after the saved workspace is restored, so it wins on load.
  assert.ok(JS.indexOf("bindWorkspaceHash(window") > JS.indexOf("setMode(IS_TAB && CHAT_MODES.includes(_urlMode)"));
});
