// Hivey "web chats" bridge — runs INSIDE the embedded provider pages (Gemini, Claude,
// ChatGPT, Copilot, Mistral) ONLY when framed (inside the Hivey sidebar's web panel).
//
// It lets Hivey's overlay tools (Page / Element / Capture / Tabs) attach context to the
// provider's chat AS A REAL FILE UPLOAD (the way the "+" button works) or inline text.
//
// KEY POINT: on Firefox a File created in the content-script world is rejected by the page's
// <input type=file> (security boundary). So the actual DOM work is done by a tiny script we
// inject into the PAGE's own world (allowed because our DNR rule strips the site's CSP). The
// page-world script builds the File in the page principal and uploads it reliably. The file is
// an in-memory Blob — never written to disk, discarded right after the site reads it.
(function () {
  try {
    if (window.top === window.self) return; // only inside our embed
  } catch (_) {}
  // claude.ai: let it show its own menu (see webchat-top.js, which runs next in the PAGE's world and
  // answers its framing check like a top-level page). Only in OUR panel, which only this isolated
  // world can tell: the mark is set before any of the site's scripts run and removed at once.
  try {
    if (/(^|\.)claude\.ai$/.test(location.hostname) && inHiveyPanel()) document.documentElement.setAttribute("data-hivey-top", "");
  } catch (_) {}

  // Tell the sidebar this frame really holds the provider's page — a frame that loads without this
  // hello is the browser's "can't open this page" error, and the sidebar offers a tab instead.
  try { if (window.parent === window.top) window.parent.postMessage({ __hiveyWeb: "hello" }, "*"); } catch (_) {}

  // True only when this page is the direct child of Hivey's own sidebar page — never when some other
  // site frames it (the provider's "can't run embedded" guard protects against clickjacking there).
  // Chromium names the parent's origin (location.ancestorOrigins); Firefox doesn't have that list, but
  // lets a content script read its own extension page's address.
  function inHiveyPanel() {
    var api = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
    var base = api && api.runtime && api.runtime.getURL ? api.runtime.getURL("") : "";
    if (!base || window.parent !== window.top) return false;
    try {
      var ao = location.ancestorOrigins;
      if (ao && ao.length) return ao.length === 1 && base.indexOf(ao[0] + "/") === 0;
    } catch (_) {}
    try { return String(window.parent.location.href).indexOf(base) === 0; } catch (_) { return false; }
  }

  // The page-world worker lives in webchat-pw.js, declared with "world": "MAIN" in the manifests:
  // an inline <script> injected from here is refused by Chromium's MV3 policy (« Executing inline
  // event handler violates the following Content Security Policy directive »), so on Chrome and
  // Brave nothing reached the site's composer.

  // Relay context from the sidebar (our parent) to the page-world worker.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || e.source !== window.parent || d.__hiveyWeb !== "paste") return;
    try { window.postMessage({ __hiveyPW: 1, text: d.text, imageDataUrl: d.imageDataUrl, textFile: d.textFile }, "*"); } catch (_) {}
    try { window.parent.postMessage({ __hiveyWeb: "pasted", ok: true }, "*"); } catch (_) {}
  });
})();
