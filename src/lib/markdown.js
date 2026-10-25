import { setHTML } from "./dom.js";
import { t } from "./i18n.js";
// Markdown rendering (marked + DOMPurify) and "artifacts" (HTML/SVG preview,
// Mermaid diagrams). Artifacts run inside sandboxed iframes (opaque origin): the
// model-generated code can reach neither the extension, the pages, nor the API
// keys — and the extension's CSP does not constrain it there.
//
// marked and DOMPurify are loaded as globals via <script> in sidebar.html.

let afCounter = 0;
let mermaidLibPromise = null;
// Artifact mode (toggled in the composer). When OFF, code is shown as plain copyable
// blocks instead of being auto-rendered as a live interactive preview.
let artifactsLive = true;
export function setArtifactsLive(on) { artifactsLive = on !== false; }

// Judge0 (compile & run) config, set from the sidebar's settings. When an endpoint is
// configured, code blocks in compiled languages get a "Compile & run" button.
let judge0Cfg = { endpoint: "", key: "" };
export function setJudge0Config(c) { judge0Cfg = { endpoint: (c && c.endpoint) || "", key: (c && c.key) || "" }; }

// File-language → regex matching the Judge0 language name (resolved to a numeric id at
// run time from the instance's /languages, so it works across Judge0 versions).
const JUDGE0_LANGS = {
  c: /^c\s*\(/i, cpp: /c\+\+/i, "c++": /c\+\+/i, cc: /c\+\+/i, cxx: /c\+\+/i,
  rust: /rust/i, rs: /rust/i, go: /\bgo\b/i, golang: /\bgo\b/i,
  python: /python/i, py: /python/i, java: /\bjava\b/i, csharp: /c#|mono|\.net/i, cs: /c#|mono|\.net/i,
  ruby: /ruby/i, rb: /ruby/i, php: /php/i, kotlin: /kotlin/i, kt: /kotlin/i,
  swift: /swift/i, dart: /dart/i, scala: /scala/i, haskell: /haskell/i, hs: /haskell/i,
  perl: /perl/i, pl: /perl/i, lua: /lua/i, bash: /bash/i, sh: /bash/i, sql: /sql/i,
  typescript: /typescript/i, ts: /typescript/i,
};
function judge0Headers(base, key) {
  const h = {};
  if (!key) return h;
  if (/rapidapi\.com/i.test(base)) {
    h["X-RapidAPI-Key"] = key;
    try { h["X-RapidAPI-Host"] = new URL(base).host; } catch (_) {}
  } else {
    h["X-Auth-Token"] = key;
  }
  return h;
}
// Compile & run a code block on Judge0 and show the output inside `slot`.
async function runJudge0Block(source, lang, slot, btn) {
  const re = JUDGE0_LANGS[lang];
  if (!judge0Cfg.endpoint || !re) return;
  const base = judge0Cfg.endpoint.replace(/\/+$/, "");
  const headers = judge0Headers(base, judge0Cfg.key);
  const orig = btn ? btn.textContent : "";
  if (btn) { btn.textContent = "…"; btn.disabled = true; }
  slot.style.display = "";
  setHTML(slot, '<pre class="j0-out">' + escapeHtml(isFr() ? "Compilation & exécution sur Judge0…" : "Compiling & running on Judge0…") + "</pre>");
  try {
    const langs = await (await fetch(base + "/languages", { headers })).json();
    const matches = (Array.isArray(langs) ? langs : []).filter((l) => re.test(l.name || "")).sort((a, b) => b.id - a.id);
    if (!matches.length) throw new Error("no Judge0 language matches ." + lang);
    const res = await fetch(base + "/submissions?base64_encoded=false&wait=true", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ source_code: source, language_id: matches[0].id, stdin: "" }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
    const r = await res.json();
    let out = "";
    if (r.compile_output) out += "[compile]\n" + r.compile_output + "\n";
    if (r.stdout) out += r.stdout;
    if (r.stderr) out += (out ? "\n" : "") + "[stderr]\n" + r.stderr;
    if (!out && r.message) out = r.message;
    out += "\n\n[" + ((r.status && r.status.description) || "?") + " · " + (r.time ?? "?") + "s · " + (r.memory ?? "?") + " KB · " + matches[0].name + "]";
    setHTML(slot, '<pre class="j0-out">' + escapeHtml(out) + "</pre>");
  } catch (e) {
    const msg = "Judge0: " + (e && e.message ? e.message : String(e)) +
      (isFr() ? "\n(vérifiez l'endpoint/clé dans Réglages ; l'instance doit autoriser le CORS)" : "\n(check the endpoint/key in Settings; the instance must allow CORS)");
    setHTML(slot, '<pre class="j0-out err">' + escapeHtml(msg) + "</pre>");
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

function getMermaidLib() {
  if (!mermaidLibPromise) {
    mermaidLibPromise = fetch(browser.runtime.getURL("vendor/mermaid.min.js")).then((r) =>
      r.text()
    );
  }
  return mermaidLibPromise;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Which artifact frames have actually reported back (i.e. their scripts RAN). Used
// to detect a CSP-blocked preview and offer the "open in a tab" fallback.
const reportedArtifacts = new Set();
// Resize artifact iframes that report their own height.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || !d.__artifact) return;
  // Only trust messages that actually come from one of OUR artifact iframes. They're sandboxed with
  // an OPAQUE origin (e.origin === "null"), so we can't match on origin — we match the source window
  // against the live artifact frames instead. Without this, any frame/window with a reference could
  // spoof {__artifact} to resize an iframe or suppress the "open in a tab" fallback.
  let fromArtifact = false;
  const frames = document.querySelectorAll("iframe.artifact-frame");
  for (const fr of frames) { if (fr.contentWindow === e.source) { fromArtifact = true; break; } }
  if (!fromArtifact) return;
  reportedArtifacts.add(d.id);
  const f = document.querySelector(`iframe[data-aid="${d.id}"]`);
  if (f) f.style.height = Math.min(d.h + 8, 900) + "px";
});

export function configureMarkdown() {
  if (window.marked && window.marked.setOptions) {
    window.marked.setOptions({ gfm: true, breaks: true });
  }
  // Links: open in a new tab with a safe rel.
  if (window.DOMPurify) {
    window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
}

export function renderMarkdown(raw) {
  const html = window.marked ? window.marked.parse(raw || "") : escapeHtml(raw || "");
  return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
}

const REPORTER = (id) =>
  `<script>function __r(){try{parent.postMessage({__artifact:1,id:${JSON.stringify(
    id
  )},h:document.documentElement.scrollHeight},'*')}catch(e){}}` +
  `window.addEventListener('load',function(){__r();setTimeout(__r,300);setTimeout(__r,1200)});<\/script>`;

// The artifact "runner": a tiny static page served from hivey.be (a real https origin
// whose CSP we control and made permissive). Inside an extension page, EVERY local
// scheme for a framed document (srcdoc / blob: / data:) inherits the extension's strict
// `script-src 'self'` CSP, so the artifact's scripts never run. Framing a real https
// origin escapes that: the runner's document uses hivey.be's permissive CSP. The
// artifact HTML is handed to the runner LOCALLY via postMessage — it never touches the
// server (only the static runner is fetched). The frame stays sandboxed (opaque origin),
// so the artifact can't reach the extension, the page or the user's keys.
const RUNNER_URL = "https://hivey.be/artifact-runner.html";
function makeFrame(srcdoc, { sandbox, initialHeight }) {
  const id = "af" + ++afCounter;
  const f = document.createElement("iframe");
  f.className = "artifact-frame";
  f.dataset.aid = id;
  f.setAttribute("sandbox", sandbox || "");
  f.style.height = (initialHeight || 160) + "px";
  // Hand the artifact to the runner via the URL fragment (#h=…): it's read on load (no
  // postMessage race) and a fragment is NEVER sent to the server. For a doc too big for a
  // URL (e.g. a bundled lib), fall back to postMessage after the runner signals ready.
  const encoded = encodeURIComponent(srcdoc);
  if (encoded.length < 1800000) {
    f.src = RUNNER_URL + "#h=" + encoded;
  } else {
    f.src = RUNNER_URL;
    let sent = false;
    const send = () => {
      if (sent || !f.contentWindow) return;
      // targetOrigin MUST stay "*": this frame is sandboxed with an OPAQUE origin, which can't be
      // named as a targetOrigin. Safe here — the payload is (model-generated) artifact HTML, not a
      // secret, and it's sent to a specific frame window we just created.
      try { f.contentWindow.postMessage({ type: "pg-artifact-render", html: srcdoc }, "*"); sent = true; } catch (_) {}
    };
    f.addEventListener("load", () => setTimeout(send, 20));
    const onReady = (e) => {
      // Only react to the ready-signal from THIS artifact's own frame (not any window that can post).
      if (e.source === f.contentWindow && e.data && e.data.type === "pg-artifact-ready") { send(); window.removeEventListener("message", onReady); }
    };
    window.addEventListener("message", onReady);
  }
  return f;
}

// Interactive languages = real Claude-style artifacts the user can USE/PLAY.
const INTERACTIVE = ["html", "jsx", "tsx", "react", "babel"];
const GAME_SANDBOX = "allow-scripts allow-modals allow-pointer-lock allow-popups allow-forms";

// Wrap a bare HTML fragment into a full document; pass full documents through.
function asHtmlDocument(code) {
  if (/<!doctype/i.test(code) || /<html[\s>]/i.test(code)) return code;
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>body{margin:0;font-family:system-ui;background:#fff;color:#111}</style></head>` +
    `<body>${code}</body></html>`
  );
}

// React/JSX artifact runtime, à la Claude: React + ReactDOM + Babel transpile the
// component in-browser, inside the sandboxed iframe. The libraries are fetched by
// the isolated iframe only (not by the extension) and only when such an artifact
// is shown. The model is asked to define a component named `App`.
function reactShell(code, id) {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>body{margin:0;font-family:system-ui;background:#fff;color:#111}#root{min-height:40px}` +
    `.err{color:#b00;padding:10px;white-space:pre-wrap;font:12px ui-monospace}</style>` +
    `<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>` +
    `<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>` +
    `<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>` +
    `</head><body><div id="root"></div>` +
    `<script type="text/babel" data-presets="react">\n${code}\n` +
    `;(function(){try{var C=(typeof App!=='undefined')?App:(typeof Component!=='undefined'?Component:null);` +
    `var r=document.getElementById('root');if(C&&!r.hasChildNodes()){ReactDOM.createRoot(r).render(React.createElement(C));}}` +
    `catch(e){document.body.innerHTML='<div class=err>'+(e&&e.message?e.message:e)+'</div>';}})();<\/script>` +
    REPORTER(id) +
    `</body></html>`
  );
}

// Build the full artifact document for a given language.
function buildArtifactDoc(code, lang, id) {
  if (lang === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:10px;background:#fff}</style></head><body>${code}${REPORTER(id)}</body></html>`;
  }
  if (lang === "jsx" || lang === "tsx" || lang === "react" || lang === "babel") {
    return reactShell(code, id);
  }
  // html (interactive app / game)
  return asHtmlDocument(code) + REPORTER(id);
}

function renderPreview(slot, code, lang) {
  const id = "af" + (afCounter + 1);
  const srcdoc = buildArtifactDoc(code, lang, id);
  // The runner itself needs allow-scripts to receive the artifact (even SVG, whose own
  // content has no scripts), so every artifact uses the same sandbox set.
  const sandbox = GAME_SANDBOX;
  const initialHeight = lang === "svg" ? 260 : 380;
  const f = makeFrame(srcdoc, { sandbox, initialHeight });
  slot.textContent = "";
  slot.appendChild(f);
  // SVG has no scripts (nothing to report). For interactive artifacts, if the frame
  // never reports back within a moment, its scripts were blocked by the extension CSP
  // (some Firefox builds enforce it on framed documents). In that case surface a big
  // "Run in a new tab" action — a TOP-LEVEL data: document runs on its own opaque
  // origin with NO inherited CSP, so the artifact is fully playable there.
  if (lang !== "svg") {
    setTimeout(() => {
      if (reportedArtifacts.has(id)) return; // scripts ran — nothing to do
      f.style.display = "none"; // the embedded frame is script-dead — replace it
      const note = document.createElement("div");
      note.className = "artifact-note";
      note.textContent = RUN_HINT();
      const run = document.createElement("button");
      run.className = "artifact-run";
      run.textContent = "▶ " + RUN_LABEL();
      run.addEventListener("click", () => openArtifact(code, lang));
      slot.appendChild(note);
      slot.appendChild(run);
    }, 2600);
  }
}
// Localised labels for the fallback "run in a tab" button (en/fr, picked from <html lang>).
function isFr() { try { return (document.documentElement.lang || "").toLowerCase().startsWith("fr"); } catch (_) { return false; } }
function RUN_LABEL() { return isFr() ? "Lancer dans un onglet" : "Run in a new tab"; }
function OPEN_TAB_LABEL() { return isFr() ? "Ouvrir dans un onglet" : "Open in a new tab"; }

// A clean call-to-action card shown in place of an interactive artifact: clicking it
// opens the artifact full-size in a new tab (where it's fully interactive).
function makeOpenCard(code, lang) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "artifact-open-card";
  const icon = document.createElement("span");
  icon.className = "artifact-open-icon";
  icon.textContent = "▶";
  const txt = document.createElement("span");
  txt.className = "artifact-open-text";
  const title = document.createElement("span");
  title.className = "artifact-open-title";
  title.textContent = OPEN_TAB_LABEL();
  const sub = document.createElement("span");
  sub.className = "artifact-open-sub";
  sub.textContent = isFr() ? "Aperçu interactif en plein écran" : "Full-screen interactive preview";
  txt.appendChild(title);
  txt.appendChild(sub);
  const arrow = document.createElement("span");
  arrow.className = "artifact-open-arrow";
  arrow.textContent = "↗";
  card.appendChild(icon);
  card.appendChild(txt);
  card.appendChild(arrow);
  card.addEventListener("click", () => openArtifact(code, lang));
  return card;
}
function RUN_HINT() { return isFr() ? "L'aperçu intégré n'a pas pu démarrer — ouvre l'artifact jouable dans un onglet." : "The inline preview couldn't start — open the playable artifact in a tab."; }

// The theme's own colours, read where the sidebar draws (a diagram used to sit on a white page, unreadable
// on a dark theme). Mermaid needs plain colours, so the CSS variables are resolved here.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
  const light = !!(document.body && document.body.classList.contains("theme-light"));
  return {
    light,
    bg: v("--bg", light ? "#f6f7fb" : "#0f111a"), panel: v("--panel-2", light ? "#eef0f6" : "#262a40"),
    text: v("--text", light ? "#18181b" : "#f8fafc"), muted: v("--muted", "#9aa0b4"),
    accent: v("--accent", "#8b5cf6"), accent2: v("--accent-2", "#6366f1"), border: v("--border", "#3a3f5a"),
  };
}
// A diagram, drawn in the theme's colours, that zooms (− / + / ⟲, Ctrl+wheel or pinch) and pans
// (drag) — inline and when opened in a tab.
function mermaidDoc(code, lib, id, c) {
  const vars = JSON.stringify({
    darkMode: !c.light, background: c.bg, fontFamily: "system-ui, sans-serif",
    primaryColor: c.panel, primaryTextColor: c.text, primaryBorderColor: c.accent,
    secondaryColor: c.panel, secondaryTextColor: c.text, secondaryBorderColor: c.accent2,
    tertiaryColor: c.bg, tertiaryTextColor: c.text, tertiaryBorderColor: c.border,
    lineColor: c.muted, textColor: c.text, mainBkg: c.panel, nodeBorder: c.accent, clusterBkg: c.bg,
    clusterBorder: c.border, titleColor: c.text, edgeLabelBackground: c.bg, noteBkgColor: c.panel, noteTextColor: c.text,
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;background:${c.bg};color:${c.text};font-family:system-ui,sans-serif}` +
    `#vp{position:relative;overflow:hidden;min-height:120px;cursor:grab;touch-action:none}#vp.drag{cursor:grabbing}` +
    `#st{transform-origin:0 0;padding:12px;display:inline-block}` +
    `#zm{position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:2}` +
    `#zm button{width:26px;height:26px;border-radius:7px;border:1px solid ${c.border};background:${c.panel};color:${c.text};font:600 14px system-ui;cursor:pointer;padding:0}` +
    `#zm button:hover{border-color:${c.accent}}.err{color:#e5484d;font-size:13px;padding:10px}</style>` +
    `<script>${lib}<\/script></head><body><div id="vp"><div id="zm"><button id="zo" title="−">−</button>` +
    `<button id="zr" title="100 %">⟲</button><button id="zi" title="+">+</button></div>` +
    `<div id="st"><pre class="mermaid">${escapeHtml(code)}</pre></div></div>` +
    `<script>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:${vars}});` +
    `mermaid.run().then(function(){var vp=document.getElementById('vp'),st=document.getElementById('st'),s=1,x=0,y=0,d=null;` +
    `function ap(){st.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';}` +
    `function z(f,cx,cy){var n=Math.min(6,Math.max(0.25,s*f));cx=cx==null?vp.clientWidth/2:cx;cy=cy==null?vp.clientHeight/2:cy;x=cx-(cx-x)*n/s;y=cy-(cy-y)*n/s;s=n;ap();}` +
    `document.getElementById('zi').onclick=function(){z(1.25);};document.getElementById('zo').onclick=function(){z(0.8);};` +
    `document.getElementById('zr').onclick=function(){s=1;x=0;y=0;ap();};` +
    `vp.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();var r=vp.getBoundingClientRect();z(e.deltaY<0?1.12:0.89,e.clientX-r.left,e.clientY-r.top);},{passive:false});` +
    `vp.addEventListener('pointerdown',function(e){if(e.target.closest('#zm'))return;d={px:e.clientX,py:e.clientY,x:x,y:y};vp.classList.add('drag');vp.setPointerCapture(e.pointerId);});` +
    `vp.addEventListener('pointermove',function(e){if(!d)return;x=d.x+e.clientX-d.px;y=d.y+e.clientY-d.py;ap();});` +
    `vp.addEventListener('pointerup',function(){d=null;vp.classList.remove('drag');});` +
    `vp.addEventListener('dblclick',function(){s=1;x=0;y=0;ap();});})` +
    `.catch(function(e){document.body.innerHTML='<div class=err>Mermaid : '+(e&&e.message?e.message:e)+'</div>';});<\/script>` +
    REPORTER(id) + `</body></html>`;
}
async function renderMermaid(slot, code) {
  slot.textContent = isFr() ? "Rendu du diagramme…" : "Drawing the diagram…";
  const lib = await getMermaidLib();
  // makeFrame will bump afCounter to this id; the reporter uses the same one.
  const id = "af" + (afCounter + 1);
  const f = makeFrame(mermaidDoc(code, lib, id, themeColors()), { sandbox: "allow-scripts", initialHeight: 200 });
  slot.textContent = "";
  slot.appendChild(f);
}

function toolbarButton(label, onClick) {
  const b = document.createElement("button");
  b.className = "code-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// Open an artifact full-size in its OWN browser tab. We navigate to a TOP-LEVEL
// `data:` document: it gets a fresh opaque origin with NO inherited CSP, so the
// artifact's scripts run and it's fully interactive — unlike an embedded frame, whose
// document inherits the strict extension CSP. tabs.create is the reliable path for an
// extension (content-initiated top-level data: navigations are blocked, ours are not).
function openArtifact(code, lang) {
  // A diagram opens as a diagram (it used to be handed over as an HTML page).
  if (lang === "mermaid") { getMermaidLib().then((lib) => openArtifactDoc(mermaidDoc(code, lib, "open", themeColors()))); return; }
  openArtifactDoc(buildArtifactDoc(code, lang, "open"));
}
function openArtifactDoc(doc) {
  // Open the runner in a new tab (real https origin → scripts run). The artifact rides
  // in the URL fragment, so it never hits the server. We can't navigate a tab to
  // data:/blob: (Firefox blocks top-level data:; blob:moz-extension keeps the strict CSP).
  const encoded = encodeURIComponent(doc);
  if (encoded.length < 1800000) {
    try { window.open(RUNNER_URL + "#h=" + encoded, "_blank"); return; } catch (_) {}
  }
  // Large doc → open the runner then postMessage it.
  let win = null;
  try { win = window.open(RUNNER_URL, "_blank"); } catch (_) {}
  if (!win) return;
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    // Real top-level window at a real origin → target it explicitly (not "*") so the artifact HTML
    // can't leak to a different origin if the tab navigated away.
    try { win.postMessage({ type: "pg-artifact-render", html: doc }, "https://hivey.be"); } catch (_) {}
    if (tries >= 25) clearInterval(iv);
  }, 180);
  setTimeout(() => clearInterval(iv), 5000);
}

function artifactLabel(lang) {
  if (lang === "mermaid") return "✨ " + t("code.diagram");
  if (lang === "svg") return "✨ SVG";
  if (INTERACTIVE.includes(lang)) return "✨ " + t("code.interactive");
  return lang || "code";
}

// Turn <pre><code> blocks into toolbar'd code blocks and Claude-style artifacts.
// Interactive HTML/JSX render automatically inside a sandboxed iframe the user can
// actually use and PLAY (games, apps, simulations), with an Aperçu/Code toggle and
// an "Ouvrir" button for full screen. Mermaid renders diagrams; other languages
// stay as a copyable code block.
export function enhanceArtifacts(container) {
  const codes = container.querySelectorAll("pre > code");
  for (const code of codes) {
    const pre = code.parentElement;
    if (pre.dataset.enhanced) continue;
    pre.dataset.enhanced = "1";

    const lang = ([...code.classList].find((c) => c.startsWith("language-")) || "").slice(9);
    // Artifact mode OFF → no live preview; everything stays a plain copyable code block.
    const isInteractive = artifactsLive && INTERACTIVE.includes(lang); // html / jsx / …
    const isPreviewable = isInteractive || (artifactsLive && lang === "svg");
    const isMermaid = artifactsLive && lang === "mermaid";
    const isArtifact = isPreviewable || isMermaid;

    const wrap = document.createElement("div");
    wrap.className = isArtifact ? "code-wrap artifact" : "code-wrap";
    const bar = document.createElement("div");
    bar.className = "code-bar";
    const tag = document.createElement("span");
    tag.className = "code-lang";
    tag.textContent = artifactLabel(lang);
    bar.appendChild(tag);

    const slot = document.createElement("div");
    slot.className = "artifact-slot";

    if (isPreviewable) {
      pre.style.display = "none";
      if (isInteractive) {
        // Interactive apps/games: instead of embedding the live preview, show a clean
        // call-to-action card that opens the artifact full-size in a new tab (where it's
        // fully interactive/playable).
        slot.appendChild(makeOpenCard(code.textContent, lang));
      } else {
        // SVG: render inline (static, no tab needed).
        renderPreview(slot, code.textContent, lang);
      }
      const toggle = toolbarButton("</> Code", () => {
        const showingCode = pre.style.display !== "none";
        pre.style.display = showingCode ? "none" : "";
        slot.style.display = showingCode ? "" : "none";
        toggle.textContent = showingCode ? "</> Code" : isInteractive ? "👁 Artifact" : "👁 Aperçu";
      });
      bar.appendChild(toggle);
      bar.appendChild(toolbarButton("⤢ Ouvrir", () => openArtifact(code.textContent, lang)));
    }

    // Compiled-language code (C/C++/Rust/Go/Python/Java…): a "Compile & run" button that
    // executes it on the configured Judge0 instance and shows the output in the slot.
    if (!isArtifact && judge0Cfg.endpoint && JUDGE0_LANGS[lang]) {
      const runBtn = toolbarButton("▶ " + (isFr() ? "Compiler & exécuter" : "Compile & run"), () => {
        runJudge0Block(code.textContent, lang, slot, runBtn);
      });
      runBtn.classList.add("j0-run-btn");
      bar.appendChild(runBtn);
    }

    // In the interface's language (it was French whatever the language).
    const copy = toolbarButton(t("code.copy"), () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        copy.textContent = t("code.copied");
        setTimeout(() => (copy.textContent = t("code.copy")), 1500);
      });
    });
    bar.appendChild(copy);

    pre.replaceWith(wrap);
    wrap.appendChild(bar);
    wrap.appendChild(pre);
    wrap.appendChild(slot);

    if (isMermaid) {
      pre.style.display = "none";
      renderMermaid(slot, code.textContent);
    }
  }
}
