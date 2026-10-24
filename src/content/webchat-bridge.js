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
  // Tell the sidebar this frame really holds the provider's page — a frame that loads without this
  // hello is the browser's "can't open this page" error, and the sidebar offers a tab instead.
  try { if (window.parent === window.top) window.parent.postMessage({ __hiveyWeb: "hello" }, "*"); } catch (_) {}

  // ── Page-world worker (stringified & injected). Self-contained: no outer refs. ──
  function HIVEY_PW() {
    function deepAll(sel) {
      var out = [];
      (function w(r) {
        try {
          r.querySelectorAll(sel).forEach(function (e) { out.push(e); });
          r.querySelectorAll("*").forEach(function (e) { if (e.shadowRoot) w(e.shadowRoot); });
        } catch (_) {}
      })(document);
      return out;
    }
    function bestComposer() {
      var c = deepAll('textarea,[contenteditable="true"],[contenteditable=""],input[type=text]');
      var el = null, best = -1;
      c.forEach(function (x) {
        var r; try { r = x.getBoundingClientRect(); } catch (_) { return; }
        if (!r || r.width < 60 || r.height < 14) return;
        var a = r.width * r.height; if (a > best) { best = a; el = x; }
      });
      var af = document.activeElement;
      if (af && (af.isContentEditable || af.tagName === "TEXTAREA" || af.tagName === "INPUT")) return af;
      return el || c[0] || null;
    }
    function dataUrlToFile(u, n) {
      try {
        var p = u.split(","), m = (p[0].match(/data:([^;]+)/) || [])[1] || "image/png";
        var b = atob(p[1]), a = new Uint8Array(b.length);
        for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
        return new File([a], n, { type: m });
      } catch (_) { return null; }
    }
    function acceptOk(acc, f) {
      if (!acc) return true;
      var a = acc.toLowerCase(); if (a.indexOf("*/*") >= 0) return true;
      var ext = "." + (f.name.split(".").pop() || "").toLowerCase(), t = (f.type || "").toLowerCase();
      return a.split(",").map(function (s) { return s.trim(); }).some(function (tok) {
        if (!tok) return false;
        if (tok[0] === ".") return tok === ext;
        if (tok.slice(-2) === "/*") return t.indexOf(tok.slice(0, -1)) === 0;
        return tok === t;
      });
    }
    // Set the hidden <input type=file> (the "+" button). Returns false if there's no input.
    function inputFile(f) {
      var inputs = deepAll("input[type=file]");
      if (!inputs.length) return false;
      var ord = inputs.filter(function (i) { return acceptOk(i.getAttribute("accept"), f); })
        .concat(inputs.filter(function (i) { return !acceptOk(i.getAttribute("accept"), f); }));
      for (var i = 0; i < ord.length; i++) {
        try {
          var dt = new DataTransfer(); dt.items.add(f);
          ord[i].files = dt.files;
          ord[i].dispatchEvent(new Event("input", { bubbles: true }));
          ord[i].dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        } catch (_) {}
      }
      return false;
    }
    // Drag-and-drop the file onto the composer (bubbles to the app's drop zone). Used by
    // Gemini & Mistral, which take dropped files rather than exposing a usable file input.
    function dropFile(f) {
      try {
        var t = bestComposer() || document.body;
        var dt = new DataTransfer(); dt.items.add(f);
        ["dragenter", "dragover", "drop"].forEach(function (ty) {
          var ev; try { ev = new DragEvent(ty, { bubbles: true, cancelable: true }); }
          catch (_) { ev = new Event(ty, { bubbles: true, cancelable: true }); }
          try { Object.defineProperty(ev, "dataTransfer", { value: dt }); } catch (_) {}
          t.dispatchEvent(ev);
        });
        return true;
      } catch (_) { return false; }
    }
    function pasteFile(f) {
      try {
        var t = bestComposer() || document.body;
        var dt = new DataTransfer(); dt.items.add(f);
        var ev; try { ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); }
        catch (_) { ev = new Event("paste", { bubbles: true, cancelable: true }); }
        try { Object.defineProperty(ev, "clipboardData", { value: dt }); } catch (_) {}
        t.dispatchEvent(ev);
        return true;
      } catch (_) { return false; }
    }
    // Per-site method order (avoids double-attach: the first method that "takes" wins).
    function attachFile(f, isImage) {
      var host = location.hostname;
      var siteDrop = /gemini\.google\.com$/.test(host) || /(^|\.)mistral\.ai$/.test(host);
      var methods = isImage
        ? [pasteFile, dropFile, inputFile]
        : (siteDrop ? [dropFile, inputFile, pasteFile] : [inputFile, dropFile, pasteFile]);
      for (var i = 0; i < methods.length; i++) { try { if (methods[i](f)) return true; } catch (_) {} }
      return false;
    }
    function insertText(t) {
      var el = bestComposer(); if (!el) return false;
      try {
        el.focus();
        var done = false;
        try { done = !!(document.execCommand && document.execCommand("insertText", false, t)); } catch (_) {}
        if (!done && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
          var s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
          var nx = (el.value ? el.value + "\n" : "") + t;
          if (s && s.set) s.set.call(el, nx); else el.value = nx;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      } catch (_) { return false; }
    }
    window.addEventListener("message", function (e) {
      var d = e.data; if (!d || !d.__hiveyPW) return;
      if (d.imageDataUrl) { var f = dataUrlToFile(d.imageDataUrl, "screenshot.png"); if (f) attachFile(f, true); }
      else if (d.textFile) { try { attachFile(new File([d.textFile.content], d.textFile.name || "context.txt", { type: "text/plain" }), false); } catch (_) {} }
      else if (d.text) { insertText(d.text); }
    });
  }

  // Inject the page-world worker (our DNR ruleset strips the site CSP, so inline is allowed).
  try {
    var s = document.createElement("script");
    s.textContent = "(" + HIVEY_PW.toString() + ")();";
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (_) {}

  // Relay context from the sidebar (our parent) to the page-world worker.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || e.source !== window.parent || d.__hiveyWeb !== "paste") return;
    try { window.postMessage({ __hiveyPW: 1, text: d.text, imageDataUrl: d.imageDataUrl, textFile: d.textFile }, "*"); } catch (_) {}
    try { window.parent.postMessage({ __hiveyWeb: "pasted", ok: true }, "*"); } catch (_) {}
  });
})();
