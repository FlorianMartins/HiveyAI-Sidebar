// Background (MODULE service worker on Chromium / module background page on
// Firefox). Two jobs:
//   1. Sider-style right-click menus on the page / selection.
//   2. Selection quick-actions (Explain / Translate / Improve / Summarize /
//      Reply) run HERE and stream into a floating bubble drawn ON THE PAGE by
//      the content script — WITHOUT opening the sidebar. Page-level actions
//      (summarise/translate the whole page) and "Open Hivey AI" still use the
//      sidebar.
//
// Running the model in the background (instead of the sidebar) is what lets the
// bubble appear as a page overlay on its own. We reuse the very same provider /
// agent / i18n libs the sidebar uses, so there is no logic duplication.
import "./compat.js";
import { getSettings, setSettings } from "../lib/storage.js";
import { setLang, t } from "../lib/i18n.js";
import { makeProvider } from "../lib/providers.js";
import { keyFor, WRITING_PRESETS, isHivey, hiveyTierFor } from "../lib/models.js";
import { buildSystemPrompt, runConversation } from "../lib/agent.js";
import { effectivePalette } from "../lib/theme.js";
import { registerFrameUnblock } from "../lib/frame-unblock.js";
import { ensurePeriodicAlarm, bubbleMemory } from "../lib/bg-lifetime.js";

// The Web tab's frames: anti-framing headers removed for this add-on's own pages only (see
// lib/frame-unblock.js). Session rules do not survive a browser restart — set again at each start.
const frameUnblock = () => registerFrameUnblock(browser).catch((e) => console.warn("[hivey] frame rule:", e && e.message));
frameUnblock();
browser.runtime.onStartup && browser.runtime.onStartup.addListener(frameUnblock);
browser.runtime.onInstalled.addListener(frameUnblock);

// Context-menu items. Contexts are fixed; titles are localised (English default,
// French when the user picks uiLang="fr" in Settings).
const MENU_ITEMS = [
  // Explicit parent → the submenu shows "Hivey AI" instead of Firefox's auto label (the full
  // extension name). All other items nest under it via parentId (set in buildMenus).
  { id: "ai-root", contexts: ["all"] },
  { id: "ai-open", contexts: ["all"] },
  { id: "ai-summarize-page", contexts: ["page"] },
  { id: "ai-translate-page", contexts: ["page"] },
  { id: "ai-summarize-sel", contexts: ["selection"] },
  { id: "ai-explain", contexts: ["selection"] },
  { id: "ai-translate-sel", contexts: ["selection"] },
  { id: "ai-improve", contexts: ["selection"] },
  { id: "ai-reply", contexts: ["selection", "editable"] },
  { id: "ai-image-context", contexts: ["image"] },
  { id: "ai-pdf-context", contexts: ["link"], targetUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"] },
  { id: "ai-security-sel", contexts: ["selection"] },
  { id: "ai-security-page", contexts: ["page"] },
  { id: "ai-security-link", contexts: ["link"] },
  // Region screenshot from the right-click menu — the gesture grants activeTab, so captureVisibleTab
  // works with NO site-permission dance (which the sidebar button can't do).
  { id: "ai-capture-region", contexts: ["page", "image", "selection"] },
];
const MENU_TITLES = {
  en: {
    "ai-root": "Hivey AI",
    "ai-open": "🐝 Open Hivey AI",
    "ai-summarize-page": "📝 Summarize the page",
    "ai-translate-page": "🌐 Translate the page",
    "ai-summarize-sel": "🗒️ Summarize the selection",
    "ai-explain": "💡 Explain the selection",
    "ai-translate-sel": "🔤 Translate the selection",
    "ai-improve": "✨ Improve the selected text",
    "ai-reply": "↩️ Draft a reply to this text",
    "ai-image-context": "🖼️ Use this image in Hivey AI",
    "ai-pdf-context": "📕 Read this PDF in Hivey AI",
    "ai-security-sel": "🛡️ Analyze for threats (defensive)",
    "ai-security-page": "🛡️ Security analysis of this page",
    "ai-security-link": "🛡️ Check this link (phishing / safety)",
    "ai-capture-region": "📸 Capture an area (screenshot)",
  },
  fr: {
    "ai-root": "Hivey AI",
    "ai-open": "🐝 Ouvrir Hivey AI",
    "ai-summarize-page": "📝 Résumer la page",
    "ai-translate-page": "🌐 Traduire la page",
    "ai-summarize-sel": "🗒️ Résumer la sélection",
    "ai-explain": "💡 Expliquer la sélection",
    "ai-translate-sel": "🔤 Traduire la sélection",
    "ai-improve": "✨ Améliorer le texte sélectionné",
    "ai-reply": "↩️ Rédiger une réponse à ce texte",
    "ai-image-context": "🖼️ Utiliser cette image dans Hivey AI",
    "ai-pdf-context": "📕 Lire ce PDF dans Hivey AI",
    "ai-security-sel": "🛡️ Analyser la menace (défensif)",
    "ai-security-page": "🛡️ Analyse sécurité de la page",
    "ai-security-link": "🛡️ Vérifier ce lien (phishing / sécurité)",
    "ai-capture-region": "📸 Capturer une zone (capture d'écran)",
  },
};

async function buildMenus() {
  let lang = "en";
  try {
    const { uiLang } = await browser.storage.local.get("uiLang");
    lang = uiLang === "fr" ? "fr" : "en";
  } catch (_) {}
  const titles = MENU_TITLES[lang] || MENU_TITLES.en;
  await browser.contextMenus.removeAll();
  for (const m of MENU_ITEMS) {
    const spec = { id: m.id, title: titles[m.id], contexts: m.contexts };
    if (m.id !== "ai-root") spec.parentId = "ai-root"; // nest everything under the "Hivey AI" parent
    if (m.targetUrlPatterns) spec.targetUrlPatterns = m.targetUrlPatterns;
    browser.contextMenus.create(spec);
  }
}

// Map a menu id to a quick-action name. Page-level items pass no text, so the
// sidebar falls back to the current page.
const MENU_ACTION = {
  "ai-summarize-page": "summarize",
  "ai-translate-page": "translate",
  "ai-summarize-sel": "summarize-selection",
  "ai-explain": "explain",
  "ai-translate-sel": "translate",
  "ai-improve": "improve",
  "ai-reply": "reply",
  "ai-security-sel": "security",
  "ai-security-page": "security-page",
  "ai-security-link": "security",
};

// Selection actions that run as a floating ON-PAGE bubble (no sidebar).
const BUBBLE_MENU_IDS = new Set([
  "ai-summarize-sel",
  "ai-explain",
  "ai-translate-sel",
  "ai-improve",
  "ai-reply",
]);

const TRANSLATE_LANGS = [
  "French", "English", "Spanish", "German", "Italian", "Portuguese",
  "Dutch", "Arabic", "Chinese", "Japanese", "Russian",
];

// Files needed to (re)inject the on-page bubble renderer.
const CONTENT_FILES = ["vendor/browser-polyfill.min.js", "src/content/content.js"];

// Cross-browser sidebar open: Firefox exposes sidebarAction; Chromium uses
// sidePanel. We call it synchronously inside the click handler so the user
// gesture is preserved (Chromium requires it).
function openSidebar(tab) {
  try {
    if (typeof browser !== "undefined" && browser.sidebarAction && browser.sidebarAction.open) {
      return browser.sidebarAction.open();
    }
  } catch (_) {}
  // Chromium-only side panel. Reached via bracket access because this file is
  // shared with the Firefox build, whose validator doesn't know the sidePanel API.
  try {
    const cr = (typeof chrome !== "undefined") ? chrome : null;
    const sp = cr && cr["sidePanel"];
    if (sp && sp.open) return sp.open({ windowId: tab && tab.windowId });
  } catch (_) {}
}

// 🩹 Firefox MV3 quirk: when <all_urls> is granted at RUNTIME, tabs.captureVisibleTab keeps throwing
// "Missing activeTab permission" until the extension is RELOADED — the API only picks up the host
// grant on a fresh load (Mozilla Discourse thread 122965). We do that reload ONCE, PROACTIVELY (at
// startup or the moment the grant lands) — never mid-capture — so it can't reset the user's chat or
// interrupt a selection. A persistent flag makes it happen exactly once per grant.
// Firefox only (runtime.getBrowserInfo exists only there): Chromium grants host permissions at
// install and has no such quirk — there the reload only restarted the add-on right after install.
async function reloadOnceForHostGrant(trigger) {
  try {
    if (!browser.runtime || typeof browser.runtime.getBrowserInfo !== "function") return;
    if (!browser.permissions || !browser.permissions.contains || !browser.runtime || !browser.runtime.reload) return;
    const has = await browser.permissions.contains({ origins: ["<all_urls>"] });
    if (!has) return;
    const { _capHostReloaded } = await browser.storage.local.get("_capHostReloaded");
    if (_capHostReloaded) return;
    await browser.storage.local.set({ _capHostReloaded: true });
    browser.runtime.reload();
  } catch (_) {}
}
if (typeof browser !== "undefined" && browser.permissions) {
  reloadOnceForHostGrant("startup");
  if (browser.permissions.onAdded) {
    browser.permissions.onAdded.addListener((perms) => {
      if (perms && Array.isArray(perms.origins) && perms.origins.includes("<all_urls>")) reloadOnceForHostGrant("granted");
    });
  }
}

// Firefox toolbar button = one-click area capture. Clicking a browser action IS a qualifying user
// gesture, so Firefox grants `activeTab` for the tab — which is exactly what captureVisibleTab needs
// and what a button INSIDE the sidebar panel can never obtain. So this icon screenshots reliably,
// with no site-permission prompt, doing the same thing as the right-click "Capture an area".
// Guarded to Firefox (browser.sidebarAction exists there; on Chrome the action opens the side panel
// via openPanelOnActionClick, so this listener never fires).
if (typeof browser !== "undefined" && browser.action && browser.action.onClicked && browser.sidebarAction) {
  browser.action.onClicked.addListener((tab) => {
    openSidebar(tab);
    browser.storage.local.set({ pendingCapture: { ts: Date.now() } });
  });
}

// Fall back to the legacy sidebar path (used on pages we can't overlay).
function fallbackToSidebar(tab, action, text) {
  openSidebar(tab);
  browser.storage.local.set({ pendingAction: { action, text: text || "", ts: Date.now() } });
}

browser.runtime.onInstalled.addListener(() => buildMenus());
// Chromium: the toolbar action — and its keyboard command (_execute_action, Ctrl+Shift+Y) — opens
// the side panel. Set at every start, not only at install: it costs nothing and never goes stale.
try {
  const cr = (typeof chrome !== "undefined") ? chrome : null;
  const sp = cr && cr["sidePanel"];
  if (sp && sp.setPanelBehavior) sp.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch (_) {}
// Rebuild context menus also on browser startup and whenever the UI language changes.
if (browser.runtime.onStartup) browser.runtime.onStartup.addListener(() => buildMenus());
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.uiLang) buildMenus();
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ai-open") {
    openSidebar(tab);
    return;
  }
  // Right-click an image → open the sidebar and hand it the image to use as context (the
  // sidebar fetches the URL and adds it as an attachment on the Image tab).
  if (info.menuItemId === "ai-image-context") {
    openSidebar(tab);
    browser.storage.local.set({ pendingImage: { srcUrl: info.srcUrl || "", ts: Date.now() } });
    return;
  }
  // Right-click a PDF link → open the sidebar and hand it the PDF to read on the PDF tab.
  if (info.menuItemId === "ai-pdf-context") {
    openSidebar(tab);
    browser.storage.local.set({ pendingPdf: { url: info.linkUrl || info.srcUrl || "", ts: Date.now() } });
    return;
  }
  // Right-click a link → defensive check of that URL (phishing/safety) on the Security tab.
  if (info.menuItemId === "ai-security-link") {
    fallbackToSidebar(tab, "security", info.linkUrl || info.srcUrl || "");
    return;
  }
  // Right-click → capture an area. The right-click already granted activeTab for this tab, so the
  // sidebar's captureVisibleTab will work with no site permission. Open the sidebar and queue it.
  if (info.menuItemId === "ai-capture-region") {
    openSidebar(tab);
    browser.storage.local.set({ pendingCapture: { ts: Date.now() } });
    return;
  }
  const action = MENU_ACTION[info.menuItemId];
  if (!action) return;

  // Selection actions → floating bubble on the page, no sidebar.
  if (BUBBLE_MENU_IDS.has(info.menuItemId) && (info.selectionText || "").trim()) {
    runBubble(tab, action, info.selectionText.trim()).catch((e) => console.warn("page bubble failed", e));
    return;
  }

  // Page-level actions still use the sidebar (they need the whole page in the
  // sidebar workspace). Open it FIRST so the user gesture is preserved.
  fallbackToSidebar(tab, action, info.selectionText || "");
});

// --- On-page bubble pipeline ------------------------------------------------
// We hold a single "current bubble" context so the page can ask for a re-run
// (different language / writing preset) via a `bubble_rerun` message. Kept in storage.session, not
// only in memory: the worker is usually stopped between the answer and the user's change of language.
const bubbles = bubbleMemory(browser.storage); // { tabId, action, text }
let bubbleAbort = null;

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(about:|chrome:|edge:|moz-extension:|chrome-extension:|view-source:|data:|https:\/\/addons\.mozilla\.org|https:\/\/chromewebstore\.google\.com|https:\/\/chrome\.google\.com\/webstore)/i.test(url);
}

// Firefox MV3 grants NO host permission at install — host_permissions are opt-in.
// Until the user grants page access, the declarative content script never runs and
// we cannot inject/reach the page, so the bubble fell back to the sidebar EVERY time.
// A right-click (contextMenus.onClicked) is a user gesture, so we may request it here.
// permissions.request() resolves true instantly (no prompt) when already granted.
async function ensureHostPermission() {
  try {
    if (!browser.permissions || !browser.permissions.request) return true;
    return await browser.permissions.request({ origins: ["<all_urls>"] });
  } catch (_) { return false; }
}

// Make sure the content script (which draws the bubble) is present in the tab.
async function ensureContent(tabId) {
  try { await browser.tabs.sendMessage(tabId, { type: "ping" }); return true; } catch (_) {}
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  } catch (_) {
    try { await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES }); }
    catch (_) { return false; }
  }
  for (let i = 0; i < 6; i++) {
    try { await browser.tabs.sendMessage(tabId, { type: "ping" }); return true; }
    catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  return false;
}

function langLabel(v) {
  const l = t("lang." + v);
  return l && l !== "lang." + v ? l : v;
}

function actionRequest(action, text, lang, presetId) {
  switch (action) {
    case "translate":
      return { label: t("rail.translate"), content: t("prompt.translate", { lang, text }), translate: true };
    case "improve":
      return {
        label: t("rail.improve"),
        content: `${t("presetPrompt." + (presetId || "improve"))}\n${t("improve.only")}\n\n${t("improve.textLabel")}\n${text}`,
        improve: true,
      };
    case "summarize-selection":
      return { label: t("label.summarizeSel"), content: t("prompt.summarizeSel", { text }) };
    case "explain":
      return { label: t("label.explain"), content: t("prompt.explain", { text }) };
    case "reply":
      return { label: t("label.reply"), content: t("prompt.reply", { lang, text }) };
    default:
      return null;
  }
}

// Open the bubble on the page and kick off the model. Falls back to the sidebar
// on pages we cannot overlay (browser pages, store pages, …).
async function runBubble(tab, action, text) {
  if (!tab || isRestrictedUrl(tab.url)) { fallbackToSidebar(tab, action, text); return; }
  // Ask for page access FIRST (this call must stay before any other await so the
  // user-gesture from the right-click is preserved). Without it the bubble can never
  // reach the page on Firefox. If the user declines, gracefully use the sidebar.
  if (!(await ensureHostPermission())) { fallbackToSidebar(tab, action, text); return; }
  if (!(await ensureContent(tab.id))) { fallbackToSidebar(tab, action, text); return; }

  await bubbles.save({ tabId: tab.id, action, text });
  const settings = await getSettings();
  setLang(settings.uiLang || "en");
  const pal = effectivePalette(settings.theme || "dark", settings.themeColors);
  const reqInit = actionRequest(action, text, settings.targetLang || "French", settings.improvePreset);
  const langs = reqInit && reqInit.translate ? TRANSLATE_LANGS.map((v) => ({ value: v, label: langLabel(v) })) : null;
  const presets = reqInit && reqInit.improve ? WRITING_PRESETS.map(([id]) => ({ value: id, label: t("preset." + id) })) : null;

  try {
    await browser.tabs.sendMessage(tab.id, {
      type: "bubble_open",
      title: reqInit ? reqInit.label : "",
      source: text,
      note: t("bubble.note"),
      copyLabel: t("bubble.copy"),
      closeLabel: t("close.title"),
      langs, presets,
      currentLang: settings.targetLang || "French",
      currentPreset: settings.improvePreset || "improve",
      accent: pal.accent, accent2: pal.accent2,
    });
  } catch (_) { fallbackToSidebar(tab, action, text); return; }

  runBubbleModel();
}

async function runBubbleModel() {
  const last = await bubbles.load();
  if (!last) return;
  const { tabId, action, text } = last;
  const send = (m) => { browser.tabs.sendMessage(tabId, m).catch(() => {}); };
  const settings = await getSettings();
  setLang(settings.uiLang || "en");
  const lang = settings.targetLang || "French";
  const req = actionRequest(action, text, lang, settings.improvePreset);
  if (!req) return;

  const providerId = settings.provider;
  if (!keyFor(providerId, settings) && providerId !== "ollama" && providerId !== "lmstudio") {
    send({ type: "bubble_error", error: t("err.noKeyModel") });
    return;
  }

  if (bubbleAbort) { try { bubbleAbort.abort(); } catch (_) {} }
  bubbleAbort = new AbortController();
  send({ type: "bubble_reset" });

  let raw = "";
  // Resolve a 🐝 Hivey pseudo-model (e.g. hivey/hybrid) to a REAL model for this task — the bubble
  // path doesn't go through the chat dispatcher, so we'd otherwise send an invalid model id → 400.
  const bubbleMode = action === "translate" ? "translate" : action === "improve" ? "improve" : "chat";
  let effSettings = settings;
  const chosen = settings.models && settings.models[settings.provider];
  if (isHivey(chosen)) {
    const sel = String(hiveyTierFor(chosen, bubbleMode, text) || "");
    const bar = sel.indexOf("|");
    const provId = bar > 0 ? sel.slice(0, bar) : settings.provider;
    const modId = bar > 0 ? sel.slice(bar + 1) : sel;
    if (modId && !isHivey(modId)) {
      effSettings = { ...settings, provider: provId, models: { ...settings.models, [provId]: modId } };
    }
  }
  const system = buildSystemPrompt({
    agentMode: false, targetLang: lang, responseLang: settings.responseLang,
    mode: bubbleMode, blockPayments: settings.blockPayments, artifacts: false,
  });

  // Build the list of models to try. On a FREE model via OpenRouter, rotate through a few free
  // fallbacks when one is upstream rate-limited (429) — so the right-click quick actions keep working
  // without a paid key (that was the "translate/summarize don't work on Free" breakage).
  const FREE_FALLBACKS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-4-31b-it:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "openai/gpt-oss-20b:free",
  ];
  const primary = String((effSettings.models && effSettings.models[effSettings.provider]) || "");
  // Rotate free fallbacks ONLY when the RESOLVED model is genuinely free (":free"). A chosen provider
  // model or a paid Hivey tier is used AS-IS — the quick actions respect the user's model choice.
  const isFreeOR = effSettings.provider === "openrouter" && /:free$/i.test(primary);
  const candidates = isFreeOR ? [...new Set([primary || FREE_FALLBACKS[0], ...FREE_FALLBACKS])] : [primary];

  let lastErr = null;
  for (const modelId of candidates) {
    if (bubbleAbort.signal.aborted) return;
    raw = "";
    send({ type: "bubble_reset" });
    try {
      const runSettings = { ...effSettings, models: { ...effSettings.models, [effSettings.provider]: modelId } };
      const provider = makeProvider(runSettings, { thinking: false, webSearch: false });
      await runConversation({
        provider, system,
        history: [{ role: "user", content: req.content }],
        tools: [],
        onText: (d) => { raw += d; send({ type: "bubble_delta", text: d }); },
        onThink: () => {},
        signal: bubbleAbort.signal,
      });
      send({ type: "bubble_done", raw });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      lastErr = e;
      const rl = /\b429\b|rate.?limit|temporarily rate-limited|quota/i.test(String((e && e.message) || ""));
      if (!rl || raw) break; // non-rate-limit error, or we already streamed some text → stop rotating
    }
  }
  send({ type: "bubble_error", error: (lastErr && lastErr.message) ? lastErr.message : String(lastErr || "failed") });
}

// The on-page bubble asks for a re-run when the user changes its language / style.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "bubble_rerun") return;
  (async () => {
    if (!(await bubbles.load())) return;
    if (msg.lang) await setSettings({ targetLang: msg.lang });
    if (msg.preset) await setSettings({ improvePreset: msg.preset });
    runBubbleModel();
  })();
});

// Hivey Code (app.hivey.be) asks — via the page bridge — to open the sidebar's own settings, so
// the two products share one settings page (theme/colours/providers).
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "hivey-open-options") return;
  try { browser.runtime.openOptionsPage(); } catch (_) {}
});

// ----- 🔔 Page-change monitoring --------------------------------------------
// Watch a set of URLs and notify the user when a page's visible text changes (price / availability
// watch). All local: we fetch the page from the background on a periodic alarm, hash its text, and
// compare to the last hash. No third-party service.
const WATCH_KEY = "pageWatches";

function textHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200000);
}
async function getWatches() {
  const { [WATCH_KEY]: list } = await browser.storage.local.get(WATCH_KEY);
  return Array.isArray(list) ? list : [];
}
async function setWatches(list) {
  await browser.storage.local.set({ [WATCH_KEY]: list });
}
async function checkWatches() {
  const list = await getWatches();
  if (!list.length) return;
  let changed = false;
  for (const w of list) {
    try {
      const res = await fetch(w.url, { credentials: "omit", cache: "no-store" });
      if (!res.ok) continue;
      const hash = textHash(stripHtml(await res.text()));
      if (w.hash && hash !== w.hash) {
        w.changedAt = Date.now();
        try {
          browser.notifications.create("hiveyWatch:" + w.url, {
            type: "basic",
            iconUrl: browser.runtime.getURL("icons/icon.svg"),
            title: "Page changed",
            message: (w.title || w.url).slice(0, 80),
          });
        } catch (_) {}
      }
      if (w.hash !== hash) { w.hash = hash; w.checkedAt = Date.now(); changed = true; }
    } catch (_) {
      // unreachable page — skip this round
    }
  }
  if (changed) await setWatches(list);
}

try {
  if (browser.alarms) {
    // Created once, not at every start of the worker (that restarted its 15-minute countdown).
    ensurePeriodicAlarm(browser.alarms, "hiveyPageWatch", 15).catch(() => {});
    browser.alarms.onAlarm.addListener((a) => { if (a && a.name === "hiveyPageWatch") checkWatches(); });
  }
} catch (_) {}

// Clicking a change notification opens the page.
try {
  if (browser.notifications && browser.notifications.onClicked) {
    browser.notifications.onClicked.addListener((id) => {
      if (id && id.startsWith("hiveyWatch:")) {
        const url = id.slice("hiveyWatch:".length);
        try { browser.tabs.create({ url }); } catch (_) {}
        try { browser.notifications.clear(id); } catch (_) {}
      }
    });
  }
} catch (_) {}

// 🛡 Security-header analysis of a URL. Extension fetches (with host permission) expose ALL response
// headers, so we can inspect CSP / HSTS / X-Frame-Options / etc. — 100% defensive, read-only.
const SEC_HEADER_CHECKS = [
  { key: "content-security-policy", label: "Content-Security-Policy", why: "Mitigates XSS & data injection by restricting sources." },
  { key: "strict-transport-security", label: "Strict-Transport-Security (HSTS)", why: "Forces HTTPS, blocks protocol-downgrade attacks." },
  { key: "x-content-type-options", label: "X-Content-Type-Options", why: "Stops MIME-type sniffing (should be 'nosniff')." },
  { key: "x-frame-options", label: "X-Frame-Options", why: "Prevents clickjacking (or use CSP frame-ancestors)." },
  { key: "referrer-policy", label: "Referrer-Policy", why: "Limits referrer leakage to third parties." },
  { key: "permissions-policy", label: "Permissions-Policy", why: "Restricts powerful browser features (camera, geolocation…)." },
  { key: "cross-origin-opener-policy", label: "Cross-Origin-Opener-Policy", why: "Isolates the browsing context (Spectre-class defense)." },
];
async function analyzeHeaders(url) {
  const res = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "follow" });
  const headers = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const checks = SEC_HEADER_CHECKS.map((c) => ({
    label: c.label,
    present: headers[c.key] != null,
    value: headers[c.key] || "",
    why: c.why,
  }));
  const score = Math.round((checks.filter((c) => c.present).length / checks.length) * 100);
  return { url: res.url || url, status: res.status, score, checks, server: headers["server"] || "" };
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "headers:analyze" || !msg.url) return;
  analyzeHeaders(msg.url)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});

// DeepSearch source reader: fetch an arbitrary URL and return its plain text. Runs in the
// background (extension context) so it bypasses CORS via the <all_urls> host permission. Only
// static HTML is read (no JS execution); credentials are omitted. Used to deep-read the best
// sources found during a DeepSearch run.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "fetch:page" || !msg.url) return;
  (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(msg.url, { credentials: "omit", cache: "no-store", redirect: "follow", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return sendResponse({ ok: false, error: "HTTP " + res.status });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();
      const text = /text\/html|application\/xhtml/i.test(ct) ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim().slice(0, 200000);
      sendResponse({ ok: true, url: res.url || msg.url, text });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true;
});

// Screenshot the visible tab FROM THE BACKGROUND. captureVisibleTab called from the sidebar/popup
// context can fail with "Missing activeTab permission" even when <all_urls> is granted (the sidebar
// isn't a tab, so the activeTab fallback the API reaches for isn't in effect). The background page
// runs with the extension's host permissions directly, so it captures reliably via <all_urls>.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "capture:visible") return;
  (async () => {
    try {
      const opts = { format: msg.format || "png" };
      const dataUrl = msg.windowId != null
        ? await browser.tabs.captureVisibleTab(msg.windowId, opts)
        : await browser.tabs.captureVisibleTab(opts);
      sendResponse({ ok: true, dataUrl });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true;
});

// Watch / unwatch / list, driven from the sidebar.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type || !msg.type.startsWith("watch:")) return;
  (async () => {
    const list = await getWatches();
    if (msg.type === "watch:add" && msg.url) {
      if (!list.some((w) => w.url === msg.url)) {
        list.push({ url: msg.url, title: msg.title || msg.url, addedAt: Date.now(), hash: "" });
        await setWatches(list);
        checkWatches(); // seed the initial hash right away
      }
      sendResponse({ ok: true, watching: true });
    } else if (msg.type === "watch:remove" && msg.url) {
      await setWatches(list.filter((w) => w.url !== msg.url));
      sendResponse({ ok: true, watching: false });
    } else if (msg.type === "watch:list") {
      sendResponse({ ok: true, watches: list });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

// The document_start frame script asks, on EVERY page load, whether its tab is currently under
// agent control — so it can redraw the control frame instantly without waiting for the sidebar.
// The sidebar keeps the set of glowed tabs (+ theme accents) in storage.session.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "agent_glow_query") return;
  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId == null) { sendResponse({ on: false }); return true; }
  browser.storage.session
    .get("hiveyGlowTabs")
    .then((d) => {
      const map = (d && d.hiveyGlowTabs) || {};
      const e = map[tabId];
      sendResponse(e ? { on: true, accent: e.accent, accent2: e.accent2 } : { on: false });
    })
    .catch(() => sendResponse({ on: false }));
  return true; // async sendResponse
});
