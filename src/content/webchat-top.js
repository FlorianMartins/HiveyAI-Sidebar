// Hivey — claude.ai in the Web tab, with Claude's own menu. Runs in the PAGE's world ("world":
// "MAIN"), at document_start, right after webchat-bridge.js, before any of the site's scripts.
//
// WHY: claude.ai asks one shared helper — `window.self !== window.top` — whether it is framed, and
// when it is it renders without its app frame: no left menu (« Show sidebar », past chats), no
// Ctrl+K, and signed out it refuses to sign in (« This page can't run in an embedded view »).
// Firefox's native sidebar loads claude.ai as a top-level page, which is why the menu is there.
//
// HOW: window.top can't be redefined (unforgeable), window.self can ([Replaceable]): it now returns
// window.top, so the check reads "top-level". The bare global name `self` is the site's handle on its
// own window (it writes self.__TSR_ROUTER__, reads self.crypto…) and window.top is a cross-origin
// window it may not touch: a global `let self` keeps that name on the real window — a global let
// shadows the window property for every later script and module of the page. Only `window.self`
// (and `globalThis.self`), the spelling of a framing check, change.
//
// ONLY in Hivey's own panel: the page world can't tell who frames it, the isolated bridge can, and
// leaves the data-hivey-top mark when it is us. Without the mark (another site framing claude.ai,
// a top-level tab), nothing changes and Claude's guard against being framed stays whole.
(function () {
  var root = document.documentElement;
  if (!root || !root.hasAttribute("data-hivey-top")) return;
  root.removeAttribute("data-hivey-top");
  var w = window;
  // 1. The global `let self`, through an inline script (our DNR ruleset strips the site CSP). If it
  //    doesn't run, stop: redefining window.self without it would hand the site a window it can't use.
  try {
    var s = document.createElement("script");
    s.textContent = "let self = window; document.documentElement.setAttribute('data-hivey-self', '');";
    (document.head || root).appendChild(s);
    s.remove();
  } catch (_) {}
  if (!root.hasAttribute("data-hivey-self")) return;
  root.removeAttribute("data-hivey-self");
  // 2. window.self answers like a top-level page.
  try {
    Object.defineProperty(w, "self", { configurable: true, enumerable: true, get: function () { return w.top; }, set: function () {} });
  } catch (_) {}
})();
