// claude.ai in the Web tab keeps its own menu: inside a frame it asks `window.self !== window.top`
// and, framed, drops its app frame (left menu, past chats) and refuses to sign in. In Hivey's panel
// only, webchat-bridge.js (isolated world, the only one that can tell who frames the page) leaves a
// mark and webchat-top.js (page world) makes `window.self` answer like a top-level page, while the
// bare name `self` stays the page's own window. These tests run both scripts against a fake window.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));
const TOP_JS = readFileSync(join(ROOT, "src/content/webchat-top.js"), "utf8");
const BRIDGE_JS = readFileSync(join(ROOT, "src/content/webchat-bridge.js"), "utf8");

// A fake <html> element: attributes only.
function fakeRoot() {
  const attrs = new Map();
  return {
    attrs,
    hasAttribute: (n) => attrs.has(n),
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    appendChild() {},
  };
}

// A page world: `window` is the realm's global, `top` is another (cross-origin) window that can't
// be redefined, `self` is the browser's own configurable accessor. Inserting an inline <script>
// runs its text as a classic script of the same realm — unless the site's CSP blocks it.
function pageWorld({ marked = true, inlineBlocked = false } = {}) {
  const root = fakeRoot();
  if (marked) root.setAttribute("data-hivey-top", "");
  const ctx = vm.createContext({});
  const TOP = { name: "the sidebar page" };
  ctx.__top = TOP;
  ctx.__root = root;
  vm.runInContext(`
    var window = globalThis;
    Object.defineProperty(globalThis, "top", { value: __top, configurable: false, enumerable: true });
    Object.defineProperty(globalThis, "self", { get() { return globalThis; }, set(v) {}, configurable: true, enumerable: true });
    globalThis.crypto = { getRandomValues() {} };`, ctx);
  ctx.document = {
    documentElement: root,
    head: null,
    createElement: () => ({ textContent: "", remove() {} }),
  };
  root.appendChild = (s) => { if (!inlineBlocked) vm.runInContext(s.textContent, ctx); };
  return { ctx, root, TOP, run: (code) => vm.runInContext(code, ctx) };
}

test("in Hivey's panel, window.self reads as the top window — Claude's framing check says top-level", () => {
  const p = pageWorld();
  p.run(TOP_JS);
  assert.equal(p.run("window.self === window.top"), true, "the framing check");
  assert.equal(p.run("window.self !== window.top"), false, "claude.ai's own spelling of it");
  // A later script of the site: the bare name `self` is still its own window.
  assert.equal(p.run("self === window"), true, "bare self is the page's window");
  assert.equal(p.run("typeof self.crypto"), "object", "self.crypto still reachable");
  p.run("self.__TSR_ROUTER__ = { ok: 1 }");
  assert.equal(p.run("window.__TSR_ROUTER__.ok"), 1, "writing through self lands on the page's window, not on top");
  assert.equal(p.TOP.__TSR_ROUTER__, undefined);
  assert.equal(p.root.attrs.size, 0, "no mark left on the page");
});

test("without the bridge's mark (another site framing claude.ai, a normal tab), nothing changes", () => {
  const p = pageWorld({ marked: false });
  p.run(TOP_JS);
  assert.equal(p.run("window.self === window"), true);
  assert.equal(p.run("window.self === window.top"), false, "Claude's guard against being framed stays whole");
});

test("if the inline script can't run (CSP), window.self is left alone rather than half-done", () => {
  const p = pageWorld({ inlineBlocked: true });
  p.run(TOP_JS);
  assert.equal(p.run("window.self === window"), true);
  assert.equal(p.run("self === window"), true);
});

// ── The isolated bridge decides: only the direct child of OUR extension page gets the mark. ──
function bridgeWorld({ host = "claude.ai", ancestorOrigins, parentHref, parentIsTop = true, firefox = false } = {}) {
  const root = fakeRoot();
  const top = { postMessage() {} };
  const parent = parentIsTop ? top : { postMessage() {} };
  Object.defineProperty(parent, "location", { get() { if (parentHref === undefined) throw new Error("cross-origin"); return { href: parentHref }; } });
  const win = { top, parent, addEventListener() {}, postMessage() {} };
  win.self = win;
  const location = { hostname: host };
  if (ancestorOrigins) location.ancestorOrigins = Object.assign([...ancestorOrigins], { length: ancestorOrigins.length });
  const runtime = { getURL: (p) => (firefox ? "moz-extension://1111-2222/" : "chrome-extension://ourid/") + p };
  const ctx = vm.createContext({
    window: win, location,
    document: { documentElement: root, head: null, createElement: () => ({ textContent: "", remove() {} }) },
    ...(firefox ? { browser: { runtime } } : { chrome: { runtime } }),
  });
  vm.runInContext(BRIDGE_JS, ctx);
  return root.hasAttribute("data-hivey-top");
}

test("the bridge marks claude.ai framed by Hivey's own sidebar (Chromium: ancestorOrigins)", () => {
  assert.equal(bridgeWorld({ ancestorOrigins: ["chrome-extension://ourid"] }), true);
});
test("the bridge marks claude.ai framed by Hivey's own sidebar (Firefox: the parent page's address)", () => {
  assert.equal(bridgeWorld({ firefox: true, parentHref: "moz-extension://1111-2222/src/sidebar/sidebar.html" }), true);
});
test("no mark when someone else frames claude.ai", () => {
  assert.equal(bridgeWorld({ ancestorOrigins: ["https://evil.example"] }), false, "a web site");
  assert.equal(bridgeWorld({ ancestorOrigins: ["chrome-extension://otherid"] }), false, "another extension (e.g. Claude's own side panel)");
  assert.equal(bridgeWorld({ firefox: true }), false, "Firefox, parent unreadable (cross-origin site)");
  assert.equal(bridgeWorld({ firefox: true, parentHref: "moz-extension://9999/x.html" }), false, "Firefox, another extension");
  assert.equal(bridgeWorld({ ancestorOrigins: ["chrome-extension://ourid", "https://evil.example"], parentIsTop: false }), false, "nested deeper");
});
test("no mark on the other providers — only claude.ai needs it", () => {
  assert.equal(bridgeWorld({ host: "chatgpt.com", ancestorOrigins: ["chrome-extension://ourid"] }), false);
  assert.equal(bridgeWorld({ host: "gemini.google.com", firefox: true, parentHref: "moz-extension://1111-2222/src/sidebar/sidebar.html" }), false);
});

test("both manifests run webchat-top.js in the page world, at document_start, right after the bridge, on claude.ai only", () => {
  assert.ok(existsSync(join(ROOT, "src/content/webchat-top.js")));
  for (const m of ["manifest.json", "manifest.chrome.json"]) {
    const cs = json(m).content_scripts;
    const bi = cs.findIndex((c) => c.js.some((j) => j.endsWith("webchat-bridge.js")));
    const ti = cs.findIndex((c) => c.js.some((j) => j.endsWith("webchat-top.js")));
    assert.ok(bi >= 0 && ti > bi, `${m}: listed after the bridge (the bridge leaves the mark first)`);
    const t = cs[ti];
    assert.equal(t.world, "MAIN", m);
    assert.equal(t.run_at, "document_start", m);
    assert.equal(t.all_frames, true, m);
    assert.deepEqual(t.matches, ["https://claude.ai/*"], m);
    assert.equal(cs[bi].run_at, "document_start", m);
  }
});
