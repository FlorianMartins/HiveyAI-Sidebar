// Sidebar UI controller.
//
// Workspaces ("modes"): chat / translate / improve / image. A single unified model
// picker sits just above the composer and lists ONLY the models of connected
// providers (a key set, an OAuth account, or a running local server) — fetched
// live from each provider's /models endpoint so it reflects what is actually
// available. Comparison is done per-message (a "Comparer" button on the latest
// answer). Conversations are kept locally for privacy.

import { getSettings, setSettings, onSettingsChanged } from "../lib/storage.js";
import { parsePcap } from "../lib/pcap.js";
import { makeProvider, listModels, listOpenRouterRich, generateImage, transcribeAudio, transcribeAudioViaChat } from "../lib/providers.js";
import { buildSystemPrompt, activeTools, runConversation } from "../lib/agent.js";
import { SKILLS, GOAL_SYSTEM, ENHANCE_SYSTEM, skillById } from "../lib/skills.js";
import { executeTool, setAgentTab, clearAgentTab, getAgentTab } from "../lib/tools.js";
import { initBenchmarkView } from "../lib/benchmarkView.js";
import { configureMarkdown, renderMarkdown, enhanceArtifacts, setArtifactsLive, setJudge0Config } from "../lib/markdown.js";
import { PROVIDERS, PROVIDER_ORDER, modelFor, keyFor, connectedProviders, defaultSearchModel, IMAGE_SIZES, WRITING_PRESETS, WRITING_TONES, WRITING_LENGTHS, NO_LENGTH_PRESETS, HIVEY_AUTO, HIVEY_VARIANTS, hiveyTiers, hiveyTierFor, hiveyHeuristicKey, hiveyLabelKey, hiveyRouterModel, HIVEY_ROUTER_SYSTEM, isHivey } from "../lib/models.js";
import { categoryForMode, categoryLabel, modelScore } from "../lib/benchmarks.js";
import { connectOpenRouter } from "../lib/auth.js";
import { applyTheme, effectivePalette, applyFont, withOpacity } from "../lib/theme.js";
import { t, setLang, applyDom, getLang } from "../lib/i18n.js";
import { PROMPT_CATEGORIES, BUILTIN_PROMPTS, builtinText, builtinTitle } from "../lib/prompts.js";
import { SHORTCUT_ACTIONS, defaultShortcuts, comboFromEvent } from "../lib/shortcuts.js";
import { downloadMarkdown, printConversation } from "../lib/exportConversation.js";
import {
  listConversations, getConversation, saveConversation, deleteConversation,
  newConversationId, titleFrom, togglePinned, conversationMatches,
} from "../lib/history.js";
import { setHTML } from "../lib/dom.js";

const $ = (id) => document.getElementById(id);
// Are we running as a standalone full-screen TAB (vs the docked sidebar)? The
// "open in a tab" button appends ?tab=1; we hide that button when already in a tab.
const IS_TAB = new URLSearchParams(location.search).get("tab") === "1";
const els = {
  benchmarkView: $("benchmarkView"),
  bvSources: $("bvSources"),
  bvSearch: $("bvSearch"),
  bvOnlyGap: $("bvOnlyGap"),
  bvRun: $("bvRun"),
  bvStop: $("bvStop"),
  bvProgress: $("bvProgress"),
  bvBody: $("bvBody"),
  modelInput: $("modelInput"),
  modelMenu: $("modelMenu"),
  modelWrap: $("modelWrap"),
  modelConnect: $("modelConnect"),
  expandTab: $("expandTab"),
  brand: $("brandToggle"),
  attachBtn: $("attachBtn"),
  composerMain: $("composerMain"),
  toolsLeft: $("toolsLeft"),
  attachInput: $("attachInput"),
  attachStrip: $("attachStrip"),
  dropOverlay: $("dropOverlay"),
  searchBtn: $("searchBtn"),
  searchBar: $("searchBar"),
  searchInput: $("searchInput"),
  searchCount: $("searchCount"),
  searchPrev: $("searchPrev"),
  searchNext: $("searchNext"),
  searchClose: $("searchClose"),
  searchResults: $("searchResults"),
  modelFilterBtn: $("modelFilterBtn"),
  modelFilterPanel: $("modelFilterPanel"),
  filterProviders: $("filterProviders"),
  filterReset: $("filterReset"),
  filterClose: $("filterClose"),
  freeConnect: $("freeConnect"),
  emptyOptions: $("emptyOptions"),
  historyBtn: $("historyBtn"),
  newChat: $("newChat"),
  openOptions: $("openOptions"),
  webChatsChip: $("webChatsChip"),
  webHeadCtl: $("webHeadCtl"),
  webToolsSlot: $("webToolsSlot"),
  cmdChips: $("cmdChips"),
  cmdPalette: $("cmdPalette"),
  webPanel: $("webPanel"),
  webHivey: $("webHivey"),
  webHiveyBtn: $("webHiveyBtn"),
  webHiveyMenu: $("webHiveyMenu"),
  webNewChat: $("webNewChat"),
  webProv: $("webProv"),
  webProvBtn: $("webProvBtn"),
  webProvLabel: $("webProvLabel"),
  webProvDot: $("webProvDot"),
  webProvMenu: $("webProvMenu"),
  webFrame: $("webFrame"),
  webOverlay: $("webOverlay"),
  webOvToggle: $("webOvToggle"),
  webOvMenu: $("webOvMenu"),
  webInjectEl: $("webInjectEl"),
  webInjectPage: $("webInjectPage"),
  webInjectShot: $("webInjectShot"),
  webInjectTabs: $("webInjectTabs"),
  webTabsMenu: $("webTabsMenu"),
  webTabsList: $("webTabsList"),
  webTabsSend: $("webTabsSend"),
  webHint: $("webHint"),
  webOpenTab: $("webOpenTab"),
  closeWeb: $("closeWeb"),
  historyPanel: $("historyPanel"),
  historySearch: $("historySearch"),
  historyList: $("historyList"),
  clearHistory: $("clearHistory"),
  deleteSelected: $("deleteSelected"),
  closeHistory: $("closeHistory"),
  pageBar: $("pageBar"),
  pageToggle: $("pageToggle"),
  selPageToggle: $("selPageToggle"),
  pageTitle: $("pageTitle"),
  watchBtn: $("watchBtn"),
  secHeadersBtn: $("secHeadersBtn"),
  secRecipes: $("secRecipes"),
  pickEl: $("pickEl"),
  captureRegion: $("captureRegion"),
  tabsBtn: $("tabsBtn"),
  tabsPanel: $("tabsPanel"),
  tabsList: $("tabsList"),
  tabsClose: $("tabsClose"),
  tabsClear: $("tabsClear"),
  messages: $("messages"),
  empty: $("empty"),
  emptyOnboard: $("emptyOnboard"),
  emptyGreeting: $("emptyGreeting"),
  emptyLogo: $("emptyLogo"),
  emptyFeatures: $("emptyFeatures"),
  input: $("input"),
  stop: $("stop"),
  rail: $("rail"),
  railAddBtn: $("railAddBtn"),
  railAddMenu: $("railAddMenu"),
  codeView: $("codeView"),
  openCodeApp: $("openCodeApp"),
  codeAppUrlLabel: $("codeAppUrlLabel"),
  controls: $("controls"),
  chatControls: $("chatControls"),
  translateControls: $("translateControls"),
  improveControls: $("improveControls"),
  imageControls: $("imageControls"),
  pdfControls: $("pdfControls"),
  pdfFile: $("pdfFile"),
  pdfInfo: $("pdfInfo"),
  pdfSummarize: $("pdfSummarize"),
  pdfImages: $("pdfImages"),
  pdfText: $("pdfText"),
  thinking: $("thinking"),
  artifactMode: $("artifactMode"),
  webSearch: $("webSearch"),
  deepSearch: $("deepSearch"),
  deepSeg: $("deepSeg"),
  pageCtx: $("pageCtx"),
  autoScroll: $("autoScroll"),
  verifyAnswers: $("verifyAnswers"),
  dictateBtn: $("dictateBtn"),
  translateLang: $("translateLang"),
  improvePreset: $("improvePreset"),
  improveTone: $("improveTone"),
  wisebaseControls: $("wisebaseControls"),
  wbScope: $("wbScope"),
  wbManageBtn: $("wbManageBtn"),
  wbAddPageBtn: $("wbAddPageBtn"),
  imageSize: $("imageSize"),
  confirmBar: $("confirmBar"),
  confirmText: $("confirmText"),
  confirmAllow: $("confirmAllow"),
  confirmDeny: $("confirmDeny"),
};

let settings;
let history = [];        // provider-native message array (multi-turn continuation)
let transcript = [];     // UI transcript for local history
let convId = newConversationId();
let abortController = null;
let currentPage = null;
let busy = false;
let mode = "chat";
// OpenRouter models discovered to be genuinely DEAD on this account (404 / no endpoint /
// data-policy gated). Session-only: removed from the picker as we hit them, reset on reload —
// so after fixing the account they all come back. NOTE: a transient 429 (rate limit) must NOT
// go here — that would permanently hide a perfectly good free model. Those use orCooldown.
const orUnavailable = new Set();
// The real model Hivey last routed/rotated to — kept for a DISCREET badge tooltip only, never a
// thread message (#6: the user must never see "model switched / connected / cooldown" in the chat).
let lastRoutedModel = null;
// Free models that just hit a rate limit (429). This is TRANSIENT: the model stays VISIBLE in
// the picker and the user's selection is NOT changed; we merely avoid auto-picking/rotating to
// it for a short cooldown so the very next turn doesn't immediately 429 again. Auto-expires.
const orCooldown = new Map(); // id -> expiry timestamp (ms)
const OR_COOLDOWN_MS = 90 * 1000;
function coolDown(id, ms = OR_COOLDOWN_MS) { if (id) orCooldown.set(id, Date.now() + ms); }
function isCooled(id) {
  const exp = orCooldown.get(id);
  if (!exp) return false;
  if (Date.now() >= exp) { orCooldown.delete(id); return false; }
  return true;
}

// PDF workspace state: a LIST of loaded documents (multi-PDF context). Each entry
// is { name, text, pages, doc }. The user can add more PDFs at any time.
let pdfs = [];
let pdfWorkerSet = false;
const PDF_BUDGET = 24000; // chars of PDF text passed to the model as supporting context
// Last primary turn (to re-run on another model for the "compare" button).
let lastUserContent = "";
let lastRunMode = "chat";
let lastForceWeb = false;


// Composer attachments (files/images the AI gets as context). Transient — bound to
// the next message, cleared after a send or when switching workspace. Each entry:
//   image: { type:"image", name, dataUrl, mediaType }
//   text : { type:"text",  name, text, isPdf?, pages? }
let attachments = [];
const ATT_IMG_MAX_MB = 10;   // an image bigger than this is rejected (base64 bloat / API limits)
const ATT_TXT_MAX_MB = 25;   // a text/PDF file bigger than this is rejected
const ATT_TXT_BUDGET = 16000; // chars of EACH attached text file folded into the prompt

// Searchable model combobox (main picker). `mainValue` holds the selected
// "providerId|modelId"; `mainCombo` renders the floating, type-to-filter list.
// The price/provider filter persists in settings.
let mainValue = "";
let mainCombo = null;
let filterPersistTimer = null;

// Per-workspace isolation: Chat, Agent, Translate, Improve and Image each keep
// their OWN live conversation AND their own saved-conversation history (the two
// are distinct). Terminal and Code have dedicated panes and are not chat-area
// modes. We swap the live globals (history/transcript/convId/…) in and out of a
// per-mode session whenever the workspace changes.
const CHAT_MODES = ["chat", "agent", "translate", "improve", "image", "pdf", "security", "wisebase"];
const sessions = {}; // mode -> { history, transcript, convId, lastUserContent, lastRunMode, lastForceWeb, toggles }
// The composer toggles (Thinking / Artifacts / Web / Page) are PER-TAB: each workspace
// keeps its own. We seed every new tab from the startup defaults (captured once, before
// any user toggling) so turning Thinking on in Chat never leaks into Agent or the others.
let initialToggles = null;
// ── Thinking levels ─────────────────────────────────────────────────────────
// The Thinking chip is a CYCLING button with three levels: off → high → max → off.
//   off  = no reasoning (fast, cheap) · high = deep reasoning · max = maximum budget.
// We keep the current level in the chip's data-level attribute (single source of truth)
// and persist it as settings.thinkLevel (per-tab in each session's toggles).
const THINK_LEVELS = ["off", "high", "max"];
function thinkLevelNorm(v) {
  if (v === "high" || v === "max" || v === "off") return v;
  return v ? "high" : "off"; // back-compat with the old boolean `thinking`
}
function getThink(el) { return thinkLevelNorm(el && el.dataset ? el.dataset.level : "off"); }
function setThink(el, lvl) {
  lvl = thinkLevelNorm(lvl);
  if (!el) return lvl;
  el.dataset.level = lvl;
  el.classList.toggle("active", lvl !== "off");
  el.setAttribute("aria-pressed", lvl !== "off" ? "true" : "false");
  const badge = el.querySelector(".lvl");
  if (badge) badge.textContent = lvl === "high" ? "H" : lvl === "max" ? "MAX" : "";
  el.title =
    lvl === "off" ? t("chip.thinkOff") : lvl === "high" ? t("chip.thinkHigh") : t("chip.thinkMax");
  if (el.id === "thinking") refreshThinkSegs(lvl);
  return lvl;
}
// Reflect the active Thinking level onto its 3 segment buttons (off / on / max).
function refreshThinkSegs(lvl) {
  document.querySelectorAll(".ts-btn").forEach((b) => b.classList.toggle("on", b.dataset.lvl === lvl));
}
function seedToggles() {
  const src = initialToggles || settings || {};
  return {
    thinking: thinkLevelNorm(src.thinkLevel != null ? src.thinkLevel : src.thinking),
    artifacts: src.artifacts !== false,
    webSearch: !!src.webSearch,
    deepSearch: !!src.deepSearch,
    includePageContext: src.includePageContext !== false,
  };
}
function blankSession(m) {
  const toggles = seedToggles();
  // Thinking is a CHAT-ONLY feature — never seed it on for Agent/Translate/Improve/etc.,
  // so enabling it in Chat can't leak into the other tabs.
  if (m !== "chat") toggles.thinking = "off";
  return { history: [], transcript: [], convId: newConversationId(), lastUserContent: "", lastRunMode: m, lastForceWeb: false, nodes: null, pageCtxKeys: new Set(), customTitle: "", importedSources: [], toggles };
}
// Visual persistence per tab: instead of re-deriving the DOM from `transcript`
// (which can drop streamed/enhanced content and the compare bars), we DETACH the
// actual message nodes when leaving a tab and RE-ATTACH them on return — nodes keep
// their event listeners, compare bars and live artifact iframes intact.
// Each tab keeps its messages in a DETACHED holder <div> when it's not the one on screen, so a
// task running in a BACKGROUND tab renders into its own holder and never bleeds into the visible
// tab (true multitasking: chat + image generation at once, each in its own tab). The visible tab's
// messages live directly in els.messages; switching tabs just moves nodes between holder ⇄ view.
function modeHolder(m) {
  const s = getSession(m);
  if (!s.holder) s.holder = document.createElement("div");
  return s.holder;
}
// Where a NEW message for mode m must be appended: the live view if m is on screen, else its
// detached holder. Defaults to the live view (the common, on-tab case — unchanged behaviour).
function homeFor(m) {
  return (m && CHAT_MODES.includes(m) && m !== mode) ? modeHolder(m) : els.messages;
}
function stashMode(m) {
  if (!CHAT_MODES.includes(m)) return;
  const h = modeHolder(m);
  Array.from(els.messages.children).filter((n) => n.id !== "empty").forEach((n) => h.appendChild(n));
}
function restoreMode(m) {
  clearMessages();
  const h = modeHolder(m);
  if (h.childNodes.length) {
    els.empty.classList.add("hidden");
    while (h.firstChild) els.messages.appendChild(h.firstChild);
  } else {
    els.empty.classList.remove("hidden");
  }
  updateEmptyState();
}
function getSession(m) { return sessions[m] || (sessions[m] = blankSession(m)); }
// Copy the live globals into a mode's session (before leaving it, or after we
// reassign any global to a brand-new array — in-place .push keeps refs in sync).
function syncSessionFromGlobals(m) {
  if (!CHAT_MODES.includes(m)) return;
  const s = getSession(m);
  s.history = history; s.transcript = transcript; s.convId = convId;
  s.lastUserContent = lastUserContent; s.lastRunMode = lastRunMode; s.lastForceWeb = lastForceWeb;
}
// Load a mode's session into the live globals.
function loadSessionToGlobals(m) {
  const s = getSession(m);
  history = s.history; transcript = s.transcript; convId = s.convId;
  lastUserContent = s.lastUserContent; lastRunMode = s.lastRunMode; lastForceWeb = s.lastForceWeb;
}
// Reflect a tab's own toggle states onto the composer checkboxes (per-tab toggles).
function applyModeToggles(m) {
  const tg = getSession(m).toggles || (getSession(m).toggles = seedToggles());
  // Thinking only ever applies on the Chat tab (bulletproofs against any stale state).
  setThink(els.thinking, m === "chat" ? tg.thinking : "off");
  els.artifactMode.checked = tg.artifacts;
  // Security mode analyses local evidence (pcap/logs) — never auto web-search.
  els.webSearch.checked = m === "security" ? false : tg.webSearch;
  els.deepSearch.checked = m === "chat" ? !!tg.deepSearch : false;
  els.pageCtx.checked = tg.includePageContext;
  setArtifactsLive(tg.artifacts);
  updateDeepSeg();
}
// Show the depth segment only while DeepSearch is on, and reflect the chosen depth.
function updateDeepSeg() {
  if (!els.deepSeg) return;
  const on = els.deepSearch && els.deepSearch.checked;
  els.deepSeg.hidden = !on;
  const depth = settings.deepSearchDepth || "standard";
  els.deepSeg.querySelectorAll(".ts-btn").forEach((b) => b.classList.toggle("on", b.dataset.depth === depth));
}
// Re-render the chat area from the active session's transcript (used when the
// workspace changes), re-attaching the per-message "compare" bar on the last answer.
// Composer placeholder for a workspace — resolved live so it follows the UI language.
function placeholderFor(m) { return t("ph." + m) || t("ph.chat"); }

// The Agent workspace IS a dedicated tab now (no more "Agent" chip): being in it is
// what turns on tool-use. The page-context chips (Réflexion/Web/Page) stay available.
function agentActive() { return mode === "agent"; }

// Re-render the toolbar / sidebar action icon in the current theme's accent
// colours so the browser button and sidebar header follow the chosen theme.
// (Static manifest icons can't react to a runtime setting, but setIcon() can.)
async function updateActionIcon() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const a1 = (cs.getPropertyValue("--accent") || "#2563eb").trim();   // base majority
    let a2 = (cs.getPropertyValue("--accent-2") || "#7c3aed").trim();   // end touch
    if (settings.gradientOn === false) a2 = a1;                          // gradient off → solid favicon
    const mid = ((typeof settings.gradientSplit === "number" && settings.gradientSplit >= 0) ? settings.gradientSplit : 55) / 100;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="12" y1="10" x2="84" y2="86" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="' + a1 + '"/><stop offset="' + mid.toFixed(3) + '" stop-color="' + a1 + '"/><stop offset="1" stop-color="' + a2 + '"/>' +
      '</linearGradient></defs><g fill="url(#g)">' +
      '<rect x="17" y="9" width="62" height="14" rx="7"/>' +
      '<rect x="8" y="30" width="80" height="14" rx="7"/>' +
      '<rect x="12" y="51" width="72" height="14" rx="7"/>' +
      '<rect x="23" y="72" width="50" height="14" rx="7"/></g></svg>';
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/svg+xml;base64," + btoa(svg); });
    const imageData = {};
    for (const s of [16, 32]) {
      const cv = document.createElement("canvas"); cv.width = s; cv.height = s;
      const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, s, s); ctx.drawImage(img, 0, 0, s, s);
      imageData[s] = ctx.getImageData(0, 0, s, s);
    }
    try { if (browser.sidebarAction && browser.sidebarAction.setIcon) await browser.sidebarAction.setIcon({ imageData }); } catch (_) {}
    const actionApi = (browser.action && browser.action.setIcon) ? browser.action
                    : (typeof chrome !== "undefined" && chrome.action && chrome.action.setIcon) ? chrome.action : null;
    try { if (actionApi) await actionApi.setIcon({ imageData }); } catch (_) {}
  } catch (_) {}
}

async function init() {
  configureMarkdown();
  settings = await getSettings();
  setJudge0Config({ endpoint: settings.judge0Endpoint, key: settings.judge0Key });
  // Snapshot the toggle defaults ONCE, before anything can change them, so every
  // workspace tab seeds from the same baseline and stays independent thereafter.
  initialToggles = {
    thinking: thinkLevelNorm(settings.thinkLevel != null ? settings.thinkLevel : settings.thinking),
    artifacts: settings.artifacts !== false,
    webSearch: !!settings.webSearch,
    includePageContext: settings.includePageContext !== false,
  };
  applyTheme(settings.theme || "dark", settings.themeColors, gradOpts()); // colour theme + custom overrides + gradient/topbar
  applyAura();                         // background auras (colour/size/opacity) — also synced to Hivey Code
  applyFont(settings.uiFont);          // user-chosen UI font (bundled webfont or system)
  updateActionIcon();                  // tint the toolbar/sidebar icon to match the theme
  setLang(settings.uiLang || "en");   // English by default; other languages chosen in Settings
  applyDom(document);                  // fill all data-i18n static markup
  document.documentElement.lang = settings.uiLang || "en";
  document.body.classList.toggle("rail-right", settings.railSide === "right");
  applyRailPinned(); // rail = hover overlay; pinned open iff not railHidden
  applyMsgBorder(); // customisable reply-bubble outline (on/off / colour / neon)
  applyModeModel(mode); // restore the startup tab's own model
  populateModelSelector();
  // No-FOUC: the saved theme, font, language and layout are now applied — reveal the UI (it was
  // kept invisible by CSS until this point). rAF so the first painted frame is the styled one.
  requestAnimationFrame(() => document.documentElement.classList.add("theme-ready"));
  populateImprovePresets();
  populateImproveTones();
  setThink(els.thinking, thinkLevelNorm(settings.thinkLevel != null ? settings.thinkLevel : settings.thinking));
  els.artifactMode.checked = settings.artifacts !== false; // default ON
  setArtifactsLive(els.artifactMode.checked);
  els.webSearch.checked = settings.webSearch;
  els.deepSearch.checked = settings.deepSearch;
  els.pageCtx.checked = settings.includePageContext;
  // Lists AUTOMATICALLY remember the last choice (shown as the resting value). The placeholder
  // label ("Translate to" / "Writing style" / "Custom size") only shows until the user picks once.
  populateImageSizes();
  if (settings.targetLang) els.translateLang.value = settings.targetLang;
  if (settings.improvePreset) els.improvePreset.value = settings.improvePreset;
  els.improveTone.value = settings.improveTone || "auto";
  els.imageSize.value = settings.imageSize || "";
  decorateLangOptions();               // "French — Français", "Hindi — हिन्दी"… (endonyms) before theming
  // Themed dropdowns (same look/behaviour as "Choose an analysis") over the native selects.
  themeNativeSelect(els.translateLang);
  setupImprovePicker();               // Improve = one button → a 2-list (Action | Tone) popup
  themeNativeSelect(els.imageSize);
  themeNativeSelect(els.wbScope);
  syncToggleVisibility();
  updateImageNote();
  wire();
  // Full-screen tab: open ON the conversation/workspace the sidebar handed us
  // (?mode= & ?conv=), so "Agrandir" feels like the same view enlarged.
  const _params = new URLSearchParams(location.search);
  const _urlMode = _params.get("mode");
  const _urlConv = _params.get("conv");
  setMode(IS_TAB && CHAT_MODES.includes(_urlMode) ? _urlMode : (settings.mode || "chat"));
  if (IS_TAB && _urlConv) { try { await loadConversation(_urlConv); } catch (_) {} }
  // Coming back from the full-screen tab (exitTab): land on the conversation we left.
  if (!IS_TAB) {
    try {
      const { pgReturn } = await browser.storage.local.get("pgReturn");
      if (pgReturn && Date.now() - pgReturn.ts < 15000) {
        await browser.storage.local.remove("pgReturn");
        if (CHAT_MODES.includes(pgReturn.mode) && pgReturn.mode !== mode) setMode(pgReturn.mode);
        if (pgReturn.conv) await loadConversation(pgReturn.conv);
      }
    } catch (_) {}
  }
  setupPageAwareness();
  autoListConnected();           // refresh available models in the background
  // Run a queued context-menu action whenever it appears — even if the sidebar was
  // already open when the user clicked the menu (that's the "right-click does nothing" fix).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.pendingAction && changes.pendingAction.newValue) consumePendingAction();
    if (area === "local" && changes.pendingImage && changes.pendingImage.newValue) consumePendingImage();
    if (area === "local" && changes.pendingPdf && changes.pendingPdf.newValue) consumePendingPdf();
    if (area === "local" && changes.pendingCapture && changes.pendingCapture.newValue) consumePendingCapture();
  });
  await refreshCurrentPage();
  await consumePendingAction();
  await consumePendingImage();
  await consumePendingCapture();
  await consumePendingPdf();
}
// Right-click-a-PDF → read it. The background stores the PDF URL; we fetch it, extract its text
// (same pipeline as the PDF tab), add it as context, and switch to the PDF tab.
let lastPendingPdfTs = 0;
async function consumePendingPdf() {
  let pendingPdf;
  try { ({ pendingPdf } = await browser.storage.local.get("pendingPdf")); } catch (_) { return; }
  if (!pendingPdf || !pendingPdf.url || Date.now() - pendingPdf.ts > 60000) return;
  if (pendingPdf.ts === lastPendingPdfTs) return;
  lastPendingPdfTs = pendingPdf.ts;
  try { await browser.storage.local.remove("pendingPdf"); } catch (_) {}
  if (mode !== "pdf") setMode("pdf");
  flashTopBanner(t("pdf.fetching"));
  try {
    const resp = await fetch(pendingPdf.url);
    const buf = await resp.arrayBuffer();
    const { text, pages } = await extractPdfText(buf);
    const name = (decodeURIComponent(pendingPdf.url.split("/").pop() || "document.pdf").split("?")[0]) || "document.pdf";
    attachments.push({ type: "text", name, text, isPdf: true, pages, ctxIncluded: true });
    renderAttachStrip();
    flashTopBanner(t("pdf.added"));
    els.input && els.input.focus();
  } catch (_) {
    addMessage("error", t("pdf.fetchFailed"));
  }
}
// Right-click-an-image → use it as context. The background stores the image URL; we fetch it
// (extension host permissions let us read any origin), add it as an image attachment, and
// switch to the Image tab so it's ready to mix/edit. A top banner confirms it.
let lastPendingImageTs = 0;
async function consumePendingImage() {
  let pendingImage;
  try { ({ pendingImage } = await browser.storage.local.get("pendingImage")); } catch (_) { return; }
  if (!pendingImage || !pendingImage.srcUrl || Date.now() - pendingImage.ts > 60000) return;
  if (pendingImage.ts === lastPendingImageTs) return;
  lastPendingImageTs = pendingImage.ts;
  try { await browser.storage.local.remove("pendingImage"); } catch (_) {}
  try {
    let dataUrl, mediaType = "image/png";
    if (/^data:/i.test(pendingImage.srcUrl)) {
      dataUrl = pendingImage.srcUrl;
      mediaType = (pendingImage.srcUrl.match(/^data:([^;,]+)/) || [])[1] || mediaType;
    } else {
      const resp = await fetch(pendingImage.srcUrl);
      const blob = await resp.blob();
      mediaType = blob.type || mediaType;
      dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    }
    attachments.push({ type: "image", name: t("img.fromPage"), dataUrl, mediaType, ctxIncluded: true });
    if (mode !== "image") setMode("image");
    renderAttachStrip();
    flashTopBanner(t("img.addedFromPage"));
    els.input && els.input.focus();
  } catch (_) {
    addMessage("error", t("img.fetchFailed"));
  }
}

// Region capture triggered from the RIGHT-CLICK menu. The right-click is a genuine user gesture, so
// Firefox grants `activeTab` for that tab — which is exactly what captureVisibleTab needs and what a
// sidebar-button click can never obtain. So this path screenshots reliably with NO site permission.
let lastPendingCaptureTs = 0;
async function consumePendingCapture() {
  let pendingCapture;
  try { ({ pendingCapture } = await browser.storage.local.get("pendingCapture")); } catch (_) { return; }
  if (!pendingCapture || Date.now() - pendingCapture.ts > 60000) return;
  if (pendingCapture.ts === lastPendingCaptureTs) return;
  lastPendingCaptureTs = pendingCapture.ts;
  try { await browser.storage.local.remove("pendingCapture"); } catch (_) {}
  if (!["chat", "agent", "translate", "improve", "image", "pdf"].includes(mode)) setMode("chat");
  captureRegion();
}

// ----- Unified model picker -------------------------------------------------
// Only providers the user is actually connected to (key / account / local server).
// Nothing connected => the picker is hidden and a Connect button is shown instead.
function providersToShow() {
  return connectedProviders(settings);
}

// Models for a provider: the live-fetched list when we have one (authoritative —
// only what the key/account can access), otherwise the catalogue defaults.
function modelsOf(providerId) {
  const fetched = (settings.modelLists && settings.modelLists[providerId]) || [];
  // User-entered model names (Settings) — used even if the endpoint can't be auto-listed
  // (e.g. a CORS-blocked Ollama / a custom server with no /models route). Listed FIRST.
  const userM = (settings.userModels && settings.userModels[providerId]) || [];
  const base = fetched.length ? fetched : PROVIDERS[providerId].models.map((m) => m[0]);
  const ids = [...userM, ...base];
  const labels = new Map(PROVIDERS[providerId].models);
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push([id, labels.get(id) || id]);
  }
  return out;
}

// Fill the model <select> with your connected API providers' models (grouped),
// preceded by a neutral placeholder. (API mode only — sites have no model menu.)
function prettifyVendor(v) {
  return (v || "").split(/[-_]/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}
function prettifyORName(m) {
  // OpenRouter "name" is usually "Vendor: Model Name" -> keep the model part.
  if (m.name && m.name.includes(": ")) return m.name.split(": ").slice(1).join(": ");
  return prettifyVendor(m.id.split("/")[1] || m.id);
}
function orCost(m) {
  if (!m.prompt && !m.completion) return t("cost.free");
  const inM = m.prompt * 1e6; // price per 1M prompt tokens
  return "$" + (inM >= 1 ? inM.toFixed(2) : inM.toFixed(3)) + "/M";
}
// Visual price tier for an OpenRouter model: a coloured dot (green → cheap, red →
// expensive) + a gift for free models, so cost is readable at a glance. Emoji are
// used (not CSS) because they render reliably inside native <option> dropdowns.
function priceTier(m) {
  if (!m.prompt && !m.completion) return { emoji: "🎁", color: "#34d399" }; // free
  const inM = m.prompt * 1e6;
  if (inM <= 1) return { emoji: "🟢", color: "#34d399" };   // pas cher
  if (inM <= 5) return { emoji: "🟡", color: "#fbbf24" };   // abordable
  if (inM <= 15) return { emoji: "🟠", color: "#fb923c" };  // modéré
  return { emoji: "🔴", color: "#f87171" };                  // cher
}
function orOptionLabel(m) {
  const t = priceTier(m);
  return t.emoji + " " + prettifyORName(m) + " — " + orCost(m);
}
// Canonical price-tier NAME (free/green/yellow/orange/red) for the filter — mirrors
// priceTier()'s thresholds. Used as data-tier on each <option>.
function priceTierName(m) {
  if (!m.prompt && !m.completion) return "free";
  const inM = m.prompt * 1e6;
  if (inM <= 1) return "green";
  if (inM <= 5) return "yellow";
  if (inM <= 15) return "orange";
  return "red";
}
// Stamp an <option> with the attributes the filter reads (provider / tier / free).
function tagOption(o, provider, tier) {
  o.dataset.provider = provider;
  if (tier) { o.dataset.tier = tier; o.dataset.free = tier === "free" ? "true" : "false"; }
}

// Display label for a "providerId|modelId" value (used for the "current model"
// row that we pin at the top of the list — see fillModelSelect).
function labelForValue(value) {
  const { providerId, modelId } = parseSel(value);
  if (providerId === "openrouter" && settings.orModels) {
    const m = settings.orModels.find((x) => x.id === modelId);
    if (m) return orOptionLabel(m);
  }
  const map = new Map(modelsOf(providerId));
  return map.get(modelId) || modelId;
}

// OpenRouter hierarchy: one optgroup per vendor (OpenRouter › vendor › model+cost),
// each option prefixed with a price-tier dot (🎁 for free).
function orModelVisible(m) {
  if (orUnavailable.has(m.id)) return false;               // discovered as inaccessible this session
  if (settings.orFreeOnly && (m.prompt || m.completion)) return false; // free-only mode hides paid
  return true;
}
function fillOpenRouterGroups(sel) {
  const byVendor = {};
  for (const m of settings.orModels) {
    if (!orModelVisible(m)) continue;
    const vendor = (m.id.split("/")[0] || "autres");
    (byVendor[vendor] = byVendor[vendor] || []).push(m);
  }
  for (const vendor of Object.keys(byVendor).sort()) {
    const group = document.createElement("optgroup");
    group.label = "OpenRouter · " + prettifyVendor(vendor);
    for (const m of byVendor[vendor].sort((a, b) => prettifyORName(a).localeCompare(prettifyORName(b)))) {
      const o = document.createElement("option");
      o.value = "openrouter|" + m.id;
      o.textContent = orOptionLabel(m);
      o.style.color = priceTier(m).color;
      tagOption(o, "openrouter", priceTierName(m));
      o.dataset.subprovider = vendor;
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
}

function fillModelSelect(sel, selectedValue) {
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = t("model.choose");
  sel.appendChild(ph);
  // Pin the active model as the FIRST entry so the native dropdown opens at the TOP
  // showing it, instead of scrolling deep into a long list (the "list opens at the
  // end" glitch). A duplicate value lower down is harmless.
  if (selectedValue) {
    const cur = document.createElement("optgroup");
    cur.label = t("model.current");
    const o = document.createElement("option");
    o.value = selectedValue;
    o.textContent = labelForValue(selectedValue);
    cur.appendChild(o);
    sel.appendChild(cur);
  }
  for (const pid of providersToShow()) {
    if (pid === "openrouter" && settings.orModels && settings.orModels.length) {
      fillOpenRouterGroups(sel);
      continue;
    }
    const group = document.createElement("optgroup");
    const noKey = !(keyFor(pid, settings) || PROVIDERS[pid].local);
    group.label = PROVIDERS[pid].label + (noKey ? t("model.keyMissing") : "");
    for (const [mid, mlabel] of modelsOf(pid)) {
      const o = document.createElement("option");
      o.value = pid + "|" + mid;
      o.textContent = mlabel;
      tagOption(o, pid, null); // no per-token pricing for non-OpenRouter providers
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
  sel.value = selectedValue || "";
}

// ----- Image model picker (Image tab only) ----------------------------------
// In the Image workspace the model dropdown lists ONLY image-generation models
// (from providers that support /images/generations and are connected). Choosing
// one sets the image provider + model used by runImage().
function imageModelChoices() {
  const out = [];
  for (const pid of PROVIDER_ORDER) {
    const meta = PROVIDERS[pid];
    if (currentKeyMissing(pid)) continue; // only connected providers
    // OpenRouter: list EVERY model that can output images (Gemini/Nano Banana, etc.),
    // pulled live from the account's model list — far more than a hard-coded handful.
    if (pid === "openrouter" && settings.orModels && settings.orModels.length) {
      const dyn = settings.orModels.filter((m) => m.image && !orUnavailable.has(m.id));
      if (dyn.length) {
        for (const m of dyn) out.push([pid, m.id, prettifyORName(m)]);
        continue;
      }
    }
    if (!meta.supportsImages || !meta.imageModels) continue;
    for (const [mid, mlabel] of meta.imageModels) out.push([pid, mid, mlabel]);
  }
  return out;
}
// Map an image tier emoji to a filter tier name (so price filtering works here too).
function imageTierName(emoji) {
  return emoji === "🎁" ? "free" : emoji === "🟢" ? "green" : emoji === "🟡" ? "yellow"
    : emoji === "🟠" ? "orange" : emoji === "🔴" ? "red" : null;
}
// Combobox items for the Image tab.
function imageComboItems() {
  // Group by provider, rank each provider's image models by their curated IMAGE score,
  // and show either that score (🎯) or the per-image price (💰) via the header toggle.
  const byProv = {};
  for (const [pid, mid, mlabel] of imageModelChoices()) {
    (byProv[pid] = byProv[pid] || []).push([mid, mlabel]);
  }
  const out = [];
  for (const pid of Object.keys(byProv)) {
    const rows = byProv[pid].map(([mid, mlabel]) => {
      const tier = imagePriceTier(pid, mid);
      const score = modelScore(mid, "image");
      const mf = combineBadge(score, tier.note, tier.color);
      return {
        value: pid + "|" + mid, label: mlabel, provider: pid, subprovider: null,
        tier: imageTierName(tier.emoji), color: null, badge: mf.badge, badgeColor: mf.badgeColor, parts: mf.parts, score,
        group: PROVIDERS[pid].label,
      };
    });
    rows.sort(byScoreDesc);
    for (const r of rows) out.push(r);
  }
  return out;
}
function populateImageModelSelector() {
  const list = imageModelChoices();
  const anyConnected = connectedProviders(settings).length > 0;
  els.modelWrap.classList.toggle("hidden", !anyConnected || !list.length);
  els.modelConnect.classList.add("hidden"); // 🐝 onboarding (freeConnect) covers connecting — no redundant top "Connect a provider" button
  els.modelFilterBtn.classList.toggle("hidden", !anyConnected || !list.length);
  const cur = (settings.imageProvider || "openai") + "|" + (settings.imageModel || "");
  const exists = list.some(([pid, mid]) => pid + "|" + mid === cur);
  if (exists) {
    mainValue = cur;
  } else if (list.length) {
    // Stored image model not among CONNECTED ones (e.g. default OpenAI but only
    // OpenRouter connected) → fall back to the first available and persist it.
    mainValue = list[0][0] + "|" + list[0][1];
    const fb = parseSel(mainValue);
    settings.imageProvider = fb.providerId;
    settings.imageModel = fb.modelId;
    setSettings({ imageProvider: fb.providerId, imageModel: fb.modelId });
    updateImageNote();
  } else {
    mainValue = "";
  }
  if (mainCombo) mainCombo.refresh();
  els.modelFilterBtn.classList.toggle("active", filterIsActive());
  updateEmptyState();
}

// Approximate cost tier per image model (these endpoints don't expose token pricing
// the way chat models do, so we annotate from each model's published per-image price).
function imagePriceTier(pid, mid) {
  // OpenRouter image models: use the model's REAL pricing → 🎁 free / coloured tiers,
  // exactly like the chat lists in the other tabs.
  if (pid === "openrouter" && settings.orModels) {
    const om = settings.orModels.find((x) => x.id === mid);
    if (om) { const tt = priceTier(om); return { emoji: tt.emoji, color: tt.color, note: orCost(om) }; }
  }
  const m = (mid || "").toLowerCase();
  // Free first.
  if (m.includes("schnell-free") || m.includes("schnell_free")) return { emoji: "🎁", color: "#34d399", note: "free" };
  if (m.includes("dall-e-2")) return { emoji: "🟢", color: "#34d399", note: "~$0.02/image" };
  if (m.includes("schnell")) return { emoji: "🟢", color: "#34d399", note: "~$0.003/image" };
  if (m.includes("sd3") || m.includes("sd-3") || m.includes("stable")) return { emoji: "🟢", color: "#34d399", note: "~$0.01/image" };
  if (m.includes("flux") && m.includes("dev")) return { emoji: "🟡", color: "#fbbf24", note: "~$0.025/image" };
  if (m.includes("dall-e-3")) return { emoji: "🟡", color: "#fbbf24", note: "~$0.04–0.12/image" };
  if (m.includes("grok")) return { emoji: "🟡", color: "#fbbf24", note: "~$0.07/image" };
  if (m.includes("flux") && m.includes("pro")) return { emoji: "🟠", color: "#fb923c", note: "~$0.04/image" };
  if (m.includes("gpt-image")) return { emoji: "🟠", color: "#fb923c", note: "~$0.04–0.17/image" };
  return { emoji: "⚪", color: "#9aa0b4", note: t("image.tierDefault") };
}

// Refresh whichever model picker the active workspace needs.
function refreshModelUI() {
  if (mode === "image") populateImageModelSelector();
  else populateModelSelector();
}

// ── Model picker metric: rank/label models either by curated benchmark accuracy for the
// current tab's specialty (🎯) or by price (💰). A toggle in the picker header switches it.
// Two INDEPENDENT badges: Accuracy (🎯) and Price (💰). Either or BOTH can be shown. Accuracy
// stays the priority for sorting. Defaults: accuracy on, price off.
function metricScoreOn() { return settings.metricScore !== false; }
function metricPriceOn() { return settings.metricPrice === true; }
function toggleMetric(which) {
  // Each badge is freely toggleable — including turning BOTH off (then the list shows no badge).
  if (which === "score") settings.metricScore = !metricScoreOn();
  else settings.metricPrice = !metricPriceOn();
  setSettings({ metricScore: metricScoreOn(), metricPrice: metricPriceOn() });
}
// Build the badge from whichever metrics are on (accuracy first). `parts` keeps EACH segment's
// own colour (accuracy keeps its score colour, price keeps its price colour) for the renderer.
function combineBadge(score, priceBadge, priceColor) {
  const parts = [];
  if (metricScoreOn()) parts.push({ text: score == null ? "—" : score + "%", color: scoreColor(score) });
  if (metricPriceOn() && priceBadge) parts.push({ text: priceBadge, color: priceColor });
  return { badge: parts.map((p) => p.text).join(" · "), badgeColor: parts[0] && parts[0].color, score, parts };
}
// Render an item's badge into `el`, colouring EACH segment with its own colour (the accuracy %
// in its score colour, the price in its price colour). Falls back to the single colour/string.
function fillBadge(el, it) {
  el.textContent = "";
  if (it.parts && it.parts.length) {
    it.parts.forEach((p, i) => {
      if (i) { const sep = document.createElement("span"); sep.className = "ci-sep"; sep.textContent = " · "; el.appendChild(sep); }
      const s = document.createElement("span"); s.textContent = p.text; if (p.color) s.style.color = p.color; el.appendChild(s);
    });
  } else {
    el.textContent = it.badge || "";
    if (it.badgeColor) el.style.color = it.badgeColor;
  }
}
// 🐝 Hivey thinking budget by tier: auto reasoning on the "reasoning" tier (where it actually
// helps), off elsewhere (cheap/utility turns must stay cheap). The user's manual choice wins if higher.
const THINK_ORDER = { off: 0, high: 1, max: 2 };
function hiveyThink(tierKey, userLevel) {
  // 🐝 Hivey Smart = best result, no compromise → MAX reasoning on every turn.
  if (activeHiveyId() === "hivey/smart") return "max";
  // Plan-first: give the AGENT a reasoning budget too (so it plans instead of flailing), plus the
  // reasoning tier. Cheap/utility turns stay off. The user's manual choice still wins if higher.
  const auto = (tierKey === "reasoning" || tierKey === "agent") ? "high" : "off";
  const u = userLevel || "off";
  return (THINK_ORDER[auto] > THINK_ORDER[u]) ? auto : u;
}
// 3-state sort cycle: "" (normal) → "desc" (best/highest first) → "asc" (lowest first) → "".
// Accuracy is the priority key; price is the key only when accuracy is hidden.
function getSort() { return ["desc", "asc"].includes(settings.modelSort) ? settings.modelSort : ""; }
function cycleSort() {
  const next = getSort() === "" ? "desc" : getSort() === "desc" ? "asc" : "";
  settings.modelSort = next; setSettings({ modelSort: next });
}
const PRICE_TIER_RANK = { free: 0, green: 1, yellow: 2, orange: 3, red: 4 };
function applyModelSort(rows) {
  const dir = getSort();
  if (!dir || !rows.length) return rows;
  const grp = t("sort.results");
  const flat = rows.filter((r) => r.value && r.value.indexOf("|hivey/") === -1); // drop the Hivey pseudo-rows
  const byScore = !metricScoreOn() && metricPriceOn()
    ? (a, b) => ((PRICE_TIER_RANK[a.tier] ?? 9) - (PRICE_TIER_RANK[b.tier] ?? 9)) // price-only: cheapest = "best"
    : (a, b) => ((b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score)); // accuracy priority
  flat.sort(byScore);
  if (dir === "asc") flat.reverse();
  return flat.map((r) => ({ ...r, group: grp }));
}
// Benchmark category for the active tab (chat=global, agent=agentique, image=image…).
function benchCat() { return categoryForMode(mode); }
// Colour for an accuracy score (green = strong → red = weak; grey = unknown).
function scoreColor(s) {
  if (s == null) return "var(--muted)";
  if (s >= 85) return "#34d399";
  if (s >= 75) return "#a3e635";
  if (s >= 62) return "#fbbf24";
  if (s >= 48) return "#fb923c";
  return "#f87171";
}
// Build the {badge,badgeColor,score} a combo item should show for a given OpenRouter model
// object `m` (with pricing) under the active metric. `score` (or null) drives the sort.
function orMetricFields(m, cat) {
  const score = modelScore(m.id, cat);
  return combineBadge(score, orCost(m), priceTier(m).color);
}
// Same for a non-OpenRouter model id (no live pricing → only the accuracy part shows).
function plainMetricFields(modelId, cat) {
  const score = modelScore(modelId, cat);
  return combineBadge(score, "", null);
}
// Sort comparator: best benchmark score first (unknown last), then name. Used to SUB-SORT
// within each provider/vendor group so the best models for the tab surface at the top.
function byScoreDesc(a, b) {
  const sa = a.score == null ? -1 : a.score, sb = b.score == null ? -1 : b.score;
  if (sb !== sa) return sb - sa;
  return (a.label || "").localeCompare(b.label || "");
}
// Sticky header for the model picker: a segmented toggle to switch the per-provider badge
// between the curated accuracy % for the active tab (🎯) and the price (💰), plus a small
// caption naming the specialty being scored. `rerender` redraws the open menu in place.
const METRIC_ICON = {
  // 🎯 target (accuracy) and 🏷 price-tag — line icons matching the sidebar's design.
  score: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  price: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13 21a1.9 1.9 0 0 1-2.7 0L3 13.7V4h9.7l7.9 7.9a1.7 1.7 0 0 1 0 1.5z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
};
function buildMetricToggle(rerender) {
  const wrap = document.createElement("div");
  wrap.className = "combo-metric";
  const seg = document.createElement("div");
  seg.className = "cm-seg";
  // INDEPENDENT toggles: Accuracy and Price can each be on — turn both on to see both badges.
  const tip = { score: t("metric.scoreCap", { cat: categoryLabel(benchCat()) }), price: t("metric.priceCap") };
  const onFor = { score: metricScoreOn(), price: metricPriceOn() };
  for (const m of ["score", "price"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-btn icon-only" + (onFor[m] ? " on" : "");
    setHTML(b, METRIC_ICON[m]);
    b.title = tip[m];
    b.setAttribute("aria-label", tip[m]);
    b.addEventListener("mousedown", (e) => { e.preventDefault(); toggleMetric(m); setTimeout(rerender, 0); });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);
  // Right side: a SINGLE sort button cycling through 3 states — normal → ↓ (best first) →
  // ↑ (worst first) → normal. Accuracy is the priority sort key.
  const dir = getSort();
  const right = document.createElement("div");
  right.className = "cm-sort";
  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "cm-btn icon-only sort-cycle" + (dir ? " on" : "");
  setHTML(sortBtn, dir === "asc" ? SORT_ASC_ICON : dir === "desc" ? SORT_DESC_ICON : SORT_NONE_ICON);
  sortBtn.title = dir === "asc" ? t("sort.asc") : dir === "desc" ? t("sort.desc") : t("sort.off");
  sortBtn.setAttribute("aria-label", sortBtn.title);
  sortBtn.addEventListener("mousedown", (e) => { e.preventDefault(); cycleSort(); setTimeout(rerender, 0); });
  right.appendChild(sortBtn);
  // Filter button INSIDE the dropdown header (top-right) — opens the price/provider filter popup.
  // The external modelbar filter button is hidden (CSS) so the filter lives in one tidy place.
  const fbtn = document.createElement("button");
  fbtn.type = "button";
  fbtn.className = "cm-btn icon-only cm-filter" + (filterIsActive() ? " on" : "");
  setHTML(fbtn, COMBO_FILTER_ICON);
  fbtn.title = t("filter.title");
  fbtn.setAttribute("aria-label", t("filter.title"));
  fbtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); toggleFilterPanel(fbtn); });
  right.appendChild(fbtn);
  wrap.appendChild(right);
  return wrap;
}
const COMBO_FILTER_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';
const SORT_DESC_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="m3 17 3 3 3-3"/><path d="M6 18V4"/></svg>';
const SORT_ASC_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 19h4"/><path d="M11 15h7"/><path d="M11 11h10"/><path d="m3 7 3-3 3 3"/><path d="M6 6v14"/></svg>';
const SORT_NONE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>';

// Combobox items for the chat-style pickers (Chat/Agent/Translate/Improve/PDF +
// Terminal). OpenRouter models are grouped by vendor so the list — and the vendor
// sub-filter — stay readable. Within each vendor, models are ranked by their curated
// benchmark score for the active tab's specialty (the picker header toggles the badge
// between that accuracy % and the price).
function chatComboItems() {
  const cat = benchCat();
  const out = [];
  // 🐝 Hivey presets — PRO (best model per specialty + reasoning), SMART (best quality/price mix) and
  // FREE (best free models) — ALWAYS lead the picker. They no longer hide when the OpenRouter catalogue
  // isn't loaded yet (or the connected-providers check is momentarily empty), which is what made them
  // "disappear" and the current selection show as a raw "hivey/hybrid" id.
  for (const hid of ["hivey/smart", "hivey/hybrid", "hivey/free"]) {
    const v = HIVEY_VARIANTS[hid];
    if (!v) continue;
    out.push({
      value: "openrouter|" + hid, label: v.label,
      provider: "openrouter", subprovider: "hivey", tier: hid === "hivey/free" ? "free" : "paid", color: v.color, group: "Hivey",
    });
  }
  for (const pid of providersToShow()) {
    if (pid === "openrouter" && settings.orModels && settings.orModels.length) {
      const byVendor = {};
      for (const m of settings.orModels) {
        if (orUnavailable.has(m.id)) continue;
        const vendor = m.id.split("/")[0] || "other";
        (byVendor[vendor] = byVendor[vendor] || []).push(m);
      }
      for (const vendor of Object.keys(byVendor).sort()) {
        const rows = byVendor[vendor].map((m) => {
          const mf = orMetricFields(m, cat);
          return {
            value: "openrouter|" + m.id, label: prettifyORName(m), provider: "openrouter",
            subprovider: vendor, tier: priceTierName(m), color: null,
            badge: mf.badge, badgeColor: mf.badgeColor, parts: mf.parts, score: mf.score,
            group: "OpenRouter · " + prettifyVendor(vendor),
          };
        });
        rows.sort(byScoreDesc); // best model for this tab first, within the vendor
        for (const r of rows) out.push(r);
      }
      continue;
    }
    const rows = modelsOf(pid).filter(([mid]) => !mid.startsWith("hivey/")).map(([mid, mlabel]) => {
      const mf = plainMetricFields(mid, cat);
      return {
        value: pid + "|" + mid, label: mlabel, provider: pid, subprovider: null, tier: null,
        color: null, badge: mf.badge, badgeColor: mf.badgeColor, parts: mf.parts, score: mf.score,
        group: PROVIDERS[pid].label,
      };
    });
    rows.sort(byScoreDesc);
    for (const r of rows) out.push(r);
  }
  return applyModelSort(out);
}
// Each workspace tab keeps its OWN model. Before refreshing the picker for a mode, point
// settings.provider/models at that mode's last-used selection (if its provider is still
// connected) so the picker shows it. The Image tab has its own image model already.
function applyModeModel(m) {
  if (m === "image" || m === "code") return;
  const v = settings.modeSel && settings.modeSel[m];
  if (!v) return; // first visit → inherit the current model (sensible default)
  const ps = parseSel(v);
  if (ps.providerId && connectedProviders(settings).includes(ps.providerId)) {
    settings.provider = ps.providerId;
    settings.models = { ...(settings.models || {}), [ps.providerId]: ps.modelId };
  }
}
function populateModelSelector() {
  const connected = connectedProviders(settings);
  const none = connected.length === 0;
  // Nothing connected yet → hide the picker. The onboarding panel (freeConnect / "Other
  // providers") already offers connecting, so we drop the redundant top "Connect a provider"
  // button entirely (kept always-hidden). Once connected, show the searchable combobox.
  els.modelConnect.classList.add("hidden");
  els.modelWrap.classList.toggle("hidden", none);
  els.modelFilterBtn.classList.toggle("hidden", none);
  if (connected.length) {
    const pid = connected.includes(settings.provider) ? settings.provider : connected[0];
    mainValue = pid + "|" + modelFor(pid, settings);
  } else {
    mainValue = "";
  }
  if (mainCombo) mainCombo.refresh();
  els.modelFilterBtn.classList.toggle("active", filterIsActive());
  updateEmptyState();
}

// Empty-screen content: onboarding when no provider is connected, a friendly
// greeting ("Comment puis-je vous aider ?") once one is — terminal-flavoured in
// the Terminal tab.
function updateEmptyState() {
  const connected = connectedProviders(settings).length > 0;
  els.emptyOnboard.classList.toggle("hidden", connected);
  els.emptyGreeting.classList.toggle("hidden", !connected);
  if (els.emptyFeatures) els.emptyFeatures.classList.toggle("hidden", !connected);
  // The centre logo mirrors the ACTIVE tab (chat bubble, agent robot, image frame…) instead of
  // always showing the Hivey brand mark — and a one-line summary recaps the tab's features.
  setEmptyLogo(connected ? mode : null);
  if (connected) {
    els.emptyGreeting.textContent =
      mode === "agent" ? t("greeting.agent") :
      mode === "pdf" ? t("greeting.pdf") :
      mode === "translate" ? t("greeting.translate") :
      mode === "improve" ? t("greeting.improve") :
      mode === "image" ? t("greeting.image") :
      mode === "security" ? t("greeting.security") :
      mode === "wisebase" ? t("greeting.wisebase") :
      t("greeting");
    const feat = t("feat." + mode);
    if (els.emptyFeatures) setHTML(els.emptyFeatures, feat && feat !== "feat." + mode ? feat : ""); // feat.* may contain <strong> emphasis
  }
}
// Swap the big centred logo for the active tab's icon (cloned from the rail), or restore the
// Hivey brand mark for onboarding (mode === null). Cached so we don't rebuild every refresh.
let emptyLogoMode = "__init__";
function setEmptyLogo(m) {
  if (!els.emptyLogo || emptyLogoMode === m) return;
  emptyLogoMode = m;
  if (!m) { setHTML(els.emptyLogo, HIVEY_LOGO_SVG); return; } // onboarding → Hivey brand mark
  const railSvg = els.rail.querySelector('.railtab[data-mode="' + m + '"] svg');
  if (railSvg) {
    const c = railSvg.cloneNode(true);
    c.classList.add("tab-ic");
    els.emptyLogo.innerHTML = "";
    els.emptyLogo.appendChild(c);
  } else {
    setHTML(els.emptyLogo, HIVEY_LOGO_SVG);
  }
}
const HIVEY_LOGO_SVG = '<svg viewBox="0 0 96 96" role="img" aria-label="Hivey AI"><defs><linearGradient id="hiveLogoA" x1="12" y1="10" x2="84" y2="86" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="0.55" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs><g fill="url(#hiveLogoA)"><rect x="17" y="9" width="62" height="14" rx="7"/><rect x="8" y="30" width="80" height="14" rx="7"/><rect x="12" y="51" width="72" height="14" rx="7"/><rect x="23" y="72" width="50" height="14" rx="7"/></g></svg>';

function parseSel(value) {
  const i = (value || "").indexOf("|");
  if (i < 0) return { providerId: settings.provider, modelId: modelFor(settings.provider, settings) };
  return { providerId: value.slice(0, i), modelId: value.slice(i + 1) };
}
function currentSelection() {
  return parseSel(mainValue);
}
// When "Hivey" is the chosen model, resolve it to the actual best model for THIS task
// (mode + a quick complexity heuristic). Anything else passes through unchanged.
function resolveHivey(sel, runMode, text) {
  if (!sel || !isHivey(sel.modelId)) return sel;
  const m = runMode || mode;
  const r = parseSel(hiveyTierFor(sel.modelId, m, text || ""));
  return m !== "image" ? ensureUsable(r, sel.modelId) : r;
}
// Async variant: for ambiguous chat/PDF turns it asks a TINY cheap model (the router)
// which difficulty tier should answer, then routes there — so one request uses several
// APIs (router + solver) and premium models are spent only when the task is truly hard.
// Deterministic modes (image/agent/translate/improve) skip the call. Any failure or a
// >4.5s stall falls back instantly to the local regex heuristic, so it never blocks.
async function resolveHiveyRouted(sel, runMode, text, signal) {
  if (!sel || !isHivey(sel.modelId)) return { sel, tierKey: null };
  const hid = sel.modelId; // which Hivey variant (free / low-cost / balanced / pro)
  const T = hiveyTiers(hid);
  const m = runMode || mode;
  // Guarantee the chosen text model is actually usable on this account (skip the image
  // tier, handled separately) — any variant, any specialised capability.
  const fix = (s) => ensureUsable(s, hid);
  if (m === "image") return { sel: parseSel(T.image), tierKey: "image" };
  if (m === "agent") return { sel: fix(parseSel(T.agent)), tierKey: "agent" };
  if (m === "translate" || m === "improve") return { sel: fix(parseSel(T.utility)), tierKey: "utility" };
  // Chat/PDF: pick the capability tier. On the FREE tier we use the local heuristic ONLY —
  // an extra LLM "dispatcher" call would burn the shared free rate-limit (~20/min, 200/day)
  // and add latency/model-churn, which is exactly what was causing cascades of free errors.
  // Paid tiers still use the smart dispatcher (with a heuristic fallback if it stalls).
  let key = hiveyHeuristicKey(text || "");
  if (hid !== "hivey/free" && !currentKeyMissing("openrouter")) {
    const probe = (text || "").slice(0, 2000);
    if (probe.trim()) {
      try {
        const routerSel = fix(parseSel(hiveyRouterModel(hid)));
        const label = await Promise.race([
          runUtilityCompletion(routerSel, HIVEY_ROUTER_SYSTEM, probe, signal),
          new Promise((res) => setTimeout(() => res(""), 7000)),
        ]);
        if (label && label.trim()) key = hiveyLabelKey(label);
      } catch (_) { /* keep the heuristic key */ }
    }
  }
  return { sel: fix(parseSel(T[key] || T.chat)), tierKey: key };
}
// True when Hivey is the user's chosen text model. Also checks the persisted selection so
// it stays true on the Image tab (which has its own picker) — Hivey routes EVERY tab.
// The Hivey variant id currently in effect (selection first, then the persisted
// OpenRouter choice so it still applies on the Image tab), or null if none.
function activeHiveyId() {
  const cur = currentSelection().modelId;
  if (isHivey(cur)) return cur;
  const persisted = settings.models && settings.models.openrouter;
  if (isHivey(persisted)) return persisted;
  return null;
}

function syncToggleVisibility() {
  // No-op: the control chips (incl. Web) are always visible now. Kept as a hook
  // in case provider-specific UI tweaks are needed later.
}
function updateImageNote() {
  // The "via <provider>" note was removed from the Image tab UI. Kept as a no-op so
  // existing call sites stay valid.
}
function populateImprovePresets() {
  els.improvePreset.innerHTML = "";
  // Placeholder = the control's label, shown as the resting display (no separate label text).
  const ph = document.createElement("option");
  ph.value = ""; ph.disabled = true; ph.selected = true;
  ph.textContent = t("improve.style");
  els.improvePreset.appendChild(ph);
  for (const [id] of WRITING_PRESETS) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = t("preset." + id);
    els.improvePreset.appendChild(o);
  }
  if (els.improvePreset._syncThemed) els.improvePreset._syncThemed();
}
// The Improve tab's TONE pin (right of the action). "auto" is the resting label ("Tone") = no directive.
function populateImproveTones() {
  els.improveTone.innerHTML = "";
  for (const id of WRITING_TONES) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = t("tone." + id);
    els.improveTone.appendChild(o);
  }
  if (els.improveTone._syncThemed) els.improveTone._syncThemed();
}
// Improve control = ONE button ("Improve", "Rewrite"…) that opens a single popup holding TWO separate
// lists: Action (left) and Tone (right). Keeps the two native <select>s (hidden) for state/persistence.
function setupImprovePicker() {
  const seg = document.querySelector("#improveControls .improve-seg");
  if (!seg || seg._picker) return;
  seg._picker = true;
  els.improvePreset.classList.add("native-hidden");
  els.improveTone.classList.add("native-hidden");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sec-analysis-btn improve-pick-btn";
  btn.innerHTML = '<span class="sa-label"></span><span class="sa-caret" aria-hidden="true"><svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 3l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.6"/></svg></span>';
  const label = btn.querySelector(".sa-label");
  const syncLabel = () => {
    const a = t("preset." + (els.improvePreset.value || "improve"));
    const tone = els.improveTone.value;
    label.textContent = tone && tone !== "auto" ? `${a} · ${t("tone." + tone)}` : a;
  };
  let menu = null;
  const closeMenu = () => { if (menu) menu.classList.add("hidden"); };
  const setSel = (sel, val) => { sel.value = val; sel.dispatchEvent(new Event("change", { bubbles: true })); syncLabel(); buildCols(); };
  const mkCol = (headKey, entries, curVal, onPick) => {
    const col = document.createElement("div"); col.className = "imp-col";
    const h = document.createElement("div"); h.className = "imp-col-head"; h.textContent = t(headKey); col.appendChild(h);
    const listEl = document.createElement("div"); listEl.className = "imp-col-list";
    for (const [val, txt] of entries) {
      const it = document.createElement("button"); it.type = "button";
      it.className = "imp-item" + (val === curVal ? " sel" : "");
      it.textContent = txt;
      it.addEventListener("click", (e) => { e.stopPropagation(); onPick(val); });
      listEl.appendChild(it);
    }
    col.appendChild(listEl); return col;
  };
  function buildCols() {
    if (!menu) return;
    menu.innerHTML = "";
    const cols = document.createElement("div"); cols.className = "imp-cols";
    cols.appendChild(mkCol("improve.style", WRITING_PRESETS.map(([id]) => [id, t("preset." + id)]), els.improvePreset.value || "improve", (v) => setSel(els.improvePreset, v)));
    cols.appendChild(mkCol("improve.tone", WRITING_TONES.map((id) => [id, t("tone." + id)]), els.improveTone.value || "auto", (v) => setSel(els.improveTone, v)));
    menu.appendChild(cols);
  }
  const openMenu = () => {
    if (menu && !menu.classList.contains("hidden")) { closeMenu(); return; }
    if (!menu) { menu = document.createElement("div"); menu.className = "improve-pick-menu hidden"; document.body.appendChild(menu); }
    buildCols();
    menu.classList.remove("hidden");
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
    const mh = menu.offsetHeight, above = r.top - 6 - mh;
    menu.style.top = (above > 8 ? above : Math.min(r.bottom + 6, window.innerHeight - mh - 8)) + "px";
    const closer = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) { closeMenu(); document.removeEventListener("mousedown", closer); } };
    setTimeout(() => document.addEventListener("mousedown", closer), 0);
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); openMenu(); });
  seg.appendChild(btn);
  els.improvePreset.addEventListener("change", syncLabel);
  els.improveTone.addEventListener("change", syncLabel);
  syncLabel();
}
// Assemble the Improve instruction from action + tone. Every fragment comes from i18n, so the whole
// instruction is in the user's UI language. (Length was dropped — Shorten/Expand already cover it.)
function improveInstruction(presetId, tone) {
  const parts = [t("presetPrompt." + (presetId || "improve"))];
  if (tone && tone !== "auto") parts.push(t("tonePrompt." + tone));
  return parts.join(" ");
}
function populateImageSizes() {
  els.imageSize.innerHTML = "";
  // Placeholder + default = the "Size" label (empty value): no fixed size — the model uses the
  // dimensions described in the prompt. It doubles as the control's resting label, and stays the
  // default so users can ask for custom sizes freely.
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t("image.customSize");
  none.title = t("size.none");
  els.imageSize.appendChild(none);
  for (const [value] of IMAGE_SIZES) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = t("size." + value);
    els.imageSize.appendChild(o);
  }
  if (els.imageSize._syncThemed) els.imageSize._syncThemed();
}

// Endonyms (each language written in its own script) for the translate target list. Keyed by the
// option value. Appended after the localized name as "Name — Endonym" so the list reads the way
// language pickers do worldwide. Languages whose endonym equals the displayed name (English,
// Afrikaans, Esperanto…) are intentionally omitted — the equality guard in decorateLangOptions()
// then shows just the name, which is ALSO what elegantly handles "don't write English — English"
// for the user's own UI language (e.g. FR UI → lang.French = "Français" == endonym → no dash).
const LANG_NATIVE = {
  French: "Français", Spanish: "Español", German: "Deutsch", Italian: "Italiano",
  Portuguese: "Português", Dutch: "Nederlands", Arabic: "العربية", Chinese: "简体中文",
  "Traditional Chinese": "繁體中文", Japanese: "日本語", Korean: "한국어", Russian: "Русский",
  Hindi: "हिन्दी", Bengali: "বাংলা", Turkish: "Türkçe", Polish: "Polski", Ukrainian: "Українська",
  Romanian: "Română", Greek: "Ελληνικά", Czech: "Čeština", Swedish: "Svenska", Danish: "Dansk",
  Norwegian: "Norsk", Finnish: "Suomi", Hungarian: "Magyar", Hebrew: "עברית", Thai: "ไทย",
  Vietnamese: "Tiếng Việt", Indonesian: "Bahasa Indonesia", Malay: "Bahasa Melayu", Filipino: "Tagalog",
  Persian: "فارسی", Urdu: "اردو", Swahili: "Kiswahili", Catalan: "Català", Croatian: "Hrvatski",
  Serbian: "Српски", Slovak: "Slovenčina", Slovenian: "Slovenščina", Bulgarian: "Български",
  Lithuanian: "Lietuvių", Latvian: "Latviešu", Estonian: "Eesti", Icelandic: "Íslenska",
  Irish: "Gaeilge", Welsh: "Cymraeg", Tamil: "தமிழ்", Telugu: "తెలుగు", Marathi: "मराठी",
  Gujarati: "ગુજરાતી", Punjabi: "ਪੰਜਾਬੀ", Kannada: "ಕನ್ನಡ", Malayalam: "മലയാളം", Nepali: "नेपाली",
  Sinhala: "සිංහල", Khmer: "ខ្មែរ", Lao: "ລາວ", Burmese: "မြန်မာ", Mongolian: "Монгол",
  Kazakh: "Қазақ", Azerbaijani: "Azərbaycan", Georgian: "ქართული", Armenian: "Հայերեն",
  Albanian: "Shqip", Macedonian: "Македонски", Belarusian: "Беларуская", Basque: "Euskara",
  Galician: "Galego", Latin: "Latina",
};
// Decorate each translate-target <option> as "Localized name — Endonym". Idempotent: the base name
// is always recomputed (localized via i18n for the ~11 translated keys, else the text before " — "),
// so re-running never doubles the endonym. The endonym is dropped when it equals the base name.
function decorateLangOptions() {
  const sel = els.translateLang;
  if (!sel) return;
  for (const o of sel.options) {
    if (!o.value) continue; // skip the "Translate to" placeholder
    const base = o.hasAttribute("data-i18n") ? t(o.getAttribute("data-i18n")) : o.textContent.split(" — ")[0].trim();
    const nat = LANG_NATIVE[o.value] || "";
    o.textContent = nat && nat.toLowerCase() !== base.toLowerCase() ? `${base} — ${nat}` : base;
  }
}

// Apply a "providerId|modelId" choice from a picker. Provider + model are written
// in ONE atomic storage write: two separate writes used to race the storage
// change-listener (which fired after the first), leaving the stale model selected
// — that was the Terminal picker "doesn't change / glitches" bug.
async function applyModelChoice(value) {
  const sel = parseSel(value);
  if (!sel.providerId) return null;
  settings.provider = sel.providerId;
  settings.models = { ...(settings.models || {}), [sel.providerId]: sel.modelId };
  await setSettings({ provider: sel.providerId, models: settings.models });
  return sel;
}

// A model was picked in the MAIN combobox.
async function onMainPick(value) {
  mainValue = value;
  // In the Image tab the picker selects an IMAGE model (provider + model used by
  // runImage), not the chat model.
  if (mode === "image") {
    const sel = parseSel(value);
    if (sel.providerId) {
      settings.imageProvider = sel.providerId;
      settings.imageModel = sel.modelId;
      await setSettings({ imageProvider: sel.providerId, imageModel: sel.modelId });
      updateImageNote();
    }
    return;
  }
  await applyModelChoice(value);
  // Remember this model for THIS workspace tab only (independent per mode).
  settings.modeSel = { ...(settings.modeSel || {}), [mode]: value };
  setSettings({ modeSel: settings.modeSel });
}

// One-click free onboarding: OAuth to OpenRouter (free models, no manual key).
async function doFreeConnect() {
  const prev = els.freeConnect.textContent;
  els.freeConnect.disabled = true;
  els.freeConnect.textContent = t("or.connecting");
  try {
    const key = await connectOpenRouter();
    settings.keys = { ...(settings.keys || {}), openrouter: key };
    settings.provider = "openrouter";
    // Atomic write of the full keys object + provider so the Settings page (which
    // reads keys.openrouter) reliably shows the key it just received.
    await setSettings({ keys: settings.keys, provider: "openrouter" });
    populateModelSelector();
    autoListConnected();
    // Sync the view to the tab the user is ON: flip the onboarding screen to the connected
    // greeting (tab icon + title) on a CLEAN conversation, refresh the model picker, and show a
    // transient confirmation — instead of leaving a persistent "connected" message that hid the
    // tab's empty state until the user re-clicked/switched tabs.
    refreshModelUI();
    updateEmptyState();
    flashTopBanner(t("or.connected")); // confirmation at the TOP of the response area (more readable)
  } catch (e) {
    addMessage("error", t("or.connectErr", { msg: e && e.message ? e.message : e }));
  } finally {
    els.freeConnect.disabled = false;
    els.freeConnect.textContent = prev;
  }
}

// Choose the MOST POWERFUL free OpenRouter model that's actually available on the
// account, ranked by a curated preference (DeepSeek R1 first, then V3, Llama 70B…).
// Falls back to any free model, then any model.
function bestFreeOpenRouter(rich) {
  const usable = rich.filter((m) => !m.prompt && !m.completion && !orUnavailable.has(m.id));
  // Prefer models that aren't on a rate-limit cooldown, but fall back to cooled ones if every
  // free model is currently cooling — better to try (and maybe 429 again) than to dead-end.
  const free = usable.filter((m) => !isCooled(m.id)).length
    ? usable.filter((m) => !isCooled(m.id))
    : usable;
  if (!free.length) {
    const any = rich.filter((m) => !orUnavailable.has(m.id));
    return any.length ? any[0].id : "";
  }
  const PREF = [
    "gpt-oss-120b", "gpt-oss-20b",
    "deepseek-chat-v3", "deepseek/deepseek-chat", "deepseek-v3",
    "llama-4-maverick", "llama-4-scout", "qwen3",
    "nemotron", "deepseek-r1",
    "gemini-2.0-flash", "llama-3.3-70b", "70b",
  ];
  for (const p of PREF) {
    const hit = free.find((m) => m.id.toLowerCase().includes(p));
    if (hit) return hit.id;
  }
  return free[0].id;
}
// 🐝 Hivey robustness: a hard-coded tier model can be missing from the account's live
// catalogue or have failed — swap it for a safe model in the SAME budget so a variant
// never dead-ends on an unavailable model. Free → best working free model; paid → the
// variant's chat/code/reasoning tier (whichever is available).
// True if a model id is a free OpenRouter model (price 0 in the live catalogue, or a
// :free id) — used to rotate only free models on rate limits.
function isFreeModelId(id) {
  if (/:free\b/.test(id || "")) return true;
  const m = (settings.orModels || []).find((x) => x.id === id);
  return !!(m && !m.prompt && !m.completion);
}
function ensureUsable(sel, hid) {
  if (!sel || sel.providerId !== "openrouter") return sel;
  const list = settings.orModels || [];
  if (!list.length) return sel; // catalogue not loaded yet — trust the configured id
  const here = (id) => list.some((x) => x.id === id) && !orUnavailable.has(id) && !isCooled(id);
  if (here(sel.modelId)) return sel;
  if (hid === "hivey/free") {
    const pick = bestFreeOpenRouter(list);
    return pick ? { providerId: "openrouter", modelId: pick } : sel;
  }
  const T = hiveyTiers(hid);
  for (const k of ["chat", "code", "reasoning"]) {
    const f = parseSel(T[k] || "");
    if (f.providerId === "openrouter" && here(f.modelId)) return f;
  }
  return sel; // give up gracefully — the error handler reports the real cause
}

// Best-effort: fetch the real available model list for every connected provider.
// OpenRouter gets a richer fetch (vendor + display name + pricing) for the
// hierarchical menu.
async function autoListConnected() {
  const ids = connectedProviders(settings);
  if (!ids.length) return;
  settings.modelLists = settings.modelLists || {};
  await Promise.allSettled(
    ids.map(async (pid) => {
      try {
        if (pid === "openrouter") {
          const rich = await listOpenRouterRich(settings);
          if (rich && rich.length) {
            settings.orModels = rich;
            settings.modelLists[pid] = rich.map((m) => m.id);
            // FIX: the hard-coded default free model (e.g. llama-3.3-70b:free) is
            // often unavailable/renamed on a given account, so it silently fails.
            // Pick a free model that ACTUALLY exists in this account's live list
            // (falling back to the first model) whenever the current choice isn't
            // in the list. This makes the out-of-the-box free default just work.
            const chosen = settings.models && settings.models.openrouter;
            // Keep the user's choice if it's valid: a real id present in the live list OR a
            // Hivey pseudo-id (🐝 Hivey Free isn't a literal OpenRouter id, so it would always
            // look "missing" and used to get silently replaced — that was the model changing
            // on its own). Only auto-pick a default when there is NO usable choice yet.
            const valid = chosen && (isHivey(chosen) || rich.some((m) => m.id === chosen));
            if (!valid) {
              const pick = bestFreeOpenRouter(rich);
              if (pick) {
                settings.models = { ...(settings.models || {}), openrouter: pick };
                await setSettings({ models: settings.models });
              }
            }
          }
        } else {
          const list = await listModels(pid, settings);
          if (list && list.length) settings.modelLists[pid] = list;
        }
      } catch (_) {}
    })
  );
  await setSettings({ modelLists: settings.modelLists, orModels: settings.orModels || [] });
  refreshModelUI();
}

// ----- Model picker: searchable combobox + price/provider filter -------------
const ALL_TIERS = ["free", "green", "yellow", "orange", "red"];
// Sentinel allow-list value meaning "nothing selected → hide all" (an empty [] keeps the
// historical meaning "no filter → show all", so this disambiguates the all-unchecked case).
const FILTER_NONE = "__filter_none__";
function filterState() {
  return settings.modelFilter || { tiers: [...ALL_TIERS], providers: [], subproviders: [] };
}
function filterIsActive() {
  const f = filterState();
  return (f.providers && f.providers.length > 0) || (f.subproviders && f.subproviders.length > 0) ||
    (f.tiers && f.tiers.length < ALL_TIERS.length);
}
// Does a combobox item pass the current price/provider filter + the typed query?
function comboPasses(it, q) {
  if (q) {
    const hay = (it.label + " " + it.value).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  // The 🐝 Hivey recommended rows (Smart / Hivey / Free) are pseudo-models, not catalogue entries —
  // their "tier" isn't a price bucket, so they must bypass the price/provider filter and always
  // show (otherwise the default all-buckets filter hid Smart/Hivey, whose tier is "paid").
  if (it.subprovider === "hivey") return true;
  const f = filterState();
  if (it.tier && f.tiers && f.tiers.length && !f.tiers.includes(it.tier)) return false;
  if (f.providers && f.providers.length && !f.providers.includes(it.provider)) return false;
  if (it.provider === "openrouter" && it.subprovider && f.subproviders && f.subproviders.length && !f.subproviders.includes(it.subprovider)) return false;
  return true;
}

// Reusable searchable combobox. `input` shows the selected label and is type-to-filter;
// `menu` is a floating list. `items()` returns {value,label,provider,subprovider,tier,
// color,group}; `getValue()`/`onPick(value)` read & set the selection.
function makeCombo({ input, menu, items, getValue, onPick, header }) {
  let openState = false;
  function curLabel() {
    const v = getValue();
    const it = items().find((x) => x.value === v);
    if (it) return it.label;
    if (!v) return "";
    // Not in the current list (e.g. OpenRouter momentarily disconnected / catalogue not loaded) —
    // resolve a friendly name instead of leaking the raw id like "hivey/hybrid".
    const id = v.includes("|") ? v.split("|")[1] : v;
    return (HIVEY_VARIANTS[id] && HIVEY_VARIANTS[id].label) || id;
  }
  function syncLabel() { input.value = curLabel(); } // the trigger always shows the CURRENT model
  let searchEl = null, listEl = null;
  // Rebuild ONLY the rows (keeps the in-menu search input + its focus intact).
  function buildList() {
    if (!listEl) return;
    const q = (searchEl && searchEl.value || "").trim().toLowerCase();
    const list = items().filter((it) => comboPasses(it, q));
    listEl.innerHTML = "";
    if (!list.length) {
      const d = document.createElement("div"); d.className = "combo-empty"; d.textContent = t("filter.noMatch"); listEl.appendChild(d);
      return;
    }
    const cur = getValue();
    let lastG = null;
    for (const it of list) {
      if (it.group && it.group !== lastG) {
        lastG = it.group;
        const h = document.createElement("div"); h.className = "combo-group"; h.textContent = it.group; listEl.appendChild(h);
      }
      const row = document.createElement("div");
      row.className = "combo-item" + (it.value === cur ? " sel" : "");
      if (it.badge) {
        row.classList.add("has-badge");
        const nm = document.createElement("span"); nm.className = "ci-name"; nm.textContent = it.label;
        const bd = document.createElement("span"); bd.className = "ci-badge";
        fillBadge(bd, it); // each segment keeps its OWN colour (accuracy %, then price)
        row.appendChild(nm); row.appendChild(bd);
        row.title = it.label + " · " + it.badge;
      } else {
        row.textContent = it.label;
        row.title = it.label;
        if (it.color) row.style.color = it.color;
      }
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(it); });
      listEl.appendChild(row);
    }
  }
  // Full menu = optional header + a SEARCH input (inside the list) + the scrollable rows. Keeps
  // the typed query/focus across re-renders (e.g. when the metric toggle redraws the header).
  function render() {
    const q = searchEl ? searchEl.value : "";
    const wasFocused = document.activeElement === searchEl;
    menu.innerHTML = "";
    if (header) { const h = header(rerender); if (h) menu.appendChild(h); }
    searchEl = document.createElement("input");
    searchEl.type = "text"; searchEl.className = "combo-search"; searchEl.autocomplete = "off"; searchEl.spellcheck = false;
    searchEl.placeholder = t("model.searchPh"); searchEl.value = q;
    searchEl.addEventListener("input", buildList);
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); }
      else if (e.key === "Enter") { e.preventDefault(); const f = listEl.querySelector(".combo-item"); if (f) f.dispatchEvent(new MouseEvent("mousedown")); }
    });
    menu.appendChild(searchEl);
    listEl = document.createElement("div"); listEl.className = "combo-list"; menu.appendChild(listEl);
    buildList();
    if (wasFocused) searchEl.focus();
  }
  function rerender() { render(); position(); }
  function position() {
    menu.classList.remove("hidden");
    const wrap = (input.closest && input.closest(".combo")) || input;
    const r = wrap.getBoundingClientRect();
    menu.style.minWidth = Math.max(Math.round(r.width), 300) + "px"; // as wide as the model picker
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }
  function open() { if (openState) return; openState = true; render(); position(); if (searchEl) searchEl.focus(); }
  function close() { openState = false; menu.classList.add("hidden"); syncLabel(); }
  function pick(it) { openState = false; menu.classList.add("hidden"); onPick(it.value); syncLabel(); }
  // The trigger just OPENS the popup (search/filter happens inside it) — never a text field.
  input.readOnly = true;
  input.addEventListener("mousedown", (e) => { e.preventDefault(); if (openState) close(); else open(); });
  return {
    refresh: () => { syncLabel(); if (openState) buildList(); },
    render: () => { if (openState) { render(); position(); } },
    close,
    isOpen: () => openState,
    input,
  };
}

// Filter applied to the per-message compare <select>s (native), which mirror the
// combobox filter. (The main + terminal pickers are comboboxes and filter internally.)
function applyModelFilter() {
  const f = filterState();
  const tiers = new Set(f.tiers || []);
  const provs = new Set(f.providers || []);
  const subs = new Set(f.subproviders || []);
  for (const sel of document.querySelectorAll(".cmp-select")) {
    const current = sel.value;
    for (const o of sel.querySelectorAll("option")) {
      if (!o.value || o.value === current) { o.hidden = false; continue; }
      if (o.dataset.subprovider === "hivey") { o.hidden = false; continue; } // 🐝 Hivey rows always show
      let vis = true;
      if (provs.size && o.dataset.provider && !provs.has(o.dataset.provider)) vis = false;
      if (vis && o.dataset.tier && tiers.size && !tiers.has(o.dataset.tier)) vis = false;
      if (vis && o.dataset.provider === "openrouter" && o.dataset.subprovider && subs.size && !subs.has(o.dataset.subprovider)) vis = false;
      o.hidden = !vis;
    }
    for (const g of sel.querySelectorAll("optgroup")) g.hidden = !Array.from(g.querySelectorAll("option")).some((o) => !o.hidden);
  }
}
function buildFilterPanel() {
  const f = filterState();
  const tiers = new Set(f.tiers || []);
  els.modelFilterPanel.querySelectorAll(".ftier-cb").forEach((cb) => { cb.checked = tiers.has(cb.value); });
  els.filterProviders.innerHTML = "";
  const provs = new Set(f.providers || []);
  const subs = new Set(f.subproviders || []);
  const connected = connectedProviders(settings);
  for (const pid of connected) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = pid; cb.checked = provs.size ? provs.has(pid) : true; cb.dataset.kind = "provider";
    cb.addEventListener("change", onProviderFilterChange);
    const sp = document.createElement("span");
    sp.textContent = PROVIDERS[pid] ? PROVIDERS[pid].label : pid;
    lab.appendChild(cb); lab.appendChild(sp);
    els.filterProviders.appendChild(lab);
    // OpenRouter: list its vendors as indented sub-providers so OpenRouter models can
    // be filtered by their origin (Google / OpenAI / Anthropic / Meta…).
    if (pid === "openrouter" && settings.orModels && settings.orModels.length) {
      const vendors = [...new Set(settings.orModels.filter((m) => !orUnavailable.has(m.id)).map((m) => m.id.split("/")[0] || "other"))].sort();
      for (const v of vendors) {
        const l2 = document.createElement("label"); l2.className = "subprov";
        const c2 = document.createElement("input");
        c2.type = "checkbox"; c2.value = v; c2.checked = subs.size ? subs.has(v) : true; c2.dataset.kind = "subprovider";
        c2.addEventListener("change", onSubproviderFilterChange);
        const s2 = document.createElement("span"); s2.textContent = prettifyVendor(v);
        l2.appendChild(c2); l2.appendChild(s2);
        els.filterProviders.appendChild(l2);
      }
    }
  }
}
function openFilterPanel(anchor) {
  buildFilterPanel();
  const p = els.modelFilterPanel;
  p.classList.remove("hidden");
  const r = anchor.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  p.style.left = left + "px";
  p.style.top = top + "px";
}
function toggleFilterPanel(anchor) {
  if (els.modelFilterPanel.classList.contains("hidden")) openFilterPanel(anchor);
  else els.modelFilterPanel.classList.add("hidden");
}
function persistFilter() {
  clearTimeout(filterPersistTimer);
  filterPersistTimer = setTimeout(() => setSettings({ modelFilter: settings.modelFilter }), 250);
}
// Re-render whatever is open after a filter change.
function afterFilterChange() {
  if (mainCombo) mainCombo.render();
  applyModelFilter();
  els.modelFilterBtn.classList.toggle("active", filterIsActive());
}
function onTierFilterChange() {
  const tiers = [];
  els.modelFilterPanel.querySelectorAll(".ftier-cb").forEach((cb) => { if (cb.checked) tiers.push(cb.value); });
  settings.modelFilter = { ...filterState(), tiers };
  persistFilter(); afterFilterChange();
}
function onProviderFilterChange(e) {
  // Toggling a provider mirrors onto its OpenRouter vendor checkboxes, so unchecking
  // OpenRouter visibly unchecks (and hides) ALL of its models — even when it's the only
  // connected provider (where an empty allow-list used to wrongly mean "show everything").
  if (e && e.target && e.target.value === "openrouter") {
    const on = e.target.checked;
    els.filterProviders.querySelectorAll('input[data-kind="subprovider"]').forEach((cb) => { cb.checked = on; });
  }
  const provs = [];
  els.filterProviders.querySelectorAll('input[data-kind="provider"]').forEach((cb) => { if (cb.checked) provs.push(cb.value); });
  const connected = connectedProviders(settings);
  let providers;
  if (provs.length === connected.length) providers = [];          // all checked → no filter
  else if (provs.length === 0) providers = [FILTER_NONE];         // none checked → hide everything
  else providers = provs;                                         // explicit allow-list
  // Recompute the vendor allow-list from the (possibly mirrored) checkboxes.
  const subBoxes = els.filterProviders.querySelectorAll('input[data-kind="subprovider"]');
  const subs = [];
  subBoxes.forEach((cb) => { if (cb.checked) subs.push(cb.value); });
  const subproviders = subBoxes.length === 0 ? [] : (subs.length === subBoxes.length ? [] : (subs.length === 0 ? [FILTER_NONE] : subs));
  settings.modelFilter = { ...filterState(), providers, subproviders };
  persistFilter(); afterFilterChange();
}
function onSubproviderFilterChange() {
  const all = els.filterProviders.querySelectorAll('input[data-kind="subprovider"]');
  const subs = [];
  all.forEach((cb) => { if (cb.checked) subs.push(cb.value); });
  const subproviders = subs.length === all.length ? [] : (subs.length === 0 ? [FILTER_NONE] : subs);
  settings.modelFilter = { ...filterState(), subproviders };
  persistFilter(); afterFilterChange();
}
function resetFilter() {
  settings.modelFilter = { tiers: [...ALL_TIERS], providers: [], subproviders: [] };
  persistFilter();
  buildFilterPanel();
  afterFilterChange();
}

// ----- Composer attachments (files / images as AI context) -------------------
async function addAttachmentFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    try { await readOneAttachment(file); }
    catch (_) { addMessage("error", t("attach.unsupported", { name: file.name })); }
  }
  renderAttachStrip();
}
async function readOneAttachment(file) {
  // .pcap capture → parse LOCALLY to an anonymised traffic summary (never the raw payloads) and attach
  // that text. Handled before the text-size cap since only the summary is kept.
  if (/\.(pcap|cap)$/i.test(file.name)) {
    if (file.size > 60 * 1024 * 1024) { addMessage("error", t("attach.tooBig", { name: file.name, mb: 60 })); return; }
    const sum = parsePcap(await file.arrayBuffer());
    if (!sum.ok) { addMessage("error", sum.error || t("attach.unsupported", { name: file.name })); return; }
    attachments.push({ type: "text", name: file.name, text: `[Packet capture summary — ${file.name} · parsed locally, no payloads]\n${sum.text}` });
    return;
  }
  const isImage = (file.type || "").startsWith("image/");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
  const maxMB = isImage ? ATT_IMG_MAX_MB : ATT_TXT_MAX_MB;
  if (file.size > maxMB * 1024 * 1024) { addMessage("error", t("attach.tooBig", { name: file.name, mb: maxMB })); return; }
  if (isZip) { await readZipAttachment(file); return; }
  if (isImage) {
    const dataUrl = await readFileAs(file, "dataURL");
    attachments.push({ type: "image", name: file.name, dataUrl, mediaType: file.type || "image/png" });
  } else if (isPdf) {
    const buf = await file.arrayBuffer();
    const { text, pages } = await extractPdfText(buf);
    attachments.push({ type: "text", name: file.name, text, isPdf: true, pages });
  } else {
    const text = await readFileAs(file, "text");
    attachments.push({ type: "text", name: file.name, text: text || "" });
  }
}
// Extract a .zip and attach its contents: each readable text file becomes a text
// attachment (its path + content), images become image attachments. Lets the AI see
// a whole codebase / set of files at once. Skips binaries and very large entries.
async function readZipAttachment(file) {
  if (!window.JSZip) { addMessage("error", t("attach.unsupported", { name: file.name })); return; }
  let zip;
  try { zip = await window.JSZip.loadAsync(await file.arrayBuffer()); }
  catch (_) { addMessage("error", t("attach.unsupported", { name: file.name })); return; }
  const base = file.name.replace(/\.zip$/i, "");
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  let added = 0;
  for (const entry of entries) {
    if (added >= 80) break; // safety cap on number of files
    const p = entry.name.replace(/^\/+/, "");
    if (!p || /(^|\/)(node_modules|\.git)\//.test(p)) continue;
    try {
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(p)) {
        const blob = await entry.async("blob");
        if (blob.size <= ATT_IMG_MAX_MB * 1024 * 1024) {
          const dataUrl = await readFileAs(blob, "dataURL");
          attachments.push({ type: "image", name: `${base}/${p}`, dataUrl, mediaType: blob.type || "image/png" });
          added++;
        }
        continue;
      }
      const u8 = await entry.async("uint8array");
      if (u8.length > 2 * 1024 * 1024 || u8.includes(0)) continue; // skip huge / binary files
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8); }
      catch (_) { continue; }
      attachments.push({ type: "text", name: `${base}/${p}`, text });
      added++;
    } catch (_) { /* skip unreadable entry */ }
  }
  // No "N files added" status line — the attachment strip already shows them, and we keep the
  // empty-state background until there's a real user message.
  if (!added) addMessage("error", t("attach.zipEmpty", { name: file.name }));
}
function readFileAs(file, how) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    if (how === "dataURL") r.readAsDataURL(file); else r.readAsText(file);
  });
}
async function extractPdfText(buf) {
  if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
  // `isEvalSupported: false` disables pdf.js's eval-based font path — the one CVE-2024-4367 abuses
  // to run JavaScript out of a malicious PDF. The extension CSP (script-src 'self') already blocks
  // eval outright, so this is belt AND braces: it keeps holding if that CSP is ever loosened.
  if (!pdfWorkerSet) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("vendor/pdf.worker.min.js"); pdfWorkerSet = true; }
  const doc = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || "").join(" ") + "\n\n";
  }
  return { text: text.trim(), pages: doc.numPages };
}
function attachIcon(a) { return a.type === "image" ? "🖼" : a.isPdf ? "📄" : "📎"; }
function renderAttachStrip() {
  els.attachStrip.innerHTML = "";
  els.attachStrip.classList.toggle("hidden", attachments.length === 0);
  if (attachments.length === 0) { closeContextPanel(); return; }
  // 1–2 files: show them as normal chips. 3+ : collapse into ONE foldable "Context"
  // chip you can open to view / rename / select / delete each file.
  if (attachments.length > 2) {
    const chip = document.createElement("div");
    chip.className = "attach-chip context-chip";
    const ic = document.createElement("span"); ic.textContent = "🗂"; chip.appendChild(ic);
    const name = document.createElement("span"); name.className = "acn"; name.textContent = t("attach.context", { n: attachments.length });
    chip.appendChild(name);
    const caret = document.createElement("span"); caret.className = "ctx-caret"; caret.textContent = "▾";
    chip.appendChild(caret);
    chip.addEventListener("click", (e) => { e.stopPropagation(); toggleContextPanel(); });
    els.attachStrip.appendChild(chip);
    if (contextPanelOpen) renderContextPanel();
    return;
  }
  closeContextPanel();
  attachments.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (a.type === "image") {
      const img = document.createElement("img"); img.src = a.dataUrl; chip.appendChild(img);
    } else {
      const ic = document.createElement("span"); ic.textContent = a.isPdf ? "📄" : "📎"; chip.appendChild(ic);
    }
    const name = document.createElement("span"); name.className = "acn"; name.textContent = a.name; chip.appendChild(name);
    const x = document.createElement("button"); x.className = "ax"; x.textContent = "✕"; x.title = t("attach.remove");
    x.addEventListener("click", () => { attachments.splice(i, 1); renderAttachStrip(); });
    chip.appendChild(x);
    els.attachStrip.appendChild(chip);
  });
}
function clearAttachments() { attachments = []; closeContextPanel(); renderAttachStrip(); }

// ----- "Context" panel: manage a large set of attachments ------------------
// When 3+ files are attached they collapse into one "Context (N)" chip. Clicking it
// opens this panel where each file can be viewed, renamed, ticked (for bulk delete) or
// removed individually.
let contextPanelEl = null;
let contextPanelOpen = false;
function ensureContextPanel() {
  if (contextPanelEl) return contextPanelEl;
  contextPanelEl = document.createElement("div");
  contextPanelEl.className = "ctx-panel hidden";
  contextPanelEl.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(contextPanelEl);
  return contextPanelEl;
}
function toggleContextPanel() {
  contextPanelOpen = !contextPanelOpen;
  if (contextPanelOpen) renderContextPanel();
  else closeContextPanel();
}
function closeContextPanel() {
  contextPanelOpen = false;
  if (contextPanelEl) contextPanelEl.classList.add("hidden");
}
function positionContextPanel(p) {
  // Float it just above the attach strip, spanning the sidebar width.
  const r = els.attachStrip.getBoundingClientRect();
  p.style.left = "8px";
  p.style.right = "8px";
  p.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + "px";
}
function renderContextPanel() {
  const p = ensureContextPanel();
  p.innerHTML = "";
  const head = document.createElement("div");
  head.className = "ctx-head";
  const title = document.createElement("span");
  title.className = "ctx-title";
  title.textContent = t("attach.context", { n: attachments.length });
  head.appendChild(title);
  const clearBtn = document.createElement("button");
  clearBtn.className = "ctx-clear";
  clearBtn.textContent = t("attach.clearAll");
  clearBtn.addEventListener("click", () => { clearAttachments(); });
  const closeBtn = document.createElement("button");
  closeBtn.className = "ctx-x";
  closeBtn.textContent = "✕";
  closeBtn.title = t("close.title");
  closeBtn.addEventListener("click", () => closeContextPanel());
  head.appendChild(clearBtn);
  head.appendChild(closeBtn);
  p.appendChild(head);
  // Hint: every ticked item is used as context (e.g. all images mixed for the next generation).
  const note = document.createElement("div");
  note.className = "ctx-note"; note.textContent = t("attach.includeNote");
  p.appendChild(note);

  const list = document.createElement("div");
  list.className = "ctx-list";
  attachments.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "ctx-row";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "ctx-cb";
    // Ticked = used as context (default ON, so ALL items — e.g. all images to mix — count by
    // default). Untick to exclude one from the next message WITHOUT deleting it (the ✕ deletes).
    cb.checked = a.ctxIncluded !== false;
    cb.title = t("attach.includeTitle");
    cb.addEventListener("change", () => { a.ctxIncluded = cb.checked; });
    row.appendChild(cb);
    const ic = document.createElement("span"); ic.className = "ctx-ic"; ic.textContent = attachIcon(a);
    row.appendChild(ic);
    const name = document.createElement("span");
    name.className = "ctx-name"; name.textContent = a.name; name.title = a.name;
    name.addEventListener("dblclick", () => startCtxRename(a, name, row));
    row.appendChild(name);
    const ren = document.createElement("button");
    ren.className = "ctx-act"; ren.textContent = "✎"; ren.title = t("attach.rename");
    ren.addEventListener("click", () => startCtxRename(a, name, row));
    row.appendChild(ren);
    const del = document.createElement("button");
    del.className = "ctx-act"; del.textContent = "✕"; del.title = t("attach.remove");
    del.addEventListener("click", () => {
      attachments.splice(i, 1);
      renderAttachStrip();
      if (attachments.length > 2) renderContextPanel(); else closeContextPanel();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
  p.appendChild(list);
  positionContextPanel(p);
  p.classList.remove("hidden");
}
function startCtxRename(a, nameEl, row) {
  const input = document.createElement("input");
  input.className = "ctx-rename";
  input.value = a.name;
  row.replaceChild(input, nameEl);
  input.focus(); input.select();
  let done = false;
  const commit = (save) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (save && v) a.name = v;
    renderAttachStrip();
    if (attachments.length > 2) { contextPanelOpen = true; renderContextPanel(); }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", () => commit(true));
}
// Split the pending attachments into the image list (for vision) + a folded text
// block (for any model) + render metadata for the user bubble.
function takeAttachments() {
  // Only items kept "included" in the context panel are sent (default = all included).
  const used = attachments.filter((a) => a.ctxIncluded !== false);
  const imgs = used.filter((a) => a.type === "image");
  const texts = used.filter((a) => a.type === "text");
  let textBlock = "";
  for (const a of texts) {
    const head = a.isPdf ? `[Attached PDF: ${a.name} (${a.pages} pages)]` : `[Attached file: ${a.name}]`;
    textBlock += `${head}\n${(a.text || "").slice(0, ATT_TXT_BUDGET)}\n\n`;
  }
  const meta = attachments.map((a) => ({ type: a.type, name: a.name, dataUrl: a.type === "image" ? a.dataUrl : undefined, isPdf: a.isPdf }));
  return { imgs, textBlock, meta };
}
// Build the native per-turn user content. With image attachments we switch to the
// provider's multimodal content array (Anthropic image blocks / OpenAI image_url).
function buildUserContent(text, imgs, providerId) {
  if (!imgs || !imgs.length) return text;
  const kind = (PROVIDERS[providerId] && PROVIDERS[providerId].kind) || "openai";
  if (kind === "anthropic") {
    const parts = [{ type: "text", text }];
    for (const a of imgs) {
      const m = /^data:([^;]+);base64,(.*)$/.exec(a.dataUrl || "");
      if (m) parts.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    return parts;
  }
  const parts = [{ type: "text", text }];
  for (const a of imgs) parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
  return parts;
}

// The tabs rail is an OVERLAY hidden by default: it peeks in on hover of the ☰ menu button
// and can be PINNED open by clicking it. `railHidden` (persisted) = not pinned.
// Background auras — colour/size/opacity, driven by settings and mirrored live into Hivey Code by the
// bridge. --aura-1 (left glow) follows the chosen aura colour (or the accent); --aura-2 (right glow)
// follows accent-2, matching Hivey Code's two-glow layout.
function applyAura() {
  const r = document.documentElement.style;
  const pal = effectivePalette(settings.theme || "dark", settings.themeColors);
  r.setProperty("--aura-1", (settings.auraColor || "").trim() || pal.accent || "#6366f1");
  r.setProperty("--aura-2", pal.accent2 || "#8b5cf6");
  r.setProperty("--aura-op", String(typeof settings.auraOpacity === "number" ? settings.auraOpacity : 0.12));
  r.setProperty("--aura-size", (typeof settings.auraSize === "number" ? settings.auraSize : 720) + "px");
}

let railPeekTimer = null;
function railPeek(on) {
  if (on) { clearTimeout(railPeekTimer); document.body.classList.add("rail-peek"); }
  else { clearTimeout(railPeekTimer); railPeekTimer = setTimeout(() => document.body.classList.remove("rail-peek"), 220); }
}
function applyRailPinned() {
  document.body.classList.toggle("rail-pinned", !settings.railHidden);
}
// Clicking the ☰ menu pins / unpins the rail open.
function toggleRail() {
  settings.railHidden = !settings.railHidden;
  applyRailPinned();
  setSettings({ railHidden: settings.railHidden });
}

// ----- Open in a full-screen tab --------------------------------------------
// Open the sidebar full-screen ON the conversation/workspace the user is currently
// looking at (the tab loads it from storage via ?mode= & ?conv=), and CLOSE the docked
// sidebar. CRUCIAL: sidebarAction.close() only works synchronously from a user gesture,
// so we run everything WITHOUT awaiting and call close() inside the same click tick.
function openInTab() {
  let url = browser.runtime.getURL("src/sidebar/sidebar.html") + "?tab=1";
  if (mode) url += "&mode=" + encodeURIComponent(mode);
  if (convId) url += "&conv=" + encodeURIComponent(convId);
  // The thread is already auto-saved after each turn; this just captures any last edit
  // (fire-and-forget so we never lose the click gesture before close()).
  try { saveCurrent(); } catch (_) {}
  try { browser.tabs.create({ url }); } catch (_) { window.open(url, "_blank", "noopener"); }
  try { if (browser.sidebarAction && browser.sidebarAction.close) browser.sidebarAction.close(); } catch (_) {}
}
// Reverse of openInTab: re-open the docked sidebar and close this full-screen tab, so the
// same "Agrandir" button toggles back. sidebarAction.open() MUST be called synchronously
// inside the click gesture (FIRST, before any await); only then do we save + close the tab
// (the tab stays alive until removed, so that work is safe to await).
function exitTab() {
  let opened = false;
  try { if (browser.sidebarAction && browser.sidebarAction.open) { browser.sidebarAction.open(); opened = true; } } catch (_) {}
  if (!opened) {
    try {
      const cr = (typeof chrome !== "undefined") ? chrome : null;
      const sp = cr && cr["sidePanel"];
      if (sp && sp.open) { sp.open({}).catch(() => {}); }
    } catch (_) {}
  }
  // Hand the reopened sidebar the conversation we were on, so it lands back on it.
  try { browser.storage.local.set({ pgReturn: { conv: convId, mode, ts: Date.now() } }); } catch (_) {}
  saveCurrent()
    .catch(() => {})
    .finally(() => {
      browser.tabs
        .getCurrent()
        .then((tb) => { if (tb) browser.tabs.remove(tb.id); })
        .catch(() => { try { window.close(); } catch (_) {} });
    });
}

// ----- Element picker -------------------------------------------------------
// "Ask about this element": the user points at a table / image / menu on the page;
// we capture its text + a cropped screenshot (vision) and stage them as attachments,
// so the next message can ask a question grounded in that exact element.
let picking = false;
let pickTabId = null;
// Web-tab selection (element pick / region capture) runs the picker on the active browser TAB
// directly (not through the `picking` state machine). We track it here so Esc can cancel it from
// the sidebar — otherwise focus sits in the cross-origin web iframe and Esc never reaches anything.
let webPick = null; // { tabId, cancelType: "pick_cancel" | "region_cancel" }
// Current theme accent colours, sent to the content script so its overlays
// (pick / region capture / agent glow) match the active theme.
function themeAccents() {
  const cs = getComputedStyle(document.documentElement);
  return {
    accent: (cs.getPropertyValue("--accent") || "#8b5cf6").trim(),
    accent2: (cs.getPropertyValue("--accent-2") || "#6366f1").trim(),
  };
}
async function getActiveTab() {
  // Robust across window setups: the sidebar's currentWindow can be ambiguous, so
  // fall back to the last-focused window, then any active tab.
  try {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || !tabs[0]) tabs = await browser.tabs.query({ active: true });
    return tabs && tabs[0] ? tabs[0] : null;
  } catch (_) { return null; }
}
async function getActiveTabId() {
  const pinned = getAgentTab && getAgentTab();
  if (pinned != null) return pinned; // glow/operate on the agent's dedicated tab, not the user's
  const t = await getActiveTab();
  return t ? t.id : null;
}
// Only genuinely privileged browser pages can't host a content script. Everything
// else — http(s) on any host/port, intranet, self-signed, deep-web services — must work.
function isRestrictedUrl(url) {
  return !url
    || /^(about:|moz-extension:|chrome:|chrome-extension:|resource:|view-source:|data:|javascript:|edge:|opera:|vivaldi:|brave:)/i.test(url)
    || /^https:\/\/(addons\.mozilla\.org|chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}
// captureVisibleTab / element-pick / page-reading all need host access to the current page.
// `<all_urls>` is declared in `optional_host_permissions` (NOT required) precisely so we can
// obtain it at runtime with permissions.request() — which only works for OPTIONAL permissions,
// on BOTH Chrome and Firefox. (When it was a REQUIRED host permission, request() was rejected on
// both browsers, and an install/update where the user hadn't granted all-sites access left
// captureVisibleTab throwing "Missing activeTab permission" with no way to fix it in-page.)
//
// This MUST run synchronously inside the click gesture (request() needs a user gesture), so it's
// called FIRST in each tool's click handler. Returns true only once we genuinely hold the grant.
async function hasAllUrls() {
  try {
    if (browser.permissions && browser.permissions.contains) {
      return !!(await browser.permissions.contains({ origins: ["<all_urls>"] }));
    }
  } catch (_) {}
  return false;
}
async function ensurePagePermission() {
  // The proven config (restored from v1.22.3, which fixed exactly this): `<all_urls>` is declared in
  // BOTH host_permissions AND optional_host_permissions, so permissions.request() is allowed and will
  // grant it. request() MUST be the FIRST awaited call — it only works while the browser is still
  // handling the click, so ANY prior await (e.g. permissions.contains) would break the gesture and
  // make it reject. If it's already granted, request() resolves true with no prompt.
  try {
    if (!browser.permissions || !browser.permissions.request) return true;
    const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
    return !!granted;
  } catch (_) {
    return false;
  }
}

// Send a message to the tab's content script. If it isn't there yet (the page was
// open before the extension loaded / before host access was granted), inject it on
// demand and retry. Designed to work on EVERY scriptable page — http(s) on any host
// or port, intranet, self-signed, deep-web web services. Throws only if the page is
// truly unscriptable (a privileged browser page) or injection keeps failing.
const CONTENT_FILES = ["vendor/browser-polyfill.min.js", "src/content/content.js"];
async function sendToTab(tabId, msg) {
  // 1) Fast path: the content script is already present.
  try { return await browser.tabs.sendMessage(tabId, msg); } catch (_) {}
  // 2) Inject on demand. Try the top frame first, then all frames (some apps live
  //    inside a child frame), tolerating "already injected" errors.
  let injected = false;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    injected = true;
  } catch (_) {
    try {
      await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
      injected = true;
    } catch (_) {}
  }
  if (!injected) throw new Error("cannot inject content script on this page");
  // 3) The freshly-registered listener may need a tick — retry a few times.
  for (let i = 0; i < 5; i++) {
    try { return await browser.tabs.sendMessage(tabId, msg); }
    catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("content script unreachable after injection");
}
// ----- Agent activity glow --------------------------------------------------
// A pulsing border on the page the agent is acting on (à la Perplexity). We glow the
// ACTIVE tab and re-assert it as the agent navigates/switches; cleared when it stops.
const glowedTabs = new Set();
// Mirror the glowed tabs (+ theme accents) to storage.session so the document_start frame script
// (via the background) can redraw the frame instantly on every navigation — including DURING the
// page load, which a content script injected at document_idle can't cover.
function syncGlowStorage() {
  try {
    const acc = themeAccents();
    const map = {};
    for (const id of glowedTabs) map[id] = acc;
    browser.storage.session.set({ hiveyGlowTabs: map }).catch(() => {});
  } catch (_) {}
}
async function agentGlowActiveTab() {
  try {
    // Glow the tab the agent is PINNED to (its work tab), not whatever tab is live now — the
    // user may have switched away to keep browsing. Falls back to the active tab if not pinned.
    let id = getAgentTab();
    if (id == null) id = await getActiveTabId();
    if (id == null) return;
    glowedTabs.add(id);
    syncGlowStorage();
    try { browser.tabs.onUpdated.addListener(reglowOnLoad); } catch (_) {} // idempotent: re-frame after navigations
    try { await sendToTab(id, { type: "agent_glow", on: true, ...themeAccents() }); } catch (_) {}
  } catch (_) {}
}
async function clearAgentGlow() {
  for (const id of Array.from(glowedTabs)) {
    try { await browser.tabs.sendMessage(id, { type: "agent_glow", on: false }); } catch (_) {}
  }
  glowedTabs.clear();
  syncGlowStorage();
  try { browser.tabs.onUpdated.removeListener(reglowOnLoad); } catch (_) {}
}
// A navigation wipes the page DOM — including our injected glow frame. So the moment an
// agent-controlled tab finishes (re)loading, re-assert the frame, BEFORE the next in-page action
// (e.g. pressing play). Without this the takeover frame only came back on the next tool result,
// so the user saw the page navigate and the video start BEFORE the frame reappeared. Registered
// lazily on the first glow and removed in clearAgentGlow.
function reglowOnLoad(tabId, info) {
  // Re-assert on BOTH 'loading' (the new document just started → re-draw the frame ASAP, shrinking
  // the gap so it barely blinks) and 'complete' (guarantees it's there if the early inject lost a
  // race). setAgentGlow is idempotent, so the second send is a no-op when the frame already exists.
  if ((info.status === "loading" || info.status === "complete") && glowedTabs.has(tabId)) {
    sendToTab(tabId, { type: "agent_glow", on: true, ...themeAccents() }).catch(() => {});
  }
}
// The agent works in a DEDICATED tab it opens at the start of a run (ensureAgentTab), so it never
// overwrites the tab the user is on. Every tool targets that pinned id (not the live active tab),
// so the user can keep browsing their own tabs while it runs; the glow stays on the work tab. The
// work tab is seeded with the user's current page so "act on this page" tasks keep their context.
async function ensureAgentTab() {
  // Reuse the dedicated tab if it's still open (this runs on EVERY agent message — we must NOT
  // spawn a new tab each turn).
  try {
    const existing = getAgentTab();
    if (existing != null) {
      try { const t = await browser.tabs.get(existing); if (t) return; } catch (_) {} // closed → recreate below
    }
  } catch (_) {}
  // Open a DEDICATED, BLANK new tab for the agent to work in, and focus it — so it never overwrites
  // the tab the user is on and never starts on whatever page they happened to be looking at (e.g.
  // it must NOT auto-launch on YouTube). The model still gets the current page's content via the
  // [Active page context] block, so "act on this page" tasks keep their context; the agent just
  // navigates the blank tab itself when needed. Left open when the run ends.
  try {
    const created = await browser.tabs.create({ active: true }); // blank tab (about:newtab/blank)
    if (created && created.id != null) {
      setAgentTab(created.id);
      // Wait briefly for the tab to be ready (bounded so we never hang the run).
      for (let i = 0; i < 40; i++) {
        let st = null;
        try { const tt = await browser.tabs.get(created.id); st = tt && tt.status; } catch (_) { break; }
        if (st === "complete") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return;
    }
  } catch (_) {}
  // Fallback: pin the current tab (legacy behaviour) if creating a tab failed.
  try { const [atab] = await browser.tabs.query({ active: true, currentWindow: true }); if (atab) setAgentTab(atab.id); } catch (_) {}
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
// Screenshot a tab. Prefers Firefox's captureTab(tabId), which is satisfied by the <all_urls> host
// permission alone and does NOT demand `activeTab` the way captureVisibleTab does from a sidebar
// context — so the sidebar tools capture without the right-click. Falls back to captureVisibleTab
// (Chrome / older Firefox). Returns a data: URL or throws with a readable message.
async function captureVisible(tabId, winId) {
  if (browser.tabs.captureTab && tabId != null) {
    try { return await browser.tabs.captureTab(tabId, { format: "png" }); } catch (_) {}
  }
  return await browser.tabs.captureVisibleTab(winId, { format: "png" });
}
function cropFromShot(img, rect, dpr) {
  const sx = Math.max(0, rect.x * dpr), sy = Math.max(0, rect.y * dpr);
  const sw = Math.min(img.width - sx, rect.w * dpr), sh = Math.min(img.height - sy, rect.h * dpr);
  if (sw <= 4 || sh <= 4) return null; // off-screen / tiny → no usable crop
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw); canvas.height = Math.round(sh);
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
// Crop a rect (given in CSS px) from an image using independent X/Y scale factors — used for the
// getDisplayMedia frame, whose pixel size differs from the page's CSS viewport.
function cropScaled(img, rect, scaleX, scaleY) {
  const sx = Math.max(0, rect.x * scaleX), sy = Math.max(0, rect.y * scaleY);
  const sw = Math.min(img.width - sx, rect.w * scaleX), sh = Math.min(img.height - sy, rect.h * scaleY);
  if (sw <= 4 || sh <= 4) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw); canvas.height = Math.round(sh);
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
// Grab a single still frame (data URL) from a MediaStream (getDisplayMedia).
function frameFromStream(stream) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    const grab = () => {
      // A short delay so the first real frame is painted before we read it.
      setTimeout(() => {
        try {
          const w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return reject(new Error("empty video frame"));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(video, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) { reject(e); }
      }, 140);
    };
    video.onloadedmetadata = () => { video.play().then(grab).catch(reject); };
    video.onerror = () => reject(new Error("video error"));
  });
}
// A confirmation banner pinned at the TOP of the response area (more readable than a corner
// toast) — e.g. after a quick-connect. Auto-dismisses; replaced on repeat.
function flashTopBanner(msg) {
  // Float it OVER the response area (overlay) instead of pushing the content down — anchored to
  // #workArea (non-scrolling, position:relative) so it stays put while messages scroll.
  const host = document.getElementById("workArea") || els.messages;
  if (!host) return;
  let b = document.getElementById("topBanner");
  if (!b) { b = document.createElement("div"); b.id = "topBanner"; b.className = "top-banner"; }
  b.textContent = msg;
  host.appendChild(b);
  void b.offsetWidth; b.classList.add("show");
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove("show"); setTimeout(() => { if (b.parentNode) b.remove(); }, 300); }, 5000);
}
// UX while a selection tool is active: a clear banner in the sidebar telling the user to go
// click on the page (and how to cancel). Shown for element-pick AND region-capture, on every
// tab (Chat, the new selector tabs, and the Web tab).
let pickBannerEl = null;
function setPickBanner(on) {
  if (on) {
    if (!pickBannerEl) {
      pickBannerEl = document.createElement("div");
      pickBannerEl.className = "pick-banner";
      document.body.appendChild(pickBannerEl);
    }
    pickBannerEl.textContent = t("pick.banner");
    pickBannerEl.classList.remove("hidden");
  } else if (pickBannerEl) {
    pickBannerEl.classList.add("hidden");
  }
}
function finishPicking() { picking = false; pickTabId = null; els.pickEl.classList.remove("active"); setPickBanner(false); }
// Cancel an in-progress pick (re-click the button, click in the sidebar, or Esc).
function cancelPicking() {
  if (!picking) return;
  setPickBanner(false);
  const id = pickTabId;
  if (id != null) { try { browser.tabs.sendMessage(id, { type: "pick_cancel" }); } catch (_) {} }
}
async function pickElement() {
  if (picking || capturing) return;
  const tab = await getActiveTab();
  if (!tab) { addMessage("error", t("pick.error")); return; }
  if (isRestrictedUrl(tab.url)) { addMessage("error", t("pick.restricted")); return; }
  const tabId = tab.id;
  if (!["chat","agent","translate","improve","image","pdf"].includes(mode)) setMode("chat");
  picking = true; pickTabId = tabId; els.pickEl.classList.add("active"); setPickBanner(true);
  const note = { remove() {} }; // no response-area status message (banner covers it; keep empty state)
  let res;
  try {
    res = await sendToTab(tabId, { type: "pick_element", ...themeAccents() });
  } catch (_) {
    note.remove(); finishPicking();
    addMessage("error", t("region.reload"));
    return;
  }
  note.remove(); finishPicking();
  if (res === undefined) { addMessage("error", t("region.reload")); return; } // stale content script
  const list = (res && res.elements) || [];
  if (!res || res.cancelled || !list.length) return;
  // One screenshot of the current viewport; crop each selected element from it.
  let img = null;
  try {
    await new Promise((r) => setTimeout(r, 140));
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const winId = tabs && tabs[0] ? tabs[0].windowId : undefined;
    img = await loadImage(await browser.tabs.captureVisibleTab(winId, { format: "png" }));
  } catch (_) {}
  for (const el of list) {
    if (img) { const crop = cropFromShot(img, el.rect, res.dpr || 1); if (crop) attachments.push({ type: "image", name: t("pick.imgName", { tag: el.tag }), dataUrl: crop, mediaType: "image/png" }); }
    if (el.text) attachments.push({ type: "text", name: t("pick.attName", { tag: el.tag }), text: `[Selected <${el.tag}> on ${res.title} — ${res.url}]\n${el.text}` });
  }
  renderAttachStrip();
  els.input.focus();
}

// ----- Region capture (screenshot tool) -------------------------------------
// "Capture an area": the user draws a rectangle over the page; we crop that region
// from a screenshot and stage it as an IMAGE attachment (vision), so the next message
// can ask about exactly what's on screen — like the Hivey Code capture tool.
let capturing = false;
function finishCapture() { capturing = false; pickTabId = null; els.captureRegion.classList.remove("active"); setPickBanner(false); }
function cancelCapture() {
  if (!capturing) return;
  const id = pickTabId;
  if (id != null) { try { browser.tabs.sendMessage(id, { type: "region_cancel" }); } catch (_) {} }
  // Reset our own state unconditionally — never leave the tool wedged in "capturing" (which would
  // make every later click a no-op) just because there was no tab to message.
  finishCapture();
}
async function captureRegion() {
  if (capturing || picking) return;
  const tab = await getActiveTab();
  if (!tab) { addMessage("error", t("pick.error")); return; }
  if (isRestrictedUrl(tab.url)) { addMessage("error", t("pick.restricted")); return; }
  const tabId = tab.id;
  if (!["chat","agent","translate","improve","image","pdf"].includes(mode)) setMode("chat");
  capturing = true; pickTabId = tabId; els.captureRegion.classList.add("active"); setPickBanner(true);
  // No status message in the response area — the on-screen banner (setPickBanner) already tells the
  // user to draw, and we keep the empty-state background until there's a real user message.
  const note = { remove() {} };
  let res;
  try {
    res = await sendToTab(tabId, { type: "capture_region", ...themeAccents() });
  } catch (_) {
    note.remove(); finishCapture();
    addMessage("error", t("region.reload"));
    return;
  }
  note.remove(); finishCapture();
  // A stale content script (page loaded before this update) ignores the message and
  // returns undefined — tell the user to refresh the page once.
  if (res === undefined) { addMessage("error", t("region.reload")); return; }
  if (!res || res.cancelled || !res.rect) return;
  // Screenshot the viewport (overlay already removed), then crop the chosen rectangle.
  let img = null, capErr = "";
  try {
    await new Promise((r) => setTimeout(r, 140));
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const winId = tabs && tabs[0] ? tabs[0].windowId : undefined;
    img = await loadImage(await browser.tabs.captureVisibleTab(winId, { format: "png" }));
  } catch (e) { capErr = (e && e.message) || String(e); }
  if (!img) {
    // The host-grant reload is handled ONCE at startup (background), so we don't reload mid-capture
    // here anymore — that was what reset the chat / forced a re-select on the first use.
    addMessage("error", t("region.error") + (capErr ? " — " + capErr : ""));
    return;
  }
  const crop = cropFromShot(img, res.rect, res.dpr || 1);
  if (!crop) { addMessage("error", t("region.error")); return; }
  attachments.push({ type: "image", name: t("region.imgName"), dataUrl: crop, mediaType: "image/png" });
  renderAttachStrip();
  els.input.focus();
}

// ----- Benchmark workspace --------------------------------------------------
// Built lazily on first open: nobody should pay a table render, a catalogue fetch and a storage
// read for a workspace they never visit.
let _benchView = null;
function benchmarkView() {
  if (_benchView) return _benchView;
  _benchView = initBenchmarkView({
    els,
    t,
    load: async (k) => { try { return (await browser.storage.local.get(k))[k]; } catch (_) { return null; } },
    save: async (k, v) => { try { await browser.storage.local.set({ [k]: v }); } catch (_) {} },
    // Public endpoint: the table shows prices and context sizes before any key is entered.
    fetchCatalogue: async () => {
      const r = await fetch("https://openrouter.ai/api/v1/models");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()).data || []).filter((m) => m && m.id && !/^~/.test(m.id));
    },
    // The live test is BYOK like everything else here, and it spends the user's money, so it
    // refuses rather than falling back to some other provider they did not choose.
    callModel: async ({ model, messages, tools }) => {
      const key = keyFor("openrouter", settings);
      if (!key) return { error: t("bench.noKey") };
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, tools, max_tokens: 4000, temperature: 0, usage: { include: true } }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { error: (j.error && j.error.message) || `HTTP ${r.status}` };
        const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
        return { text: (m.content || "").trim(), toolCalls: m.tool_calls || [], cost: (j.usage && j.usage.cost) || 0 };
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
      }
    },
  });
  return _benchView;
}

// ----- Workspace modes ------------------------------------------------------
// ── Rail layout: user-defined ORDER (drag to reorder) + per-tab VISIBILITY (Settings). The
// rail markup is static, so we reorder/hide the buttons from settings at runtime. `web` and
// `code` can be hidden like any other; if the active tab gets hidden we fall back to Chat.
const RAIL_MODES = ["chat", "web", "agent", "translate", "improve", "image", "pdf", "security", "wisebase", "benchmark", "code"];
function railTabEls() { return Array.from(els.rail.querySelectorAll(".railtab:not(.rail-add)")); }
function applyRailLayout() {
  if (!els.rail) return;
  const byMode = {};
  railTabEls().forEach((b) => { byMode[b.dataset.mode] = b; });
  const saved = Array.isArray(settings.railOrder) ? settings.railOrder : [];
  // Saved order first (only modes that still exist), then insert any NEW tab (e.g. security) at its
  // CANONICAL position from RAIL_MODES — not dumped at the end — so it lands where it belongs.
  const order = saved.filter((m) => byMode[m]);
  for (const m of RAIL_MODES) {
    if (!byMode[m] || order.includes(m)) continue;
    const canon = RAIL_MODES.indexOf(m);
    let at = order.length;
    for (let i = 0; i < order.length; i++) {
      if (RAIL_MODES.indexOf(order[i]) > canon) { at = i; break; }
    }
    order.splice(at, 0, m);
  }
  order.forEach((m) => els.rail.appendChild(byMode[m])); // re-append in order
  const hidden = new Set(Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : []);
  RAIL_MODES.forEach((m) => { if (byMode[m]) byMode[m].classList.toggle("rail-tab-hidden", hidden.has(m)); });
  // If the currently active tab was just hidden, fall back to Chat.
  if (hidden.has(mode)) { if (mode === "web") closeWebPanel(); setMode("chat"); }
  updateRailAddBtn();
}
// A small "+" at the BOTTOM of the rail to quickly re-show hidden tabs (only visible when some
// tabs are hidden). Clicking it opens a little menu of the hidden workspaces.
function updateRailAddBtn() {
  if (!els.railAddBtn) return;
  els.rail.appendChild(els.railAddBtn); // keep it pinned at the very bottom after re-ordering
  const hidden = Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : [];
  els.railAddBtn.classList.toggle("rail-add-show", hidden.length > 0); // show ONLY when something is hidden
  if (!hidden.length && els.railAddMenu) els.railAddMenu.classList.add("hidden");
}
function buildRailAddMenu() {
  if (!els.railAddMenu) return;
  const hidden = Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : [];
  els.railAddMenu.innerHTML = "";
  if (!hidden.length) { // nothing hidden → a friendly hint instead of an empty menu
    const note = document.createElement("div");
    note.className = "rail-add-empty";
    note.textContent = t("rail.noneHidden");
    els.railAddMenu.appendChild(note);
  }
  hidden.forEach((m) => {
    const item = document.createElement("button");
    item.type = "button"; item.className = "rail-add-item"; item.dataset.mode = m;
    const src = els.rail.querySelector('.railtab[data-mode="' + m + '"] svg');
    if (src) { const ic = src.cloneNode(true); ic.removeAttribute("class"); item.appendChild(ic); }
    const lbl = document.createElement("span");
    lbl.textContent = t("rail." + m + "Title") || m;
    item.appendChild(lbl);
    item.addEventListener("click", (e) => { e.stopPropagation(); unhideTab(m); });
    els.railAddMenu.appendChild(item);
  });
  // Anchor next to the "+" button, on whichever side the rail sits.
  const railRect = els.rail.getBoundingClientRect();
  const btnRect = els.railAddBtn.getBoundingClientRect();
  els.railAddMenu.style.top = Math.max(8, Math.min(btnRect.top - 4, window.innerHeight - 220)) + "px";
  if (document.body.classList.contains("rail-right")) {
    els.railAddMenu.style.right = (window.innerWidth - railRect.left + 6) + "px";
    els.railAddMenu.style.left = "auto";
  } else {
    els.railAddMenu.style.left = (railRect.right + 6) + "px";
    els.railAddMenu.style.right = "auto";
  }
}
function toggleRailAddMenu() {
  if (!els.railAddMenu) return;
  const willOpen = els.railAddMenu.classList.contains("hidden");
  if (willOpen) buildRailAddMenu();
  els.railAddMenu.classList.toggle("hidden", !willOpen);
}
function unhideTab(m) {
  const hidden = new Set(Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : []);
  hidden.delete(m);
  settings.railTabsHidden = [...hidden];
  setSettings({ railTabsHidden: settings.railTabsHidden });
  applyRailLayout();
  if (els.railAddMenu) els.railAddMenu.classList.add("hidden");
  setMode(m); // jump straight to the freshly-revealed workspace
}
// Right-clicking a tab asks for confirmation (small popup at the cursor) before hiding it.
let hideConfirmEl = null;
function closeHideConfirm() { if (hideConfirmEl) { hideConfirmEl.remove(); hideConfirmEl = null; } }
function doHideTab(m) {
  const hidden = new Set(Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : []);
  hidden.add(m);
  settings.railTabsHidden = [...hidden];
  setSettings({ railTabsHidden: settings.railTabsHidden });
  applyRailLayout();
}
function askHideTab(m, x, y) {
  closeHideConfirm();
  const label = t("rail." + m + "Title") || m;
  const pop = document.createElement("div");
  pop.className = "rail-confirm";
  const msg = document.createElement("div");
  msg.className = "rail-confirm-msg";
  msg.textContent = t("rail.hideConfirm", { tab: label });
  const row = document.createElement("div");
  row.className = "rail-confirm-row";
  const no = document.createElement("button");
  no.className = "rc-no"; no.textContent = t("rail.hideCancel");
  no.addEventListener("click", (e) => { e.stopPropagation(); closeHideConfirm(); });
  const yes = document.createElement("button");
  yes.className = "rc-yes"; yes.textContent = t("rail.hideOk");
  yes.addEventListener("click", (e) => { e.stopPropagation(); closeHideConfirm(); doHideTab(m); });
  row.appendChild(no); row.appendChild(yes);
  pop.appendChild(msg); pop.appendChild(row);
  document.body.appendChild(pop);
  hideConfirmEl = pop;
  const w = pop.offsetWidth || 210, h = pop.offsetHeight || 92;
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
  pop.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + "px";
}
function persistRailOrder() {
  settings.railOrder = railTabEls().map((b) => b.dataset.mode);
  setSettings({ railOrder: settings.railOrder });
}
function setupRailDnD() {
  let dragEl = null;
  railTabEls().forEach((b) => {
    b.setAttribute("draggable", "true");
    b.addEventListener("dragstart", (e) => {
      dragEl = b; b.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.dataset.mode); } catch (_) {}
    });
    b.addEventListener("dragend", () => { b.classList.remove("dragging"); dragEl = null; persistRailOrder(); });
    b.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === b) return;
      const r = b.getBoundingClientRect();
      // Vertical rail → compare on Y; insert before/after the hovered tab.
      const after = (e.clientY - r.top) > r.height / 2;
      els.rail.insertBefore(dragEl, after ? b.nextSibling : b);
    });
  });
}

function setMode(next) {
  const prev = mode;
  if (prev !== next && els.searchBar && !els.searchBar.classList.contains("hidden")) closeSearch();
  // Save the conversation we're leaving (data + DOM nodes), then point the globals
  // at the target workspace's own conversation.
  if (prev !== next && CHAT_MODES.includes(prev)) { syncSessionFromGlobals(prev); stashMode(prev); }
  mode = next;
  settings.mode = next;
  setSettings({ mode: next });
  if (CHAT_MODES.includes(next)) { loadSessionToGlobals(next); applyModeToggles(next); }
  els.rail.querySelectorAll(".railtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === next);
    if (b.dataset.mode === next) b.classList.remove("tab-done"); // clear the "answer ready" dot
  });
  refreshBrandDone(); // update the logo's "answer ready" dot after clearing the entered tab
  // The Thinking/Web/Page toggles (now inside the composer) belong to Chat only.
  els.chatControls.classList.toggle("hidden", !["chat", "wisebase"].includes(next));
  els.translateControls.classList.toggle("hidden", next !== "translate");
  els.improveControls.classList.toggle("hidden", next !== "improve");
  els.imageControls.classList.toggle("hidden", next !== "image");
  els.pdfControls.classList.toggle("hidden", next !== "pdf");
  els.wisebaseControls.classList.toggle("hidden", next !== "wisebase");
  // The per-mode controls row is only useful for translate/improve/image/pdf/wisebase; hide it
  // entirely on Chat/Agent/Code so there's no empty bar.
  els.controls.hidden = !["translate", "improve", "image", "pdf", "wisebase"].includes(next)
    || (next === "pdf" && pdfs.length === 0); // PDF tab: no empty bar — it appears once a PDF is added via "+"
  // Attach (+) is offered on Chat/Agent/Translate/Improve/Image + Security (for .pcap/logs) + PDF
  // (the "+" replaces the old "Load PDF" button — a PDF-only picker in the composer).
  const composeExtras = ["chat", "agent", "translate", "improve", "image", "security", "wisebase", "pdf"].includes(next);
  els.attachBtn.hidden = !composeExtras;
  if (!composeExtras && attachments.length) clearAttachments();
  // On the Chat tab the "+" sits at the bottom-left (beside the toggles), with the 🎙 mic
  // right after it; on every other tab the "+" sits next to the text in the first row and the
  // mic stays at the end of that row.
  // Stop button: stays in the bottom-right toggles row on Chat/Web/Code; on the other composer tabs
  // (agent/translate/improve/image/pdf/security) it sits just LEFT of the mic on the input row.
  const stopLeftOfMic = !["chat", "web", "code", "wisebase"].includes(next);
  const toolsRight = document.querySelector(".tools-right");
  if (["chat", "wisebase"].includes(next)) {
    // Wisebase uses the EXACT Chat composer layout (attach + mic bottom-left, stop on the right).
    els.toolsLeft.appendChild(els.attachBtn);
    if (els.dictateBtn) els.toolsLeft.appendChild(els.dictateBtn); // mic to the right of "+"
  } else {
    els.composerMain.insertBefore(els.attachBtn, els.input);
    if (stopLeftOfMic && els.stop) els.composerMain.appendChild(els.stop); // stop → left of the mic
    if (els.dictateBtn) els.composerMain.appendChild(els.dictateBtn); // mic at the row's end
  }
  if (!stopLeftOfMic && els.stop && toolsRight && els.stop.parentElement !== toolsRight) {
    toolsRight.appendChild(els.stop); // back to its home on Chat/Web/Code
  }
  els.modelFilterPanel.classList.add("hidden");
  if (mainCombo) mainCombo.close();
  document.body.classList.toggle("mode-code", next === "code");
  document.body.classList.toggle("mode-wisebase", next === "wisebase");
  document.body.classList.toggle("mode-chat", next === "chat"); // options ⚙ + first-line text are chat-only
  if (next === "wisebase" && typeof onEnterWisebase === "function") onEnterWisebase();
  // 📚 Prompt library button → Chat + Wisebase (both are full chat composers).
  const plb = document.getElementById("promptLibBtn");
  if (plb) plb.hidden = !["chat", "wisebase"].includes(next);
  if (!["chat", "wisebase"].includes(next) && promptLibPanel) promptLibPanel.classList.add("hidden");
  // 🛡 Cyber recipes → Security tab only.
  renderSecRecipes(next);
  if (els.secHeadersBtn) els.secHeadersBtn.classList.toggle("hidden", next !== "security");
  els.codeView.classList.toggle("hidden", next !== "code");
  els.benchmarkView.classList.toggle("hidden", next !== "benchmark");
  document.body.classList.toggle("mode-benchmark", next === "benchmark");
  if (next === "benchmark") benchmarkView().open();
  els.input.placeholder = placeholderFor(next);
  applyModeModel(next); // each tab keeps its own model — restore it before the picker refreshes
  refreshModelUI(); // Image tab lists image models; others list chat models.
  if (CHAT_MODES.includes(next)) restoreMode(next); // re-attach this tab's own message nodes
  if (next === "code") updateCodeLauncher();
  updatePageBar(); // Page bar is Chat-only — hide it (and its popup) on other tabs
  updateEmptyState();
  // Re-evaluate the ↓ scroll-to-bottom button for the NEW tab's content (it was staying visible after
  // a tab switch because it never re-checked). Hidden if the restored thread is already at the bottom.
  if (typeof updateScrollBtn === "function") updateScrollBtn();
  if (prev !== next) playNavAnim(); // slide the new workspace content in
  // If the history panel is open, refresh it to show THIS workspace's conversations.
  if (!els.historyPanel.classList.contains("hidden")) renderHistoryList();
}
// Navigation animation: restart the slide-in on the content area when changing tab, and
// "pop" the menu icon that just became active so the switch feels tactile.
function playNavAnim() {
  [els.messages, els.controls].forEach((el) => {
    if (!el) return;
    el.classList.remove("nav-in");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("nav-in");
  });
  const act = els.rail && els.rail.querySelector(".railtab.active");
  if (act) {
    act.classList.remove("tab-pop");
    void act.offsetWidth; // restart the icon pop
    act.classList.add("tab-pop");
  }
}
// Multi-tasking indicator: when an answer finishes in a workspace the user is NOT currently
// viewing, light a dot on that workspace's menu icon so they know it's ready. Cleared when
// they open that tab (in setMode).
let bgDonePending = false; // an answer finished in a background conversation of the CURRENT tab
function markTabDone(m, runConvId) {
  if (settings.tabDoneIndicator === false) return; // disabled in Quick actions / Settings
  if (!m || !els.rail) return;
  if (m !== mode) {
    // Finished on ANOTHER workspace → dot on that tab's icon.
    const b = els.rail.querySelector('.railtab[data-mode="' + m + '"]');
    if (b) b.classList.add("tab-done");
  } else if (runConvId && runConvId !== convId) {
    // Same tab, but the user has moved to a DIFFERENT conversation → flag it on the logo only.
    bgDonePending = true;
  } else {
    return; // finished in the conversation you're looking at → nothing to signal
  }
  refreshBrandDone();
}
// The rail is a hover overlay (hidden by default), so a dot on a rail tab is invisible. Mirror an
// "answer ready" dot onto the ALWAYS-visible logo/menu button whenever any conversation is waiting.
function refreshBrandDone() {
  if (!els.rail || !els.brand) return;
  els.brand.classList.toggle("has-done", bgDonePending || !!els.rail.querySelector(".railtab.tab-done"));
}

// ----- Code workspace (AI app builder launcher) -----------------------------
// The builder (Bolt.diy / Hivey Code) runs WebContainers, which require cross-origin
// isolation (COOP/COEP) and therefore cannot live inside an extension iframe — we
// open it in a dedicated browser tab where preview / terminal / Expo Go all work.
function updateCodeLauncher() {
  const url = (settings.codeAppUrl || "").trim();
  if (url) {
    els.openCodeApp.disabled = false;
    els.openCodeApp.textContent = t("code.open");
    els.codeAppUrlLabel.textContent = url;
  } else {
    els.openCodeApp.disabled = true;
    els.openCodeApp.textContent = t("code.notConfigured");
    els.codeAppUrlLabel.textContent = t("code.setUrl");
  }
}
// Hivey Code and the sidebar are ONE service: hand the builder this sidebar's
// OpenRouter key via the URL fragment (#sk=). The fragment is never sent to the
// server; Hivey Code's bridge copies it into its own cookie then strips it.
function codeAppLaunchUrl() {
  const url = (settings.codeAppUrl || "").trim();
  if (!url) return "";

  const params = [];

  const orKey = (settings.keys && settings.keys.openrouter) || "";
  if (orKey) params.push("sk=" + encodeURIComponent(orKey));

  // Hand Hivey Code the user's ACTIVE theme palette so its UI matches the
  // sidebar's chosen colours (it applies these as CSS overrides and remembers them).
  try {
    const p = effectivePalette(settings.theme || "dark", settings.themeColors);
    const slim = {
      accent: p.accent, accent2: p.accent2, bg: p.bg, panel: p.panel,
      panel2: p.panel2, border: p.border, text: p.text, muted: p.muted,
    };
    params.push("pg_theme=" + encodeURIComponent(JSON.stringify(slim)));
  } catch (_) {}

  if (!params.length) return url; // nothing to share yet — open it blank

  return url + (url.includes("#") ? "&" : "#") + params.join("&");
}
async function openCodeApp() {
  if (!(settings.codeAppUrl || "").trim()) return browser.runtime.openOptionsPage();
  const url = codeAppLaunchUrl();
  try { await browser.tabs.create({ url }); } catch (_) { window.open(url, "_blank", "noopener"); }
  // The workshop now lives in its own tab — bring the sidebar back to Chat so the user
  // isn't left staring at the launcher screen.
  setMode("chat");
}

// ----- Page awareness -------------------------------------------------------
function setupPageAwareness() {
  const onChange = () => debouncedRefresh();
  browser.tabs.onActivated.addListener(onChange);
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab && tab.active && (changeInfo.status === "complete" || changeInfo.url)) onChange();
  });
  browser.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "page_changed") onChange();
  });
}
let refreshTimer = null;
function debouncedRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshCurrentPage, 350);
}
async function refreshCurrentPage() {
  let ok = false;
  try {
    const page = await executeTool("read_page", {}, {});
    if (page && !page.error && page.url) {
      currentPage = page;
      els.pageTitle.textContent = page.title || page.url;
      ok = true;
    }
  } catch (_) {}
  if (!ok) {
    currentPage = null;
    els.pageTitle.textContent = t("page.none");
  }
  updatePageBar();
  refreshWatchBtn();
}

// ----- 🔔 Page-change watch (composer button) --------------------------------
// Resolve the page to watch: prefer the read page, else query the active browser tab directly (so the
// bell works even on tabs where the AI hasn't read the page — e.g. the Security tab).
async function watchTargetPage() {
  if (currentPage && currentPage.url) return { url: currentPage.url, title: currentPage.title || currentPage.url };
  try {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const tb = tabs && tabs[0];
    if (tb && tb.url && /^https?:/.test(tb.url)) return { url: tb.url, title: tb.title || tb.url };
  } catch (_) {}
  return null;
}
async function refreshWatchBtn() {
  if (!els.watchBtn) return;
  els.watchBtn.style.display = ""; // always in the toolbar
  els.watchBtn.disabled = false; // always clickable — it resolves the page on click
  els.watchBtn.classList.remove("dim");
  const target = await watchTargetPage();
  if (!target) { els.watchBtn.classList.remove("on"); els.watchBtn.title = t("watch.title"); return; }
  try {
    const res = await browser.runtime.sendMessage({ type: "watch:list" });
    const on = !!(res && res.watches || []).some((w) => w.url === target.url);
    els.watchBtn.classList.toggle("on", on);
    els.watchBtn.title = t(on ? "watch.on" : "watch.title");
  } catch (_) {}
}
async function toggleWatchCurrentPage() {
  const target = await watchTargetPage();
  if (!target) { flashTopBanner(t("watch.noPage")); return; }
  const on = els.watchBtn.classList.contains("on");
  try {
    const res = await browser.runtime.sendMessage({ type: on ? "watch:remove" : "watch:add", url: target.url, title: target.title });
    if (res && res.ok) {
      els.watchBtn.classList.toggle("on", !on);
      els.watchBtn.title = t(!on ? "watch.on" : "watch.title");
      flashTopBanner(t(!on ? "watch.added" : "watch.removed"));
    }
  } catch (_) {}
}

// The Page bar (page seen by the AI + element/region tools + 📑 tab picker) is a
// CHAT-ONLY feature. Show it only on the Chat tab when the Page toggle is on; hide it
// — and close its tab-picker popup — everywhere else (that's the "Page popup stays open
// after switching workspace" fix).
function updatePageBar() {
  const webOpen = els.webPanel && !els.webPanel.classList.contains("hidden");
  // Chat: the bar appears when the "Page" context chip is on. The selector workspaces
  // (translate/improve/image/pdf) get a POPUP — toggled by the page icon on the controls row —
  // that holds the page reading + capture tools (element pick + region capture), like Chat.
  const selectorModes = ["translate", "improve", "image", "pdf"];
  const onSelector = selectorModes.includes(mode);
  // Security also gets the page tools (pick element / capture region / tab picker) to bring evidence in.
  const pageCapable = mode === "chat" || onSelector || mode === "security" || mode === "wisebase";
  // Chat AND the selector tabs (translate/improve/image/pdf) all show the SAME permanent tools bar
  // (pick element + capture region + 📑 tab picker). No page reading anywhere — the "Page" option is
  // gone; context comes only from what the user explicitly picks/captures/selects.
  const show = !webOpen && pageCapable;
  els.pageBar.classList.toggle("hidden", !show);
  if (els.tabsBtn) els.tabsBtn.classList.toggle("hidden", !pageCapable);
  els.pageBar.classList.toggle("selectors-only", pageCapable);
  els.pageBar.classList.remove("page-off");
  // The inline 👁 eye inside the bar is always hidden (no page reading here).
  if (els.pageToggle) els.pageToggle.classList.add("hidden");
  // The controls-row "launch page popup" icon is removed — the bar is permanently open instead.
  if (els.selPageToggle) els.selPageToggle.classList.add("hidden");
  if (!show || !pageCapable) els.tabsPanel.classList.add("hidden");
  updateTabsIndicator();
}
// The tabs-as-context picker is available on Chat AND the selector tabs (translate/improve/image/pdf).
function tabsPickerAvailable() { return mode === "chat" || ["translate", "improve", "image", "pdf"].includes(mode); }
async function toggleTabsPanel() {
  if (!tabsPickerAvailable()) return;
  const show = els.tabsPanel.classList.contains("hidden");
  if (show) await buildTabsList();
  els.tabsPanel.classList.toggle("hidden");
}
// Show "📑 N tabs in context" in the page bar whenever tabs are selected (the bar otherwise only
// holds the tool icons on the right). It's the clickable notification the user relies on to see and
// re-open their tab selection.
function updateTabsIndicator() {
  const n = (settings.selectedTabs || []).length;
  const has = n > 0 && tabsPickerAvailable();
  els.pageBar.classList.toggle("has-tabsel", has);
  if (els.pageTitle && has) {
    els.pageTitle.textContent = t("tabs.inContext", { n });
    els.pageTitle.title = t("tabs.inContextTitle");
  }
}
// Per-tab open/closed state of the selector page-tools popup (in-memory; closed by default).
const selectorPagePopup = {};
function toggleSelectorPagePopup() {
  if (!["translate", "improve", "image", "pdf"].includes(mode)) return;
  selectorPagePopup[mode] = !selectorPagePopup[mode];
  if (selectorPagePopup[mode]) { updatePageBar(); refreshCurrentPage(); } // opening → show + read the current page
  else { cancelPicking(); cancelCapture(); updatePageBar(); }              // closing → stop any active tool
}
// Apply the user's reply-bubble outline preference (Settings → Appearance): show/hide it,
// a custom colour, and an optional "neon" glow. Colours flow through CSS variables so it
// restyles instantly without re-rendering messages.
function applyMsgBorder() {
  const r = document.documentElement.style;
  const on = settings.msgBorderOn !== false;
  const col = (settings.msgBorderColor || "").trim();
  document.body.classList.toggle("msg-noborder", !on);
  if (col) r.setProperty("--msg-border", withOpacity(col, settings.msgBorderOpacity)); else r.removeProperty("--msg-border");
  document.body.classList.toggle("text-outline", settings.textOutlineOn === true); // neon tube on title + icon
  document.body.classList.toggle("title-contour", settings.contourOn === true);    // crisp contour (own colour)
  const cc = (settings.contourColor || "").trim();
  if (cc) r.setProperty("--contour-color", withOpacity(cc, settings.contourOpacity)); else r.removeProperty("--contour-color");
  applyRailIcon();
}
// Custom MENU (rail) icon colour (Settings → Appearance). "" = theme default (grey idle,
// --text when active/hover). A chosen colour drives idle (dimmed) and active/hover (full).
// Gradient + top-bar options passed to applyTheme (read from settings).
function gradOpts() {
  return {
    gradientOn: settings.gradientOn !== false,
    gradientSplit: (typeof settings.gradientSplit === "number") ? settings.gradientSplit : -1,
  };
}
function applyRailIcon() {
  const r = document.documentElement.style;
  const col = (settings.railIconColor || "").trim();
  if (col) {
    const c = withOpacity(col, settings.railIconOpacity);
    r.setProperty("--rail-icon", c);
    r.setProperty("--rail-icon-dim", `color-mix(in srgb, ${c} 60%, transparent)`);
  } else {
    r.removeProperty("--rail-icon");
    r.removeProperty("--rail-icon-dim");
  }
  applyTopIcons();
}
// Top header icons (☰ search history new-chat settings) — their colour/gradient is customisable
// via two colours + an on/off, independent of everything else. They reference `--top-icon-1` /
// `--top-icon-2` through the #histg/#gearg SVG gradients (fallback to the theme accents).
function applyTopIcons() {
  const r = document.documentElement.style;
  const c1 = (settings.topIconColor || "").trim();
  const grad = settings.topIconGradient !== false;
  const c2 = (settings.topIconColor2 || "").trim();
  if (c1) r.setProperty("--top-icon-1", c1); else r.removeProperty("--top-icon-1");
  if (!grad) r.setProperty("--top-icon-2", c1 || "var(--accent)"); // gradient off → solid colour 1
  else if (c2) r.setProperty("--top-icon-2", c2);
  else r.removeProperty("--top-icon-2"); // fall back to the theme's accent-2
}
function pageModeOff(m) { return !!(settings.selectorOff && settings.selectorOff[m]); }
function togglePageMode() {
  const m = mode;
  if (!["translate", "improve", "image", "pdf"].includes(m)) return;
  settings.selectorOff = { ...(settings.selectorOff || {}), [m]: !pageModeOff(m) };
  setSettings({ selectorOff: settings.selectorOff });
  // Turning it off mid-pick cancels any active selection.
  if (pageModeOff(m)) { cancelPicking(); cancelCapture(); }
  updatePageBar();
}

// ----- Multi-tab context ----------------------------------------------------
async function buildTabsList() {
  const res = await executeTool("list_tabs", {}, {});
  els.tabsList.innerHTML = "";
  const selected = new Set(settings.selectedTabs || []);
  for (const t of (res && res.tabs) || []) {
    if (!t.url || /^about:/.test(t.url)) continue;
    const li = document.createElement("li");
    const lab = document.createElement("label");
    lab.className = "tabrow";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(t.id);
    cb.dataset.tabId = String(t.id);
    const span = document.createElement("span");
    span.className = "tabtitle";
    span.textContent = t.title || t.url;
    span.title = t.url;
    lab.appendChild(cb);
    lab.appendChild(span);
    li.appendChild(lab);
    els.tabsList.appendChild(li);
  }
  updateTabsClearBtn();
}
// Show the "Reset" (deselect-all) action only when at least one tab is ticked.
function updateTabsClearBtn() {
  if (!els.tabsClear) return;
  els.tabsClear.classList.toggle("hidden", !(settings.selectedTabs || []).length);
}
// Untick every tab and drop the multi-tab context in one click.
async function clearSelectedTabs() {
  settings.selectedTabs = [];
  await setSettings({ selectedTabs: [] });
  els.tabsList.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
  updateTabsClearBtn();
  updateTabsIndicator();
}
async function persistSelectedTabs() {
  const ids = [];
  els.tabsList.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    if (cb.checked) ids.push(parseInt(cb.dataset.tabId, 10));
  });
  settings.selectedTabs = ids;
  await setSettings({ selectedTabs: ids });
  updateTabsClearBtn();
  updateTabsIndicator();
}
async function selectedTabsContext() {
  // Any tab the user has ticked is always added to the context (no extra toggle).
  if (!(settings.selectedTabs || []).length) return "";
  const parts = [];
  for (const tabId of settings.selectedTabs) {
    try {
      const p = await executeTool("read_tab", { tabId }, {});
      if (p && !p.error && p.text) {
        parts.push(`[Tab] ${p.title || ""} (${p.url})\n` + cleanText(p.text).slice(0, Math.floor(settings.maxPageChars / 2)));
      }
    } catch (_) {}
  }
  return parts.length ? `[Multi-tab context]\n${parts.join("\n\n")}\n\n` : "";
}

// ----- Local history --------------------------------------------------------
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("time.now");
  if (s < 3600) return t("time.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hour", { n: Math.floor(s / 3600) });
  return t("time.day", { n: Math.floor(s / 86400) });
}
// Display title for a saved (or synthetic current) conversation entry: a manual
// rename wins, then the auto-derived title, then the "New conversation" placeholder.
function displayTitleFor(c) {
  if (c.customTitle) return c.customTitle;
  if (c.title && c.title !== "Nouvelle conversation") return c.title;
  return t("history.newEntry");
}
// Small Markdown/PDF export menu anchored under a history row's export button.
async function openExportMenu(c, anchor) {
  document.querySelectorAll(".export-menu").forEach((n) => n.remove());
  const full = (await getConversation(c.id)) || c;
  if (!full.transcript || !full.transcript.length) { flashTopBanner(t("hist.exportEmpty")); return; }
  const menu = document.createElement("div");
  menu.className = "export-menu";
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "export-item"; b.textContent = label;
    b.addEventListener("click", (e) => { e.stopPropagation(); menu.remove(); fn(full); });
    return b;
  };
  menu.appendChild(mk(t("hist.exportMd"), downloadMarkdown));
  menu.appendChild(mk(t("hist.exportPdf"), printConversation));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(window.innerHeight - 80, r.bottom + 4)}px`;
  menu.style.left = `${Math.min(window.innerWidth - 160, r.left - 90)}px`;
  const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", closer); } };
  setTimeout(() => document.addEventListener("mousedown", closer), 0);
}

async function renderHistoryList() {
  // Each workspace shows ONLY its own saved conversations (legacy entries with no
  // mode are treated as Chat).
  const all = await listConversations();
  const saved = all.filter((c) => (c.mode || "chat") === mode && conversationMatches(c, historyQuery));
  // Always surface the conversation that is OPEN right now — even before its first
  // message is saved — as a "New conversation · Current" entry at the top, so opening
  // a fresh chat immediately shows up in the list (its name fills in from the prompt).
  const entries = saved.slice();
  if (!historyQuery && !entries.some((c) => c.id === convId)) {
    const s = getSession(mode);
    entries.unshift({ id: convId, mode, updatedAt: Date.now(), customTitle: s.customTitle || "", title: "", _synthetic: true });
  }
  els.historyList.innerHTML = "";
  els.historyList.classList.remove("has-sel"); // fresh render → nothing ticked yet
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = t("history.empty");
    els.historyList.appendChild(li);
    return;
  }
  for (const c of entries) {
    const li = document.createElement("li");
    li.className = "histrow";
    const isCurrent = c.id === convId;
    if (isCurrent) li.classList.add("current");
    // Selection checkbox (saved conversations only) for bulk delete.
    if (!c._synthetic) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "hsel";
      cb.dataset.id = c.id;
      cb.title = t("hist.selectTitle");
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", updateDeleteSelectedBtn);
      li.appendChild(cb);
    }
    const title = document.createElement("span");
    title.className = "htitle";
    title.textContent = displayTitleFor(c);
    li.appendChild(title);
    // Rename button (✏️) sits right after the title — i.e. just LEFT of the "Current"
    // tag — at the end of the title's available width.
    const ren = document.createElement("button");
    ren.className = "hact hren";
    ren.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    ren.title = t("hist.renameTitle");
    ren.addEventListener("click", (e) => { e.stopPropagation(); startRename(c, li, title); });
    li.appendChild(ren);
    // The "Current" tag is a SEPARATE, non-shrinking element — only the title text
    // truncates, so the tag is always shown in full.
    if (isCurrent) {
      const tag = document.createElement("span");
      tag.className = "hcur";
      tag.textContent = t("history.current");
      li.appendChild(tag);
    }
    const meta = document.createElement("span");
    meta.className = "hmeta";
    meta.textContent = timeAgo(c.updatedAt || Date.now());
    // (appended LATER — right before the ✕ — so the timestamp hugs the delete button, see below.)
    if (c.pinned) li.classList.add("pinned");
    // Actions: pin (📌, saved only) · share (🔗, saved only) · delete (✕, saved only).
    if (!c._synthetic) {
      const pin = document.createElement("button");
      pin.className = "hact hpin" + (c.pinned ? " on" : "");
      pin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M5 9l1.5 5h11L19 9"/><path d="M8 9V4h8v5"/></svg>';
      pin.title = c.pinned ? t("hist.unpinTitle") : t("hist.pinTitle");
      pin.addEventListener("click", async (e) => { e.stopPropagation(); await togglePinned(c.id); renderHistoryList(); });
      li.appendChild(pin);
      const share = document.createElement("button");
      share.className = "hact hshare";
      share.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      share.title = t("hist.shareTitle");
      share.addEventListener("click", (e) => { e.stopPropagation(); openSharePicker(c); });
      const exp = document.createElement("button");
      exp.className = "hact hexport";
      exp.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
      exp.title = t("hist.exportTitle");
      exp.addEventListener("click", async (e) => { e.stopPropagation(); await openExportMenu(c, exp); });
      const del = document.createElement("button");
      del.className = "hdel";
      del.textContent = "✕";
      del.title = t("delete.title");
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteConversation(c.id);
        if (c.id === convId) startFreshChat();
        renderHistoryList();
      });
      li.appendChild(share);
      li.appendChild(exp);
      li.appendChild(meta); // timestamp right before ✕
      li.appendChild(del);
    } else {
      li.appendChild(meta); // synthetic (no actions) → timestamp at the end
    }
    if (!isCurrent) li.addEventListener("click", () => loadConversation(c.id));
    els.historyList.appendChild(li);
  }
  updateDeleteSelectedBtn();
}

// Reflect the number of ticked conversations on the "Delete selected" button.
function updateDeleteSelectedBtn() {
  if (!els.deleteSelected) return;
  const n = els.historyList.querySelectorAll(".hsel:checked").length;
  // In "selection mode" (≥1 ticked), keep every row's checkbox visible so the user can add more
  // without having to hover each row (the CSS reveals them via .has-sel).
  els.historyList.classList.toggle("has-sel", n > 0);
  els.deleteSelected.classList.toggle("hidden", n === 0);
  els.deleteSelected.innerHTML =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg> ';
  els.deleteSelected.appendChild(document.createTextNode(t("history.deleteSelected", { n })));
}
// Delete every ticked conversation at once.
async function deleteSelectedConversations() {
  const ids = Array.from(els.historyList.querySelectorAll(".hsel:checked")).map((cb) => cb.dataset.id);
  if (!ids.length) return;
  for (const id of ids) await deleteConversation(id);
  if (ids.includes(convId)) startFreshChat();
  renderHistoryList();
}

// Inline rename: turn the title into an editable field. A manual title is persisted
// (customTitle) and no longer overwritten by the auto title derived from the prompt.
function startRename(c, li, titleSpan) {
  const input = document.createElement("input");
  input.className = "hrename";
  input.value = displayTitleFor(c);
  li.replaceChild(input, titleSpan);
  input.focus(); input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (save && v) await applyRename(c, v);
    renderHistoryList();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", () => commit(true));
}
async function applyRename(c, newTitle) {
  if (c.id === convId) getSession(mode).customTitle = newTitle;
  const conv = await getConversation(c.id);
  if (conv) {
    conv.customTitle = newTitle;
    conv.title = newTitle;
    await saveConversation(conv);
  }
  // An unsaved current conversation has no stored entry yet; its customTitle on the
  // session is enough and gets persisted when the first message is saved.
}

// Compress a conversation into a context note — LOCALLY and INSTANTLY (no API call,
// so the import is fast and spends zero tokens). We clean the text and, if it's long,
// keep the head + tail within a budget (the start sets up the topic, the end carries
// the latest state) so the gist survives.
function compressConversation(conv) {
  const items = conv.transcript || [];
  const raw = items
    .map((m) => `${m.role === "assistant" ? "Assistant" : m.kind === "note" ? "Note" : "User"}: ${m.text || (m.kind === "image" ? "[generated image]" : "")}`)
    .join("\n");
  const cleaned = cleanText(raw);
  if (!cleaned) return "(empty conversation)";
  const BUDGET = 4000;
  if (cleaned.length <= BUDGET) return cleaned;
  return cleaned.slice(0, Math.floor(BUDGET * 0.6)) + "\n…\n" + cleaned.slice(-Math.floor(BUDGET * 0.4));
}

// Share = inject one conversation's compressed context into ANOTHER conversation.
// Shows an inline "pick a target" list inside the history panel.
async function openSharePicker(source) {
  const all = await listConversations();
  const others = all.filter((c) => (c.mode || "chat") === mode && c.id !== source.id);
  // The conversation open right now is a valid target too — even if it's a brand-new
  // blank one not yet saved. Add it (as "New conversation") at the top.
  if (convId !== source.id && !others.some((c) => c.id === convId)) {
    const s = getSession(mode);
    others.unshift({ id: convId, mode, customTitle: s.customTitle || "", title: "", _synthetic: true });
  }
  els.historyList.innerHTML = "";
  const head = document.createElement("li");
  head.className = "share-head";
  head.textContent = t("share.pickTitle");
  els.historyList.appendChild(head);
  if (!others.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = t("share.none");
    els.historyList.appendChild(li);
  } else {
    for (const c of others) {
      const li = document.createElement("li");
      li.className = "histrow share-target";
      const title = document.createElement("span");
      title.className = "htitle";
      title.textContent = displayTitleFor(c);
      li.appendChild(title);
      li.addEventListener("click", () => injectContext(source, c));
      els.historyList.appendChild(li);
    }
  }
  const cancel = document.createElement("li");
  cancel.className = "share-cancel";
  cancel.textContent = t("share.cancel");
  cancel.addEventListener("click", () => renderHistoryList());
  els.historyList.appendChild(cancel);
}

// Replace the picker with a transient confirmation line, then return to the list —
// so the user gets clear feedback and can't click a target twice by accident.
let sharing = false;
function showShareLine(text, spinning) {
  els.historyList.innerHTML = "";
  const li = document.createElement("li");
  li.className = "share-result" + (spinning ? " spinning" : "");
  li.textContent = text;
  els.historyList.appendChild(li);
  return li;
}
function showShareResult(text) {
  showShareLine(text, false);
  setTimeout(() => { if (!els.historyPanel.classList.contains("hidden")) renderHistoryList(); }, 1500);
}

// Inject ONE conversation's compressed summary into another as background CONTEXT
// (a primed user→assistant pair in the model history), NOT as visible chat bubbles.
// The conversation shows a single discreet "📎 imported" note. Re-importing the same
// source is blocked, and concurrent clicks are ignored (no accidental loops).
async function injectContext(source, target) {
  if (sharing) return;
  sharing = true;
  showShareLine(t("share.importing"), true); // immediate "something is happening" signal
  try {
    const src = await getConversation(source.id);
    if (!src) { showShareResult(t("share.none")); return; }
    const srcTitle = displayTitleFor(src);
    const tgtTitleFor = (c) => displayTitleFor(c);
    const summary = compressConversation(src); // local + instant
    const modelNote = `[Imported context from a previous conversation titled "${srcTitle}"]\n${summary}\n[End of imported context]`;
    const ack = "Understood — I'll take that imported context into account in my answers.";
    const noteItem = { role: "note", kind: "note", text: t("share.injected", { title: srcTitle }) };

    if (target.id === convId) {
      const sess = getSession(mode);
      if ((sess.importedSources || []).includes(source.id)) { showShareResult(t("share.already")); return; }
      history.push({ role: "user", content: modelNote });
      history.push({ role: "assistant", content: ack });
      transcript.push(noteItem);
      sess.importedSources = [...(sess.importedSources || []), source.id];
      syncSessionFromGlobals(mode);
      renderTranscriptItem(noteItem);
      els.empty.classList.add("hidden");
      await saveCurrent();
      showShareResult(t("share.done", { title: srcTitle }));
    } else {
      const tgt = await getConversation(target.id);
      if (!tgt) { showShareResult(t("share.none")); return; }
      tgt.importedSources = tgt.importedSources || [];
      if (tgt.importedSources.includes(source.id)) { showShareResult(t("share.already")); return; }
      tgt.nativeHistory = tgt.nativeHistory || [];
      tgt.transcript = tgt.transcript || [];
      tgt.nativeHistory.push({ role: "user", content: modelNote });
      tgt.nativeHistory.push({ role: "assistant", content: ack });
      tgt.transcript.push(noteItem);
      tgt.importedSources.push(source.id);
      await saveConversation(tgt);
      showShareResult(t("share.addedTo", { title: tgtTitleFor(tgt) }));
    }
  } finally {
    sharing = false;
  }
}
// Persist a SPECIFIC session (bound to its own convId/mode) so an answer that
// finishes after the user has switched tabs is still saved to the right place.
async function saveSession(sess, m, sel) {
  if (!settings.saveHistory || !sess.transcript.length) return;
  // A manual rename (customTitle) is sticky; otherwise derive the title from the prompt.
  const title = sess.customTitle || titleFrom(sess.transcript);
  await saveConversation({
    id: sess.convId, title, customTitle: sess.customTitle || "", updatedAt: Date.now(), mode: m,
    providerId: sel.providerId, model: sel.modelId, transcript: sess.transcript, nativeHistory: sess.history,
    importedSources: sess.importedSources || [],
  });
}
async function saveCurrent() {
  return saveSession(getSession(mode), mode, currentSelection());
}
function renderTranscriptItem(item) {
  if (item.kind === "note") {
    return addMessage("tool", item.text); // discreet system note (e.g. imported context)
  } else if (item.role === "user") {
    const d = addMessage("user", item.text);
    if (item.atts) renderUserAttachments(d, item.atts);
    attachUserActions(d, item.text);
    return d;
  } else if (item.kind === "image") {
    const wrap = addMessage("assistant", "");
    if (item.badge) {
      const b = document.createElement("div");
      b.className = "model-badge";
      b.textContent = item.badge;
      wrap.appendChild(b);
    }
    for (const u of item.urls || []) {
      const img = document.createElement("img");
      img.src = u; img.className = "gen-image"; wrap.appendChild(img);
    }
    return wrap;
  } else {
    const el = addMessage("assistant", "");
    // Restore the model badge (which model answered) so it's still visible after switching
    // conversation/tab — it's now saved with each assistant turn.
    if (item.badge) {
      const b = document.createElement("div");
      b.className = "model-badge";
      b.textContent = item.badge;
      el.appendChild(b);
    }
    const body = document.createElement("div");
    setHTML(body, renderMarkdown(item.text || ""));
    el.appendChild(body);
    enhanceArtifacts(body);
    el._raw = item.text || "";
    attachAssistantActions(el, () => el._raw);
    return el;
  }
}
async function loadConversation(id) {
  const c = await getConversation(id);
  if (!c) return;
  bgDonePending = false; refreshBrandDone(); // opening a conversation acknowledges the background "ready" dot
  clearMessages();
  transcript = c.transcript || [];
  history = c.nativeHistory || [];
  convId = c.id;
  // Restore the last user prompt as the "compare" target so the last answer can ALWAYS be
  // re-run on another model — even after switching conversation (it used to be lost).
  const lastUser = [...transcript].reverse().find((it) => it.role === "user" && it.kind !== "note");
  lastUserContent = lastUser ? (lastUser.text || "") : "";
  lastRunMode = "chat";
  lastForceWeb = false;
  getSession(mode).pageCtxKeys = new Set(); // re-attach page context once for this thread
  getSession(mode).customTitle = c.customTitle || ""; // keep a manual rename
  getSession(mode).importedSources = c.importedSources || []; // keep dedup of imports
  syncSessionFromGlobals(mode); // these new arrays become this tab's live session
  let lastAssistantEl = null;
  for (const item of transcript) {
    const el = renderTranscriptItem(item);
    if (item.role !== "user" && item.kind !== "note") lastAssistantEl = el;
  }
  if (lastAssistantEl && lastUserContent) attachCompareBar(lastAssistantEl); // compare on the last answer
  els.empty.classList.add("hidden");
  els.historyPanel.classList.add("hidden");
}
function clearMessages() {
  // Also drop the agent "Actions" block + any action overlay — they're appended straight to
  // els.messages (not as .msg/.think), so without this they'd leak into the next conversation
  // (a stale actions bar at the bottom of a brand-new chat). 🐝
  els.messages.querySelectorAll(".msg, .think, .agent-actions, .action-bubble-overlay").forEach((n) => n.remove());
}
// Reset the view to a brand-new empty conversation (no saving).
function startFreshChat() {
  history = [];
  transcript = [];
  convId = newConversationId();
  lastUserContent = "";
  getSession(mode).pageCtxKeys = new Set();
  getSession(mode).customTitle = "";
  getSession(mode).importedSources = [];
  syncSessionFromGlobals(mode); // the fresh arrays are this tab's live session
  // A new conversation starts with NO tab held in context — otherwise a tab the user
  // ticked for a previous discussion would silently leak into the fresh one.
  if ((settings.selectedTabs || []).length) {
    settings.selectedTabs = [];
    setSettings({ selectedTabs: [] });
    if (els.tabsPanel && !els.tabsPanel.classList.contains("hidden")) buildTabsList();
    updateTabsIndicator(); // hide the "N tabs in context" pill — the fresh chat holds no context
  }
  clearMessages();
  els.empty.classList.remove("hidden");
  updateEmptyState();
}
async function newChat() {
  await saveCurrent();
  startFreshChat();
  // If the history panel is open, show the fresh conversation right away (it appears
  // as "New conversation · Current" until the first prompt names it).
  if (!els.historyPanel.classList.contains("hidden")) renderHistoryList();
}

// ----- In-conversation search -----------------------------------------------
// Find terms in the current conversation's messages and jump between matches,
// instead of re-prompting. Matches are wrapped in <mark> and navigated with
// prev/next (or Enter / Shift+Enter). Highlights are stripped on close.
let searchHits = [];
let searchIdx = -1;
function clearSearchHighlights() {
  els.messages.querySelectorAll("mark.search-hit").forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  els.messages.normalize();
  searchHits = []; searchIdx = -1;
}
function wrapMatches(textNode, needle) {
  const text = textNode.nodeValue, lower = text.toLowerCase();
  let idx = lower.indexOf(needle);
  if (idx < 0) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  while (idx >= 0) {
    if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = text.slice(idx, idx + needle.length);
    frag.appendChild(mark);
    last = idx + needle.length;
    idx = lower.indexOf(needle, last);
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  textNode.parentNode.replaceChild(frag, textNode);
}
function highlightIn(root, needle) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.toLowerCase().includes(needle)) return NodeFilter.FILTER_REJECT;
      if (n.parentNode && n.parentNode.nodeName === "MARK") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets = [];
  let n; while ((n = walker.nextNode())) targets.push(n);
  for (const node of targets) wrapMatches(node, needle);
}
function focusHit() {
  searchHits.forEach((m, i) => m.classList.toggle("current", i === searchIdx));
  const cur = searchHits[searchIdx];
  if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
}
function updateSearchCount() {
  if (searchHits.length) els.searchCount.textContent = t("search.count", { i: searchIdx + 1, n: searchHits.length });
  else els.searchCount.textContent = els.searchInput.value.trim() ? t("search.none") : "";
}
function runSearch(q) {
  clearSearchHighlights();
  const needle = (q || "").trim().toLowerCase();
  if (needle) els.messages.querySelectorAll(".msg").forEach((msg) => highlightIn(msg, needle));
  searchHits = Array.from(els.messages.querySelectorAll("mark.search-hit"));
  searchIdx = searchHits.length ? 0 : -1;
  focusHit();
  updateSearchCount();
}
function gotoHit(delta) {
  if (!searchHits.length) return;
  searchIdx = (searchIdx + delta + searchHits.length) % searchHits.length;
  focusHit();
  updateSearchCount();
}
function openSearch() {
  els.searchBar.classList.remove("hidden");
  els.searchInput.focus(); els.searchInput.select();
  if (els.searchInput.value.trim()) { runSearch(els.searchInput.value); scheduleGlobalSearch(els.searchInput.value); }
}
function closeSearch() {
  els.searchBar.classList.add("hidden");
  clearSearchHighlights();
  updateSearchCount();
  clearGlobalResults();
}
function toggleSearch() {
  if (els.searchBar.classList.contains("hidden")) openSearch(); else closeSearch();
}

// ----- Cross-conversation search --------------------------------------------
// Search EVERY saved conversation in the current workspace for the term and list
// the ones that contain it (most matches first), with a snippet. Clicking a result
// opens that conversation and highlights the term inside it.
let globalSearchTimer = null;
function scheduleGlobalSearch(q) {
  clearTimeout(globalSearchTimer);
  globalSearchTimer = setTimeout(() => searchAllConversations(q), 200);
}
function clearGlobalResults() {
  if (!els.searchResults) return;
  els.searchResults.innerHTML = "";
  els.searchResults.classList.add("hidden");
}
function countOccurrences(hay, needle) {
  let n = 0, i = hay.indexOf(needle);
  while (i >= 0) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}
async function searchAllConversations(q) {
  if (!els.searchResults) return;
  const needle = (q || "").trim().toLowerCase();
  if (needle.length < 2) { clearGlobalResults(); return; }
  const all = await listConversations();
  const inMode = all.filter((c) => (c.mode || "chat") === mode);
  const results = [];
  for (const c of inMode) {
    let count = 0, snippet = "";
    for (const m of c.transcript || []) {
      const raw = m.text || "";
      if (!raw) continue;
      const low = raw.toLowerCase();
      const hits = countOccurrences(low, needle);
      if (!hits) continue;
      count += hits;
      if (!snippet) {
        const i = low.indexOf(needle);
        const start = Math.max(0, i - 32);
        snippet = (start > 0 ? "…" : "") + raw.slice(start, i + needle.length + 48).replace(/\s+/g, " ").trim() + "…";
      }
    }
    if (count > 0) results.push({ c, count, snippet });
  }
  results.sort((a, b) => b.count - a.count || (b.c.updatedAt || 0) - (a.c.updatedAt || 0));

  els.searchResults.innerHTML = "";
  if (!results.length) { els.searchResults.classList.add("hidden"); return; }
  els.searchResults.classList.remove("hidden");
  const head = document.createElement("li");
  head.className = "sr-head";
  head.textContent = t("search.allHead", { n: results.length });
  els.searchResults.appendChild(head);
  for (const r of results) {
    const li = document.createElement("li");
    li.className = "sr-item";
    if (r.c.id === convId) li.classList.add("current");
    const top = document.createElement("div");
    top.className = "sr-top";
    const title = document.createElement("span");
    title.className = "sr-title";
    title.textContent = displayTitleFor(r.c);
    const badge = document.createElement("span");
    badge.className = "sr-count";
    badge.textContent = String(r.count);
    top.appendChild(title); top.appendChild(badge);
    li.appendChild(top);
    if (r.snippet) {
      const sn = document.createElement("div");
      sn.className = "sr-snippet";
      sn.textContent = r.snippet;
      li.appendChild(sn);
    }
    li.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (r.c.id !== convId) await loadConversation(r.c.id);
      runSearch(els.searchInput.value); // re-highlight inside the opened conversation
      // Keep the bar open; mark which result is now current.
      els.searchResults.querySelectorAll(".sr-item.current").forEach((n) => n.classList.remove("current"));
      li.classList.add("current");
    });
    els.searchResults.appendChild(li);
  }
}

// ----- Pending actions (from the right-click context menu) ------------------
// The background script writes a `pendingAction` to storage when a context-menu item
// is clicked, then tries to open the sidebar. We consume it on load AND whenever it
// changes — so it works whether the sidebar was closed (opens → init) or ALREADY OPEN
// (the storage listener catches it). The ts guard prevents a double-run.
let lastPendingTs = 0;
async function consumePendingAction() {
  const { pendingAction } = await browser.storage.local.get("pendingAction");
  if (!pendingAction || Date.now() - pendingAction.ts > 60000) return;
  if (pendingAction.ts === lastPendingTs) return; // already handled
  lastPendingTs = pendingAction.ts;
  await browser.storage.local.remove("pendingAction");
  // A right-click on a SELECTION opens an isolated, non-historised bubble (it
  // doesn't touch the conversation). Page-level actions keep the normal chat flow.
  if (BUBBLE_ACTIONS.has(pendingAction.action) && (pendingAction.text || "").trim()) {
    runOnPageBubble(pendingAction.action, pendingAction.text);
    return;
  }
  // Security analysis → ALWAYS land on the Security tab in a FRESH conversation (never append to the
  // conversation of whatever tab was active, and never stay stuck in Agent mode).
  if (pendingAction.action === "security" || pendingAction.action === "security-page") {
    if (mode !== "security") setMode("security");
    await newChat(); // open a new conversation in the Security workspace
    runQuickAction(pendingAction.action, pendingAction.text);
    return;
  }
  // Switch to the matching workspace so the action lands on the right tab.
  const ACTION_MODE = { translate: "translate", improve: "improve", image: "image" };
  const targetMode = ACTION_MODE[pendingAction.action] || "chat";
  if (mode !== "agent" && mode !== targetMode) setMode(targetMode);
  runQuickAction(pendingAction.action, pendingAction.text);
}

// ----- Isolated action bubble (right-click on a selection) ------------------
// A floating, NON-historised popup that runs a quick action (translate, improve,
// summarize, explain, reply) on the selected text. Closes on the ✕, a click
// outside, or Esc. Nothing is saved to the conversation.
const BUBBLE_ACTIONS = new Set(["translate", "improve", "summarize-selection", "explain", "reply"]);
let actionBubbleEl = null;
let bubbleAbort = null;
let bubbleCtx = null; // { tabId, action, text } for the on-page bubble

// Run a quick action as a bubble RENDERED IN THE PAGE at the right-click position.
// The sidebar runs the model (it holds the keys/providers) and streams the text to
// the page's content script. Falls back to the in-sidebar bubble on restricted pages
// or if the content script can't be reached.
async function runOnPageBubble(action, providedText) {
  const text = (providedText || "").trim();
  if (!text) return;
  const tab = await getActiveTab();
  if (!tab || isRestrictedUrl(tab.url)) { openActionBubble(action, providedText); return; }
  bubbleCtx = { tabId: tab.id, action, text };
  const reqInit = actionRequest(action, text, settings.targetLang || "French", settings.improvePreset);
  const langs = reqInit && reqInit.translate
    ? Array.from(els.translateLang.options).map((o) => ({ value: o.value, label: o.textContent }))
    : null;
  const presets = reqInit && reqInit.improve
    ? WRITING_PRESETS.map(([id]) => ({ value: id, label: t("preset." + id) }))
    : null;
  try {
    await sendToTab(tab.id, {
      type: "bubble_open", title: reqInit ? reqInit.label : "", source: text, note: t("bubble.note"),
      copyLabel: t("bubble.copy"), closeLabel: t("close.title"),
      langs, presets, currentLang: settings.targetLang || "French", currentPreset: settings.improvePreset || "improve",
      ...themeAccents(),
    });
  } catch (_) { openActionBubble(action, providedText); return; } // can't inject → in-sidebar fallback
  runBubbleModel();
}

async function runBubbleModel() {
  if (!bubbleCtx) return;
  const { tabId, action, text } = bubbleCtx;
  const send = (m) => { try { browser.tabs.sendMessage(tabId, m); } catch (_) {} };
  const lang = settings.targetLang || "French";
  const req = actionRequest(action, text, lang, settings.improvePreset);
  if (!req) return;
  // 🐝 Hivey: route the quick action by its kind (translate/improve = light; else by complexity).
  const bubbleMode = action === "translate" ? "translate" : action === "improve" ? "improve" : "chat";
  const sel = resolveHivey(currentSelection(), bubbleMode, text);
  if (currentKeyMissing(sel.providerId)) { send({ type: "bubble_error", error: t("err.noKeyModel") }); return; }
  if (bubbleAbort) { try { bubbleAbort.abort(); } catch (_) {} }
  bubbleAbort = new AbortController();
  send({ type: "bubble_reset" });
  let raw = "";
  try {
    // Use the RESOLVED sel (a real model) — not raw settings, whose models.openrouter may be the
    // "hivey/free" pseudo-id, which OpenRouter rejects with "not a valid model ID".
    const provider = makeProvider({ ...settings, provider: sel.providerId, models: { ...settings.models, [sel.providerId]: sel.modelId } }, { thinking: false, webSearch: false });
    const system = buildSystemPrompt({ agentMode: false, targetLang: lang, responseLang: settings.responseLang, mode: action === "translate" ? "translate" : action === "improve" ? "improve" : "chat", blockPayments: settings.blockPayments });
    await runConversation({
      provider, system, history: [{ role: "user", content: req.content }], tools: [],
      onText: (d) => { raw += d; send({ type: "bubble_delta", text: d }); },
      onThink: () => {}, signal: bubbleAbort.signal,
    });
    send({ type: "bubble_done", raw, html: renderMarkdown(raw) });
  } catch (e) {
    if (!(e && e.name === "AbortError")) send({ type: "bubble_error", error: (e && e.message) ? e.message : String(e) });
  }
}

// The page bubble asks for a re-run when the user changes its language / style.
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "bubble_rerun" || !bubbleCtx) return;
  if (msg.lang) { settings.targetLang = msg.lang; setSettings({ targetLang: msg.lang }); }
  if (msg.preset) { settings.improvePreset = msg.preset; setSettings({ improvePreset: msg.preset }); }
  runBubbleModel();
});

function closeActionBubble() {
  if (bubbleAbort) { try { bubbleAbort.abort(); } catch (_) {} bubbleAbort = null; }
  if (actionBubbleEl) { actionBubbleEl.remove(); actionBubbleEl = null; }
}

// Effective response language for "the user is the audience" actions (summarize/explain): the
// configured response language if one is set, else the UI language. Without this, "Auto" means
// "match the input language", so summarising an English selection answered in English even
// though the user runs the extension in French. (Translate keeps its own explicit target.)
function effLang() {
  const rl = settings.responseLang;
  if (rl && rl !== "Auto") return rl;
  return getLang() === "fr" ? "français" : "English";
}
// Append an explicit "answer in <lang>" directive to a prompt (read/summarize/explain actions).
function inLang(content) { return content + "\n\n" + t("prompt.replyIn", { lang: effLang() }); }
function actionRequest(action, text, lang, presetId, tone, length) {
  switch (action) {
    case "translate": return { label: t("rail.translate"), content: t("prompt.translate", { lang, text }), translate: true };
    case "improve": return { label: t("rail.improve"), content: `${improveInstruction(presetId || settings.improvePreset, tone != null ? tone : settings.improveTone)}\n${t("improve.only")}\n\n${t("improve.textLabel")}\n${text}`, improve: true };
    case "summarize-selection": return { label: t("label.summarizeSel"), content: inLang(t("prompt.summarizeSel", { text })) };
    case "explain": return { label: t("label.explain"), content: inLang(t("prompt.explain", { text })) };
    case "reply": return { label: t("label.reply"), content: t("prompt.reply", { lang, text }) };
    default: return null;
  }
}

function abIcon(svg, cls, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon " + (cls || "");
  if (title) b.title = title;
  setHTML(b, svg);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

async function openActionBubble(action, providedText) {
  const text = (providedText || "").trim();
  if (!text) return;
  closeActionBubble();

  const ov = document.createElement("div");
  ov.className = "action-bubble-overlay";
  ov.addEventListener("click", closeActionBubble);
  const card = document.createElement("div");
  card.className = "action-bubble";
  card.addEventListener("click", (e) => e.stopPropagation());

  // Header: title + (translate language) + copy + close.
  const head = document.createElement("div");
  head.className = "ab-head";
  const title = document.createElement("span");
  title.className = "ab-title";
  const reqInit = actionRequest(action, text, settings.targetLang || "French");
  title.textContent = reqInit ? reqInit.label : "";
  const headActions = document.createElement("div");
  headActions.className = "ab-actions";

  let langSel = null;
  let presetSel = null;
  let toneSel = null;
  if (reqInit && reqInit.translate) {
    langSel = document.createElement("select");
    langSel.className = "ab-lang";
    for (const o of els.translateLang.options) langSel.appendChild(o.cloneNode(true));
    langSel.value = settings.targetLang || "French";
    langSel.addEventListener("change", () => {
      settings.targetLang = langSel.value;          // remember the last chosen language
      setSettings({ targetLang: langSel.value });
      run();
    });
    headActions.appendChild(langSel);
  }
  if (reqInit && reqInit.improve) {
    presetSel = document.createElement("select");
    presetSel.className = "ab-lang";
    for (const [id] of WRITING_PRESETS) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = t("preset." + id);
      presetSel.appendChild(o);
    }
    presetSel.value = settings.improvePreset || "improve";
    presetSel.addEventListener("change", () => {
      settings.improvePreset = presetSel.value;     // remember the last chosen style
      setSettings({ improvePreset: presetSel.value });
      run();
    });
    headActions.appendChild(presetSel);

    toneSel = document.createElement("select");
    toneSel.className = "ab-lang";
    for (const id of WRITING_TONES) {
      const o = document.createElement("option");
      o.value = id; o.textContent = t("tone." + id);
      toneSel.appendChild(o);
    }
    toneSel.value = settings.improveTone || "auto";
    toneSel.addEventListener("change", () => {
      settings.improveTone = toneSel.value;
      setSettings({ improveTone: toneSel.value });
      run();
    });
    headActions.appendChild(toneSel);
  }

  const copyBtn = abIcon(
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    "", t("bubble.copy"),
    () => { navigator.clipboard.writeText(card._raw || "").then(() => { copyBtn.classList.add("ok"); setTimeout(() => copyBtn.classList.remove("ok"), 1200); }); },
  );
  const closeBtn = abIcon(
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    "", t("close.title"), closeActionBubble,
  );
  headActions.appendChild(copyBtn);
  headActions.appendChild(closeBtn);
  head.appendChild(title);
  head.appendChild(headActions);

  const src = document.createElement("div");
  src.className = "ab-src";
  src.textContent = text;

  const body = document.createElement("div");
  body.className = "ab-body";

  const note = document.createElement("div");
  note.className = "ab-note";
  note.textContent = t("bubble.note");

  card.appendChild(head);
  card.appendChild(src);
  card.appendChild(body);
  card.appendChild(note);
  ov.appendChild(card);
  document.body.appendChild(ov);
  actionBubbleEl = ov;

  // Position the card (default: upper-centre of the sidebar) and make it draggable
  // by its header. NOTE: the sidebar is a separate panel, so it can't be placed over
  // the web page at the exact cursor — but it can be moved freely here.
  card.style.position = "absolute";
  const cw = card.offsetWidth || 420;
  card.style.left = Math.max(8, Math.round((window.innerWidth - cw) / 2)) + "px";
  card.style.top = "44px";
  head.style.cursor = "move";
  head.style.userSelect = "none";
  let ox = 0, oy = 0;
  const onMove = (e) => {
    let nx = e.clientX - ox, ny = e.clientY - oy;
    nx = Math.max(4, Math.min(window.innerWidth - 60, nx));
    ny = Math.max(4, Math.min(window.innerHeight - 36, ny));
    card.style.left = nx + "px";
    card.style.top = ny + "px";
  };
  const stopDrag = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", stopDrag); };
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, select")) return; // controls aren't drag handles
    const r = card.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stopDrag);
  });

  async function run() {
    const lang = langSel ? langSel.value : settings.targetLang || "French";
    const req = actionRequest(action, text, lang, presetSel ? presetSel.value : settings.improvePreset, toneSel ? toneSel.value : undefined);
    if (!req) return;
    const bubbleMode = action === "translate" ? "translate" : action === "improve" ? "improve" : "chat";
    const sel = resolveHivey(currentSelection(), bubbleMode, text);
    if (currentKeyMissing(sel.providerId)) { body.textContent = t("err.noKeyModel"); return; }
    if (bubbleAbort) { try { bubbleAbort.abort(); } catch (_) {} }
    bubbleAbort = new AbortController();
    body.className = "ab-body ab-loading";
    body.textContent = "…";
    let raw = "";
    try {
      // Use the RESOLVED sel (real model), not raw settings whose models.openrouter may be "hivey/free".
      const provider = makeProvider({ ...settings, provider: sel.providerId, models: { ...settings.models, [sel.providerId]: sel.modelId } }, { thinking: false, webSearch: false });
      const system = buildSystemPrompt({ agentMode: false, targetLang: lang, responseLang: settings.responseLang, mode: action === "translate" ? "translate" : action === "improve" ? "improve" : "chat", blockPayments: settings.blockPayments });
      await runConversation({
        provider, system, history: [{ role: "user", content: req.content }], tools: [],
        onText: (delta) => { raw += delta; body.textContent = raw; body.scrollTop = body.scrollHeight; },
        onThink: () => {}, signal: bubbleAbort.signal,
      });
      card._raw = raw;
      body.className = "ab-body";
      setHTML(body, renderMarkdown(raw));
      enhanceArtifacts(body);
    } catch (e) {
      body.className = "ab-body";
      if (!(e && e.name === "AbortError")) body.textContent = (e && e.message) ? e.message : String(e);
    }
  }

  run();
}

// ----- Wiring ---------------------------------------------------------------
function wire() {
  // Searchable model combobox (main picker).
  mainCombo = makeCombo({
    input: els.modelInput, menu: els.modelMenu,
    items: () => (mode === "image" ? imageComboItems() : chatComboItems()),
    getValue: () => mainValue, onPick: onMainPick,
    header: buildMetricToggle,
  });
  // Close the combo menu when clicking outside it; also cancel element-pick mode when
  // the user clicks back in the sidebar (anywhere but the pick button).
  document.addEventListener("mousedown", (e) => {
    if (mainCombo.isOpen() && e.target !== els.modelInput && !els.modelMenu.contains(e.target) && !els.modelFilterPanel.contains(e.target)) mainCombo.close();
    if (picking && !els.pickEl.contains(e.target)) cancelPicking();
    if (capturing && !els.captureRegion.contains(e.target)) cancelCapture();
  });
  // Esc cancels element-pick / region-capture mode even when focus is in the sidebar.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") {
    if (picking) cancelPicking();
    if (capturing) cancelCapture();
    // Web-tab selection runs on the active tab outside the picking/capturing state — cancel it too.
    if (webPick) { const w = webPick; webPick = null; setPickBanner(false); try { browser.tabs.sendMessage(w.tabId, { type: w.cancelType }); } catch (_) {} }
  } });

  // "Agrandir" toggles between docked sidebar and full-screen tab. In a normal
  // sidebar it opens the full-screen tab on the current conversation; in the
  // full-screen tab the SAME button returns to the docked sidebar and closes the tab.
  // ⤢ Expand: on the Web tab it opens the EMBEDDED site/chat in a full browser tab; otherwise
  // it toggles the full-screen sidebar tab (default behaviour).
  const onExpand = () => {
    if (!els.webPanel.classList.contains("hidden")) {
      if (webCurUrl) browser.tabs.create({ url: webCurUrl });
      return;
    }
    if (IS_TAB) exitTab(); else openInTab();
  };
  if (IS_TAB) els.expandTab.title = t("expand.exit");
  els.expandTab.addEventListener("click", onExpand);

  // Click the brand/logo to show or hide the workspace tabs rail.
  // Hover the Hivey logo (or the rail itself) to peek the tabs rail open; leave to close it.
  // Hover the logo / "Hivey" wordmark → peek the menu; CLICK either → lock it open (pin), click again → unlock.
  els.brand.addEventListener("mouseenter", () => railPeek(true));
  els.brand.addEventListener("mouseleave", () => railPeek(false));
  els.brand.addEventListener("click", toggleRail);
  els.brandWord = document.getElementById("brandWord");
  if (els.brandWord) {
    els.brandWord.addEventListener("mouseenter", () => railPeek(true));
    els.brandWord.addEventListener("mouseleave", () => railPeek(false));
    els.brandWord.addEventListener("click", toggleRail);
  }
  if (els.rail) {
    els.rail.addEventListener("mouseenter", () => railPeek(true));
    els.rail.addEventListener("mouseleave", () => railPeek(false));
  }

  // ⚙ Options popup: ONE button reveals the Verify/Thinking/Web/Artifacts/Page/Auto-scroll toggles
  // (each shown as icon + name + state). Click outside to close.
  const optsToggle = document.getElementById("optsToggle");
  if (optsToggle) {
    optsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = document.body.classList.toggle("opts-open");
      optsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("mousedown", (e) => {
      if (!document.body.classList.contains("opts-open")) return;
      const cc = document.getElementById("chatControls");
      if (optsToggle.contains(e.target) || (cc && cc.contains(e.target))) return;
      document.body.classList.remove("opts-open");
      optsToggle.setAttribute("aria-expanded", "false");
    });
  }


  // 📚 Prompt library: reusable saved prompts. A button by the Options toggle opens a panel to
  // insert / save / delete prompts. Saved prompts also appear in the "/" command palette (chat).
  setupPromptLibrary();

  // ⌨️ Configurable keyboard shortcuts: map a pressed combo → action.
  setupShortcuts();

  // Composer: attachments (+).
  els.attachBtn.addEventListener("click", () => {
    // On the PDF tab the "+" opens a PDF-ONLY picker that feeds the PDF workspace (summarize / page
    // images / extract text). Everywhere else it's the normal multi-type attach picker.
    if (mode === "pdf") els.pdfFile.click();
    else els.attachInput.click();
  });
  els.attachInput.addEventListener("change", async (e) => {
    await addAttachmentFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same file
  });

  // Paste (Ctrl+V) an image / screenshot directly into the input → attach it.
  // Plain-text pastes fall through to the textarea's default behaviour.
  els.input.addEventListener("paste", async (e) => {
    const dt = e.clipboardData;
    if (!dt) return;
    let files = Array.from(dt.files || []);
    if (!files.length) {
      files = Array.from(dt.items || [])
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter(Boolean);
    }
    if (!files.length) return; // nothing but text — let the browser paste it
    e.preventDefault();
    if (mode === "code") setMode("chat"); // Image keeps the attachment (used as img2img source)
    await addAttachmentFiles(files);
    els.input.focus();
  });

  // Drag & drop files anywhere on the sidebar to attach them (in addition to +).
  let dragDepth = 0;
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const showDrop = (on) => els.dropOverlay.classList.toggle("hidden", !on);
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showDrop(true); });
  window.addEventListener("dragover", (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; showDrop(false); } });
  window.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; showDrop(false);
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    if (mode === "code") setMode("chat");          // Code has no attachment context
    if (mode === "pdf" && Array.from(files).some((f) => /\.pdf$/i.test(f.name))) { loadPdfFiles(files); return; }
    // Image keeps the dropped picture (used as the img2img source) — no switch to Chat.
    await addAttachmentFiles(files);
    els.input.focus();
  });

  // Model filter popover (price tiers + providers / OpenRouter sub-vendors).
  els.modelFilterBtn.addEventListener("click", () => toggleFilterPanel(els.modelFilterBtn));
  els.modelFilterPanel.querySelectorAll(".ftier-cb").forEach((cb) => cb.addEventListener("change", onTierFilterChange));
  els.filterReset.addEventListener("click", resetFilter);
  els.filterClose.addEventListener("click", () => els.modelFilterPanel.classList.add("hidden"));
  document.addEventListener("click", (e) => {
    if (els.modelFilterPanel.classList.contains("hidden")) return;
    if (els.modelFilterPanel.contains(e.target) || els.modelFilterBtn.contains(e.target) || (e.target.closest && e.target.closest(".cm-filter"))) return;
    els.modelFilterPanel.classList.add("hidden");
  });

  const bindToggle = (el, key, after) =>
    el.addEventListener("change", async () => {
      settings[key] = el.checked;
      // Remember this state on the ACTIVE tab so each workspace stays independent.
      if (CHAT_MODES.includes(mode)) getSession(mode).toggles[key] = el.checked;
      await setSettings({ [key]: el.checked });
      if (after) after();
    });
  // Thinking level: 3 SEGMENT buttons (off / on / max) in the options popup.
  async function setThinkLevel(next) {
    setThink(els.thinking, next); // also refreshes the segment highlight (via refreshThinkSegs)
    settings.thinkLevel = next;
    if (CHAT_MODES.includes(mode)) getSession(mode).toggles.thinking = next;
    await setSettings({ thinkLevel: next });
  }
  document.querySelectorAll(".think-seg .ts-btn").forEach((b) => {
    b.addEventListener("click", (e) => { e.preventDefault(); setThinkLevel(b.dataset.lvl); });
  });
  refreshThinkSegs(getThink(els.thinking));
  bindToggle(els.artifactMode, "artifacts", () => setArtifactsLive(els.artifactMode.checked));
  // Web and DeepSearch are two flavours of the SAME thing (web research) → mutually exclusive: turning
  // one ON turns the other OFF, so the user picks EITHER Web OR DeepSearch.
  const uncheckOther = async (otherEl, otherKey, otherAfter) => {
    if (!otherEl || !otherEl.checked) return;
    otherEl.checked = false;
    settings[otherKey] = false;
    if (CHAT_MODES.includes(mode)) getSession(mode).toggles[otherKey] = false;
    await setSettings({ [otherKey]: false });
    if (otherAfter) otherAfter();
  };
  bindToggle(els.webSearch, "webSearch", () => { if (els.webSearch.checked) uncheckOther(els.deepSearch, "deepSearch", updateDeepSeg); });
  bindToggle(els.deepSearch, "deepSearch", () => { updateDeepSeg(); if (els.deepSearch.checked) uncheckOther(els.webSearch, "webSearch"); });
  // DeepSearch depth (fast / standard / deep).
  if (els.deepSeg) els.deepSeg.querySelectorAll(".ts-btn").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      settings.deepSearchDepth = b.dataset.depth;
      await setSettings({ deepSearchDepth: settings.deepSearchDepth });
      updateDeepSeg();
    });
  });
  bindToggle(els.pageCtx, "includePageContext", updatePageBar);
  // Enabling "Page" needs host access to read the page. Ask for it right here, in the toggle's
  // user gesture, so page-context (and, once granted, the agent) work — same optional <all_urls>
  // grant the capture/pick tools request. Fire-and-forget: if declined, page-context simply stays
  // inert, as before.
  els.pageCtx.addEventListener("change", () => { if (els.pageCtx.checked) ensurePagePermission(); });
  // Auto-scroll is a GLOBAL preference (not per-tab): whether the view follows the AI's
  // answer as it streams. OFF = stay put so you can read/scroll freely while it types.
  els.autoScroll.checked = settings.autoScroll !== false;
  els.autoScroll.addEventListener("change", async () => {
    settings.autoScroll = els.autoScroll.checked;
    await setSettings({ autoScroll: settings.autoScroll });
    if (els.autoScroll.checked) scrollMessages(true);
  });
  // Verification is also a GLOBAL preference: when ON, Hivey double-checks & auto-fixes
  // each substantive answer (extra tokens); OFF = no check (cheaper/faster).
  els.verifyAnswers.checked = settings.verifyAnswers === true;
  els.verifyAnswers.addEventListener("change", async () => {
    settings.verifyAnswers = els.verifyAnswers.checked;
    await setSettings({ verifyAnswers: settings.verifyAnswers });
  });
  // 🔔 The "sound when the answer finishes" preference now lives in Settings → Appearance
  // (settings.soundOnDone), read directly by maybePlayDone(); no top-bar button anymore.
  // Keep the audio context warm on user gestures so the end-of-answer chime can fire later
  // (browsers suspend a context created/idle without a recent interaction).
  document.addEventListener("pointerdown", unlockAudioOnce, true);
  document.addEventListener("keydown", unlockAudioOnce, true);
  if (els.dictateBtn) els.dictateBtn.addEventListener("click", toggleDictation);

  railTabEls().forEach((b) => { // excludes the "+" (.rail-add) — it can't be hidden/selected as a tab
    b.addEventListener("click", () => {
      if (b.dataset.mode === "web") { openWebPanel(); return; } // Web is an embedded panel, not a chat workspace
      closeWebPanel(); // leaving web → reveal the chosen workspace underneath
      setMode(b.dataset.mode);
    });
    // Right-click a tab → confirm before hiding it (re-show via the rail "+" or Settings).
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!b.dataset.mode) return; // never the "+"
      askHideTab(b.dataset.mode, e.clientX, e.clientY);
    });
  });
  applyRailLayout();   // user's saved order + hidden tabs
  setupRailDnD();      // drag to reorder the icons
  // Mouse wheel over the rail OR the menu toggle switches workspace, wrapping INFINITELY both
  // ways (up = previous, wraps to last; down = next, wraps to first). Tracks the ACTIVE tab (not
  // `mode`) so it never gets stuck on the Web tab.
  const wheelNav = (e) => {
    const modes = railTabEls().filter((b) => !b.classList.contains("rail-tab-hidden")).map((b) => b.dataset.mode);
    if (modes.length < 2) return;
    e.preventDefault();
    const active = els.rail.querySelector(".railtab.active");
    let idx = active ? modes.indexOf(active.dataset.mode) : modes.indexOf(mode);
    if (idx < 0) idx = 0;
    const next = modes[(idx + (e.deltaY > 0 ? 1 : -1) + modes.length) % modes.length];
    if (next === "web") { openWebPanel(); return; }
    closeWebPanel();
    setMode(next);
  };
  els.rail.addEventListener("wheel", wheelNav, { passive: false });
  // Wheel anywhere on the WHOLE top bar (menu, search, history, new chat…) switches tabs.
  // The ☰ menu is inside .topbar, so this single listener covers it via bubbling.
  const topbarEl = document.querySelector(".topbar");
  if (topbarEl) topbarEl.addEventListener("wheel", wheelNav, { passive: false });
  // Rail "+" (re-show hidden tabs) + dismissers for its menu and the hide-confirm popup.
  if (els.railAddBtn) els.railAddBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleRailAddMenu(); });
  document.addEventListener("click", (e) => {
    if (els.railAddMenu && !els.railAddMenu.classList.contains("hidden")
        && !els.railAddMenu.contains(e.target) && !(els.railAddBtn && els.railAddBtn.contains(e.target)))
      els.railAddMenu.classList.add("hidden");
    if (hideConfirmEl && !hideConfirmEl.contains(e.target)) closeHideConfirm();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeHideConfirm(); if (els.railAddMenu) els.railAddMenu.classList.add("hidden"); } });
  els.openCodeApp.addEventListener("click", openCodeApp);

  // ── Resizable activity rail ──────────────────────────────────────────────
  // Apply the saved width, and let the user drag the divider (clamped 48–110px, persisted).
  (function setupRailResize() {
    const RAIL_MIN = 48, RAIL_MAX = 110;
    const applyRailWidth = (px) => document.documentElement.style.setProperty("--rail-w", Math.round(px) + "px");
    applyRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, settings.railWidth || 56)));
    const handle = document.getElementById("railResize");
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const rail = document.getElementById("rail");
      const startX = e.clientX;
      const startW = rail ? rail.getBoundingClientRect().width : (settings.railWidth || 56);
      const rightRail = document.body.classList.contains("rail-right");
      let w = startW;
      const move = (ev) => {
        const delta = (ev.clientX - startX) * (rightRail ? -1 : 1);
        w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, startW + delta));
        applyRailWidth(w);
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        setSettings({ railWidth: Math.round(w) });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
    });
  })();

  // PDF workspace controls (the old "Load PDF" button was replaced by the composer "+" — see attachBtn).
  els.pdfFile.addEventListener("change", (e) => {
    loadPdfFiles(e.target.files); // one or several PDFs at once
    e.target.value = ""; // allow re-loading the same file
  });
  els.pdfSummarize.addEventListener("click", pdfSummarizeAction);
  els.pdfImages.addEventListener("click", pdfExtractImages);
  els.pdfText.addEventListener("click", pdfExtractTextAction);

  els.translateLang.addEventListener("change", async () => {
    settings.targetLang = els.translateLang.value;
    await setSettings({ targetLang: settings.targetLang });
  });
  els.improvePreset.addEventListener("change", async () => {
    settings.improvePreset = els.improvePreset.value;
    await setSettings({ improvePreset: settings.improvePreset });
  });
  els.improveTone.addEventListener("change", async () => {
    settings.improveTone = els.improveTone.value;
    await setSettings({ improveTone: settings.improveTone });
  });
  els.imageSize.addEventListener("change", async () => {
    settings.imageSize = els.imageSize.value;
    await setSettings({ imageSize: settings.imageSize });
  });
  if (els.wbScope) els.wbScope.addEventListener("change", async () => {
    settings.wisebaseScope = els.wbScope.value;
    await setSettings({ wisebaseScope: settings.wisebaseScope });
  });
  if (els.wbManageBtn) els.wbManageBtn.addEventListener("click", () => openWbPanel(els.wbScope && els.wbScope.value ? els.wbScope.value : null));
  if (els.wbAddPageBtn) els.wbAddPageBtn.addEventListener("click", async () => {
    const wb = await wbLib();
    const cols = await wb.listCollections();
    if (!cols.length) { flashTopBanner(t("wb.needCollection")); openWbPanel(); return; }
    const target = els.wbScope.value || (cols.length === 1 ? cols[0].id : "");
    if (!target) { flashTopBanner(t("wb.pickCollectionTitle")); openWbPanel(); return; }
    await wbAddCurrentPage(target);
  });

  // In-conversation search (🔍 in the top bar).
  els.searchBtn.addEventListener("click", toggleSearch);
  els.searchInput.addEventListener("input", () => { runSearch(els.searchInput.value); scheduleGlobalSearch(els.searchInput.value); });
  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); gotoHit(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
  });
  els.searchPrev.addEventListener("click", () => gotoHit(-1));
  els.searchNext.addEventListener("click", () => gotoHit(1));
  els.searchClose.addEventListener("click", closeSearch);

  els.historyBtn.addEventListener("click", async () => {
    const show = els.historyPanel.classList.contains("hidden");
    if (show) { historyQuery = ""; if (els.historySearch) els.historySearch.value = ""; await renderHistoryList(); }
    els.historyPanel.classList.toggle("hidden");
  });
  // Full-text search across the history (title + every message).
  if (els.historySearch) {
    els.historySearch.addEventListener("input", () => { historyQuery = els.historySearch.value; renderHistoryList(); });
  }
  els.deleteSelected.addEventListener("click", deleteSelectedConversations);
  els.clearHistory.addEventListener("click", async () => {
    // Per-tab: clear only THIS workspace's saved conversations (the panel is filtered).
    const all = await listConversations();
    for (const c of all.filter((c) => (c.mode || "chat") === mode)) await deleteConversation(c.id);
    startFreshChat(); // the open one is gone too — start clean
    renderHistoryList();
    els.historyPanel.classList.add("hidden"); // nothing left to show → close the history popup
  });
  els.closeHistory.addEventListener("click", () => els.historyPanel.classList.add("hidden"));

  // Opening the tabs-as-context picker. The dedicated tabs icon does it; so does the "N tabs in
  // context" indicator (see updateTabsIndicator) when tabs are selected. NOT the whole page bar
  // anymore — the empty gap used to behave like an invisible button that popped the picker on any
  // stray click.
  if (els.tabsBtn) els.tabsBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleTabsPanel(); });
  if (els.pageTitle) els.pageTitle.addEventListener("click", (e) => {
    // The page-title slot doubles as the "N tabs in context" indicator; clicking it opens the picker.
    if (!els.pageBar.classList.contains("has-tabsel")) return;
    e.stopPropagation();
    toggleTabsPanel();
  });
  if (els.pageToggle) els.pageToggle.addEventListener("click", (e) => { e.stopPropagation(); togglePageMode(); });
  if (els.selPageToggle) els.selPageToggle.addEventListener("click", (e) => { e.stopPropagation(); toggleSelectorPagePopup(); });
  // NOTE: no ensurePagePermission()/permissions.request() here — on purpose. The web-tab capture &
  // element tools DON'T request a permission and work fine; the chat region/pick tools DID, and that
  // request() call (inside the click gesture, while <all_urls> is already granted) is exactly what
  // broke them — the screenshot then failed with "Missing activeTab permission". We rely on the same
  // already-granted host access the other tools use; if it's genuinely missing, captureRegion() shows
  // an actionable message telling the user to enable site access.
  els.pickEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (picking) return cancelPicking();
    pickElement();
  });
  els.captureRegion.addEventListener("click", (e) => {
    e.stopPropagation();
    if (capturing) return cancelCapture();
    // Ask for <all_urls> here (in the click gesture). On a FRESH grant the background reloads the
    // extension (Firefox MV3 quirk — captureVisibleTab only sees the host grant after a reload), and
    // capture works on the next click. If already granted, we proceed and, on the permission error,
    // trigger that reload ourselves (see captureRegion).
    ensurePagePermission().finally(() => captureRegion());
  });
  if (els.watchBtn) els.watchBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleWatchCurrentPage(); });
  if (els.secHeadersBtn) els.secHeadersBtn.addEventListener("click", (e) => { e.stopPropagation(); analyzePageHeaders(); });
  els.tabsClose.addEventListener("click", (e) => { e.stopPropagation(); els.tabsPanel.classList.add("hidden"); });
  els.tabsClear.addEventListener("click", (e) => { e.stopPropagation(); clearSelectedTabs(); });
  els.tabsList.addEventListener("change", persistSelectedTabs);

  // Live-refresh the multi-tab picker while it's open: open/close/finished-loading
  // a tab and the list updates instantly (debounced, ticked tabs preserved via
  // settings.selectedTabs). No manual refresh needed.
  let tabsRefreshTimer = null;
  const refreshTabsIfOpen = () => {
    if (els.tabsPanel.classList.contains("hidden")) return;
    clearTimeout(tabsRefreshTimer);
    tabsRefreshTimer = setTimeout(() => buildTabsList(), 180);
  };
  if (browser.tabs) {
    browser.tabs.onCreated.addListener(refreshTabsIfOpen);
    browser.tabs.onRemoved.addListener(refreshTabsIfOpen);
    if (browser.tabs.onUpdated) {
      browser.tabs.onUpdated.addListener((id, info) => {
        if (info && (info.title || info.url || info.status === "complete")) refreshTabsIfOpen();
      });
    }
  }

  // No Send button — Enter sends (Shift+Enter = newline).
  // Slash-command palette navigation (capture phase → runs before send/Enter handlers).
  els.input.addEventListener("keydown", (e) => {
    if (!paletteOpen()) return;
    if (e.key === "ArrowDown") { e.preventDefault(); cmdSel = Math.min(cmdItems.length - 1, cmdSel + 1); updPaletteSel(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); updPaletteSel(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pickCmd(cmdSel); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); }
  }, true);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
  });
  // Global Enter: send even when focus left the composer (e.g. after picking the
  // translation language or image size in a <select>) — no need to click back in.
  // Real text fields (search boxes, model filter) keep their own Enter behaviour.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const a = document.activeElement;
    if (actionBubbleEl) return;                        // the isolated bubble owns the focus
    if (!a || a === els.input) return;                 // composer handles its own Enter
    if (a.isContentEditable) return;
    const tag = a.tagName;
    if (tag === "TEXTAREA") return;
    if (tag === "INPUT" && /^(text|search|number|email|url|password|tel)$/i.test(a.type || "text")) return;
    if (!["chat", "agent", "translate", "improve", "image", "pdf"].includes(mode)) return;
    e.preventDefault();
    onSend();
  });
  // Esc closes the image lightbox or the action bubble.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (lightboxEl) closeLightbox();
    else if (actionBubbleEl) closeActionBubble();
  });
  // Click a generated / PDF-page image to open it enlarged in a lightbox.
  els.messages.addEventListener("click", (e) => {
    const img = e.target.closest && e.target.closest("img.gen-image");
    if (img) openLightbox(img.src, img.alt || "image.png");
  });
  // Clicking outside the History panel or the tab-picker closes them. The Search bar
  // is deliberately NOT closed here — it stays open until ✕ or the 🔍 button, so the
  // user can click a cross-conversation result without it vanishing.
  document.addEventListener("click", (e) => {
    // Toggling the menu (brand) must NOT close History — exclude it from the outside-click close.
    if (els.historyPanel && !els.historyPanel.classList.contains("hidden") &&
        !els.historyPanel.contains(e.target) && !els.historyBtn.contains(e.target)
        && !(els.brand && els.brand.contains(e.target))) els.historyPanel.classList.add("hidden");
    if (els.tabsPanel && !els.tabsPanel.classList.contains("hidden") &&
        !els.tabsPanel.contains(e.target) && !els.pageBar.contains(e.target)) els.tabsPanel.classList.add("hidden");
    // Close the "Context" attachments panel when clicking outside it (the chip toggles it
    // itself and stops propagation, so a click that reaches here is "outside").
    if (contextPanelOpen && contextPanelEl && !contextPanelEl.contains(e.target) &&
        !(e.target.closest && e.target.closest(".context-chip"))) closeContextPanel();
  });
  // Clicking on the WEB PAGE (or any other window) blurs the sidebar — close the
  // tab-picker then too, so it never lingers over the page the user moved to.
  window.addEventListener("blur", () => { if (els.tabsPanel) els.tabsPanel.classList.add("hidden"); });
  els.input.addEventListener("input", onComposerInput);
  els.stop.addEventListener("click", () => abortController && abortController.abort());
  // + New: on the Web tab it resets the embedded site (fresh session, like the provider's own
  // "new chat"); otherwise it starts a new Hivey conversation.
  els.newChat.addEventListener("click", () => {
    if (!els.webPanel.classList.contains("hidden")) {
      if (webCurUrl) els.webFrame.src = webCurUrl;
      return;
    }
    newChat();
  });

  // The gear TOGGLES Settings: first click opens the options tab (as before), a second
  // click on the gear closes that tab again. We detect an already-open options tab by URL.
  els.openOptions.addEventListener("click", async () => {
    try {
      const optUrl = browser.runtime.getURL("src/options/options.html");
      const tabs = await browser.tabs.query({});
      const open = tabs.filter((tb) => (tb.url || "").split(/[?#]/)[0] === optUrl);
      if (open.length) {
        await browser.tabs.remove(open.map((tb) => tb.id).filter((id) => id != null));
        return; // toggled OFF — don't reopen
      }
    } catch (_) {
      // tabs query/remove unavailable → fall through and just open it
    }
    browser.runtime.openOptionsPage();
  });
  els.modelConnect.addEventListener("click", () => browser.runtime.openOptionsPage());
  if (els.emptyOptions) els.emptyOptions.addEventListener("click", () => browser.runtime.openOptionsPage());
  if (els.freeConnect) els.freeConnect.addEventListener("click", doFreeConnect);

  // 🌐 Web chats — embed the provider web UIs (Gemini/Claude/ChatGPT/Copilot/Mistral) so you
  // can use your logged-in web session instead of API tokens. The iframe is allowed by the
  // declarativeNetRequest ruleset that strips the sites' anti-framing headers; an "open in
  // tab" button is the fallback for sites that still refuse (e.g. Google login).
  const webOpts = () => (els.webProvMenu ? Array.from(els.webProvMenu.querySelectorAll(".wc-opt")) : []);
  let webCurUrl = "https://claude.ai/new";
  function closeWebMenu() {
    if (els.webProvMenu) els.webProvMenu.classList.add("hidden");
    if (els.webProvBtn) els.webProvBtn.setAttribute("aria-expanded", "false");
  }
  let webCurProv = "claude";
  function selectWebChat(opt) {
    if (!opt) return;
    // Some sites can't be embedded (Cloudflare bot-protection, e.g. Perplexity) → open in a tab.
    if (opt.dataset.noembed) {
      try { browser.tabs.create({ url: opt.dataset.url }); } catch (_) {}
      toastWeb(t("web.noembed"));
      closeWebMenu();
      return;
    }
    for (const o of webOpts()) o.classList.toggle("active", o === opt);
    webCurUrl = opt.dataset.url;
    webCurProv = opt.dataset.prov;
    els.webFrame.src = opt.dataset.url;
    if (els.webProvLabel) els.webProvLabel.textContent = opt.textContent.trim();
    if (els.webProvDot) {
      const dot = opt.querySelector(".webprov-dot");
      els.webProvDot.style.background = dot ? dot.style.background : "var(--accent)";
    }
    settings.webChatProvider = opt.dataset.prov;
    setSettings({ webChatProvider: opt.dataset.prov });
    closeWebMenu();
  }
  function openWebPanel() {
    if (!els.webFrame.getAttribute("src")) {
      const prov = settings.webChatProvider || "claude";
      selectWebChat(webOpts().find((o) => o.dataset.prov === prov) || webOpts()[0]);
    }
    els.webPanel.classList.remove("hidden");
    if (els.webOverlay) els.webOverlay.classList.remove("hidden");
    document.body.classList.add("web-active"); // reveals the web-only header controls
    els.rail.querySelectorAll(".railtab").forEach((b) => b.classList.toggle("active", b.dataset.mode === "web"));
    updatePageBar(); // hide the chat Page bar while on the Web tab
  }
  function closeWebPanel() {
    els.webPanel.classList.add("hidden"); closeWebMenu();
    document.body.classList.remove("web-active");
    els.rail.querySelectorAll(".railtab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    updatePageBar();
  }
  if (els.webChatsChip) {
    els.webChatsChip.addEventListener("click", () => {
      if (els.webPanel.classList.contains("hidden")) openWebPanel();
      else closeWebPanel();
    });
  }
  if (els.closeWeb) els.closeWeb.addEventListener("click", closeWebPanel);
  if (els.webOpenTab) els.webOpenTab.addEventListener("click", () => browser.tabs.create({ url: webCurUrl }));
  // ✚ New conversation: reload the provider to its fresh-chat URL (works on every provider).
  if (els.webNewChat) els.webNewChat.addEventListener("click", () => { if (webCurUrl) els.webFrame.src = webCurUrl; });
  // ☰ Hivey menu: a vertical dropdown of Hivey's own workspaces — clicking one CLOSES web mode
  // and jumps straight to that tab (so the web panel is one click away from the rest of Hivey).
  function buildHiveyMenu() {
    if (!els.webHiveyMenu || els.webHiveyMenu.childElementCount) return;
    const tabs = Array.from(document.querySelectorAll("#rail .railtab"));
    for (const tab of tabs) {
      const mode = tab.dataset.mode;
      if (mode === "web") continue; // already in web mode — the menu is for the OTHER workspaces
      const item = document.createElement("button");
      item.type = "button";
      item.className = "webhivey-item";
      const ic = tab.querySelector("svg");
      if (ic) { const c = ic.cloneNode(true); c.setAttribute("width", "16"); c.setAttribute("height", "16"); item.appendChild(c); }
      const label = document.createElement("span");
      label.textContent = (tab.getAttribute("title") || mode || "").split("—")[0].trim();
      item.appendChild(label);
      item.addEventListener("click", () => {
        els.webHiveyMenu.classList.add("hidden");
        closeWebPanel();
        const real = document.querySelector('#rail .railtab[data-mode="' + mode + '"]');
        if (real) real.click();
      });
      els.webHiveyMenu.appendChild(item);
    }
  }
  if (els.webHiveyBtn) {
    els.webHiveyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      buildHiveyMenu();
      const hidden = els.webHiveyMenu.classList.toggle("hidden");
      els.webHiveyBtn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
  }
  document.addEventListener("click", (e) => {
    if (els.webHivey && !els.webHivey.contains(e.target)) els.webHiveyMenu && els.webHiveyMenu.classList.add("hidden");
  });
  // ── Premium integration: relocate the provider selector + the page-tools menu INTO the
  // global header (a web-only group), then drop the whole web sub-header. Result: a clean
  // iframe that fills the conversation area below ONE header — like the native chat view.
  const webProvEl = $("webProv"), webOverlayEl = $("webOverlay");
  if (els.webHeadCtl && webProvEl) els.webHeadCtl.appendChild(webProvEl); // provider → LEFT (next to ☰)
  if (els.webToolsSlot && webOverlayEl) els.webToolsSlot.appendChild(webOverlayEl); // 📄 tools → RIGHT row
  const subHead = els.webPanel && els.webPanel.querySelector(".webchats-head");
  if (subHead) subHead.remove();

  // Open the Web chats panel on startup when the user prefers an API-free experience.
  if (settings.webDefault) { try { openWebPanel(); } catch (_) {} }
  if (els.webProvBtn) {
    els.webProvBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = els.webProvMenu.classList.toggle("hidden");
      els.webProvBtn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
  }
  if (els.webProvMenu) {
    els.webProvMenu.addEventListener("click", (e) => {
      const opt = e.target.closest(".wc-opt");
      if (opt) selectWebChat(opt);
    });
  }
  document.addEventListener("click", (e) => {
    if (els.webProv && !els.webProv.contains?.(e.target) && els.webProvBtn && !els.webProvBtn.contains(e.target)) closeWebMenu();
  });
  // 🐝 Hivey overlay — put the CURRENT page into the web chat "like a paste / file upload".
  // We copy the context (page text OR a screenshot image) to the clipboard AND fire a synthetic
  // paste into the provider's composer via the bridge. Rich editors (Gemini/Claude/ChatGPT…)
  // handle the synthetic paste directly; if a site ignores it, the data is already on the
  // clipboard so a plain Ctrl+V works. Robust for both text and images.
  let webHintTimer = null;
  function toastWeb(msg) {
    if (!els.webHint) return;
    if (!els.webHint.dataset.def) els.webHint.dataset.def = els.webHint.textContent;
    clearTimeout(webHintTimer);
    els.webHint.textContent = msg;
    els.webHint.classList.add("flash");
    webHintTimer = setTimeout(() => {
      els.webHint.classList.remove("flash");
      els.webHint.textContent = els.webHint.dataset.def || "";
    }, 3500);
  }
  const WEB_COMPRESS_SYSTEM =
    "You prepare a web page as clean CONTEXT for another AI assistant. Keep ALL the substantive " +
    "information (facts, figures, names, key points, structure, code if any) but strip navigation, " +
    "menus, ads, cookie/consent banners, footers and repeated boilerplate. Rewrite it as concise, " +
    "well-structured Markdown (short headings + bullet points). Be faithful — do not add or invent " +
    "anything. Output ONLY the cleaned context, no preamble, no commentary.";
  // Send context straight INTO the provider's composer (auto-typed by the bridge). We also
  // stage it on the clipboard as a silent Ctrl+V fallback for the rare site that ignores it.
  async function sendToWebChat(payload) {
    try {
      const clipText = payload.text || (payload.textFile && payload.textFile.content) || "";
      if (clipText) { try { await navigator.clipboard.writeText(clipText); } catch (_) {} }
      if (payload.imageDataUrl) {
        try {
          const blob = await (await fetch(payload.imageDataUrl)).blob();
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        } catch (_) {}
      }
    } catch (_) {}
    try { els.webFrame.contentWindow.postMessage({ __hiveyWeb: "paste", ...payload }, "*"); } catch (_) {}
  }
  async function webInject(kind) {
    const btn = kind === "shot" ? els.webInjectShot : kind === "el" ? els.webInjectEl : els.webInjectPage;
    if (btn) btn.classList.add("busy");
    try {
      if (kind === "shot") {
        // SELECTION screenshot (draw a rectangle), like the chat tab — not the whole page.
        const tab = await getActiveTab();
        if (!tab || isRestrictedUrl(tab.url)) { toastWeb(t("web.shotErr")); return; }
        let res;
        webPick = { tabId: tab.id, cancelType: "region_cancel" };
        try { if (els.webFrame) els.webFrame.blur(); window.focus(); } catch (_) {}
        try { res = await sendToTab(tab.id, { type: "capture_region", ...themeAccents() }); }
        catch (_) { toastWeb(t("web.shotErr")); return; }
        finally { webPick = null; }
        if (!res || res.cancelled || !res.rect) return;
        let img = null;
        try {
          await new Promise((r) => setTimeout(r, 140));
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          const winId = tabs && tabs[0] ? tabs[0].windowId : undefined;
          img = await loadImage(await browser.tabs.captureVisibleTab(winId, { format: "png" }));
        } catch (_) {}
        const crop = img && cropFromShot(img, res.rect, res.dpr || 1);
        if (!crop) { toastWeb(t("web.shotErr")); return; }
        await sendToWebChat({ imageDataUrl: crop });
        toastWeb(t("web.shotSent"));
      } else if (kind === "el") {
        // No permission prompt here: it must run on the user gesture (an await before it loses
        // the gesture). The content script is already injected, so pick_element works directly.
        const tab = await getActiveTab();
        if (!tab || isRestrictedUrl(tab.url)) { toastWeb(t("web.pickErr")); return; }
        let res;
        setPickBanner(true);
        webPick = { tabId: tab.id, cancelType: "pick_cancel" };
        try { if (els.webFrame) els.webFrame.blur(); window.focus(); } catch (_) {}
        try { res = await sendToTab(tab.id, { type: "pick_element", ...themeAccents() }); }
        catch (_) { toastWeb(t("web.pickReload")); return; }
        finally { setPickBanner(false); webPick = null; }
        if (res === undefined) { toastWeb(t("web.pickReload")); return; }
        if (!res || res.cancelled || !(res.elements || []).length) return;
        const parts = res.elements.filter((el) => el.text).map((el) => `<${el.tag}>\n${el.text}`);
        if (!parts.length) { toastWeb(t("web.pickErr")); return; }
        const content =
          "Élément(s) sélectionné(s) sur « " + (res.title || res.url || "") + " »" +
          (res.url ? " (" + res.url + ")" : "") + " :\n\n" + parts.join("\n\n---\n\n").slice(0, 24000);
        await sendToWebChat({ textFile: { name: "elements.txt", content } });
        toastWeb(t("web.pickSent"));
      } else {
        // Page → a FREE Hivey model cleans & COMPRESSES the page into tidy context, attached
        // as a .txt FILE in the provider chat (not a wall of text in the input). Falls back to
        // the cleaned raw text when OpenRouter isn't connected.
        const page = await executeTool("read_page", {}, {});
        if (!page || page.error || !page.text) { toastWeb(t("web.pageEmpty")); return; }
        let body = String(page.text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        let compressed = false;
        if (!currentKeyMissing("openrouter")) {
          try {
            toastWeb(t("web.compressing"));
            const sel = ensureUsable(
              parseSel(hiveyTiers("hivey/free").extract || hiveyTiers("hivey/free").utility),
              "hivey/free",
            );
            const out = await runUtilityCompletion(sel, WEB_COMPRESS_SYSTEM, body.slice(0, 24000), null);
            if (out && out.replace(/\s/g, "").length > 40) { body = out; compressed = true; }
          } catch (_) {}
        }
        if (!compressed) body = body.slice(0, 60000);
        const base = (page.title || "page").replace(/[^\w .-]+/g, "_").trim().slice(0, 40) || "page";
        const content =
          (compressed ? "Résumé de la page" : "Contenu de la page") +
          " « " + (page.title || "") + " » (" + (page.url || "") + ") :\n\n" + body;
        await sendToWebChat({ textFile: { name: base + ".txt", content } });
        toastWeb(compressed ? t("web.pageSentSum") : t("web.pageSent"));
      }
    } catch (_) {
      toastWeb(kind === "shot" ? t("web.shotErr") : kind === "el" ? t("web.pickErr") : t("web.pageEmpty"));
    } finally {
      if (btn) btn.classList.remove("busy");
    }
  }
  // Collapse/expand the overlay tools so they don't sit on top of the provider's own UI.
  function setWebTools(open) {
    if (els.webOvMenu) els.webOvMenu.classList.toggle("hidden", !open);
    if (els.webTabsMenu) els.webTabsMenu.classList.add("hidden");
    if (els.webOverlay) els.webOverlay.classList.toggle("open", open);
    if (els.webOvToggle) els.webOvToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (els.webOvToggle) {
    els.webOvToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setWebTools(els.webOvMenu.classList.contains("hidden"));
    });
  }
  document.addEventListener("click", (e) => {
    if (els.webOverlay && !els.webOverlay.contains(e.target)) setWebTools(false);
  });
  // After an action, collapse the menu so it gets out of the way.
  const onTool = (kind) => () => { webInject(kind); setWebTools(false); };
  if (els.webInjectEl) els.webInjectEl.addEventListener("click", onTool("el"));
  if (els.webInjectPage) els.webInjectPage.addEventListener("click", onTool("page"));
  if (els.webInjectShot) els.webInjectShot.addEventListener("click", onTool("shot"));

  // 📑 Tabs as context: pick open tabs → read them → compress (free model) → attach as a file.
  function closeWebTabs() { if (els.webTabsMenu) els.webTabsMenu.classList.add("hidden"); }
  async function openWebTabs() {
    if (els.webOvMenu) els.webOvMenu.classList.add("hidden");
    if (els.webOverlay) els.webOverlay.classList.add("open");
    els.webTabsList.innerHTML = '<div class="web-tabs-empty">…</div>';
    els.webTabsMenu.classList.remove("hidden");
    let res;
    try { res = await executeTool("list_tabs", {}, {}); } catch (_) {}
    const tabs = ((res && res.tabs) || []).filter((tb) => tb.url && !/^about:/.test(tb.url));
    if (!tabs.length) { setHTML(els.webTabsList, '<div class="web-tabs-empty">' + t("web.tabsNone") + "</div>"); return; }
    els.webTabsList.innerHTML = "";
    for (const tb of tabs) {
      const row = document.createElement("label");
      row.className = "web-tab-row";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.dataset.tabId = String(tb.id);
      const span = document.createElement("span");
      span.className = "web-tab-name"; span.textContent = tb.title || tb.url; span.title = tb.url;
      row.appendChild(cb); row.appendChild(span);
      els.webTabsList.appendChild(row);
    }
  }
  async function webTabsSendSelected() {
    const ids = Array.from(els.webTabsList.querySelectorAll("input:checked"))
      .map((cb) => parseInt(cb.dataset.tabId, 10)).filter((n) => !isNaN(n));
    if (!ids.length) { toastWeb(t("web.tabsNone")); return; }
    els.webTabsSend.classList.add("busy");
    try {
      const blocks = [];
      for (const id of ids) {
        try {
          const r = await executeTool("read_tab", { tabId: id }, {});
          if (r && r.text) {
            blocks.push("### " + (r.title || r.url || "Onglet") + " (" + (r.url || "") + ")\n\n" +
              String(r.text).replace(/\n{3,}/g, "\n\n").trim());
          }
        } catch (_) {}
      }
      if (!blocks.length) { toastWeb(t("web.tabsNone")); return; }
      let body = blocks.join("\n\n---\n\n");
      let compressed = false;
      if (!currentKeyMissing("openrouter")) {
        try {
          toastWeb(t("web.compressing"));
          const sel = ensureUsable(
            parseSel(hiveyTiers("hivey/free").extract || hiveyTiers("hivey/free").utility), "hivey/free");
          const out = await runUtilityCompletion(sel, WEB_COMPRESS_SYSTEM, body.slice(0, 28000), null);
          if (out && out.replace(/\s/g, "").length > 40) { body = out; compressed = true; }
        } catch (_) {}
      }
      if (!compressed) body = body.slice(0, 60000);
      const head = (compressed ? "Résumé de " : "Contenu de ") + ids.length + " onglet(s) :\n\n";
      await sendToWebChat({ textFile: { name: "onglets.txt", content: head + body } });
      toastWeb(t("web.tabsSent"));
    } finally {
      els.webTabsSend.classList.remove("busy");
      closeWebTabs(); setWebTools(false);
    }
  }
  if (els.webInjectTabs) els.webInjectTabs.addEventListener("click", (e) => { e.stopPropagation(); openWebTabs(); });
  if (els.webTabsSend) els.webTabsSend.addEventListener("click", (e) => { e.stopPropagation(); webTabsSendSelected(); });

  // React only to connection/model changes. Ignoring churn from our own frequent
  // writes (terminalSession on every terminal message, mode, selectedTabs…) avoids
  // rebuilding the pickers mid-stream and re-fetching model lists in a loop — that
  // feedback was what glitched the sidebar when switching the Terminal model.
  onSettingsChanged(async (changes) => {
    // A UI-language switch in Settings: reload so every static + dynamic string is
    // rebuilt in the new language (simplest and fully consistent).
    if (changes.uiLang) { location.reload(); return; }
    if (changes.railSide) document.body.classList.toggle("rail-right", changes.railSide.newValue === "right");
    if (changes.railHidden) { settings.railHidden = !!changes.railHidden.newValue; applyRailPinned(); }
    if (changes.railTabsHidden || changes.railOrder) {
      settings = await getSettings();
      applyRailLayout();
    }
    if (changes.msgBorderOn || changes.msgBorderColor || changes.textOutlineOn || changes.railIconColor || changes.contourOn || changes.contourColor || changes.msgBorderOpacity || changes.contourOpacity || changes.railIconOpacity || changes.topIconColor || changes.topIconColor2 || changes.topIconGradient) {
      settings = await getSettings();
      applyMsgBorder();
    }
    if (changes.theme || changes.themeColors || changes.gradientOn || changes.gradientSplit || changes.topbarColor || changes.topbarOpacity) {
      settings = await getSettings(); // refresh the global so gradOpts() reads the NEW gradient values
      const s2 = settings;
      applyTheme(s2.theme || "dark", s2.themeColors, gradOpts());
      updateActionIcon();              // keep the browser icon in sync with the theme
    }
    if (changes.theme || changes.themeColors || changes.auraColor || changes.auraOpacity || changes.auraSize) {
      settings = await getSettings();
      applyAura();                     // live background-aura update (colour/size/opacity)
    }
    if (changes.uiFont) applyFont((await getSettings()).uiFont); // live UI font switch
    const connChanged = !!(changes.keys || changes.baseUrls || changes.localEnabled);
    const j0Changed = !!(changes.judge0Endpoint || changes.judge0Key);
    if (!connChanged && !changes.modelLists && !changes.orModels && !changes.codeAppUrl && !changes.orFreeOnly && !j0Changed) return;
    settings = await getSettings();
    updateImageNote();
    refreshModelUI();
    if (changes.codeAppUrl) updateCodeLauncher();
    if (j0Changed) setJudge0Config({ endpoint: settings.judge0Endpoint, key: settings.judge0Key });
    if (connChanged) autoListConnected();
  });
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
}
function resetComposerHeight() { els.input.style.height = "auto"; }

// ── 🐝 Slash-commands (/) — Skills, Goals, Enhance: power tools for ANY model ──
let activeSkill = null;   // {id,emoji,name,system}
let goalMode = false;     // treat the next message as a goal to plan + execute
let enhanceNext = false;  // rewrite the next prompt with a free model before sending
let cmdItems = [];
let cmdSel = -1;
let historyQuery = ""; // full-text filter for the history panel
function cmdList(filter) {
  const f = (filter || "").toLowerCase();
  const _lang = getLang();
  const lib = [
    ...(settings.promptLibrary || []).map((p) => ({ kind: "prompt", emoji: "📌", name: p.title, desc: (p.text || "").replace(/\s+/g, " ").slice(0, 60), text: p.text })),
    ...BUILTIN_PROMPTS.map((p) => ({ kind: "prompt", emoji: "📚", name: builtinTitle(p, _lang), desc: builtinText(p, _lang).replace(/\s+/g, " ").slice(0, 60), text: builtinText(p, _lang) })),
  ];
  const items = [
    { kind: "enhance", emoji: "✨", name: t("cmd.enhance"), desc: t("cmd.enhanceDesc") },
    { kind: "goal", emoji: "🎯", name: t("cmd.goal"), desc: t("cmd.goalDesc") },
    ...lib,
    ...SKILLS.map((s) => ({ kind: "skill", skill: s, emoji: s.emoji, name: s.name, desc: s.desc })),
  ];
  return f ? items.filter((it) => (it.name + " " + (it.desc || "")).toLowerCase().includes(f)) : items;
}
function updPaletteSel() {
  const btns = els.cmdPalette.querySelectorAll(".cmd-item");
  btns.forEach((b, i) => b.classList.toggle("sel", i === cmdSel));
  const sel = btns[cmdSel];
  if (sel) sel.scrollIntoView({ block: "nearest" });
}
function renderPalette(filter) {
  cmdItems = cmdList(filter);
  cmdSel = cmdItems.length ? 0 : -1;
  if (!cmdItems.length) { closePalette(); return; }
  els.cmdPalette.innerHTML = "";
  let skillHeader = false;
  cmdItems.forEach((it, i) => {
    if (it.kind === "skill" && !skillHeader) {
      skillHeader = true;
      const cat = document.createElement("div"); cat.className = "cmd-cat"; cat.textContent = t("cmd.skills");
      els.cmdPalette.appendChild(cat);
    }
    const b = document.createElement("button");
    b.type = "button"; b.className = "cmd-item" + (i === cmdSel ? " sel" : "");
    b.innerHTML = '<span class="ci-emoji"></span><span class="ci-text"><span class="ci-name"></span><span class="ci-desc"></span></span>';
    b.querySelector(".ci-emoji").textContent = it.emoji;
    b.querySelector(".ci-name").textContent = it.name;
    b.querySelector(".ci-desc").textContent = it.desc || "";
    b.addEventListener("mousedown", (e) => { e.preventDefault(); pickCmd(i); });
    els.cmdPalette.appendChild(b);
  });
  els.cmdPalette.classList.remove("hidden");
}
function closePalette() { els.cmdPalette.classList.add("hidden"); cmdItems = []; cmdSel = -1; }
function paletteOpen() { return els.cmdPalette && !els.cmdPalette.classList.contains("hidden"); }
function pickCmd(i) {
  const it = cmdItems[i]; if (!it) return;
  // A saved prompt is INSERTED into the composer (not a mode chip) — the user can edit then send.
  if (it.kind === "prompt") {
    els.input.value = it.text || ""; autoGrow(); closePalette(); els.input.focus();
    els.input.setSelectionRange(els.input.value.length, els.input.value.length);
    return;
  }
  if (it.kind === "enhance") enhanceNext = true;
  else if (it.kind === "goal") goalMode = true;
  else if (it.kind === "skill") activeSkill = it.skill;
  els.input.value = ""; autoGrow(); closePalette(); renderCmdChips(); els.input.focus();
}
function renderCmdChips() {
  const chips = [];
  if (activeSkill) chips.push({ k: "skill", label: activeSkill.emoji + " " + activeSkill.name });
  if (goalMode) chips.push({ k: "goal", label: "🎯 " + t("cmd.goal") });
  if (enhanceNext) chips.push({ k: "enhance", label: "✨ " + t("cmd.enhance") });
  els.cmdChips.innerHTML = "";
  if (!chips.length) { els.cmdChips.classList.add("hidden"); return; }
  for (const c of chips) {
    const el = document.createElement("span"); el.className = "cmd-chip";
    el.appendChild(document.createTextNode(c.label));
    const x = document.createElement("button"); x.className = "cx"; x.type = "button"; x.textContent = "✕"; x.title = t("cmd.clear");
    x.addEventListener("click", () => {
      if (c.k === "skill") activeSkill = null;
      else if (c.k === "goal") goalMode = false;
      else if (c.k === "enhance") enhanceNext = false;
      renderCmdChips();
    });
    el.appendChild(x);
    els.cmdChips.appendChild(el);
  }
  els.cmdChips.classList.remove("hidden");
}
function onComposerInput() {
  autoGrow();
  const v = els.input.value;
  if (mode === "chat" && v.startsWith("/")) renderPalette(v.slice(1));
  else if (paletteOpen()) closePalette();
  // @-mention sources: an "@…" token at the cursor opens a picker of sources (current page + open
  // tabs) to inject explicitly into the next message's context.
  const at = /(?:^|\s)@([^\s@]*)$/.exec(v.slice(0, els.input.selectionStart ?? v.length));
  if (at) renderAtMenu(at[1]);
  else closeAtMenu();
}

// ----- @-mention sources -----------------------------------------------------
let atMenuEl = null;
function closeAtMenu() { if (atMenuEl) atMenuEl.classList.add("hidden"); }
function replaceAtToken() {
  // Remove the trailing "@partial" the user was typing.
  const val = els.input.value;
  const pos = els.input.selectionStart ?? val.length;
  const before = val.slice(0, pos).replace(/(?:^|\s)@[^\s@]*$/, (m) => (m[0] === "@" ? "" : m[0]));
  els.input.value = before + val.slice(pos);
  autoGrow();
  els.input.focus();
}
async function renderAtMenu(filter) {
  if (!atMenuEl) {
    atMenuEl = document.createElement("div");
    atMenuEl.className = "at-menu cmd-palette";
    document.querySelector(".composer-box").appendChild(atMenuEl);
  }
  const f = (filter || "").toLowerCase();
  const items = [{ kind: "page", name: t("at.currentPage"), desc: t("at.currentPageDesc") }];
  try {
    const res = await executeTool("list_tabs", {}, {});
    for (const tb of (res && res.tabs) || []) {
      if (!tb.url || /^about:/.test(tb.url)) continue;
      items.push({ kind: "tab", id: tb.id, name: tb.title || tb.url, desc: tb.url });
    }
  } catch (_) {}
  const shown = f ? items.filter((it) => (it.name + " " + (it.desc || "")).toLowerCase().includes(f)) : items;
  if (!shown.length) { closeAtMenu(); return; }
  atMenuEl.innerHTML = "";
  const head = document.createElement("div"); head.className = "cmd-cat"; head.textContent = t("at.head");
  atMenuEl.appendChild(head);
  for (const it of shown.slice(0, 12)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cmd-item";
    b.innerHTML = '<span class="ci-emoji"></span><span class="ci-text"><span class="ci-name"></span><span class="ci-desc"></span></span>';
    b.querySelector(".ci-emoji").textContent = it.kind === "page" ? "📄" : "🗂";
    b.querySelector(".ci-name").textContent = it.name;
    b.querySelector(".ci-desc").textContent = it.desc || "";
    b.addEventListener("mousedown", async (e) => { e.preventDefault(); await pickAtSource(it); });
    atMenuEl.appendChild(b);
  }
  atMenuEl.classList.remove("hidden");
}
async function pickAtSource(it) {
  replaceAtToken();
  closeAtMenu();
  if (it.kind === "page") {
    if (els.pageCtx) { els.pageCtx.checked = true; els.pageCtx.dispatchEvent(new Event("change")); }
    flashTopBanner(t("at.addedPage"));
  } else if (it.kind === "tab") {
    const ids = new Set(settings.selectedTabs || []);
    ids.add(it.id);
    settings.selectedTabs = [...ids];
    settings.includeSelectedTabs = true;
    await setSettings({ selectedTabs: settings.selectedTabs, includeSelectedTabs: true });
    if (typeof updateTabsClearBtn === "function") updateTabsClearBtn();
    flashTopBanner(t("at.addedTab", { name: (it.name || "").slice(0, 40) }));
  }
}

// ----- 🛡 Quick analysis (Security tab) --------------------------------------
// A LIST of one-tap defensive analysis templates (prompt inserted into the composer). "Custom" is the
// default = free-form. The live "Analyze security headers" ACTION lives as an icon on the page bar.
const SEC_ANALYSES = [
  { id: "custom", labelKey: "an.custom" },
  { id: "csp", promptKey: "recipe.cspPrompt", labelKey: "an.csp" },
  { id: "httpReview", promptKey: "recipe.httpReviewPrompt", labelKey: "an.httpReview" },
  { id: "pcap", promptKey: "recipe.pcapPrompt", labelKey: "an.pcap" },
  { id: "cve", promptKey: "an.cvePrompt", labelKey: "an.cve" },
  { id: "cookies", promptKey: "an.cookiesPrompt", labelKey: "an.cookies" },
  { id: "tls", promptKey: "an.tlsPrompt", labelKey: "an.tls" },
  { id: "cors", promptKey: "an.corsPrompt", labelKey: "an.cors" },
  { id: "jwt", promptKey: "an.jwtPrompt", labelKey: "an.jwt" },
  { id: "secrets", promptKey: "an.secretsPrompt", labelKey: "an.secrets" },
  { id: "logs", promptKey: "an.logsPrompt", labelKey: "an.logs" },
  { id: "nmap", promptKey: "an.nmapPrompt", labelKey: "an.nmap" },
  { id: "dockerfile", promptKey: "an.dockerfilePrompt", labelKey: "an.dockerfile" },
  { id: "deps", promptKey: "an.depsPrompt", labelKey: "an.deps" },
  { id: "phishing", promptKey: "an.phishingPrompt", labelKey: "an.phishing" },
  { id: "hash", promptKey: "an.hashPrompt", labelKey: "an.hash" },
  { id: "iam", promptKey: "an.iamPrompt", labelKey: "an.iam" },
  { id: "incident", promptKey: "an.incidentPrompt", labelKey: "an.incident" },
];
function renderSecRecipes(next) {
  if (!els.secRecipes) return;
  if (next !== "security") { els.secRecipes.classList.add("hidden"); closeAnalysisMenu(); return; }
  els.secRecipes.innerHTML = "";
  // Custom themed dropdown. A native <select>'s option list can't be themed on many OSes (stays
  // white), so we build our own. The MENU is fixed-positioned on <body> so it's never clipped by the
  // composer container (that clipping is what squished the rows). Styled like the model picker.
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sec-analysis-btn";
  btn.innerHTML = '<span class="sa-label"></span><span class="sa-caret" aria-hidden="true"><svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 3l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.6"/></svg></span>';
  btn.querySelector(".sa-label").textContent = t("an.custom");
  btn.addEventListener("click", (e) => { e.stopPropagation(); openAnalysisMenu(btn); });
  els.secRecipes.appendChild(btn);
  els.secRecipes.classList.remove("hidden");
}
let analysisMenuEl = null;
function closeAnalysisMenu() { if (analysisMenuEl) analysisMenuEl.classList.add("hidden"); }
function openAnalysisMenu(anchor) {
  if (analysisMenuEl && !analysisMenuEl.classList.contains("hidden")) { closeAnalysisMenu(); return; }
  if (!analysisMenuEl) {
    analysisMenuEl = document.createElement("div");
    analysisMenuEl.className = "sec-analysis-menu hidden";
    document.body.appendChild(analysisMenuEl);
  }
  analysisMenuEl.innerHTML = "";
  for (const a of SEC_ANALYSES) {
    if (a.id === "custom" || !a.promptKey) continue; // "Custom" = resting default (no action)
    const item = document.createElement("button");
    item.type = "button"; item.className = "sa-item";
    item.innerHTML = '<span class="sa-ic">🛡</span><span></span>';
    item.querySelector("span:last-child").textContent = t(a.labelKey);
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // inLang(): append an explicit "answer in <user's language>" directive. Without it the recipe
      // text drove the reply language (English recipes → English answers), ignoring the user's
      // response-language / UI-language choice. Now the analysis always comes back in their language.
      els.input.value = inLang(t(a.promptKey)); autoGrow(); els.input.focus();
      closeAnalysisMenu();
    });
    analysisMenuEl.appendChild(item);
  }
  // Position it (fixed) ABOVE the button, matching its width.
  const r = anchor.getBoundingClientRect();
  analysisMenuEl.style.left = `${r.left}px`;
  analysisMenuEl.style.width = `${r.width}px`;
  analysisMenuEl.classList.remove("hidden");
  const mh = analysisMenuEl.offsetHeight;
  const above = r.top - 6 - mh;
  analysisMenuEl.style.top = `${above > 8 ? above : Math.min(r.bottom + 6, window.innerHeight - mh - 8)}px`;
  const closer = (e) => { if (analysisMenuEl && !analysisMenuEl.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { closeAnalysisMenu(); document.removeEventListener("mousedown", closer); } };
  setTimeout(() => document.addEventListener("mousedown", closer), 0);
}
async function analyzePageHeaders() {
  await refreshCurrentPage();
  const url = currentPage && currentPage.url;
  if (!url) { flashTopBanner(t("recipe.noPage")); return; }
  // Record this into the Security tab's transcript (like a normal turn) so the whole exchange is
  // saved and shows up in History — this one-tap action used to be DOM-only and vanished on reload.
  const uText = t("recipe.headers") + " — " + url;
  const uDiv = addMessage("user", uText);
  attachUserActions(uDiv, uText);
  transcript.push({ role: "user", text: uText });
  lastUserContent = uText;
  lastRunMode = "security";
  const pend = addPendingIndicator();
  try {
    const r = await browser.runtime.sendMessage({ type: "headers:analyze", url });
    removePending(pend);
    if (!r || !r.ok) {
      const emsg = (r && r.error) || "Analysis failed";
      addMessage("error", emsg);
      transcript.push({ role: "assistant", text: emsg });
      await saveCurrent();
      return;
    }
    const lines = [
      `**Security headers — ${r.url}**  (HTTP ${r.status})`,
      "",
      `Coverage score: **${r.score}/100** (${r.checks.filter((c) => c.present).length}/${r.checks.length} headers present)`,
      "",
      ...r.checks.map((c) => `- ${c.present ? "✅" : "❌"} **${c.label}**${c.present ? `: \`${(c.value || "").slice(0, 120)}\`` : " — missing"}\n  _${c.why}_`),
      "",
      "> Defensive review only — verify against your app's needs. Missing headers aren't always bugs, but the ✅ set is a good hardening baseline.",
    ];
    const md = lines.join("\n");
    const div = addMessage("assistant", "");
    try { setHTML(div, renderMarkdown(md)); div._raw = md; } catch (_) { div.textContent = md; }
    attachAssistantActions(div, () => md);
    transcript.push({ role: "assistant", text: md });
    scrollMessages(false);
    await saveCurrent();
  } catch (e) {
    removePending(pend);
    const emsg = e instanceof Error ? e.message : String(e);
    addMessage("error", emsg);
    transcript.push({ role: "assistant", text: emsg });
    await saveCurrent();
  }
}

// Overlay a THEMED dropdown (same look/behaviour as the "Choose an analysis" list) on a native
// <select>. The native <select> is kept (hidden) so all existing logic — value, populate, cloning,
// change handlers — keeps working; picking in the themed menu just sets the value + fires "change".
function themeNativeSelect(sel) {
  if (!sel || sel._themed) return;
  sel._themed = true;
  sel.classList.add("native-hidden");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sec-analysis-btn themed-sel-btn";
  btn.innerHTML = '<span class="sa-label"></span><span class="sa-caret" aria-hidden="true"><svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 3l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.6"/></svg></span>';
  const labelEl = btn.querySelector(".sa-label");
  const syncLabel = () => {
    const opt = Array.from(sel.options).find((o) => o.value === sel.value) || sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : "";
  };
  let menuEl = null;
  const closeMenu = () => { if (menuEl) menuEl.classList.add("hidden"); };
  const openMenu = () => {
    if (menuEl && !menuEl.classList.contains("hidden")) { closeMenu(); return; }
    if (!menuEl) { menuEl = document.createElement("div"); menuEl.className = "sec-analysis-menu themed-sel-menu hidden"; document.body.appendChild(menuEl); }
    menuEl.innerHTML = "";
    for (const o of sel.options) {
      if (o.disabled) continue; // skip the placeholder / label option
      const item = document.createElement("button");
      item.type = "button"; item.className = "sa-item" + (o.value === sel.value ? " sel" : "");
      const s = document.createElement("span"); s.textContent = o.textContent; item.appendChild(s);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel(); closeMenu();
      });
      menuEl.appendChild(item);
    }
    const r = btn.getBoundingClientRect();
    menuEl.style.left = r.left + "px"; menuEl.style.width = Math.max(Math.round(r.width), 170) + "px";
    menuEl.classList.remove("hidden");
    const mh = menuEl.offsetHeight, above = r.top - 6 - mh;
    menuEl.style.top = (above > 8 ? above : Math.min(r.bottom + 6, window.innerHeight - mh - 8)) + "px";
    const closer = (e) => { if (menuEl && !menuEl.contains(e.target) && !btn.contains(e.target)) { closeMenu(); document.removeEventListener("mousedown", closer); } };
    setTimeout(() => document.addEventListener("mousedown", closer), 0);
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); openMenu(); });
  sel.parentNode.insertBefore(btn, sel.nextSibling);
  sel.addEventListener("change", syncLabel);
  sel._syncThemed = syncLabel;
  syncLabel();
}

// ----- 📚 Wisebase (local knowledge base + RAG) ------------------------------
// The heavy RAG lib (IndexedDB + transformers.js) is dynamic-imported on first use, so it never
// weighs on users who don't open the tab.
let _wbLib = null;
async function wbLib() { if (!_wbLib) _wbLib = await import("../lib/wisebase.js"); return _wbLib; }
let wbPanelEl = null;
let wbCurrentCollection = null; // collection id shown in the manager (null = collections list)
let wbBusy = false;             // guards concurrent ingestion
let wbTypeFilter = "all";       // sources view filter: all | files | notes | pages

function wbEl(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
// Line-icon set (matches the sidebar's stroke-icon charter) — no emojis in the Wisebase UI.
const WBI = {
  pdf: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/><path d="M8 13h6"/><path d="M8 17h4"/></svg>',
  page: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></svg>',
  imp: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  exp: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m8 11 4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  ren: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
};
// A labelled wb-btn with a leading line-icon (no emoji).
function wbIconBtn(icon, label, cls) {
  const b = document.createElement("button"); b.type = "button"; b.className = cls || "wb-btn";
  const s = document.createElement("span"); s.className = "wb-btn-ic"; setHTML(s, icon);
  const l = document.createElement("span"); l.textContent = label;
  b.appendChild(s); b.appendChild(l); return b;
}

// "Search in" scope select: All collections + one option per collection.
async function renderWbScope() {
  if (!els.wbScope) return;
  let cols = [];
  try { cols = await (await wbLib()).listCollections(); } catch (_) {}
  const prev = els.wbScope.value || settings.wisebaseScope || "";
  els.wbScope.innerHTML = "";
  els.wbScope.appendChild(Object.assign(document.createElement("option"), { value: "", textContent: t("wb.scopeAll") }));
  for (const c of cols) els.wbScope.appendChild(Object.assign(document.createElement("option"), { value: c.id, textContent: c.name }));
  els.wbScope.value = cols.some((c) => c.id === prev) ? prev : "";
  if (els.wbScope._syncThemed) els.wbScope._syncThemed();
}
function wbScopeIds() { const v = els.wbScope ? els.wbScope.value : ""; return v ? [v] : null; } // null = all

// Entering the Wisebase tab: refresh the scope; open the manager automatically if it's empty.
async function onEnterWisebase() {
  await renderWbScope();
  try { if (!(await (await wbLib()).listCollections()).length) openWbPanel(); } catch (_) {}
}

// ---- Management panel -------------------------------------------------------
function openWbPanel(collectionId) {
  wbCurrentCollection = collectionId || null;
  if (!wbPanelEl) {
    wbPanelEl = wbEl("div", "wb-overlay");
    wbPanelEl.addEventListener("click", (e) => { if (e.target === wbPanelEl) closeWbPanel(); });
    document.body.appendChild(wbPanelEl);
  }
  wbPanelEl.classList.remove("hidden");
  renderWbPanel();
}
function closeWbPanel() { if (wbPanelEl) wbPanelEl.classList.add("hidden"); renderWbScope(); }

async function renderWbPanel() {
  if (!wbPanelEl || wbPanelEl.classList.contains("hidden")) return;
  wbPanelEl.innerHTML = "";
  const card = wbEl("div", "wb-card");
  const head = wbEl("div", "wb-head");
  const backOrTitle = wbEl("div", "wb-head-title");
  if (wbCurrentCollection) {
    const back = wbEl("button", "wb-back", t("wb.back")); back.type = "button";
    back.addEventListener("click", () => { wbCurrentCollection = null; renderWbPanel(); });
    backOrTitle.appendChild(back);
  } else {
    backOrTitle.appendChild(wbEl("span", "wb-title", "📚 " + t("wb.title")));
  }
  const close = wbEl("button", "wb-close", "✕"); close.type = "button"; close.title = t("wb.close");
  close.addEventListener("click", closeWbPanel);
  head.appendChild(backOrTitle); head.appendChild(close);
  card.appendChild(head);

  const body = wbEl("div", "wb-body");
  card.appendChild(body);
  wbPanelEl.appendChild(card);

  if (wbCurrentCollection) await renderWbSources(body);
  else await renderWbCollections(body);
}

async function renderWbCollections(body) {
  body.appendChild(wbEl("p", "wb-intro", t("wb.intro")));
  // New collection row.
  const newRow = wbEl("div", "wb-newrow");
  const input = wbEl("input", "wb-input"); input.type = "text"; input.placeholder = t("wb.collectionNamePh");
  const add = wbEl("button", "wb-btn wb-btn-primary", t("wb.create")); add.type = "button";
  const doCreate = async () => {
    const name = input.value.trim(); if (!name) return;
    const col = await (await wbLib()).createCollection(name); input.value = "";
    // Auto-select + open the new collection (its sources view) and make it the active search scope.
    wbCurrentCollection = col.id;
    settings.wisebaseScope = col.id; setSettings({ wisebaseScope: col.id });
    renderWbPanel();
    await renderWbScope();
    if (els.wbScope) els.wbScope.value = col.id;
    if (els.wbScope && els.wbScope._syncThemed) els.wbScope._syncThemed();
  };
  add.addEventListener("click", doCreate);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doCreate(); });
  // Import an exported collection (JSON) → re-indexed into a new collection.
  const imp = wbIconBtn(WBI.imp, t("wb.import")); imp.title = t("wb.importTitle");
  const impInput = wbEl("input"); impInput.type = "file"; impInput.accept = "application/json,.json"; impInput.hidden = true;
  impInput.addEventListener("change", async () => {
    const f = impInput.files && impInput.files[0]; impInput.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      flashTopBanner(t("wb.importing"));
      await (await wbLib()).importCollection(data);
      renderWbPanel(); renderWbScope();
    } catch (e) { flashTopBanner(t("wb.ingestError", { msg: e instanceof Error ? e.message : String(e) })); }
  });
  imp.addEventListener("click", () => impInput.click());
  newRow.appendChild(input); newRow.appendChild(add); newRow.appendChild(imp); newRow.appendChild(impInput);
  body.appendChild(newRow);

  const cols = await (await wbLib()).listCollections();
  if (!cols.length) { body.appendChild(wbEl("div", "wb-empty", t("wb.noCollections"))); return; }
  const list = wbEl("div", "wb-list");
  const wb = await wbLib();
  for (const c of cols) {
    const st = await wb.collectionStats(c.id);
    const row = wbEl("div", "wb-col-row");
    const main = wbEl("button", "wb-col-open"); main.type = "button";
    main.appendChild(wbEl("span", "wb-col-name", c.name));
    main.appendChild(wbEl("span", "wb-col-stat", t("wb.stat", { sources: st.sources, chunks: st.chunks })));
    main.addEventListener("click", () => { wbCurrentCollection = c.id; renderWbPanel(); });
    const ren = wbEl("button", "wb-icon"); ren.type = "button"; ren.title = t("wb.rename"); setHTML(ren, WBI.ren);
    ren.addEventListener("click", async () => {
      const name = (window.prompt(t("wb.renamePrompt"), c.name) || "").trim();
      if (name) { await wb.renameCollection(c.id, name); renderWbPanel(); renderWbScope(); }
    });
    const del = wbEl("button", "wb-icon wb-icon-del"); del.type = "button"; del.title = t("wb.delete"); setHTML(del, WBI.del);
    del.addEventListener("click", async () => {
      if (!window.confirm(t("wb.deleteCollectionConfirm"))) return;
      await wb.deleteCollection(c.id); renderWbPanel(); renderWbScope();
    });
    row.appendChild(main); row.appendChild(ren); row.appendChild(del);
    list.appendChild(row);
  }
  body.appendChild(list);
}

async function renderWbSources(body) {
  const wb = await wbLib();
  const cols = await wb.listCollections();
  const col = cols.find((c) => c.id === wbCurrentCollection);
  if (!col) { wbCurrentCollection = null; return renderWbPanel(); }
  // Heading row: collection name + Export.
  const headRow = wbEl("div", "wb-col-headrow");
  headRow.appendChild(wbEl("div", "wb-col-heading", col.name));
  const exp = wbEl("button", "wb-icon"); exp.type = "button"; exp.title = t("wb.export"); setHTML(exp, WBI.exp);
  exp.addEventListener("click", async () => {
    const data = await wb.exportCollection(col.id);
    if (data) downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `wisebase-${col.name.replace(/[^\w-]+/g, "_")}.json`);
  });
  headRow.appendChild(exp);
  body.appendChild(headRow);

  // Add-source toolbar (line-icons, no emoji).
  const bar = wbEl("div", "wb-addbar");
  const fileInput = wbEl("input"); fileInput.type = "file"; fileInput.accept = "application/pdf,.pdf,.txt,.md,text/plain,text/markdown"; fileInput.multiple = true; fileInput.hidden = true;
  fileInput.addEventListener("change", () => { const fs = Array.from(fileInput.files || []); fileInput.value = ""; wbAddFiles(col.id, fs); });
  const btnPdf = wbIconBtn(WBI.pdf, t("wb.addPdf"));
  btnPdf.addEventListener("click", () => fileInput.click());
  const btnText = wbIconBtn(WBI.text, t("wb.addTextBtn"));
  btnText.addEventListener("click", () => wbToggleTextForm(body, col.id, "text"));
  const btnNote = wbIconBtn(WBI.note, t("wb.addNoteBtn"));
  btnNote.addEventListener("click", () => wbToggleTextForm(body, col.id, "note"));
  const btnPage = wbIconBtn(WBI.page, t("wb.addPageBtn"));
  btnPage.addEventListener("click", () => wbAddCurrentPage(col.id));
  bar.append(btnPdf, btnText, btnNote, btnPage, fileInput);
  body.appendChild(bar);

  // Progress line (updated in place during ingestion).
  const prog = wbEl("div", "wb-progress hidden"); prog.id = "wbProgress";
  body.appendChild(prog);

  // Inline text/note form mount point.
  body.appendChild(wbEl("div", "wb-formmount"));

  // Full-text search.
  const search = wbEl("input", "wb-input wb-search"); search.type = "search"; search.placeholder = t("wb.searchPh");
  const results = wbEl("div", "wb-search-results");
  search.addEventListener("input", async () => {
    const q = search.value.trim(); results.innerHTML = "";
    if (q.length < 2) return;
    const hits = await wb.searchText(q, [col.id], { limit: 20 });
    if (!hits.length) { results.appendChild(wbEl("div", "wb-empty", t("wb.searchNoHits"))); return; }
    results.appendChild(wbEl("div", "wb-search-count", t("wb.searchHits", { n: hits.length })));
    for (const h of hits.slice(0, 20)) {
      const snip = h.text.length > 200 ? h.text.slice(Math.max(0, h.pos - 60), h.pos + 140) + "…" : h.text;
      results.appendChild(wbEl("div", "wb-search-hit", "…" + snip));
    }
  });
  body.appendChild(search);
  body.appendChild(results);

  // Sources list, with a type filter (All / Files / Notes / Pages).
  let sources = await wb.listSources(col.id);
  const typeChips = wbEl("div", "wb-typefilter");
  const isNote = (ty) => ty === "note";
  const isPage = (ty) => ty === "page";
  const isFile = (ty) => ty === "pdf" || ty === "file" || ty === "text";
  const counts = {
    all: sources.length,
    files: sources.filter((s) => isFile(s.type)).length,
    notes: sources.filter((s) => isNote(s.type)).length,
    pages: sources.filter((s) => isPage(s.type)).length,
  };
  for (const f of ["all", "files", "notes", "pages"]) {
    const chip = wbEl("button", "wb-type-chip" + (wbTypeFilter === f ? " on" : ""), `${t("wb.type_" + f)} (${counts[f]})`);
    chip.type = "button";
    chip.addEventListener("click", () => { wbTypeFilter = f; renderWbPanel(); });
    typeChips.appendChild(chip);
  }
  body.appendChild(typeChips);
  if (wbTypeFilter === "files") sources = sources.filter((s) => isFile(s.type));
  else if (wbTypeFilter === "notes") sources = sources.filter((s) => isNote(s.type));
  else if (wbTypeFilter === "pages") sources = sources.filter((s) => isPage(s.type));

  if (!sources.length) { body.appendChild(wbEl("div", "wb-empty", t("wb.noSources"))); return; }
  const list = wbEl("div", "wb-list");
  for (const s of sources) {
    const row = wbEl("div", "wb-src-row");
    const info = wbEl("div", "wb-src-info");
    info.appendChild(wbEl("span", "wb-src-title", s.title));
    info.appendChild(wbEl("span", "wb-src-meta", t("wb.sourceMeta", { type: s.type, chunks: s.chunkCount, kb: Math.max(1, Math.round((s.size || 0) / 1024)) })));
    const ren = wbEl("button", "wb-icon"); ren.type = "button"; ren.title = t("wb.rename"); setHTML(ren, WBI.ren);
    ren.addEventListener("click", async () => {
      const nm = (window.prompt(t("wb.renamePrompt"), s.title) || "").trim();
      if (nm) { await wb.renameSource(s.id, nm); renderWbPanel(); }
    });
    const del = wbEl("button", "wb-icon wb-icon-del"); del.type = "button"; del.title = t("wb.delete"); setHTML(del, WBI.del);
    del.addEventListener("click", async () => {
      if (!window.confirm(t("wb.deleteSourceConfirm"))) return;
      await wb.deleteSource(s.id); renderWbPanel(); renderWbScope();
    });
    row.appendChild(info); row.appendChild(ren); row.appendChild(del);
    list.appendChild(row);
  }
  body.appendChild(list);
}

// Inline textarea form for pasted text / a note.
function wbToggleTextForm(body, collectionId, kind) {
  const mount = body.querySelector(".wb-formmount"); if (!mount) return;
  if (mount.firstChild) { mount.innerHTML = ""; return; }
  const form = wbEl("div", "wb-form");
  const title = wbEl("input", "wb-input"); title.type = "text"; title.placeholder = t("wb.titlePh");
  const ta = wbEl("textarea", "wb-textarea"); ta.placeholder = t("wb.pastePh"); ta.rows = 5;
  const actions = wbEl("div", "wb-form-actions");
  const add = wbEl("button", "wb-btn wb-btn-primary", t("wb.add")); add.type = "button";
  const cancel = wbEl("button", "wb-btn", t("wb.cancel")); cancel.type = "button";
  cancel.addEventListener("click", () => { mount.innerHTML = ""; });
  add.addEventListener("click", async () => {
    const text = ta.value.trim(); if (!text) return;
    const label = title.value.trim() || (kind === "note" ? t("wb.addNoteBtn") : text.slice(0, 40));
    mount.innerHTML = "";
    await wbIngest(collectionId, { type: kind, title: label, text });
  });
  actions.append(add, cancel);
  form.append(title, ta, actions);
  mount.appendChild(form);
  ta.focus();
}

// Read PDF / TXT / MD files → text → ingest each.
async function wbAddFiles(collectionId, files) {
  for (const f of Array.from(files || [])) {
    try {
      let text = "";
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
        const buf = await f.arrayBuffer();
        const { text: t2 } = await extractPdfText(buf);
        text = t2;
      } else {
        text = await f.text();
      }
      await wbIngest(collectionId, { type: /\.pdf$/i.test(f.name) ? "pdf" : "file", title: f.name, text });
    } catch (e) { flashTopBanner(t("wb.ingestError", { msg: e instanceof Error ? e.message : String(e) })); }
  }
}

async function wbAddCurrentPage(collectionId) {
  await refreshCurrentPage();
  if (!currentPage || !currentPage.text || !currentPage.text.trim()) { flashTopBanner(t("wb.pageNoText")); return; }
  await wbIngest(collectionId, { type: "page", title: currentPage.title || currentPage.url || "page", text: currentPage.text, meta: { url: currentPage.url } });
}

// Shared ingestion with a live progress line (model download, then per-chunk).
async function wbIngest(collectionId, payload) {
  if (wbBusy) return;
  wbBusy = true;
  const prog = document.getElementById("wbProgress");
  const setProg = (txt) => { if (prog) { prog.classList.remove("hidden"); prog.textContent = txt; } };
  setProg(t("wb.ingesting", { title: payload.title }));
  try {
    const wb = await wbLib();
    const src = await wb.addSource(collectionId, payload, {
      onProgress: (p) => {
        if (p.phase === "model" && p.status === "progress" && p.total) setProg(t("wb.ingestModel", { pct: Math.round((p.loaded / p.total) * 100) }));
        else if (p.phase === "embed") setProg(t("wb.ingestEmbed", { title: payload.title, done: p.done, total: p.total }));
      },
    });
    flashTopBanner(t("wb.ingestDone", { title: src.title, chunks: src.chunkCount }));
  } catch (e) {
    flashTopBanner(t("wb.ingestError", { msg: e instanceof Error ? e.message : String(e) }));
  } finally {
    wbBusy = false;
    renderWbPanel(); renderWbScope();
  }
}

// ---- RAG send path ----------------------------------------------------------
async function onWisebaseSend() {
  const q = els.input.value.trim();
  if (!q) return;
  els.input.value = ""; autoGrow();
  startBusy();
  const signal = abortController && abortController.signal;
  const sess = getSession("wisebase");
  // ONE user bubble (streamed manually below — do NOT also call sendToModel, which would add a 2nd).
  const userDiv = addMessage("user", q, "wisebase");
  attachUserActions(userDiv, q);
  sess.transcript.push({ role: "user", text: q });

  const status = addMessage("tool", t("wb.retrieving"), "wisebase");
  let hits = [];
  try {
    const wb = await wbLib();
    hits = await wb.retrieve(q, wbScopeIds(), {
      k: settings.wisebaseTopK || 6,
      onProgress: (p) => { if (p.phase === "model" && p.status === "progress") status.textContent = t("wb.modelLoading"); },
    });
  } catch (e) {
    status.textContent = t("wb.ingestError", { msg: e instanceof Error ? e.message : String(e) });
    endBusy(); return;
  }
  status.remove();
  if (!hits.length) {
    addMessage("assistant", t("wb.noContext"), "wisebase");
    sess.transcript.push({ role: "assistant", text: t("wb.noContext") });
    try { await saveSession(sess, "wisebase", currentSelection()); } catch (_) {}
    endBusy(); return;
  }

  // Numbered context passages → the model must cite [n] and answer in the QUESTION's language
  // (wb.system carries that instruction, so it works regardless of the UI language).
  const ctxBlock = hits.map((h, i) => `[${i + 1}] Source: ${h.sourceTitle}\n${h.text}`).join("\n\n");
  const modelContent = `${t("wb.system")}\n\n[Context passages]\n${ctxBlock}\n\n[Question]\n${q}`;
  const sel = resolveHivey(currentSelection(), "chat", q);
  try {
    if (currentKeyMissing(sel.providerId)) { addMessage("error", t("err.noKeyModel"), "wisebase"); endBusy(); return; }
    const pending = addPendingIndicator("wisebase");
    const sink = makeSink("📚 " + t("wb.title"), getThink(els.thinking) !== "off", pending, "wisebase");
    const provider = makeProvider(
      { ...settings, provider: sel.providerId, models: { ...settings.models, [sel.providerId]: sel.modelId } },
      { thinking: getThink(els.thinking), webSearch: false }
    );
    const system = buildSystemPrompt({ agentMode: false, targetLang: settings.targetLang, responseLang: settings.responseLang, mode: "chat", blockPayments: settings.blockPayments, artifacts: els.artifactMode.checked });
    const turn = await provider.runTurn({ system, history: [{ role: "user", content: modelContent }], tools: [], onText: sink.onText, onThink: sink.onThink, signal });
    sink.finalize();
    const answer = (turn && turn.text) || sink.getRaw();
    sess.transcript.push({ role: "assistant", text: answer });
    try { await saveSession(sess, "wisebase", sel); } catch (_) {}

    // Sources footer — each numbered passage is expandable to read the exact cited text.
    const foot = wbEl("div", "wb-answer-sources");
    foot.appendChild(wbEl("div", "wb-answer-sources-h", t("wb.answerSources")));
    hits.forEach((h, i) => {
      const d = wbEl("details", "wb-cite");
      const sm = wbEl("summary"); sm.textContent = `[${i + 1}] ${h.sourceTitle}`;
      d.appendChild(sm); d.appendChild(wbEl("div", "wb-cite-text", h.text));
      foot.appendChild(d);
    });
    (homeFor("wisebase") || els.messages).appendChild(foot);
    scrollMessages();
  } catch (e) {
    if (!(signal && signal.aborted)) addMessage("error", e instanceof Error ? e.message : String(e), "wisebase");
  } finally {
    endBusy();
  }
}

// ----- 📝 Universal summary (page / article / YouTube) -----------------------
// One-tap "Summarize" of the current tab. For a YouTube video it pulls the caption transcript and
// asks for a timestamped, clickable summary; for any other page it summarizes the extracted main text.
function ytIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get("v") || (u.pathname.startsWith("/shorts/") ? (u.pathname.split("/")[2] || null) : null);
    return null;
  } catch (_) { return null; }
}
async function summarizeCurrentPage() {
  if (busy) return;
  await refreshCurrentPage();
  if (!currentPage || !currentPage.url) { flashTopBanner(t("sum.noPage")); return; }
  const lang = effLang();
  const vid = ytIdFromUrl(currentPage.url);

  if (vid) {
    const status = addMessage("tool", t("sum.fetchingTranscript"));
    let tr = null;
    try { const tab = await getActiveTab(); if (tab) tr = await sendToTab(tab.id, { type: "read_transcript" }); } catch (_) {}
    // Content script stale (SPA nav) or failed → fetch the transcript fresh in the background by id.
    if (!tr || !tr.ok || (tr.videoId && tr.videoId !== vid)) {
      try { const bg = await browser.runtime.sendMessage({ type: "yt:transcript", videoId: vid }); if (bg && bg.ok) tr = bg; } catch (_) {}
    }
    status.remove();
    if (tr && tr.ok && tr.segments && tr.segments.length) {
      let body = "", total = 0;
      for (const s of tr.segments) {
        const line = `[${s.start}] ${s.text}\n`;
        if (total + line.length > 40000) break;
        body += line; total += line.length;
      }
      const title = tr.title || currentPage.title || "";
      const content = `${t("sum.videoPrompt", { lang, vid })}\n\n[Title]\n${title}\n\n[Transcript — each line begins with its timestamp in seconds]\n${body}`;
      return sendToModel("📺 " + t("sum.videoDisplay", { title }), content, { runMode: "chat" });
    }
    flashTopBanner(t("sum.noTranscript"));
  }

  const text = (currentPage.text || "").trim();
  if (!text) { flashTopBanner(t("sum.noText")); return; }
  const title = currentPage.title || currentPage.url;
  const content = `${t("sum.pagePrompt", { lang })}\n\n[Title]\n${title}\n[URL]\n${currentPage.url}\n\n[Page content]\n${text.slice(0, 40000)}`;
  return sendToModel("📄 " + t("sum.pageDisplay", { title }), content, { runMode: "chat" });
}

// ----- 🔎 DeepSearch (multi-step cited web research) -------------------------
// The same proven deep-research loop, implemented client-side on the sidebar's own web + LLM
// plumbing (BYOK, nothing server-side): decompose → fan-out web searches → deep-read the best
// sources → synthesize a structured, cited report. Depth (fast/standard/deep) scales the fan-out.
const DEEP_DEPTH = { fast: { subs: 3, fetch: 0 }, standard: { subs: 5, fetch: 3 }, deep: { subs: 8, fetch: 6 } };

function deepBaseHid(sel) {
  if (isHivey(sel.modelId)) return sel.modelId;
  const ss = parseSel(settings.searchModel || "");
  return ss && isHivey(ss.modelId) ? ss.modelId : null;
}
function shortUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return String(u).slice(0, 40); } }
// Extract, dedupe and rank source URLs across the gathered findings (most-mentioned first).
function deepRankUrls(text, limit) {
  const counts = new Map();
  for (const m of (text.match(/https?:\/\/[^\s)<>\]"']+/g) || [])) {
    const url = m.replace(/[.,;:]+$/, "");
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico)$/i.test(url)) continue;
    counts.set(url, (counts.get(url) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, limit);
}
async function deepFetchPage(url) {
  try {
    const r = await browser.runtime.sendMessage({ type: "fetch:page", url });
    return r && r.ok ? { url: r.url || url, text: (r.text || "").slice(0, 12000) } : null;
  } catch (_) { return null; }
}

async function runDeepSearch(question) {
  const depth = DEEP_DEPTH[settings.deepSearchDepth] || DEEP_DEPTH.standard;
  const lang = effLang();
  const sel = currentSelection();
  const hid = deepBaseHid(sel);
  const synthSel = resolveHivey(sel, "chat", question);                                       // real model for synthesis
  const utilSel = hid ? ensureUsable(parseSel(hiveyTiers(hid).utility || hiveyTiers(hid).chat), hid) : synthSel;
  const searchSel = hid ? ensureUsable(parseSel(hiveyTiers(hid).search), hid) : parseSel(settings.searchModel || "");

  startBusy();
  const signal = abortController && abortController.signal;

  // User bubble + persist the question.
  const sess = getSession("chat");
  const userDiv = addMessage("user", question, "chat");
  attachUserActions(userDiv, question);
  sess.transcript.push({ role: "user", text: question });

  // Collapsible live-progress trace (reasoning-panel style).
  const panel = document.createElement("details"); panel.className = "think deep-progress"; panel.open = true;
  const psum = document.createElement("summary"); psum.textContent = "🔎 " + t("deep.title"); panel.appendChild(psum);
  const plog = document.createElement("div"); plog.className = "think-body"; panel.appendChild(plog);
  homeFor("chat").appendChild(panel);
  els.empty.classList.add("hidden");
  const step = (txt) => { const d = document.createElement("div"); d.className = "deep-step"; d.textContent = txt; plog.appendChild(d); scrollMessages(); };

  try {
    if (currentKeyMissing(searchSel && searchSel.providerId)) { panel.open = false; addMessage("error", t("err.noKeyModel")); return; }

    // 1) Decompose into diverse sub-queries.
    step(t("deep.decompose"));
    let subs = [];
    try {
      const raw = await runUtilityCompletion(utilSel,
        `Decompose the user's question into up to ${depth.subs} focused, diverse web-search queries that together fully cover it. Reply with ONLY a JSON array of short query strings (in the question's language). No prose.`,
        question, signal);
      subs = JSON.parse((raw.match(/\[[\s\S]*\]/) || ["[]"])[0]);
    } catch (_) { subs = []; }
    subs = (Array.isArray(subs) ? subs : []).filter((s) => typeof s === "string" && s.trim()).slice(0, depth.subs);
    if (!subs.length) subs = [question];
    step(t("deep.subqueries", { n: subs.length }));

    // 2) Fan-out web searches (reuse the existing web-plugin search path). Collect the REAL provider
    // citation URLs alongside the prose so the report links to resolvable sources, not model-typed URLs.
    const findings = [];
    const allCitations = [];
    for (const sq of subs) {
      if (signal && signal.aborted) break;
      step(t("deep.searching", { q: sq.slice(0, 80) }));
      const cites = [];
      const res = hid ? await hiveyWebFetch(hid, sq, signal, cites) : await webResearchWith(searchSel, sq, signal, false, cites);
      if (res) findings.push({ q: sq, text: res });
      for (const c of cites) allCitations.push(c);
    }
    if (!findings.length) { panel.open = false; addMessage("assistant", t("deep.noResults")); return; }

    // 3) Deep-read the best sources (standard/deep), summarized against the question.
    const urls = deepRankUrls(findings.map((f) => f.text).join("\n"), depth.fetch);
    const pages = [];
    for (const url of urls) {
      if (signal && signal.aborted) break;
      step(t("deep.reading", { url: shortUrl(url) }));
      const p = await deepFetchPage(url);
      if (!p || !p.text.trim()) continue;
      const s2 = await runUtilityCompletion(utilSel,
        `Summarize the following web page STRICTLY as it relates to this question: "${question}". Keep only relevant facts, figures and quotes. If irrelevant, reply exactly "N/A".`,
        `[URL] ${p.url}\n\n${p.text}`, signal).catch(() => "");
      if (s2 && !/^n\/?a\.?$/i.test(s2.trim())) pages.push({ url: p.url, summary: s2.trim() });
    }

    // 4) Synthesize a structured, cited report (streamed into a normal answer bubble).
    step(t("deep.synthesizing"));
    panel.open = false; // collapse the trace once writing starts
    // Build a VALIDATED source allow-list: deep-read pages (actually fetched → resolvable) first, then
    // the REAL web-plugin citation URLs. These are the ONLY links allowed in the report — URLs the model
    // types from memory are frequently hallucinated/truncated (→ 404).
    const srcSeen = new Set();
    const sources = [];
    const addSrc = (url, title) => {
      if (!url || srcSeen.has(url)) return;
      if (/\.(png|jpe?g|gif|svg|webp|css|js|ico)(\?|$)/i.test(url)) return;
      srcSeen.add(url); sources.push({ url, title: title || "" });
    };
    for (const p of pages) addSrc(p.url, "");           // validated by an actual fetch
    for (const c of allCitations) addSrc(c.url, c.title); // real search-result URLs
    const topSources = sources.slice(0, 15);
    const numOf = (url) => topSources.findIndex((s) => s.url === url) + 1;

    const findBlock = findings.map((f) => `## Search: ${f.q}\n${f.text}`).join("\n\n");
    const pageBlock = pages.map((p) => { const n = numOf(p.url); return `${n ? `[${n}] ` : ""}${p.url}\n${p.summary}`; }).join("\n\n");
    const sourceList = topSources.map((s, i) => `[${i + 1}] ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n");
    const sysReport = `You are a rigorous research analyst. Using ONLY the gathered material below, write a clear, well-structured report in ${lang} that answers the user's question. Cross-check claims across sources, note disagreements and remaining uncertainty, and never invent facts. CITE sources inline as [n] using ONLY the numbered SOURCES list below — NEVER write a raw URL in the body, NEVER invent a URL, and NEVER cite a number that is not in that list. Do NOT write your own "Sources" section: a verified one is appended automatically.`;
    const synthContent = `[Question]\n${question}\n\n[Gathered search findings]\n${findBlock}${pageBlock ? `\n\n[Deep-read sources]\n${pageBlock}` : ""}${sourceList ? `\n\n[SOURCES — cite these as [n]; do not use any other URL]\n${sourceList}` : ""}`;

    const pending = addPendingIndicator("chat");
    const sink = makeSink("🔎 " + t("deep.badge"), getThink(els.thinking) !== "off", pending, "chat");
    const provider = makeProvider(
      { ...settings, provider: synthSel.providerId, models: { ...settings.models, [synthSel.providerId]: synthSel.modelId } },
      { thinking: getThink(els.thinking), webSearch: false }
    );
    const system = buildSystemPrompt({ agentMode: false, targetLang: settings.targetLang, responseLang: settings.responseLang, mode: "chat", blockPayments: settings.blockPayments, artifacts: els.artifactMode.checked });
    const turn = await provider.runTurn({ system: system + "\n\n" + sysReport, history: [{ role: "user", content: synthContent }], tools: [], onText: sink.onText, onThink: sink.onThink, signal });
    sink.finalize();
    let answer = (turn && turn.text) || sink.getRaw();

    // Append a DETERMINISTIC, verified "Sources" section from the real URLs (pages fetched + provider
    // citations) — so the links always resolve, regardless of what the model typed. Replace any Sources
    // section the model wrote anyway.
    if (topSources.length) {
      answer = answer.replace(/\n+#{0,4}\s*\**\s*(sources|références)\b[\s\S]*$/i, "").trim();
      answer += "\n\n**Sources**\n" + topSources.map((s, i) => `${i + 1}. [${shortUrl(s.url)}](${s.url})${s.title ? " — " + s.title.replace(/[\[\]]/g, "") : ""}`).join("\n");
      sink.setRaw(answer);
    }

    sess.transcript.push({ role: "assistant", text: answer });
    // Persist the DISPLAY transcript only — we don't inject the big research context into the native
    // history (keeps follow-up turns clean and avoids per-provider wire-format issues).
    try { await saveSession(sess, "chat", sel); } catch (_) {}
  } catch (e) {
    if (!(signal && signal.aborted)) addMessage("error", e instanceof Error ? e.message : String(e));
  } finally {
    endBusy();
  }
}

// ----- 🧠 Mindmap / Flowchart (Mermaid) --------------------------------------
// Turn any answer (or pasted text / hand-written Mermaid) into a diagram, rendered IN-PAGE via
// mermaid.render (not a sandboxed iframe) so we can export it as SVG or PNG. The mermaid lib is
// already vendored; we load it into the page lazily on first use.
let mermaidPagePromise = null;
let mmOverlayEl = null;
function mermaidThemeForCurrent() { return document.body.classList.contains("theme-light") ? "default" : "dark"; }
function loadMermaidInPage() {
  if (mermaidPagePromise) return mermaidPagePromise;
  mermaidPagePromise = new Promise((resolve, reject) => {
    if (window.mermaid) return resolve(window.mermaid);
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("vendor/mermaid.min.js");
    s.onload = () => {
      try { window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: mermaidThemeForCurrent(), htmlLabels: false, flowchart: { htmlLabels: false } }); resolve(window.mermaid); }
      catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error("mermaid load failed"));
    document.head.appendChild(s);
  });
  return mermaidPagePromise;
}
function stripFences(code) {
  let c = (code || "").trim();
  const m = c.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  if (m) c = m[1].trim();
  return c;
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function openMindmapFrom(sourceText) {
  const src = (sourceText || "").trim();
  if (!src) { flashTopBanner(t("mind.empty")); return; }
  openMindmapPanel();
  setMindmapState("loading", t("mind.generating"));
  try {
    const sel = resolveHivey(currentSelection(), "chat", src);
    if (currentKeyMissing(sel.providerId)) { setMindmapState("error", t("err.noKeyModel")); return; }
    const code = stripFences(await runUtilityCompletion(sel, t("mind.system"), src.slice(0, 12000), null));
    if (!code) { setMindmapState("error", t("mind.failed")); return; }
    await renderMindmap(code);
  } catch (e) {
    setMindmapState("error", e instanceof Error ? e.message : String(e));
  }
}

function openMindmapPanel() {
  if (!mmOverlayEl) {
    mmOverlayEl = document.createElement("div"); mmOverlayEl.className = "mm-overlay";
    mmOverlayEl.addEventListener("click", (e) => { if (e.target === mmOverlayEl) closeMindmap(); });
    mmOverlayEl.innerHTML =
      '<div class="mm-card">' +
      '<div class="mm-head"><span class="mm-title">🧠 <span class="mm-title-t"></span></span>' +
      '<div class="mm-tools">' +
      '<button type="button" class="mm-btn" data-act="regen"></button>' +
      '<button type="button" class="mm-btn" data-act="code"></button>' +
      '<button type="button" class="mm-btn" data-act="svg"></button>' +
      '<button type="button" class="mm-btn" data-act="png"></button>' +
      '<button type="button" class="mm-close" data-act="close">✕</button>' +
      '</div></div>' +
      '<div class="mm-body"><div class="mm-diagram" id="mmDiagram"></div>' +
      '<div class="mm-codewrap" id="mmCodeWrap" hidden><textarea class="mm-code" id="mmCode" spellcheck="false"></textarea>' +
      '<button type="button" class="mm-btn mm-render" data-act="render"></button></div></div>' +
      '</div>';
    document.body.appendChild(mmOverlayEl);
    mmOverlayEl.querySelector(".mm-title-t").textContent = t("mind.title");
    mmOverlayEl.querySelector('[data-act="regen"]').textContent = t("mind.regen");
    mmOverlayEl.querySelector('[data-act="code"]').textContent = t("mind.code");
    mmOverlayEl.querySelector('[data-act="svg"]').textContent = "SVG";
    mmOverlayEl.querySelector('[data-act="png"]').textContent = "PNG";
    mmOverlayEl.querySelector('[data-act="render"]').textContent = t("mind.render");
    mmOverlayEl.querySelector('[data-act="close"]').title = t("wb.close");
    mmOverlayEl.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]"); if (!act) return;
      const a = act.dataset.act;
      if (a === "close") closeMindmap();
      else if (a === "code") { const w = document.getElementById("mmCodeWrap"); w.hidden = !w.hidden; }
      else if (a === "render") renderMindmap(document.getElementById("mmCode").value).catch(() => {});
      else if (a === "svg") exportMindmap("svg");
      else if (a === "png") exportMindmap("png");
      else if (a === "regen") { const c = document.getElementById("mmCode").value; if (c.trim()) renderMindmap(c); }
    });
  }
  mmOverlayEl.classList.remove("hidden");
}
function closeMindmap() { if (mmOverlayEl) mmOverlayEl.classList.add("hidden"); }
function setMindmapState(kind, msg) {
  const d = document.getElementById("mmDiagram"); if (!d) return;
  setHTML(d, `<div class="mm-msg ${kind === "error" ? "mm-err" : ""}">${escapeHtmlSafe(msg)}</div>`);
}
function escapeHtmlSafe(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function renderMindmap(code) {
  const clean = stripFences(code);
  const codeEl = document.getElementById("mmCode"); if (codeEl) codeEl.value = clean;
  setMindmapState("loading", t("mind.rendering"));
  try {
    const mermaid = await loadMermaidInPage();
    try { mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: mermaidThemeForCurrent(), htmlLabels: false, flowchart: { htmlLabels: false } }); } catch (_) {}
    const { svg } = await mermaid.render("mmSvg" + Date.now().toString(36), clean);
    const d = document.getElementById("mmDiagram");
    if (d) {
      // Defense-in-depth: the Mermaid source is LLM output that a malicious page could steer via
      // prompt injection. mermaid already runs with securityLevel:"strict" + htmlLabels:false, but we
      // ALSO sanitize the rendered SVG (DOMPurify SVG profile) before it touches the privileged
      // sidebar DOM — so even a Mermaid sanitizer bypass can't land script in an origin that can read
      // the stored BYOK keys. This is the one model-output→DOM path that wasn't already sanitized.
      const safe = window.DOMPurify ? window.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : svg;
      setHTML(d, safe); d._svg = safe;
    }
  } catch (e) {
    // Invalid diagram → show the error and reveal the code so the user can fix it.
    setMindmapState("error", t("mind.invalid") + " " + (e && e.message ? e.message : ""));
    const w = document.getElementById("mmCodeWrap"); if (w) w.hidden = false;
  }
}
function exportMindmap(kind) {
  const d = document.getElementById("mmDiagram");
  const svg = d && d._svg;
  if (!svg) { flashTopBanner(t("mind.nothing")); return; }
  if (kind === "svg") { downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "mindmap.svg"); return; }
  // PNG: rasterize the SVG onto a 2× canvas.
  const svgEl = d.querySelector("svg");
  const w = (svgEl && svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width) || (svgEl && svgEl.getBoundingClientRect().width) || 1200;
  const h = (svgEl && svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.height) || (svgEl && svgEl.getBoundingClientRect().height) || 800;
  const scale = 2;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = document.body.classList.contains("theme-light") ? "#ffffff" : "#0b0b0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, "mindmap.png"); }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); flashTopBanner(t("mind.pngFail")); };
  img.src = url;
}

// ----- 📚 Prompt library -----------------------------------------------------
let promptLibPanel = null;
let plibCat = "all";        // active filter: all | favorites | mine | <category>
let plibSearch = "";        // search query
let plibEditId = null;      // id of the user prompt being edited (null = none)
function genId() { return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function savePromptLibrary(list) {
  settings.promptLibrary = list;
  setSettings({ promptLibrary: list });
}
function plibFavs() { return settings.promptFavorites || []; }
function plibIsFav(id) { return plibFavs().includes(id); }
function plibToggleFav(id) {
  const favs = new Set(plibFavs());
  favs.has(id) ? favs.delete(id) : favs.add(id);
  settings.promptFavorites = [...favs];
  setSettings({ promptFavorites: settings.promptFavorites });
}
// Merge built-in templates (localized) with the user's own prompts into one list.
function plibAll() {
  const lang = getLang();
  const builtin = BUILTIN_PROMPTS.map((p) => ({ id: p.id, title: builtinTitle(p, lang), text: builtinText(p, lang), category: p.category, builtin: true }));
  const mine = (settings.promptLibrary || []).map((p) => ({ ...p, builtin: false }));
  return [...mine, ...builtin];
}
function renderPromptLibrary() {
  if (!promptLibPanel) return;
  promptLibPanel.innerHTML = "";

  // Header: title + "New prompt".
  const head = document.createElement("div"); head.className = "plib-head-row";
  const h = document.createElement("span"); h.className = "plib-head"; h.textContent = t("plib.title");
  const newBtn = document.createElement("button");
  newBtn.type = "button"; newBtn.className = "plib-newbtn"; newBtn.textContent = "＋ " + t("plib.new");
  newBtn.addEventListener("click", () => plibOpenForm(null));
  head.appendChild(h); head.appendChild(newBtn);
  promptLibPanel.appendChild(head);

  // Edit/new form (if open).
  if (plibEditId !== null) { promptLibPanel.appendChild(plibForm(plibEditId)); }

  // Category filter — a single clean dropdown (was a chip row).
  const catSel = document.createElement("select"); catSel.className = "plib-catsel";
  const cats = ["all", "favorites", ...PROMPT_CATEGORIES, "mine"];
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c === "favorites" ? "★ " + t("plibcat.favorites") : t("plibcat." + c);
    catSel.appendChild(o);
  }
  catSel.value = plibCat;
  catSel.addEventListener("change", () => { plibCat = catSel.value; plibRenderList(); });
  promptLibPanel.appendChild(catSel);

  // Search.
  const search = document.createElement("input");
  search.type = "search"; search.className = "plib-search"; search.placeholder = t("plib.searchPh");
  search.value = plibSearch;
  search.addEventListener("input", () => { plibSearch = search.value; plibRenderList(); });
  promptLibPanel.appendChild(search);

  // Quick "save current composer text".
  const saveRow = document.createElement("button");
  saveRow.type = "button"; saveRow.className = "plib-save";
  saveRow.textContent = "＋ " + t("plib.saveCurrent");
  saveRow.addEventListener("click", () => {
    const text = (els.input.value || "").trim();
    if (!text) { flashTopBanner(t("plib.empty")); return; }
    plibOpenForm(null, text);
  });
  promptLibPanel.appendChild(saveRow);

  const listWrap = document.createElement("div"); listWrap.className = "plib-list"; listWrap.id = "plibList";
  promptLibPanel.appendChild(listWrap);
  plibRenderList();
}
function plibRenderList() {
  const listWrap = document.getElementById("plibList");
  if (!listWrap) return;
  listWrap.innerHTML = "";
  const q = plibSearch.trim().toLowerCase();
  let items = plibAll();
  if (plibCat === "favorites") items = items.filter((p) => plibIsFav(p.id));
  else if (plibCat === "mine") items = items.filter((p) => !p.builtin);
  else if (plibCat !== "all") items = items.filter((p) => p.category === plibCat);
  if (q) items = items.filter((p) => (p.title || "").toLowerCase().includes(q) || (p.text || "").toLowerCase().includes(q));
  if (!items.length) {
    const empty = document.createElement("div"); empty.className = "plib-empty"; empty.textContent = t("plib.none");
    listWrap.appendChild(empty); return;
  }
  for (const p of items) {
    const row = document.createElement("div"); row.className = "plib-item";
    const ins = document.createElement("button");
    ins.type = "button"; ins.className = "plib-ins"; ins.title = t("plib.insert");
    ins.innerHTML = '<span class="plib-name"></span><span class="plib-text"></span>';
    ins.querySelector(".plib-name").textContent = p.title;
    ins.querySelector(".plib-text").textContent = (p.text || "").replace(/\s+/g, " ").slice(0, 70);
    ins.addEventListener("click", () => {
      els.input.value = p.text || ""; autoGrow(); els.input.focus();
      els.input.setSelectionRange(els.input.value.length, els.input.value.length);
      togglePromptLibrary(false);
    });
    const fav = document.createElement("button");
    fav.type = "button"; fav.className = "plib-fav" + (plibIsFav(p.id) ? " on" : ""); fav.title = t("plib.favorite");
    fav.textContent = plibIsFav(p.id) ? "★" : "☆";
    fav.addEventListener("click", (e) => { e.stopPropagation(); plibToggleFav(p.id); plibRenderList(); });
    row.appendChild(ins); row.appendChild(fav);
    if (!p.builtin) {
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "plib-edit"; edit.title = t("plib.edit"); edit.textContent = "✎";
      edit.addEventListener("click", (e) => { e.stopPropagation(); plibOpenForm(p.id); });
      const del = document.createElement("button");
      del.type = "button"; del.className = "plib-del"; del.title = t("plib.delete"); del.textContent = "✕";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        savePromptLibrary((settings.promptLibrary || []).filter((x) => x.id !== p.id));
        renderPromptLibrary();
      });
      row.appendChild(edit); row.appendChild(del);
    }
    listWrap.appendChild(row);
  }
}
function plibOpenForm(id, prefillText) {
  plibEditId = id || "new";
  renderPromptLibrary();
  // Prefill the textarea for "save current".
  if (prefillText) { const ta = promptLibPanel.querySelector(".plib-form-text"); if (ta) ta.value = prefillText; }
}
function plibForm(id) {
  const editing = id && id !== "new";
  const existing = editing ? (settings.promptLibrary || []).find((x) => x.id === id) : null;
  const form = document.createElement("div"); form.className = "plib-form";
  const title = document.createElement("input"); title.type = "text"; title.className = "plib-form-title"; title.placeholder = t("plib.namePh");
  if (existing) title.value = existing.title || "";
  const catSel = document.createElement("select"); catSel.className = "plib-form-cat";
  for (const c of PROMPT_CATEGORIES) { const o = document.createElement("option"); o.value = c; o.textContent = t("plibcat." + c); catSel.appendChild(o); }
  catSel.value = (existing && existing.category) || "writing";
  const ta = document.createElement("textarea"); ta.className = "plib-form-text"; ta.rows = 4; ta.placeholder = t("plib.textPh");
  if (existing) ta.value = existing.text || "";
  const actions = document.createElement("div"); actions.className = "plib-form-actions";
  const save = document.createElement("button"); save.type = "button"; save.className = "plib-form-save"; save.textContent = t("plib.save");
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "plib-form-cancel"; cancel.textContent = t("plib.cancel");
  cancel.addEventListener("click", () => { plibEditId = null; renderPromptLibrary(); });
  save.addEventListener("click", () => {
    const nm = title.value.trim(), tx = ta.value.trim();
    if (!nm || !tx) { flashTopBanner(t("plib.empty")); return; }
    let list = settings.promptLibrary || [];
    if (existing) list = list.map((x) => (x.id === id ? { ...x, title: nm, text: tx, category: catSel.value } : x));
    else list = [{ id: genId(), title: nm, text: tx, category: catSel.value, at: Date.now() }, ...list].slice(0, 200);
    savePromptLibrary(list);
    plibEditId = null; renderPromptLibrary();
  });
  actions.appendChild(save); actions.appendChild(cancel);
  form.appendChild(title); form.appendChild(catSel); form.appendChild(ta); form.appendChild(actions);
  return form;
}
function togglePromptLibrary(force) {
  if (!promptLibPanel) return;
  const open = force === undefined ? promptLibPanel.classList.contains("hidden") : force;
  if (open) { plibEditId = null; renderPromptLibrary(); promptLibPanel.classList.remove("hidden"); }
  else promptLibPanel.classList.add("hidden");
}
// ----- ⌨️ Configurable keyboard shortcuts ------------------------------------
function shortcutHandlers() {
  return {
    newChat: () => startFreshChat(),
    focusComposer: () => { els.input && els.input.focus(); },
    toggleHistory: () => { els.historyBtn && els.historyBtn.click(); },
    toggleWeb: () => { if (els.webSearch) { els.webSearch.checked = !els.webSearch.checked; els.webSearch.dispatchEvent(new Event("change")); } },
    modeChat: () => setMode("chat"),
    modeTranslate: () => setMode("translate"),
    modeImprove: () => setMode("improve"),
    modeSecurity: () => setMode("security"),
    promptLibrary: () => { if (["chat", "wisebase"].includes(mode)) togglePromptLibrary(); },
  };
}
function setupShortcuts() {
  const handlers = shortcutHandlers();
  window.addEventListener("keydown", (e) => {
    const combo = comboFromEvent(e);
    if (!combo) return;
    const map = { ...defaultShortcuts(), ...(settings.shortcuts || {}) };
    for (const a of SHORTCUT_ACTIONS) {
      if (map[a.id] && map[a.id] === combo && handlers[a.id]) {
        e.preventDefault();
        handlers[a.id]();
        return;
      }
    }
  });
}

function setupPromptLibrary() {
  const toolsRight = document.querySelector(".tools-right");
  const optsToggle = document.getElementById("optsToggle");
  if (!toolsRight) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "promptLibBtn"; btn.className = "ctool plib-btn";
  btn.title = t("plib.title"); btn.setAttribute("aria-label", t("plib.title"));
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  btn.hidden = !["chat", "wisebase"].includes(mode); // Chat + Wisebase
  toolsRight.insertBefore(btn, optsToggle || toolsRight.firstChild);

  promptLibPanel = document.createElement("div");
  promptLibPanel.id = "promptLibPanel"; promptLibPanel.className = "plib-panel hidden";
  document.querySelector(".composer-box").appendChild(promptLibPanel);

  btn.addEventListener("click", (e) => { e.stopPropagation(); togglePromptLibrary(); });
  document.addEventListener("mousedown", (e) => {
    if (promptLibPanel.classList.contains("hidden")) return;
    if (btn.contains(e.target) || promptLibPanel.contains(e.target)) return;
    togglePromptLibrary(false);
  });
}

// ----- Message rendering ----------------------------------------------------
// --- Auto-scroll manager -----------------------------------------------------
// Keep the thread pinned to the bottom while the AI streams, BUT pause as soon as the
// user scrolls up (so they can read), and show a "↓ jump to latest" button. The whole
// auto-scroll behaviour can be disabled with the `autoScroll` setting.
let stickBottom = true, scrollWired = false;
function isAtBottom() {
  const m = els.messages;
  return (m.scrollHeight - m.scrollTop - m.clientHeight) < 48;
}
// Pin the button to the bottom-right CORNER of the messages viewport. It lives on <body> with
// position:fixed and is placed from the live bounding rect of #messages, so it can never be
// clipped by an ancestor's overflow and always floats over the last answer — not over the model
// picker or composer below it.
function positionScrollBtn() {
  const btn = els.scrollBottomBtn;
  if (!btn) return;
  const r = els.messages.getBoundingClientRect();
  const size = 30;
  btn.style.left = `${Math.round(r.right - 12 - size)}px`;
  btn.style.top = `${Math.round(r.bottom - 12 - size)}px`;
}
function updateScrollBtn() {
  const btn = els.scrollBottomBtn;
  if (!btn) return;
  const show = !isAtBottom();
  btn.classList.toggle("show", show);   // .show drives a discreet fade/scale-in
  if (show) positionScrollBtn();
}
function wireScroll() {
  if (scrollWired || !els.messages) return;
  scrollWired = true;
  els.messages.addEventListener("scroll", () => { stickBottom = isAtBottom(); updateScrollBtn(); });
  const btn = document.createElement("button");
  btn.id = "scrollBottomBtn"; btn.type = "button"; btn.className = "scroll-bottom-btn";
  btn.title = t("scroll.toBottom");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  btn.addEventListener("click", () => scrollMessages(true));
  // On <body> + fixed so it's never clipped; positioned from the #messages rect (bottom-right corner).
  document.body.appendChild(btn);
  els.scrollBottomBtn = btn;
  window.addEventListener("resize", () => { if (btn.classList.contains("show")) positionScrollBtn(); });
}
// Scroll to the bottom when appropriate. force=true (user sent / clicked ↓) always scrolls
// and re-pins; otherwise only if auto-scroll is on AND the user hasn't scrolled up.
function scrollMessages(force) {
  wireScroll();
  if (force) stickBottom = true;
  if (force || (settings.autoScroll !== false && stickBottom)) {
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  updateScrollBtn();
}
// `m` (optional) = the mode this message belongs to. When a task runs in a tab the user has
// switched AWAY from, its messages are appended to that tab's detached holder (homeFor) instead
// of the visible area — so concurrent tasks stay in their own tab. Omit m for normal on-tab UI.
function addMessage(role, text, m) {
  const home = homeFor(m);
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "error") {
    // Error notices get a top-right toolbar: copy the message, and a small ✕ to dismiss it.
    const span = document.createElement("span");
    span.className = "msg-err-text";
    span.textContent = text || "";
    div.appendChild(span);
    const bar = document.createElement("div");
    bar.className = "mact-bar err";
    bar.appendChild(makeActBtn("mcopy", COPY_GLYPH, t("msg.copy"), (b) => copyToClipboard(text || "", b)));
    bar.appendChild(makeActBtn("mclose", CLOSE_GLYPH, t("close.title"), () => div.remove()));
    div.appendChild(bar);
  } else if (role === "user") {
    // User text lives in its own span so it can be edited/swapped (versions) without wiping the
    // action bar / version arrows appended after it.
    const span = document.createElement("span");
    span.className = "umsg-text";
    span.textContent = text || "";
    div.appendChild(span);
  } else {
    div.textContent = text || "";
  }
  home.appendChild(div);
  if (home === els.messages) {
    els.empty.classList.add("hidden");
    scrollMessages(role === "user"); // user-sent messages always jump to bottom & re-pin
  }
  return div;
}
// Update a user bubble's visible text (keeps its action bar / version arrows intact).
function setUserText(div, text) {
  if (!div) return;
  let sp = div.querySelector(".umsg-text");
  if (!sp) { sp = document.createElement("span"); sp.className = "umsg-text"; div.insertBefore(sp, div.firstChild); }
  sp.textContent = text || "";
  div._raw = text || "";
}
// 🐝 A SINGLE status line that EVOLVES through the workflow steps (Analysing → Searching →
// Generating → Checking → Fixing). set() creates it on first use and updates in place.
function makeStepStatus(m) {
  let el = null;
  return {
    set(txt) {
      // Recreate only if truly gone (no parent) — a detached holder node has isConnected=false
      // yet is still valid, so we must NOT recreate it on every update for a background task.
      if (!el || !el.parentNode) { el = addMessage("tool", "", m); el.classList.add("hivey-step"); }
      el.textContent = "🐝 " + txt;
      scrollMessages();
    },
    done() { if (el) { el.remove(); el = null; } },
  };
}
// Render attachment thumbnails/chips inside a user message bubble.
function renderUserAttachments(div, meta) {
  if (!meta || !meta.length) return;
  const box = document.createElement("div");
  box.className = "att-thumbs";
  for (const a of meta) {
    if (a.type === "image" && a.dataUrl) {
      const img = document.createElement("img"); img.src = a.dataUrl; img.alt = a.name || ""; box.appendChild(img);
    } else {
      const f = document.createElement("span"); f.className = "att-file"; f.textContent = (a.isPdf ? "📄 " : "📎 ") + (a.name || "file"); box.appendChild(f);
    }
  }
  div.appendChild(box);
}

// ----- Per-message actions (copy / resend / edit · copy answer) -------------
function flashBtn(btn) {
  if (!btn) return;
  btn.classList.add("ok");
  setTimeout(() => btn.classList.remove("ok"), 1100);
}
// Visible, formatting-free text of an assistant bubble: the rendered DOM stripped of markdown
// symbols (so "**bold**" → "bold", "# Title" → "Title", lists/links keep only their text). We
// clone the bubble, drop the hover action bar + artifact controls, and read its rendered innerText
// (attached offscreen so block-level line breaks compute correctly).
function plainTextFromEl(el) {
  if (!el) return "";
  try {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".mact-bar, .artifact-actions, .artifact-head, button").forEach((n) => n.remove());
    clone.style.position = "fixed";
    clone.style.left = "-99999px";
    clone.style.top = "0";
    clone.style.whiteSpace = "pre-wrap";
    document.body.appendChild(clone);
    const txt = clone.innerText || clone.textContent || "";
    clone.remove();
    return txt.replace(/\n{3,}/g, "\n\n").trim();
  } catch (_) {
    return (el.innerText || el.textContent || "").trim();
  }
}
async function copyToClipboard(text, btn) {
  try { await navigator.clipboard.writeText(text || ""); flashBtn(btn); }
  catch (_) {
    // Fallback for contexts where the async clipboard API is blocked.
    try {
      const ta = document.createElement("textarea");
      ta.value = text || ""; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      flashBtn(btn);
    } catch (_) {}
  }
}
// Drop a previous prompt back into the composer (switching to a chat workspace if
// the user is on Code/Image, which have no composer).
function fillComposer(text) {
  if (!CHAT_MODES.includes(mode)) setMode("chat");
  els.input.value = text || "";
  autoGrow();
  els.input.focus();
  try { els.input.setSelectionRange(els.input.value.length, els.input.value.length); } catch (_) {}
}
function resendPrompt(text) { if (busy) return; fillComposer(text); onSend(); }
function editPrompt(text) { fillComposer(text); }
// Best-effort user region (browser locale + timezone) so the agent recommends/open streaming that
// is actually available where the user is, with region-appropriate links.
function userRegion() {
  try {
    const lang = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
    return [lang, tz].filter(Boolean).join(" / ");
  } catch (_) { return ""; }
}

// Hover actions on a USER bubble: copy the message, resend it as-is, or load it
// back into the composer to edit. Double-click or right-click also opens it to edit.
function makeActBtn(cls, glyph, title, fn) {
  const b = document.createElement("button");
  b.className = "mact " + cls;
  b.type = "button";
  setHTML(b, glyph);
  b.title = title;
  b.addEventListener("click", (e) => { e.stopPropagation(); fn(b); });
  return b;
}
// Delete a message bubble from the view AND (best-effort) from the current session transcript, so it
// stays gone after reload. Also drops a trailing Wisebase "Sources" footer that belongs to an answer.
function deleteMessageBubble(div, role, rawText) {
  const next = div.nextElementSibling;
  div.remove();
  if (role === "assistant" && next && next.classList && next.classList.contains("wb-answer-sources")) next.remove();
  try {
    const sess = getSession(mode);
    const txt = (rawText || "").trim();
    // Drop it from the DISPLAY transcript…
    for (let i = sess.transcript.length - 1; i >= 0; i--) {
      const e = sess.transcript[i];
      if (e.role === role && (e.text || "").trim() === txt) { sess.transcript.splice(i, 1); break; }
    }
    // …AND from the native HISTORY sent to the model, so the conversation actually forgets it (a
    // user turn's history content embeds the display text; an assistant turn's content IS the answer).
    const hist = sess.history || [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      if (!h || h.role !== role) continue;
      const c = typeof h.content === "string" ? h.content : JSON.stringify(h.content || "");
      if (txt && (c.includes(txt) || txt.includes(c))) { hist.splice(i, 1); break; }
    }
    saveSession(sess, mode, currentSelection());
  } catch (_) {}
}
// One consistent SVG icon set for the message hover actions (all stroke-based, same 24-viewBox
// weight) so the copy / edit / resend / markdown / mindmap / delete row reads as ONE clean toolbar
// instead of a mix of text glyphs (⧉ ✎ ↻ M) and SVGs.
const DEL_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
const COPY_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const EDIT_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
const RESEND_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>';
const COPYMD_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6 3 12l5 6"/><path d="M16 6l5 6-5 6"/></svg>';
const CLOSE_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
function attachUserActions(div, rawText) {
  if (!div || div._actsBound) return;
  div._actsBound = true;
  div._raw = rawText || "";
  const bar = document.createElement("div");
  bar.className = "mact-bar user";
  bar.appendChild(makeActBtn("mcopy", COPY_GLYPH, t("msg.copy"), (b) => copyToClipboard(div._raw, b)));
  bar.appendChild(makeActBtn("medit", EDIT_GLYPH, t("msg.edit"), () => beginEditUserMessage(div)));
  bar.appendChild(makeActBtn("mresend", RESEND_GLYPH, t("msg.resend"), () => resendPrompt(div._raw)));
  bar.appendChild(makeActBtn("mdel", DEL_GLYPH, t("msg.delete"), () => deleteMessageBubble(div, "user", div._raw)));
  div.appendChild(bar);
  div.addEventListener("dblclick", () => beginEditUserMessage(div));
  div.addEventListener("contextmenu", (e) => { e.preventDefault(); beginEditUserMessage(div); });
}

// ----- Edit a message IN PLACE + keep prior answers as switchable VERSIONS -----------
// Editing the previous user message regenerates its answer; the old (message + answer) stays
// available via ‹ k/n › arrows on the bubble. Scoped to the LAST user turn of a chat tab
// (non-agent); other cases fall back to loading the text into the composer.
function isLastUserMessage(div) {
  if (!div || !div.parentElement) return false;
  let n = div.nextElementSibling;
  while (n) { if (n.classList && n.classList.contains("msg") && n.classList.contains("user")) return false; n = n.nextElementSibling; }
  return true;
}
function recordTurnVersion(div, text, modelContent, answerEl) {
  if (!div) return;
  if (!div._turn) div._turn = { versions: [], idx: 0 };
  const T = div._turn;
  T.versions.push({ text, modelContent, answerEl });
  T.idx = T.versions.length - 1;
  div._raw = text;
  div._modelContent = modelContent;
  div._answerEl = answerEl;
  renderTurnArrows(div);
}
function renderTurnArrows(div) {
  const T = div && div._turn;
  const old = div.querySelector(":scope > .umsg-vers");
  if (old) old.remove();
  if (!T || T.versions.length <= 1) return;
  const wrap = document.createElement("div");
  wrap.className = "umsg-vers";
  const prev = makeActBtn("vprev", "‹", t("msg.prevVersion"), () => switchTurnVersion(div, T.idx - 1));
  const counter = document.createElement("span");
  counter.className = "umsg-vers-n";
  counter.textContent = `${T.idx + 1}/${T.versions.length}`;
  const next = makeActBtn("vnext", "›", t("msg.nextVersion"), () => switchTurnVersion(div, T.idx + 1));
  wrap.appendChild(prev); wrap.appendChild(counter); wrap.appendChild(next);
  div.appendChild(wrap);
}
function switchTurnVersion(div, newIdx) {
  const T = div && div._turn;
  if (!T || busy) return;
  newIdx = Math.max(0, Math.min(T.versions.length - 1, newIdx));
  if (newIdx === T.idx) return;
  const cur = T.versions[T.idx];
  if (cur && cur.answerEl && cur.answerEl.parentNode) cur.answerEl.remove(); // detach (kept in memory)
  T.idx = newIdx;
  const v = T.versions[newIdx];
  setUserText(div, v.text);
  div._modelContent = v.modelContent;
  div._answerEl = v.answerEl;
  if (v.answerEl) div.after(v.answerEl); // re-insert this version's answer right after the bubble
  lastUserContent = v.modelContent;
  renderTurnArrows(div);
  scrollMessages();
}
function beginEditUserMessage(div) {
  if (!div || busy) return;
  // Eligible only for the LAST user turn of a chat tab (a regen makes sense there). Otherwise just
  // load the text into the composer (legacy behaviour) so we never discard later turns silently.
  if (!CHAT_MODES.includes(mode) || agentActive() || !isLastUserMessage(div) || !div._answerEl) {
    return fillComposer(div._raw);
  }
  if (div.querySelector(":scope > .umsg-edit")) return; // already editing
  const sp = div.querySelector(".umsg-text");
  const ed = document.createElement("div");
  ed.className = "umsg-edit";
  const ta = document.createElement("textarea");
  ta.className = "umsg-edit-ta";
  ta.value = div._raw || "";
  const row = document.createElement("div");
  row.className = "umsg-edit-row";
  const save = document.createElement("button");
  save.className = "umsg-edit-btn save"; save.type = "button"; save.textContent = t("msg.editSave");
  const cancel = document.createElement("button");
  cancel.className = "umsg-edit-btn"; cancel.type = "button"; cancel.textContent = t("msg.editCancel");
  row.appendChild(cancel); row.appendChild(save);
  ed.appendChild(ta); ed.appendChild(row);
  if (sp) sp.style.display = "none";
  div.insertBefore(ed, sp ? sp.nextSibling : div.firstChild);
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
  const close = () => { ed.remove(); if (sp) sp.style.display = ""; };
  cancel.addEventListener("click", (e) => { e.stopPropagation(); close(); });
  save.addEventListener("click", (e) => {
    e.stopPropagation();
    const v = ta.value.trim();
    close();
    if (v && v !== div._raw) resendEditedTurn(div, v);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save.click(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
}
async function resendEditedTurn(div, newText) {
  if (busy) return;
  // Detach the current answer so the regenerated one takes its place; the old version stays in
  // memory (recordTurnVersion already captured it as version 0) and is restored via the arrows.
  if (div._answerEl && div._answerEl.parentNode) div._answerEl.remove();
  setUserText(div, newText);
  await sendToModel(newText, newText, { reuseUserEl: div, versioned: true });
}
// Hover actions on an ASSISTANT bubble: two copy modes — plain TEXT (visible text only, no
// markdown symbols, which is what most people want when pasting into a doc/email) and raw
// MARKDOWN (the formatting preserved, for pasting back into a markdown editor).
function attachAssistantActions(el, getRaw) {
  if (!el || el._actsBound) return;
  el._actsBound = true;
  const bar = document.createElement("div");
  bar.className = "mact-bar assistant";
  bar.appendChild(makeActBtn("mcopy", COPY_GLYPH, t("msg.copyText"), (b) => copyToClipboard(plainTextFromEl(el), b)));
  bar.appendChild(makeActBtn("mcopymd", COPYMD_GLYPH, t("msg.copyMd"), (b) => copyToClipboard((getRaw && getRaw()) || el._raw || "", b)));
  bar.appendChild(makeActBtn("mmind", '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h4"/><path d="M11 12 17 7"/><path d="M11 12l6 5"/></svg>', t("mind.make"), () => openMindmapFrom((getRaw && getRaw()) || el._raw || "")));
  bar.appendChild(makeActBtn("mdel", DEL_GLYPH, t("msg.delete"), () => deleteMessageBubble(el, "assistant", (getRaw && getRaw()) || el._raw || "")));
  el.appendChild(bar);
}

// Agent mode: a single collapsible "Actions" block that hides the agent's individual
// tool calls (for immersion) while keeping them consultable on click. Shows a live
// "Action in progress…" header that turns into "Actions (N)" and collapses when done.
// Human-readable, icon-prefixed description of the tool call the agent is RUNNING — shown live in
// the actions "button" (summary), updated at each step. Falls back to the raw tool name.
function describeAgentAction(call) {
  const name = call && call.name;
  const inp = (call && call.input) || {};
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch (_) { return (u || "").slice(0, 40); } };
  const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  switch (name) {
    case "read_page": return "📄 " + t("agent.act.read");
    case "read_selection": return "📄 " + t("agent.act.readSel");
    case "find_elements": return "🔎 " + t("agent.act.find") + (inp.query ? ` « ${clip(inp.query, 30)} »` : "");
    case "click_element": case "click_at": return "🖱️ " + t("agent.act.click") + (inp.text || inp.ref ? ` « ${clip(inp.text || inp.ref, 30)} »` : "");
    case "fill_input": return "⌨️ " + t("agent.act.fill") + (inp.value ? ` « ${clip(inp.value, 24)} »` : "");
    case "scroll_page": return "↕️ " + t("agent.act.scroll");
    case "navigate": return "🌐 " + t("agent.act.navigate") + (inp.url ? ` ${host(inp.url)}` : "");
    case "open_tab": return "🌐 " + t("agent.act.openTab") + (inp.url ? ` ${host(inp.url)}` : "");
    case "control_media":
      return inp.action === "pause" ? "⏸️ " + t("agent.act.pause")
        : /autoplay/.test(inp.action || "") ? "🔁 " + t("agent.act.autoplay")
        : "▶️ " + t("agent.act.play") + (inp.query ? ` « ${clip(inp.query, 30)} »` : "");
    case "screenshot": return "📸 " + t("agent.act.screenshot");
    case "web_search": case "search": return "🔍 " + t("agent.act.search") + (inp.query ? ` « ${clip(inp.query, 30)} »` : "");
    default: return "⚙️ " + (name || t("agent.act.run"));
  }
}
function makeAgentActions() {
  let wrap = null, list = null, label = null, currentRow = null, count = 0;
  const ensure = () => {
    if (wrap) return;
    els.empty.classList.add("hidden");
    wrap = document.createElement("details");
    wrap.className = "agent-actions";
    // Expanded WHILE the agent works, so the user sees each step (navigate / read / click…) happen
    // live instead of staring at a lone spinner and wondering what's going on. finish() folds it.
    wrap.open = true;
    const sum = document.createElement("summary");
    sum.className = "agent-actions-sum";
    const spin = document.createElement("span");
    spin.className = "agent-spin";
    label = document.createElement("span");
    label.className = "agent-actions-label";
    label.textContent = t("agent.actionsRunning");
    const caret = document.createElement("span");
    caret.className = "agent-actions-caret i-ph:caret-right";
    sum.appendChild(spin);
    sum.appendChild(label);
    sum.appendChild(caret);
    list = document.createElement("div");
    list.className = "agent-actions-list";
    wrap.appendChild(sum);
    wrap.appendChild(list);
    els.messages.appendChild(wrap);
    scrollMessages();
  };
  return {
    open() { ensure(); }, // show the frame right away (before the first tool call)
    start(call) {
      ensure();
      // Live "button" text = a readable description of the current step (updates each step).
      if (label) { label.textContent = describeAgentAction(call); wrap.classList.add("running"); }
      const row = document.createElement("div");
      row.className = "agent-act";
      const head = document.createElement("div");
      head.className = "agent-act-head";
      head.textContent = `→ ${call.name}(${JSON.stringify(call.input).slice(0, 80)})`;
      row.appendChild(head);
      // Mark the step as in-progress: navigations wait for the page to fully load (up to ~12s), so
      // a visible "…" pulse tells the user it's working, not frozen.
      row.classList.add("pending");
      list.appendChild(row);
      currentRow = row;
      scrollMessages();
    },
    end(call, out) {
      if (!currentRow) return;
      currentRow.classList.remove("pending");
      const res = document.createElement("div");
      res.className = "agent-act-res" + (out && (out.blocked || out.error) ? " err" : "");
      res.textContent = out && out.blocked ? `🛡 ${out.error}` : out && out.error ? `✗ ${out.error}` : "✓ ok";
      currentRow.appendChild(res);
      count++;
    },
    finish() {
      if (!wrap) return;
      wrap.classList.add("done");
      wrap.classList.remove("running");
      const sp = wrap.querySelector(".agent-spin");
      if (sp) sp.remove();
      if (label) label.textContent = count ? t("agent.actionsDone", { n: count }) : t("agent.actionsNone");
      wrap.open = false; // keep it folded once finished; the user can expand to review
    },
  };
}
function addThinkBlock(m) {
  const home = homeFor(m);
  const d = document.createElement("details");
  d.className = "think";
  d.open = true;
  const s = document.createElement("summary");
  s.textContent = t("chip.thinking");
  const body = document.createElement("div");
  body.className = "think-body";
  d.appendChild(s);
  d.appendChild(body);
  home.appendChild(d);
  if (home === els.messages) { els.empty.classList.add("hidden"); scrollMessages(); }
  return body;
}

// Animated "the model is working" indicator, shown from the moment we send until
// the first token (or reasoning) streams back — so the response area is never blank
// while we wait. Cycles a few phrases with a pulsing-dots animation.
function addPendingIndicator(m) {
  const wrap = addMessage("assistant", "", m);
  wrap.classList.add("pending-msg");
  const ind = document.createElement("div");
  ind.className = "typing";
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  for (let k = 0; k < 3; k++) dots.appendChild(document.createElement("i"));
  const label = document.createElement("span");
  label.className = "typing-label";
  const phrases = [t("think.working"), t("think.reading"), t("think.reasoning"), t("think.almost")];
  let pi = 0;
  label.textContent = phrases[0] + "…";
  ind.appendChild(dots); ind.appendChild(label);
  wrap.appendChild(ind);
  scrollMessages();
  wrap._iv = setInterval(() => { pi = (pi + 1) % phrases.length; label.textContent = phrases[pi] + "…"; }, 1800);
  return wrap;
}
function removePending(node) {
  if (!node) return;
  if (node._iv) { clearInterval(node._iv); node._iv = null; }
  node.remove();
}

// Streaming sink: owns one assistant card (+ optional model badge) and its
// thinking block. Used for a normal turn and for each compare run. `pendingEl` is
// the animated waiting indicator, removed as soon as the first content arrives.
// Universal (model-agnostic) thinking: split a model's reply into the <think>…</think>
// reasoning block and the actual answer — exactly the trick that makes the artifact preview
// work everywhere. Lets ANY model "think" (even ones that ignore the provider reasoning
// param), with the depth driven by our prompt. Tolerant of <thinking> too and of the tags
// arriving split across stream chunks (we re-derive from the full text each delta).
function splitThink(full) {
  const open = full.match(/<think(?:ing)?>/i);
  if (!open) return { think: "", answer: full };
  const afterOpen = full.slice(open.index + open[0].length);
  const pre = full.slice(0, open.index); // any text before <think> (usually empty)
  const close = afterOpen.match(/<\/think(?:ing)?>/i);
  if (!close) return { think: afterOpen, answer: pre }; // still streaming the reasoning
  const think = afterOpen.slice(0, close.index);
  const answer = (pre + afterOpen.slice(close.index + close[0].length)).replace(/^\s+/, "");
  return { think, answer };
}

function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; }
}

function makeSink(badgeLabel, showThink = true, pendingEl = null, m = null) {
  // `m` = the mode this card belongs to; when that tab isn't on screen, the card and its
  // reasoning block render into the tab's detached holder (homeFor) instead of the visible area.
  let el = null, contentEl = null, raw = "", think = null;
  let full = "", nativeThink = "", promptThink = ""; // raw = ANSWER only (think stripped out)
  let codingDetails = null, codingPre = null, coding = false; // collapsible live-code view
  // ── Smooth "typewriter" streaming ──────────────────────────────────────────
  // Models emit tokens in bursts (a chunk of 1 char, then 40, then 3…), which makes the
  // answer jump around. We instead reveal characters on a rAF loop that catches up to the
  // received text at a rate PROPORTIONAL to the backlog: a fast model reveals fast, the
  // tail end glides in like a typewriter — fluid regardless of the provider's chunking.
  const smooth = settings.smoothStream !== false && !prefersReducedMotion();
  let shown = 0, rafId = 0;
  const paint = () => { setHTML(contentEl, renderMarkdown(smooth ? raw.slice(0, shown) : raw)); };
  const tick = () => {
    rafId = 0;
    const gap = raw.length - shown;
    if (gap <= 0) return;
    shown = Math.min(raw.length, shown + Math.max(2, Math.ceil(gap * 0.22)));
    paint();
    scrollMessages();
    if (shown < raw.length) rafId = requestAnimationFrame(tick);
  };
  const stopRaf = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };
  const dropPending = () => { if (pendingEl) { removePending(pendingEl); pendingEl = null; } };
  const ensure = () => {
    if (el) return;
    el = addMessage("assistant", "", m);
    // Header row: model pill (left) + a Copy-answer button pinned to the FAR RIGHT of the embed.
    const head = document.createElement("div");
    head.className = "answer-head";
    if (badgeLabel) {
      const b = document.createElement("div");
      b.className = "model-badge";
      b.textContent = badgeLabel;
      b.title = badgeLabel + (lastRoutedModel ? "  ·  via " + lastRoutedModel : ""); // discreet "via <real model>" on hover (#6)
      head.appendChild(b);
    }
    // No per-answer copy/delete buttons in the header anymore — they were duplicates. All the answer
    // actions (copy / copy-as-markdown / mindmap / delete) live in the SINGLE hover action bar BELOW
    // the answer (attachAssistantActions), exactly like the user messages.
    el.appendChild(head);
    contentEl = document.createElement("div");
    el.appendChild(contentEl);
  };
  // When the answer starts emitting code, route the LIVE stream into a COLLAPSED
  // "💻 Coding…" block (cleaner) that the user can expand to watch the code being written.
  const ensureCoding = () => {
    if (codingDetails) return;
    codingDetails = document.createElement("details");
    codingDetails.className = "coding-block";
    const sum = document.createElement("summary");
    sum.textContent = "💻 " + t("step.coding");
    codingDetails.appendChild(sum);
    codingPre = document.createElement("pre");
    codingPre.className = "coding-live";
    codingDetails.appendChild(codingPre);
    el.appendChild(codingDetails);
  };
  // Render the 💭 block from BOTH sources of reasoning: the provider's native reasoning
  // stream (onThink, e.g. Claude/DeepSeek) AND the prompt-based <think> block we extract
  // from the text stream (works on every model). Gated on the 💭 toggle being ON.
  const renderThink = () => {
    if (!showThink) return;
    const txt = nativeThink + promptThink;
    if (!txt) return;
    if (!think) think = addThinkBlock(m);
    think.textContent = txt;
    scrollMessages();
  };
  return {
    onText(delta) {
      dropPending();
      full += delta;
      // Strip any <think>…</think> out of the visible answer (→ reasoning block instead).
      const sp = splitThink(full);
      if (sp.think) { promptThink = sp.think; renderThink(); }
      raw = sp.answer;
      // Still streaming the reasoning (no answer yet): show the 💭 block, but don't create
      // the answer bubble yet — so reasoning renders ABOVE the answer, not below it.
      if (!raw) { scrollMessages(); return; }
      ensure();
      if (!coding && raw.indexOf("```") !== -1) coding = true;
      if (coding) {
        ensureCoding();
        codingPre.textContent = raw;           // live code, hidden inside the foldable block
        if (codingDetails.open) codingPre.scrollTop = codingPre.scrollHeight;
        contentEl.style.display = "none";       // keep the message clean while coding
      } else if (smooth) {
        if (!rafId) rafId = requestAnimationFrame(tick); // glide new text in via the rAF loop
      } else {
        setHTML(contentEl, renderMarkdown(raw));
      }
      scrollMessages();
    },
    onThink(delta) {
      // Native provider reasoning (DeepSeek R1, o-series, Claude…). Gated on the 💭 toggle.
      if (!showThink) return;
      dropPending();
      nativeThink += delta;
      renderThink();
    },
    finalize() {
      dropPending();
      stopRaf();                  // stop the typewriter and show the COMPLETE answer at once
      // Safety net: if the model opened a <think> block but never closed it (so the answer
      // never streamed out), don't lose the content — surface it stripped of the open tag.
      if (!raw && full) raw = full.replace(/^\s*<think(?:ing)?>/i, "").replace(/^\s+/, "");
      if (raw) ensure();
      if (contentEl) {
        contentEl.style.display = "";
        setHTML(contentEl, renderMarkdown(raw));
        enhanceArtifacts(contentEl); // turn code blocks into runnable artifact cards
      }
      if (codingDetails) { codingDetails.remove(); codingDetails = null; } // live view no longer needed
    },
    getRaw: () => raw,
    // Replace the rendered content (e.g. to append a verified, deterministic Sources section).
    setRaw(newRaw) {
      raw = newRaw || "";
      if (contentEl) { contentEl.style.display = ""; setHTML(contentEl, renderMarkdown(raw)); enhanceArtifacts(contentEl); }
    },
    getEl: () => el,
  };
}

// Classify an OpenRouter failure so we show the RIGHT advice (not always "enable
// privacy"). Order matters: the data-policy message also contains "no endpoints found".
//   policy      → account privacy gate (free/loggable endpoints disabled)
//   rate        → free-tier rate limit hit (~20/min, 200/day)
//   unavailable → this model has no usable endpoint right now (auto-switch away)
function classifyOpenRouterError(providerId, msg) {
  if (providerId !== "openrouter") return null;
  const m = msg || "";
  if (/data policy|prompt logging|model training|privacy|loggable/i.test(m)) return "policy";
  // 401 = the API KEY is rejected (invalid/expired/"User not found"). Must be checked BEFORE the
  // "unavailable" rule below, because "User not found" also matches /not found/ — but it's an AUTH
  // problem, not a model problem, so switching models is futile (every model will 401).
  if (/\b401\b|user not found|no auth credentials|invalid api key|invalid key|unauthor|not authenticated/i.test(m))
    return "auth";
  if (/\b429\b|rate.?limit|rate.?limited|free-models-per|requests per (day|min)/i.test(m)) return "rate";
  if (/\b404\b|no endpoints found|no allowed providers|not found|does not exist/i.test(m)) return "unavailable";
  return null;
}
function showRunError(providerId, e, modelId) {
  if (e && e.name === "AbortError") { addMessage("tool", t("msg.interrupted")); return; }
  const msg = e && e.message ? e.message : String(e);
  const kind = classifyOpenRouterError(providerId, msg);
  if (kind === "policy") {
    addOpenRouterFreeError(msg); // privacy gate — show advice + the real message
  } else if (kind === "auth") {
    // Invalid / unrecognized API key — switching models won't help. Tell the user to fix the key.
    addMessage("error", t("err.orAuth") + "\n\n" + t("err.orRaw", { msg: trimErr(msg) }));
  } else if (kind === "rate") {
    // A 429 is TRANSIENT: keep the model in the picker and keep the user's selection. Just put
    // it on a short cooldown so Hivey rotates away from it briefly (and so we don't re-hit it
    // on the very next turn). It comes back automatically — it does NOT disappear from the list.
    if (modelId && isFreeModelId(modelId)) coolDown(modelId);
    addMessage("error", t("err.orRate") + "\n\n" + t("err.orRaw", { msg: trimErr(msg) }));
  } else if (kind === "unavailable") {
    if (modelId) handleOpenRouterUnavailable(modelId); // drop it + switch to a working model
    addMessage("error", t("err.orUnavailable", { model: modelId || "?" }) + "\n\n" + t("err.orRaw", { msg: trimErr(msg) }));
  } else {
    addMessage("error", t("err.generic", { msg }));
  }
}
// Keep the raw OpenRouter message readable (strip the JSON envelope when present).
function trimErr(msg) {
  let m = String(msg || "");
  const i = m.indexOf('"message"');
  if (i >= 0) { const q = m.slice(i + 9).match(/"\s*:\s*"([^"]+)"/); if (q) m = q[1]; }
  return m.slice(0, 300);
}
// The OpenRouter privacy-gate error, with a one-click link to the privacy page AND the
// raw message OpenRouter returned (so the user can see the real cause).
function addOpenRouterFreeError(rawMsg) {
  const div = addMessage("error", t("err.orFree"));
  div.appendChild(document.createElement("br"));
  const a = document.createElement("a");
  a.href = "https://openrouter.ai/settings/privacy";
  a.textContent = t("or.enableLink");
  a.style.color = "#b9a7ff";
  a.style.fontWeight = "700";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    try { browser.tabs.create({ url: a.href }); } catch (_) { window.open(a.href, "_blank", "noopener"); }
  });
  div.appendChild(a);
  if (rawMsg) {
    const raw = document.createElement("div");
    raw.style.cssText = "margin-top:6px;opacity:.7;font-size:11px;white-space:pre-wrap";
    raw.textContent = "OpenRouter: " + trimErr(rawMsg);
    div.appendChild(raw);
  }
}
// Drop an OpenRouter model that the account can't use from the picker, and switch
// the active selection to the next best free model so the user isn't stuck on it.
function handleOpenRouterUnavailable(modelId) {
  if (!modelId || orUnavailable.has(modelId)) return;
  orUnavailable.add(modelId);
  const list = (settings.orModels || []).filter((m) => !orUnavailable.has(m.id));
  if ((settings.models && settings.models.openrouter) === modelId) {
    const pick = bestFreeOpenRouter(settings.orModels || []);
    if (pick && pick !== modelId) {
      settings.models = { ...(settings.models || {}), openrouter: pick };
      setSettings({ models: settings.models });
      lastRoutedModel = pick; // internal plumbing — never shown in the thread (#6)
      try { console.debug("[Hivey] switched model →", pick); } catch (_) {}
    }
  }
  refreshModelUI();
}
function currentKeyMissing(providerId) {
  const meta = PROVIDERS[providerId];
  if (!meta || !meta.needsKey) return false;
  return !keyFor(providerId, settings);
}
function confirmAction(name, input) {
  return new Promise((resolve) => {
    // A sensitive action (download / reserve / delete / sign-up…) gets a clear warning
    // and shows what it's about to do; ordinary (manual-mode) actions use the generic text.
    if (input && input.sensitive) {
      const what = input.label || input.url || "";
      els.confirmText.textContent = t("confirm.sensitive", { action: input.sensitive, what: String(what).slice(0, 80) });
    } else {
      els.confirmText.textContent = t("confirm.prompt", { name, input: JSON.stringify(input).slice(0, 120) });
    }
    els.confirmBar.classList.remove("hidden");
    const cleanup = (v) => {
      els.confirmBar.classList.add("hidden");
      els.confirmAllow.removeEventListener("click", onAllow);
      els.confirmDeny.removeEventListener("click", onDeny);
      resolve(v);
    };
    const onAllow = () => cleanup(true);
    const onDeny = () => cleanup(false);
    els.confirmAllow.addEventListener("click", onAllow);
    els.confirmDeny.addEventListener("click", onDeny);
  });
}
// ----- Efficiency: context cleaning + cheap-model routing + compaction -------
// Trim boilerplate so the user pays only for meaningful tokens (and gets a faster
// first token from a smaller prompt). Lossless-ish: we collapse whitespace, drop
// blank/duplicate consecutive lines and obvious chrome ("cookie", "menu" one-liners
// repeated). Only runs when settings.cleanContext is on.
function cleanText(s) {
  if (!s) return "";
  if (!settings.cleanContext) return s;
  const lines = String(s).replace(/\r/g, "").split("\n");
  const out = [];
  let prev = null, blank = 0;
  for (let raw of lines) {
    const line = raw.replace(/[ \t ]+/g, " ").trim();
    if (!line) { if (++blank > 1) continue; out.push(""); prev = null; continue; }
    blank = 0;
    if (line === prev) continue;          // drop immediate duplicate lines
    out.push(line);
    prev = line;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// Total characters across a native history (≈4 chars/token) — used only to decide
// WHEN to compact the conversation.
function historyChars(h) {
  let n = 0;
  for (const m of h || []) {
    const c = m && m.content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) for (const p of c) n += (p && p.text ? p.text.length : 0);
  }
  return n;
}

// The cheap "housekeeping" model used for summaries / compaction / auto-titles when
// smartRouting is on, so the premium model the user picked is spent only on answers.
// settings.utilityModel pins one; "" = auto-pick the cheapest FREE connected model
// (a free OpenRouter model, else the current selection as a last resort).
function utilitySelection() {
  // 🐝 Hivey routes housekeeping (titles, summaries, compaction) to its cheap utility tier.
  if (activeHiveyId() && !currentKeyMissing("openrouter")) {
    return ensureUsable(parseSel(hiveyTiers(activeHiveyId()).utility), activeHiveyId());
  }
  if (settings.utilityModel) {
    const u = parseSel(settings.utilityModel);
    if (u.providerId && !currentKeyMissing(u.providerId)) return u;
  }
  if (isConnectedFree("openrouter") && settings.orModels && settings.orModels.length) {
    const free = settings.orModels
      .filter((m) => !m.prompt && !m.completion && !orUnavailable.has(m.id))
      .sort((a, b) => a.id.length - b.id.length); // shortest id ≈ smallest/fastest free model
    if (free.length) return { providerId: "openrouter", modelId: free[0].id };
  }
  return currentSelection();
}
function isConnectedFree(pid) { return !currentKeyMissing(pid) && providersToShow().includes(pid); }

// One-shot, non-streaming-ish completion on a given model. Returns plain text.
async function runUtilityCompletion(sel, system, userText, signal) {
  const provider = makeProvider(
    { ...settings, provider: sel.providerId, models: { ...settings.models, [sel.providerId]: sel.modelId } },
    { thinking: false, webSearch: false }
  );
  const turn = await provider.runTurn({
    system, history: [{ role: "user", content: userText }], tools: [],
    onText: null, onThink: null, signal,
  });
  return (turn && turn.text || "").trim();
}

// 🐝 Hivey orchestration stage 1 — WEB: a small fast model runs the web plugin and
// gathers the relevant facts + source URLs, so the (pricier) routed model only has to
// analyse and write. Returns the findings text, or "" on failure (caller falls back).
// Run a fast web-research pass with a GIVEN search-capable model. `multi` asks for several
// OPTIONS/ALTERNATIVES (used by the agent so it doesn't tunnel on the first obvious choice).
async function webResearchWith(ss, query, signal, multi, outCitations) {
  if (!ss || !ss.providerId || currentKeyMissing(ss.providerId)) return "";
  const q = (typeof query === "string" ? query : "").slice(0, 4000);
  if (!q.trim()) return "";
  try {
    const provider = makeProvider(
      { ...settings, provider: ss.providerId, models: { ...settings.models, [ss.providerId]: ss.modelId } },
      { thinking: false, webSearch: true }
    );
    const system = multi
      ? "You are a fast internet-research assistant working ALONGSIDE an agent. (1) If a [Current page: …] block is included below, FIRST give a one-paragraph SUMMARY of that page. (2) Then search the web for the user's task and return SEVERAL viable options/approaches/answers (not just the single most obvious one), each with the key facts and its SOURCE URL. If the task is to WATCH or STREAM something, CHECK and list where it is LEGALLY available — official services and FREE, LEGAL, ad-supported platforms (Pluto TV, Tubi, Plex, Rakuten TV, Roku, ARTE, France.tv, 6play, Molotov, YouTube, Twitch, the official channel/league site for live sports) — each with its URL and whether it's free; NEVER suggest piracy or illegal streaming sites. Be concise and strictly factual — do NOT act, do NOT answer the user; just gather the page summary + raw material and ALTERNATIVES the agent can choose from."
      : "You are a fast web-research assistant. Search the web for the user's request and return the key facts, figures, dates and quotes WITH their source URLs. Be concise and strictly factual — do NOT answer the user or give opinions, just gather the raw material.";
    const turn = await Promise.race([
      provider.runTurn({
        system,
        history: [{ role: "user", content: q }], tools: [], onText: null, onThink: null, signal,
      }),
      new Promise((res) => setTimeout(() => res(null), 22000)),
    ]);
    // Hand back the REAL source URLs (web-plugin citations) so callers can build resolvable links
    // instead of trusting the model's typed-out URLs (which 404).
    if (outCitations && turn && Array.isArray(turn.citations)) outCitations.push(...turn.citations);
    return (turn && turn.text || "").trim();
  } catch (_) { return ""; }
}
function hiveyWebFetch(hid, query, signal, outCitations) {
  return webResearchWith(parseSel(hiveyTiers(hid).search), query, signal, false, outCitations);
}

// 🐝 Hivey verification — a CHEAP model double-checks the final answer for factual
// errors, fabricated/unsupported claims and contradictions. Returns "OK" when the
// answer is sound, a short list of issues otherwise, or null on failure/skip.
async function hiveyVerify(hid, question, answer, signal) {
  const T = hiveyTiers(hid);
  const vs = ensureUsable(parseSel(T.verify || T.light || T.utility), hid); // capable fact-checker
  if (!vs.providerId || currentKeyMissing(vs.providerId)) return null;
  // Feed the FULL answer (was sliced to 6k → the checker saw big code as "cut off" and
  // wrongly flagged it as incomplete). Cap high enough for whole artifacts.
  const full = (typeof answer === "string" ? answer : "");
  const a = full.slice(0, 60000);
  if (a.replace(/\s/g, "").length < 40) return null; // skip trivial/empty answers
  // Local truncation signal: balanced ``` fences ⇒ the code block is closed/complete, so
  // tell the checker NOT to claim it is cut off.
  const fences = (a.match(/```/g) || []).length;
  const looksComplete = full.length <= 60000 && fences % 2 === 0;
  const completeNote = looksComplete
    ? "The answer below is the COMPLETE final output and its code blocks are properly closed. Do NOT claim it is truncated, cut off or incomplete — judge only what is actually present.\n"
    : "";
  try {
    const out = await Promise.race([
      runUtilityCompletion(
        vs,
        "You are a meticulous reviewer. Check the assistant's answer for REAL problems only: factual errors, fabricated/unsupported claims, hallucinations, internal contradictions, or code that clearly cannot run (undefined references, broken syntax). Do NOT nitpick style, and do NOT invent missing-feature complaints if the feature actually appears in the answer. " +
          completeNote +
          "If the answer is sound, reply EXACTLY 'OK'. Otherwise reply with up to 4 short bullet points naming the SPECIFIC problems — no preamble, no praise.",
        "[Question]\n" + (question || "") + "\n\n[Answer]\n" + a, signal
      ),
      new Promise((res) => setTimeout(() => res(null), 18000)),
    ]);
    return out == null ? null : (out.trim() || null);
  } catch (_) { return null; }
}

// 🐝 Hivey anti-hallucination — when the verifier flags problems, a STRONG model rewrites
// the answer, fixing the listed issues and refusing to invent facts. Returns the corrected
// answer text, or "" on failure. Uses the variant's strongest relevant tier.
async function hiveyCorrect(hid, question, answer, issues, tierKey, signal, overrideSel) {
  const T = hiveyTiers(hid);
  // For a NON-Hivey model we correct with the SAME model the user picked (overrideSel), so a
  // good model's answer is never downgraded to a free one. For Hivey, use the best tier.
  const cs = overrideSel
    ? overrideSel
    : ensureUsable(parseSel((tierKey === "code" && T.code) ? T.code : (T.reasoning || T.chat)), hid);
  if (!cs.providerId || currentKeyMissing(cs.providerId)) return "";
  try {
    return await Promise.race([
      runUtilityCompletion(
        cs,
        "You are correcting an AI answer that a checker flagged. Produce a REVISED, FINAL answer that fixes every listed problem. Rules: do NOT invent facts — if something cannot be verified, say so explicitly rather than guessing; keep what was correct. CRUCIAL: if the draft was cut off, truncated or incomplete (e.g. an unfinished function or missing logic), output the FULL, COMPLETE and RUNNABLE version with nothing omitted — finish every function and include all required code. Output ONLY the corrected answer (same language as the question), no meta-commentary.",
        "[Question]\n" + (question || "") + "\n\n[Draft answer]\n" + (answer || "").slice(0, 60000) +
        "\n\n[Problems found by the checker]\n" + (issues || ""), signal
      ),
      new Promise((res) => setTimeout(() => res(""), 40000)),
    ]);
  } catch (_) { return ""; }
}

// 🐝 Hivey orchestration stage 1 — CODE: the senior model designs a precise plan that a
// cheaper, reliable model then implements verbatim. Returns the plan, or "" on failure.
async function hiveyCodePlan(hid, task, signal) {
  const ps = parseSel(hiveyTiers(hid).codePlanner);
  if (!ps.providerId || currentKeyMissing(ps.providerId)) return "";
  const q = (typeof task === "string" ? task : "").slice(0, 6000);
  if (!q.trim()) return "";
  try {
    return await Promise.race([
      runUtilityCompletion(
        ps,
        "You are a senior software architect. For the user's coding task, produce a precise, complete implementation plan: the files/components to create, the key functions with their signatures, the data flow, the libraries to use, the edge cases and the pitfalls to avoid. Be specific and unambiguous so a capable engineer implements it correctly on the first try. Do NOT write the full final code — output the plan only.",
        q, signal
      ),
      new Promise((res) => setTimeout(() => res(""), 35000)),
    ]);
  } catch (_) { return ""; }
}

// Compact a session's NATIVE history when it grows past the budget: summarise the
// OLD turns with the cheap model and keep only the recent ones verbatim. The UI
// transcript is untouched — the user still sees everything; only the model payload
// shrinks (that's the token saving). No-op for agent mode (tool messages) or when
// disabled. Returns true if it compacted.
const COMPRESS_TRIGGER_CHARS = 28000; // ~7k tokens of native history → start compacting
const COMPRESS_KEEP_TAIL = 6;         // recent native messages always kept verbatim
let compressing = false;
async function maybeCompressSession(sess, sessMode, signal) {
  if (!settings.compressHistory || compressing) return false;
  if (sessMode === "agent") return false; // keep tool-call sequences intact
  const h = sess.history;
  if (!Array.isArray(h) || h.length <= COMPRESS_KEEP_TAIL + 2) return false;
  if (historyChars(h) < COMPRESS_TRIGGER_CHARS) return false;
  // Find a cut point that keeps the tail starting on a USER message (valid for both
  // wire formats), so we never break role alternation.
  let cut = Math.max(1, h.length - COMPRESS_KEEP_TAIL);
  while (cut < h.length && h[cut].role !== "user") cut++;
  if (cut >= h.length) return false;
  const older = h.slice(0, cut);
  const olderText = older.map((m) => {
    const c = m.content;
    const txt = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p && p.text || "").join(" ") : "";
    return `${m.role === "assistant" ? "Assistant" : "User"}: ${txt}`;
  }).join("\n").slice(0, 24000);
  if (!olderText.trim()) return false;
  let summary = "";
  try {
    compressing = true;
    const sel = settings.smartRouting ? utilitySelection() : currentSelection();
    summary = await runUtilityCompletion(
      sel,
      "You compress chat history. Produce a dense, faithful summary that preserves names, facts, decisions, code identifiers and open questions, so the assistant can continue seamlessly. No preamble.",
      `Summarise the earlier part of this conversation in under 200 words:\n\n${olderText}`,
      signal
    );
  } catch (_) {
    summary = ""; // on any failure, fall back to a local truncation below
  } finally {
    compressing = false;
  }
  if (!summary) summary = olderText.slice(0, 1500); // safe local fallback
  const note = `[Earlier conversation summary — older messages were compacted to save tokens]\n${summary}\n\n[End of summary]`;
  // Prepend the summary INTO the first kept (user) message so we don't introduce a
  // stray message that could break alternation on strict APIs.
  const tail = h.slice(cut);
  const first = tail[0];
  if (typeof first.content === "string") {
    first.content = note + "\n\n" + first.content;
  } else if (Array.isArray(first.content)) {
    const ti = first.content.findIndex((p) => p && p.type === "text");
    if (ti >= 0) first.content[ti] = { ...first.content[ti], text: note + "\n\n" + first.content[ti].text };
    else first.content.unshift({ type: "text", text: note });
  }
  sess.history = tail;
  if (mode === sessMode) history = sess.history; // keep the live global pointing at the compacted array
  if (mode === sessMode) addMessage("tool", t("ctx.compacted"));
  return true;
}

function pageContextBlock() {
  if (!currentPage) return "";
  const ctx = cleanText((currentPage.text || "")).slice(0, settings.maxPageChars);
  return (
    `[Active page context]\nTitle: ${currentPage.title}\nURL: ${currentPage.url}\n` +
    (currentPage.description ? `Description: ${currentPage.description}\n` : "") + `${ctx}\n\n`
  );
}
async function getSelection() {
  try {
    const sel = await executeTool("read_selection", {}, {});
    return (sel && sel.selection) || "";
  } catch (_) { return ""; }
}
function startBusy() {
  busy = true;
  els.stop.classList.remove("hidden"); // Stop button appears while streaming (no Send button — Enter sends)
  const cb = document.querySelector(".composer-box");
  if (cb) cb.classList.add("is-busy"); // AI working → coloured frame (animation only when focused)
  abortController = new AbortController();
}
function endBusy() {
  els.stop.classList.add("hidden");
  const cb = document.querySelector(".composer-box");
  if (cb) cb.classList.remove("is-busy");
  abortController = null;
  busy = false;
}
// ── 🎙 Voice input — 100% FREE, no API credits. Uses the browser's built-in SpeechRecognition
// when available (Chrome/Edge), otherwise the OS's NATIVE voice typing (Windows Win+H, macOS
// Dictation, Linux desktop dictation), which types straight into the focused composer. We never
// call a paid transcription API.
let _recog = null, _dictating = false, _mediaRec = null, _mediaStream = null;
function dictationLang() { return getLang() === "fr" ? "fr-FR" : "en-US"; }
// How to transcribe the recording: Whisper (Groq free / OpenAI) when connected, otherwise via an
// audio-capable CHAT model on OpenRouter (Gemini) so the mic works with just the OpenRouter key.
function transcriptionMethod() {
  if (!currentKeyMissing("groq")) return { kind: "whisper", provider: "groq" };
  if (!currentKeyMissing("openai")) return { kind: "whisper", provider: "openai" };
  if (!currentKeyMissing("openrouter")) return { kind: "chat", provider: "openrouter" };
  return null;
}
function toggleDictation() {
  if (_dictating) {
    // Stop whichever path is running. Stopping the recorder triggers transcription (onstop).
    try { if (_mediaRec && _mediaRec.state !== "inactive") { _mediaRec.stop(); return; } } catch (_) {}
    try { _recog && _recog.stop(); } catch (_) {}
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) { startSrDictation(SR); return; }   // free on-device recognition (Chrome/Edge)
  // No in-browser recognition (e.g. Firefox) → record the mic and transcribe via the user's own
  // Whisper-capable key (Groq is free). Falls back to the OS voice-typing hint if none is connected.
  startMediaDictation();
}
// Recording fallback: capture the mic, then transcribe with the connected Whisper provider.
async function startMediaDictation() {
  const tMethod = transcriptionMethod();
  if (!tMethod) { flashTopBanner(t("dictate.needKey")); els.input.focus(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    flashTopBanner(t("dictate.micUnavailable")); els.input.focus(); return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) {
    const nm = (e && (e.name || e.message)) || "";
    if (/NotFound|Devices|Overconstrained/i.test(nm)) {
      flashTopBanner(t("dictate.micNone"));
    } else {
      // The mic prompt doesn't appear in the sidebar/side panel → open a normal tab that DOES prompt;
      // once granted (with "remember"), getUserMedia works from the sidebar too.
      try { browser.tabs.create({ url: browser.runtime.getURL("src/permission/mic.html") }); } catch (_) {}
      flashTopBanner(t("dictate.micGrant"));
    }
    return;
  }
  _mediaStream = stream;
  let rec;
  // Pick a mimeType the browser actually supports (Firefox = ogg/opus, Chrome = webm) so recording
  // never silently fails; fall back to the default if none report supported.
  const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
  const pick = (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported)
    ? CANDIDATES.find((tp) => MediaRecorder.isTypeSupported(tp))
    : null;
  try { rec = pick ? new MediaRecorder(stream, { mimeType: pick }) : new MediaRecorder(stream); }
  catch (_) {
    try { rec = new MediaRecorder(stream); }
    catch (e2) { stream.getTracks().forEach((tr) => tr.stop()); _mediaStream = null; flashTopBanner(t("dictate.failed")); return; }
  }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = async () => {
    try { _mediaStream && _mediaStream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    _mediaStream = null; _mediaRec = null;
    stopDictationUI();
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    if (!blob.size) return;
    flashTopBanner(t("dictate.transcribing"));
    try {
      const text = tMethod.kind === "whisper"
        ? await transcribeAudio({ ...settings, provider: tMethod.provider }, blob)
        : await transcribeAudioViaChat({ ...settings }, blob);
      if (text && text.trim()) {
        const base = els.input.value;
        const sep = base && !/\s$/.test(base) ? " " : "";
        els.input.value = base + sep + text.trim();
        autoGrow(); els.input.focus();
      } else { flashTopBanner(t("dictate.empty")); }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      flashTopBanner(t("dictate.failed") + (msg ? " — " + msg.slice(0, 140) : ""));
    }
  };
  _mediaRec = rec;
  rec.start();
  _dictating = true;
  if (els.dictateBtn) { els.dictateBtn.classList.add("active"); els.dictateBtn.setAttribute("aria-pressed", "true"); }
  flashTopBanner(t("dictate.listening"));
}
// Native OS dictation hint (free, built into Windows/macOS/Linux — types into the focused field).
function osDictationHint() {
  const p = (navigator.platform || navigator.userAgent || "").toLowerCase();
  if (p.includes("win")) return t("dictate.osWin");
  if (p.includes("mac") || p.includes("iphone") || p.includes("ipad")) return t("dictate.osMac");
  if (p.includes("linux") || p.includes("x11")) return t("dictate.osLinux");
  return t("dictate.osGeneric");
}
// On-device path (browsers that ship SpeechRecognition).
function startSrDictation(SR) {
  try {
    _recog = new SR();
    _recog.lang = dictationLang();
    _recog.interimResults = true;
    _recog.continuous = true;
    const base = els.input.value;
    _recog.onresult = (e) => {
      let finalTxt = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript;
        else interim += r[0].transcript;
      }
      const sep = base && !/\s$/.test(base) ? " " : "";
      els.input.value = base + sep + (finalTxt || interim);
      autoGrow();
    };
    _recog.onerror = (e) => {
      const err = e && e.error;
      if (err === "not-allowed") { flashTopBanner(t("dictate.micDenied")); stopDictationUI(); return; }
      // On-device recognition unavailable (needs Google servers / blocked / offline) → fall back to
      // RECORDING the mic and transcribing via the user's own AI, so the mic works cross-platform.
      if ((err === "network" || err === "service-not-allowed") && transcriptionMethod()) {
        stopDictationUI();
        startMediaDictation();
        return;
      }
      if (err && err !== "no-speech" && err !== "aborted") flashTopBanner(t("dictate.failed"));
      stopDictationUI();
    };
    _recog.onend = () => stopDictationUI();
    _recog.start();
    _dictating = true;
    els.dictateBtn.classList.add("active");
    els.dictateBtn.setAttribute("aria-pressed", "true");
    els.input.focus();
  } catch (_) { stopDictationUI(); }
}
function stopDictationUI() {
  _dictating = false;
  if (els.dictateBtn) { els.dictateBtn.classList.remove("active"); els.dictateBtn.setAttribute("aria-pressed", "false"); }
  _recog = null;
}

// Optional "answer ready" chime — a short two-note tone synthesised with the Web Audio API
// (no asset to ship). Off by default; toggled by the top-bar 🔔 button (and persisted).
let _audioCtx = null;
function getAudioCtx() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  } catch (_) { return null; }
  return _audioCtx;
}
function emitChime(ctx) {
  const now = ctx.currentTime;
  [[880, 0], [1320, 0.12]].forEach(([freq, at]) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.14, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now + at); osc.stop(now + at + 0.18);
  });
}
function maybePlayDone() {
  if (!settings.soundOnDone) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    // The context is often SUSPENDED by the time an answer finishes (no recent gesture).
    // resume() is async, so we must schedule the notes only AFTER it resolves — scheduling
    // immediately against a suspended clock is why the chime was silent at the end of a reply.
    if (ctx.state === "suspended") ctx.resume().then(() => emitChime(ctx)).catch(() => {});
    else emitChime(ctx);
  } catch (_) { /* audio not available — ignore */ }
}
// Unlock/keep the audio context warm on the user's first gesture so the end-of-answer chime
// can fire later without a gesture (browsers block a cold context outside a user interaction).
function unlockAudioOnce() {
  if (!settings.soundOnDone) return;
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

// ----- Per-message comparison ----------------------------------------------
// Add a "compare with another model" bar under the latest assistant answer.
// Remember the comparison model PER TAB (mode), so each tab reopens with its last choice.
function saveCompareModel(v) {
  if (!v) return;
  const map = { ...(settings.compareModels || {}) };
  if (map[mode] === v) return;
  map[mode] = v;
  settings.compareModels = map;
  setSettings({ compareModels: map });
}
// 👍/👎 per-answer rating → a per-model NET score (likes − dislikes) kept locally. It feeds the
// "auto" picker (🏆 best-rated). Clicking the same thumb again UNDOES it (fix a mis-click); clicking
// the opposite thumb switches the vote. Zero scores are dropped so the tally stays clean.
function applyVote(modelSel, delta) {
  if (!modelSel || !delta) return;
  const votes = { ...(settings.modelVotes || {}) };
  votes[modelSel] = (votes[modelSel] || 0) + delta;
  if (votes[modelSel] === 0) delete votes[modelSel];
  settings.modelVotes = votes;
  setSettings({ modelVotes: votes });
}
const THUMB_UP_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v11"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
const THUMB_DOWN_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V3"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
function voteButtons(el) {
  const wrap = document.createElement("span");
  wrap.className = "cmp-rate";
  const up = document.createElement("button");
  up.type = "button"; up.className = "cmp-vote cmp-like"; setHTML(up, THUMB_UP_SVG); up.title = t("vote.like");
  const down = document.createElement("button");
  down.type = "button"; down.className = "cmp-vote cmp-dislike"; setHTML(down, THUMB_DOWN_SVG); down.title = t("vote.dislike");
  const sync = () => {
    up.classList.toggle("on", el._vote === "up");
    down.classList.toggle("on", el._vote === "down");
    up.disabled = down.disabled = !el._modelSel;
  };
  const vote = (dir) => {
    const sel = el._modelSel; if (!sel) return;
    const cur = el._vote || null;
    if (cur === dir) { applyVote(sel, dir === "up" ? -1 : +1); el._vote = null; }       // undo
    else {
      if (cur === "up") applyVote(sel, -1); else if (cur === "down") applyVote(sel, +1); // clear old
      applyVote(sel, dir === "up" ? +1 : -1); el._vote = dir;                            // apply new
    }
    sync();
  };
  up.addEventListener("click", () => vote("up"));
  down.addEventListener("click", () => vote("down"));
  sync();
  wrap.appendChild(up); wrap.appendChild(down);
  return wrap;
}

// A searchable model dropdown for the compare bar — same combobox as the main picker, so the SEARCH
// lives INSIDE the list (at the top), not beside it. The menu floats on <body> (fixed).
function makeCompareCombo(initialValue) {
  const wrap = document.createElement("div");
  wrap.className = "combo cmp-combo";
  const input = document.createElement("input");
  input.className = "combo-input cmp-combo-input"; input.type = "text"; input.readOnly = true; input.spellcheck = false;
  const caret = document.createElement("span"); caret.className = "combo-caret"; caret.textContent = "▾";
  wrap.appendChild(input); wrap.appendChild(caret);
  const menu = document.createElement("div"); menu.className = "combo-menu cmp-combo-menu hidden";
  document.body.appendChild(menu);
  let value = initialValue || "";
  const combo = makeCombo({
    input, menu,
    items: () => chatComboItems(),
    getValue: () => value,
    onPick: (v) => { value = v; },
  });
  combo.refresh(); // fill the trigger label with the current model
  return { wrap, menu, combo, get value() { return value; }, set value(v) { value = v; combo.refresh(); } };
}

const COMPARE_GLYPH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/><path d="M18 3v12a9 9 0 0 1-9-9"/></svg>';
// Compare = a small ICON in the answer's action bar (next to copy/M/mindmap/delete). Clicking it opens
// a POPUP with the model picker(s) + a Compare button — no more full inline bar under the message.
function attachCompareBar(el) {
  els.messages.querySelectorAll(".msg-actions").forEach((n) => n.remove()); // legacy inline compare bars
  document.querySelectorAll(".cmp-popup, .cmp-combo-menu").forEach((n) => n.remove());
  document.querySelectorAll(".mact.mcompare").forEach((n) => n.remove()); // only the LAST answer keeps it
  if (!el || !lastUserContent) return;

  const items = chatComboItems();
  const firstOther = ((items.find((x) => x.value && x.value !== mainValue) || items[0]) || {}).value || "";
  const comboAValue = (settings.compareModels || {})[mode] || firstOther;
  const comboA = makeCompareCombo(comboAValue);
  // The 2nd model defaults to a DIFFERENT one than the 1st — prefer 🎁 Free (a strong ⇄ free compare).
  const FREE_VAL = "openrouter|hivey/free";
  const secondDefault =
    comboAValue !== FREE_VAL && items.some((x) => x.value === FREE_VAL)
      ? FREE_VAL
      : ((items.find((x) => x.value && x.value !== comboAValue) || {}).value || firstOther);
  const comboB = makeCompareCombo(secondDefault);
  comboB.wrap.classList.add("hidden");

  const addBtn = document.createElement("button");
  addBtn.className = "cmp-add"; addBtn.type = "button"; addBtn.textContent = "+"; addBtn.title = t("compare.add");
  addBtn.addEventListener("click", () => {
    const showing = !comboB.wrap.classList.toggle("hidden");
    addBtn.classList.toggle("on", showing);
    addBtn.textContent = showing ? "−" : "+";
    addBtn.title = showing ? t("compare.remove") : t("compare.add");
  });

  const runBtn = document.createElement("button");
  runBtn.className = "cmp-btn";
  runBtn.textContent = t("compare.btn");
  runBtn.addEventListener("click", () => {
    saveCompareModel(comboA.value);
    const list = [parseSel(comboA.value)];
    if (!comboB.wrap.classList.contains("hidden") && comboB.value && comboB.value !== comboA.value) list.push(parseSel(comboB.value));
    popup.classList.add("hidden");
    compareRun(list, runBtn);
  });

  // The popup (fixed on <body>, so it's never clipped by the message).
  const popup = document.createElement("div");
  popup.className = "cmp-popup hidden";
  const head = document.createElement("div"); head.className = "cmp-popup-head"; head.textContent = t("compare.with");
  const row = document.createElement("div"); row.className = "cmp-popup-row";
  row.appendChild(comboA.wrap); row.appendChild(comboB.wrap); row.appendChild(addBtn);
  popup.appendChild(head); popup.appendChild(row); popup.appendChild(runBtn);
  document.body.appendChild(popup);

  // The compare ICON, added to the answer's hover action bar (or the answer itself as a fallback).
  const icon = makeActBtn("mcompare", COMPARE_GLYPH, t("compare.title"), (b) => {
    if (!popup.classList.contains("hidden")) { popup.classList.add("hidden"); return; }
    popup.classList.remove("hidden");
    const r = b.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popup.offsetWidth - 8)) + "px";
    const mh = popup.offsetHeight, above = r.top - 6 - mh;
    popup.style.top = (above > 8 ? above : Math.min(r.bottom + 6, window.innerHeight - mh - 8)) + "px";
    // Don't close when the click lands in one of the combo dropdowns (they're rendered on <body>,
    // OUTSIDE the popup) — otherwise picking a model would close the compare popup.
    const closer = (e) => { if (popup && !popup.contains(e.target) && !(e.target.closest && e.target.closest(".cmp-combo-menu")) && e.target !== b && !b.contains(e.target)) { popup.classList.add("hidden"); document.removeEventListener("mousedown", closer); } };
    setTimeout(() => document.addEventListener("mousedown", closer), 0);
  });
  const actbar = el.querySelector(":scope > .mact-bar.assistant");
  if (actbar) actbar.insertBefore(icon, actbar.firstChild);
  else el.appendChild(icon);
}

// Run the SAME last prompt on one or more other models, in sequence, appending each answer.
async function compareRun(list, btn) {
  if (busy || !lastUserContent || !list.length) return;
  btn.disabled = true;
  startBusy();
  try {
    for (const orig of list) {
      // Resolve a Hivey pseudo-variant (hivey/smart|hybrid|free) to the REAL model it routes to for
      // this task — never send "hivey/hybrid" raw to OpenRouter (→ 400 "not a valid model ID").
      const second = resolveHivey(orig, lastRunMode, lastUserContent);
      if (currentKeyMissing(second.providerId)) {
        addMessage("error", t("err.keyMissingFor", { label: PROVIDERS[second.providerId].label }));
        continue;
      }
      let cmpPending = null;
      const badge = `${PROVIDERS[second.providerId].label} · ${second.modelId}`;
      try {
        const provider = makeProvider(
          { ...settings, provider: second.providerId, models: { ...settings.models, [second.providerId]: second.modelId } },
          { thinkLevel: getThink(els.thinking), webSearch: els.webSearch.checked || lastForceWeb }
        );
        const system = buildSystemPrompt({ agentMode: false, targetLang: settings.targetLang, responseLang: settings.responseLang, mode: lastRunMode, blockPayments: settings.blockPayments, artifacts: els.artifactMode.checked, thinkLevel: getThink(els.thinking) });
        cmpPending = addPendingIndicator();
        const sink = makeSink(badge, getThink(els.thinking) !== "off", cmpPending);
        await runConversation({ provider, system, history: [{ role: "user", content: lastUserContent }], tools: [], onText: sink.onText, onThink: sink.onThink, signal: abortController.signal });
        sink.finalize();
        if (sink.getRaw()) transcript.push({ role: "assistant", text: `**${badge}**\n\n${sink.getRaw()}` });
        const cmpEl = sink.getEl();
        if (cmpEl) { cmpEl._raw = sink.getRaw(); cmpEl._modelSel = `${second.providerId}|${second.modelId}`; }
        attachCompareBar(cmpEl); // allow comparing/voting again on the newest answer
      } catch (e) {
        removePending(cmpPending);
        showRunError(second.providerId, e, second.modelId);
      } finally {
        removePending(cmpPending);
      }
    }
  } finally {
    endBusy();
    btn.disabled = false;
    await saveCurrent();
  }
}

// ----- Core send ------------------------------------------------------------
async function sendToModel(displayText, modelContent, { forceWeb = false, runMode = "chat", attImgs = [], attMeta = [], reuseUserEl = null, versioned = false } = {}) {
  if (busy) return;
  const sel = currentSelection();
  if (currentKeyMissing(sel.providerId)) {
    addMessage("error", t("err.noKeyModel"));
    return;
  }
  // Remember the last-used provider + model as the default for next time
  // (single atomic write — see applyModelChoice).
  if (sel.providerId && sel.modelId) {
    settings.provider = sel.providerId;
    settings.models = { ...(settings.models || {}), [sel.providerId]: sel.modelId };
    setSettings({ provider: sel.providerId, models: settings.models });
  }
  // Bind this send to the conversation that is active RIGHT NOW. If the user
  // switches workspace/discussion while the answer is still streaming, the globals
  // get re-pointed — but we keep pushing into THIS session, so the AI's answer is
  // never lost or misrouted (that's the "Chat loses responses on switch" fix).
  const sess = getSession(mode);
  const sessMode = mode;
  // Bind THIS run to stable refs (convId + arrays) captured now. If the user starts a new conversation
  // or switches tabs mid-run, the session's live arrays get reassigned — but this run keeps writing to
  // and saving into ITS OWN conversation, so the answer is never lost or mixed into another thread.
  const boundConvId = convId;
  const boundTranscript = sess.transcript;
  const boundHistory = sess.history;
  const boundSess = () => ({ convId: boundConvId, transcript: boundTranscript, history: boundHistory, customTitle: sess.customTitle, importedSources: sess.importedSources });
  let userDiv;
  if (reuseUserEl) {
    // Editing an existing turn: reuse its bubble (don't add a second one or a duplicate transcript
    // entry) — just refresh its visible text. The new answer becomes a new VERSION below.
    userDiv = reuseUserEl;
    setUserText(userDiv, displayText);
  } else {
    userDiv = addMessage("user", displayText, sessMode);
    if (attMeta && attMeta.length) renderUserAttachments(userDiv, attMeta);
    attachUserActions(userDiv, displayText);
    boundTranscript.push({ role: "user", text: displayText, atts: attMeta && attMeta.length ? attMeta : undefined });
  }
  userDiv._modelContent = modelContent;
  lastUserContent = modelContent;
  lastRunMode = runMode;
  lastForceWeb = forceWeb;
  startBusy();

  const wantWeb = els.webSearch.checked || forceWeb;
  const agentMode = agentActive();

  // Web-search routing: send the turn to a dedicated web-capable model (Perplexity
  // Sonar, or a free OpenRouter model with the "web" plugin) instead of e.g. Claude.
  // When that model lives on a DIFFERENT provider we run it as an isolated single
  // turn, so two providers' native message formats never get mixed in the shared
  // history. (Skipped in agent mode, which keeps its tools on the chosen model.)
  // 🐝 Hivey: route this turn to the best model for the task (cheap for simple chat,
  // premium for hard reasoning, an affordable strong model for the agent, etc.).
  // Effective mode for Hivey: the agent flag wins, then the per-call runMode
  // (translate/improve route deterministically; chat goes through the LLM router).
  const hiveyMode = agentMode ? "agent" : runMode;
  const hid = isHivey(sel.modelId) ? sel.modelId : null;
  // 🐝 Evolving workflow status (Analyse → Search/Plan → Generate → Check → Fix).
  const hstep = hid ? makeStepStatus(sessMode) : null;
  if (hstep) hstep.set(t("step.analyze"));
  const routed = await resolveHiveyRouted(sel, hiveyMode, modelContent, abortController && abortController.signal);
  let turnSel = routed.sel;
  let tierKey = routed.tierKey;
  let isolated = false;
  let webPlugin = wantWeb; // whether the FINAL model runs the web plugin itself
  let badge = hid ? "🐝 " + prettifyORName({ id: turnSel.modelId }) : null;

  // 🐝 Hivey VISION: an image is attached → route to the variant's multimodal model,
  // because the cheap text models (DeepSeek, Llama…) can't see images.
  if (hid && attImgs && attImgs.length && !agentMode) {
    turnSel = ensureUsable(parseSel(hiveyTiers(hid).vision || hiveyTiers(hid).chat), hid);
    tierKey = "vision";
    badge = "🐝 " + prettifyORName({ id: turnSel.modelId }) + " 👁";
  }

  // Web search for NON-Hivey models: send the turn to a dedicated web-capable model.
  if (wantWeb && !agentMode && !hid) {
    const ss = parseSel(settings.searchModel || defaultSearchModel(settings));
    if (ss.providerId && !currentKeyMissing(ss.providerId) &&
        (ss.providerId !== turnSel.providerId || ss.modelId !== turnSel.modelId)) {
      turnSel = ss;
      isolated = true;
      const lbl = PROVIDERS[ss.providerId] ? PROVIDERS[ss.providerId].label : ss.providerId;
      badge = t("badge.web", { label: lbl, model: ss.modelId });
    }
  }

  // 🐝 Hivey ORCHESTRATION — combine several models in ONE request: a cheap model does
  // the grunt work, the smart routed model does the thinking. Pure chat turns only.
  if (hid && !agentMode && tierKey !== "vision" && runMode !== "translate" && runMode !== "improve") {
    const T = hiveyTiers(hid);
    if (wantWeb) {
      // (a) Web: a small fast model gathers facts + sources, the routed model analyses.
      if (hstep) hstep.set(t("step.search"));
      const fetched = await hiveyWebFetch(hid, modelContent, abortController.signal);
      if (fetched) {
        modelContent = "[Web research gathered for you by a fast search model — analyse it critically and answer, citing the sources]\n" +
          fetched + "\n\n[User request]\n" + modelContent;
        webPlugin = false; // already researched; no need to pay for the plugin again
        badge = "🐝 " + prettifyORName({ id: parseSel(T.search).modelId }) + " 🔎 → " + prettifyORName({ id: turnSel.modelId }) + " 🧠";
      }
      // If the fetch failed, keep webPlugin=true so the routed model still searches.
    } else if (tierKey === "code" && T.codePlanner && T.codeWriter) {
      // (b) Code: the senior model DESIGNS the solution, a cheaper model WRITES it.
      if (hstep) hstep.set(t("step.plan"));
      const plan = await hiveyCodePlan(hid, modelContent, abortController.signal);
      if (plan) {
        modelContent = "[Senior engineer's implementation plan — follow it exactly and write COMPLETE, correct, runnable code; do not omit anything]\n" +
          plan + "\n\n[User request]\n" + modelContent;
        turnSel = parseSel(T.codeWriter);
        badge = "🐝 " + prettifyORName({ id: parseSel(T.codePlanner).modelId }) + " 🧠 → " + prettifyORName({ id: turnSel.modelId }) + " ✍️";
      }
    }
  }

  // 🐝 PARALLEL WEB RESEARCH — ONLY in INTERACTION MODE (explicit opt-in). It used to run on every
  // Hivey agent task, which slowed runs down and sometimes injected off-topic/hallucinated material
  // into the agent's context. Now it only runs when the user enabled Interaction mode (where the
  // agent is meant to present researched options before acting). One pass, capped at 22 s, fails open.
  if (agentMode && settings.agentInteractive) {
    if (hstep) hstep.set(t("step.search"));
    const researchSel = hid
      ? parseSel(hiveyTiers(hid).search)
      : parseSel(settings.searchModel || defaultSearchModel(settings));
    // The internet agent ALSO reads the current page (like the "Page" tool) so it can summarise what
    // the user is looking at and hand that to the main agent for the decision.
    let pageText = "";
    try {
      if (!currentPage) await refreshCurrentPage();
      if (currentPage) pageText = cleanText(currentPage.text || "").slice(0, 6000);
    } catch (_) {}
    const researchInput =
      (displayText || modelContent) +
      (pageText ? `\n\n[Current page: ${currentPage ? currentPage.title || currentPage.url : ""}]\n${pageText}` : "");
    const research = await webResearchWith(researchSel, researchInput, abortController && abortController.signal, true);
    if (research) {
      modelContent =
        "[Internet agent (ran in parallel): it READ the current page and researched the web, returning a SHORT page summary + SEVERAL candidate options/sources. Use this as your evidence to decide; do not tunnel on the first obvious choice. Verify on the live page before acting.]\n" +
        research +
        "\n\n[User request]\n" +
        modelContent;
    }
  }

  // Agent-model override: tool calling fails on many fast/free models (e.g. Llama),
  // so the user can pin a tool-capable model for agent mode in Settings. The agent
  // keeps the shared history (multi-turn tool loop), so it is NOT isolated.
  if (agentMode && settings.agentModel) {
    const as = parseSel(settings.agentModel);
    if (as.providerId && !currentKeyMissing(as.providerId)) {
      turnSel = as;
      if (as.providerId !== sel.providerId || as.modelId !== sel.modelId) {
        const lbl = PROVIDERS[as.providerId] ? PROVIDERS[as.providerId].label : as.providerId;
        badge = t("badge.agent", { label: lbl, model: as.modelId });
      }
    }
  }

  // With image attachments, switch the user turn to the provider's multimodal
  // content array (vision). Text-file attachments are already folded into modelContent.
  const userContent = buildUserContent(modelContent, attImgs, turnSel.providerId);
  let turnHistory;
  if (isolated) {
    turnHistory = [{ role: "user", content: userContent }];
  } else {
    // Token saving: summarise older turns before this one when the thread is long.
    await maybeCompressSession(sess, sessMode, abortController && abortController.signal);
    boundHistory.push({ role: "user", content: userContent });
    turnHistory = boundHistory;
  }
  // 🐝 Hivey auto-thinking: spend a reasoning budget ONLY on the reasoning tier (where it pays
  // off), never on cheap/utility turns. The user's manual Thinking choice still wins if higher.
  const effThink = hid ? hiveyThink(tierKey, getThink(els.thinking)) : getThink(els.thinking);
  let provider = makeProvider(
    { ...settings, provider: turnSel.providerId, models: { ...settings.models, [turnSel.providerId]: turnSel.modelId } },
    { thinkLevel: effThink, webSearch: webPlugin }
  );
  const system = buildSystemPrompt({ agentMode, targetLang: settings.targetLang, responseLang: settings.responseLang, mode: runMode, blockPayments: settings.blockPayments, artifacts: els.artifactMode.checked, thinkLevel: effThink, skill: activeSkill ? activeSkill.system : "", goal: goalMode ? GOAL_SYSTEM : "", interactive: agentMode && !!settings.agentInteractive, region: userRegion() });
  const tools = activeTools({ agentMode });
  if (hstep) hstep.set(t("step.generate"));
  const pending = addPendingIndicator(sessMode);
  const sink = makeSink(badge, getThink(els.thinking) !== "off", pending, sessMode);
  // Agent mode: collapse the agent's tool calls into ONE foldable "Actions" block for
  // a cleaner, more immersive run — the steps are hidden but consultable on click.
  const agentActs = agentMode ? makeAgentActions() : null;
  if (agentMode) {
    if (agentActs) agentActs.open(); // show the "Working…" control frame immediately (don't wait for tool #1)
    await ensureAgentTab(); // 🔒 dedicate ONE background tab to THIS conversation (created/reused)
    agentGlowActiveTab();   // glow the page border while the agent works
  }
  try {
    const runOnce = () => runConversation({
      provider, system, history: turnHistory, tools,
      onText: sink.onText, onThink: sink.onThink,
      onToolStart: (call) => {
        sink.finalize();
        if (agentMode) agentGlowActiveTab();
        if (agentActs) agentActs.start(call);
        else addMessage("tool", `→ ${call.name}(${JSON.stringify(call.input).slice(0, 80)})`, sessMode);
      },
      onToolEnd: (call, out) => {
        if (agentMode) agentGlowActiveTab();
        if (agentActs) agentActs.end(call, out);
        else addMessage("tool", out && out.blocked ? `   🛡 ${out.error}` : `   ${out && out.error ? "✗ " + out.error : "✓ ok"}`, sessMode);
      },
      // Agent permission: "manual" confirms EVERY action; "auto" (Allow, default) runs
      // freely but still confirms VERY SENSITIVE actions (downloads, reserve/book,
      // delete, sign-up, install…). confirmFn is therefore available in BOTH modes; the
      // anti-purchase guard applies in both too.
      confirmActions: settings.agentPermission !== "auto",
      confirmFn: agentMode ? confirmAction : null,
      guard: { blockPayments: settings.blockPayments },
      signal: abortController.signal,
      // Independent verifier (agent only): a separate, stateless model pass that re-reads the
      // page and judges whether the task is GENUINELY done — kills "thought it worked but didn't".
      verify: (agentMode && settings.agentVerify === true) ? async (hist, claimed) => {
        try {
          if (agentActs) agentActs.start({ name: "verify", input: {} });
          const page = await executeTool("read_page", {}, {}).catch(() => null);
          const vSys = "You are a STRICT independent verifier for a browser agent. Given the user's TASK, the agent's CLAIMED result and the CURRENT page, decide if the task is GENUINELY accomplished (not merely claimed). Reply EXACTLY 'PASS' when truly done, otherwise 'FAIL: <one short line — what is missing / what to do next>'. Never accept unverified success.";
          const vUsr = "TASK:\n" + text + "\n\nAGENT CLAIM:\n" + (claimed || "(none)") +
            "\n\nCURRENT PAGE:\n" + (page ? ((page.title || "") + " — " + (page.url || "") + "\n" + String(page.text || "").slice(0, 2500)) : "(unavailable)");
          const r = await provider.runTurn({ system: vSys, history: [{ role: "user", content: vUsr }], tools: [], onText: null, onThink: null, signal: abortController.signal });
          const o = ((r && r.text) || "").trim();
          const pass = /^\s*pass\b/i.test(o);
          if (agentActs) agentActs.end({ name: "verify" }, { ok: pass, error: pass ? null : "needs another pass" });
          return { pass, reason: o.replace(/^\s*fail:?\s*/i, "").slice(0, 300) };
        } catch (_) { return { pass: true }; } // never block the agent on a verifier hiccup
      } : null,
    });
    // 🐝 Hivey Free auto-rotation: free OpenRouter endpoints fail a LOT (rate limits, no
    // endpoint, transient 5xx, "model busy"…). Before any output, rotate to another free model
    // on ANY error — EXCEPT a data-policy gate, which is account-wide so trying other free
    // models would just repeat the same error (we surface the fix link for that one instead).
    let attempt = 0;
    while (true) {
      try { await runOnce(); break; }
      catch (runErr) {
        const kind = classifyOpenRouterError(turnSel.providerId, runErr && runErr.message);
        // NEVER replay an AGENT run: re-running the conversation re-executes its tools (it would
        // re-open YouTube / re-do actions, which looked like "it relaunched 5×"). Rotation here is
        // for output-less CHAT turns only; an agent turn that errors mid-run just surfaces it.
        if (!agentMode && hid === "hivey/free" && kind !== "policy" && kind !== "auth" && !sink.getRaw() && attempt < 5) {
          // 404 → genuinely dead, remove for the session; everything else → short cooldown.
          if (kind === "unavailable") orUnavailable.add(turnSel.modelId);
          else coolDown(turnSel.modelId);
          const next = ensureUsable(turnSel, hid); // now avoids the exhausted/cooled model
          if (!next || next.modelId === turnSel.modelId) throw runErr; // no alternative left
          turnSel = next;
          attempt++;
          lastRoutedModel = turnSel.modelId; // silent rotation — no thread message (#6)
          try { console.debug("[Hivey] rotated model →", turnSel.modelId); } catch (_) {}
          provider = makeProvider(
            { ...settings, provider: turnSel.providerId, models: { ...settings.models, [turnSel.providerId]: turnSel.modelId } },
            { thinkLevel: effThink, webSearch: webPlugin }
          );
          continue;
        }
        throw runErr;
      }
    }
    sink.finalize();
    markTabDone(sessMode, boundConvId); // dot on the workspace icon if the user has switched away
    if (sink.getRaw()) {
      maybePlayDone(); // optional "answer ready" chime (Settings → Appearance toggle)
      boundTranscript.push({ role: "assistant", text: sink.getRaw(), badge: badge || undefined });
      const ansIdx = sess.transcript.length - 1; // slot to REPLACE if it gets corrected
      const aEl = sink.getEl();
      if (aEl) { aEl._raw = sink.getRaw(); aEl._modelSel = sel.providerId && sel.modelId ? `${sel.providerId}|${sel.modelId}` : ""; attachAssistantActions(aEl, sink.getRaw); }
      // Versioning: tie this answer to its user bubble (non-agent chat turns) so an in-place edit
      // keeps the previous answer switchable via ‹ k/n › arrows. Fresh sends create version 0;
      // an edited resend (versioned) adds a new version.
      if (aEl && !agentMode) recordTurnVersion(userDiv, displayText, modelContent, aEl);
      if (mode === sessMode) attachCompareBar(aEl); // compare bar only if still on this tab
      // 🐝 Hivey verification + self-correction — double-check substantive answers
      // (facts, hallucinations, INCOMPLETE/truncated code). When the checker flags problems,
      // a STRONG model rewrites the answer; this repeats until it passes (cap 2 rounds). Runs
      // in the background so it never blocks the next message.
      // The PAID Hivey tiers (Smart / Hybrid) ALWAYS self-check & auto-correct — it's their
      // reliability promise, and their models are fast. Hivey FREE does NOT force it: on the free
      // tier verify+correct means 2–3 EXTRA calls to slow, rate-limited free models (the verifier is
      // itself a weak free model that over-flags, so it often regenerates/REPLACES the whole answer)
      // — which is exactly what made Free feel "super long to respond". Free honours the explicit
      // Verify chip only (OFF by default). Other (non-Hivey) models also honour that chip.
      // Skip the auto-verify (and its "✓ Verified by a low-cost model" badge) on the workshop tabs —
      // agent / translate / improve / image / pdf — where it isn't wanted.
      const verifyMode = !["agent", "translate", "improve", "image", "pdf"].includes(sessMode);
      const forceVerify = !!hid && hid !== "hivey/free"; // paid Hivey tiers only; Free stays fast
      // FREE models (Hivey Free or any ":free" model) NEVER auto-verify — even when the Verify chip is
      // ON: verify+correct means 2-3 EXTRA calls to slow, rate-limited free models with tight daily
      // token quotas ("les tokens partent trop vite"). Verification is disabled by default for Free.
      const freeTier = hid === "hivey/free" || /:free\b/i.test(String(turnSel || ""));
      if (aEl && verifyMode && !freeTier && tierKey !== "light" && tierKey !== "image" && (settings.verifyAnswers === true || forceVerify)) {
        const q = displayText, vSig = abortController && abortController.signal;
        // Verify works on ANY model now: a free model fact-checks; for a NON-Hivey model the
        // correction is regenerated by the SAME model the user picked (no quality downgrade).
        const vhid = hid || "hivey/free";
        const corrSel = hid ? null : turnSel;
        (async () => {
          let curEl = aEl, curRaw = sink.getRaw(), round = 0, corrected = false;
          try {
            while (round < 2 && curEl && curEl.isConnected) {
              if (hstep) hstep.set(t("step.verify"));
              const verdict = await hiveyVerify(vhid, q, curRaw, vSig);
              if (!verdict || /^\s*ok\b/i.test(verdict)) {
                const note = document.createElement("div");
                note.className = "hivey-verify ok";
                note.textContent = "✓ " + t("hivey.verified");
                curEl.appendChild(note);
                break;
              }
              // Issues found → regenerate a corrected answer and REPLACE the flawed one
              // (the previous message is deleted, not stacked below).
              if (hstep) hstep.set(t("step.correct"));
              const fixed = await hiveyCorrect(vhid, q, curRaw, verdict, tierKey, vSig, corrSel);
              if (!fixed || !fixed.trim()) break;
              const wrap = addMessage("assistant", "");
              const head = document.createElement("div");
              head.className = "hivey-verify ok";
              head.textContent = "🔁 " + t("hivey.corrected");
              wrap.appendChild(head);
              const body = document.createElement("div");
              setHTML(body, renderMarkdown(fixed));
              enhanceArtifacts(body);
              wrap.appendChild(body);
              wrap._raw = fixed; attachAssistantActions(wrap, () => fixed);
              sess.transcript[ansIdx] = { role: "assistant", text: fixed, badge: badge || undefined }; // replace, don't append
              if (curEl) curEl.remove(); // delete the previous (flawed) message
              if (mode === sessMode) attachCompareBar(wrap); // move the compare bar onto the fix
              curEl = wrap; curRaw = fixed; round++; corrected = true;
            }
          } catch (_) {}
          if (hstep) hstep.done();
          // Persist the corrected answer (the finally block already saved the original).
          if (corrected) { try { await saveSession(boundSess(), sessMode, sel); } catch (_) {} }
        })();
      } else if (hstep) { hstep.done(); }
    } else if (hstep) { hstep.done(); }
  } catch (e) {
    removePending(pending);
    if (hstep) hstep.done();
    showRunError(turnSel.providerId, e, turnSel.modelId);
  } finally {
    removePending(pending);
    if (agentActs) agentActs.finish(); // collapse the Actions block + show the final count
    if (agentMode) { clearAgentGlow(); clearAgentTab(); } // stop glow + unpin the agent's tab
    endBusy();
    await saveSession(boundSess(), sessMode, sel);
    // Keep an open history panel in sync (e.g. the new conversation gets its title).
    if (mode === sessMode && !els.historyPanel.classList.contains("hidden")) renderHistoryList();
  }
}

// ----- Send dispatch (per mode) ---------------------------------------------
async function onSend() {
  resetComposerHeight();
  if (mode === "translate") return runTranslateFromInput();
  if (mode === "improve") return runImproveFromInput();
  if (mode === "image") return runImageFromInput();
  if (mode === "wisebase") return onWisebaseSend();
  if (mode === "pdf") return onPdfSend();
  if (mode === "code") return; // Code workspace has no composer — use the launcher button.
  return onChatSend(); // chat + agent
}
async function onChatSend() {
  let text = els.input.value.trim();
  const { imgs, textBlock, meta } = takeAttachments();
  if (!text && !meta.length) return;
  els.input.value = "";
  clearAttachments();
  closePalette();
  // 🔎 DeepSearch — multi-step cited web research instead of a single answer (Chat tab only).
  if (els.deepSearch && els.deepSearch.checked && mode === "chat" && text) { return runDeepSearch(text); }
  // ✨ /enhance — a free model rewrites the prompt into a stronger one before sending.
  if (enhanceNext && text && !currentKeyMissing("openrouter")) {
    const note = addMessage("tool", t("cmd.enhancing"));
    try {
      const sel = ensureUsable(parseSel(hiveyTiers("hivey/free").utility || hiveyTiers("hivey/free").chat), "hivey/free");
      const better = await runUtilityCompletion(sel, ENHANCE_SYSTEM, text, null);
      if (better && better.trim().length > 4) text = better.trim();
    } catch (_) {}
    if (note) note.remove();
  }
  enhanceNext = false; renderCmdChips();
  let prefix = "";
  if (!agentActive()) {
    // Send a page's content only ONCE per conversation (it stays in history after
    // that), so follow-up questions don't re-pay for the same page text every turn.
    if (mode === "chat" && els.pageCtx.checked && currentPage) { // page reading is Chat-only now
      const sess = getSession(mode);
      const key = currentPage.url || "";
      if (!settings.cleanContext || !sess.pageCtxKeys.has(key)) {
        prefix += pageContextBlock();
        sess.pageCtxKeys.add(key);
      }
    }
    prefix += await selectedTabsContext();
  } else if (currentPage) {
    // Agent mode: silently hand it the page the user is on (no Page chip / popup — it's always
    // on) so it has that context for precision, on top of its read_page/extraction tools. Sent
    // once per page per conversation to avoid re-paying for the same text each turn.
    const sess = getSession(mode);
    const key = currentPage.url || "";
    if (!settings.cleanContext || !sess.pageCtxKeys.has(key)) {
      prefix += pageContextBlock();
      sess.pageCtxKeys.add(key);
    }
  }
  if (textBlock) prefix += textBlock; // attached files/PDFs folded in as context
  const body = text || (imgs.length ? "Please look at the attached image(s)." : "Please use the attached file(s).");
  const content = prefix ? prefix + `[Message]\n${body}` : body;
  await sendToModel(text, content, { attImgs: imgs, attMeta: meta, runMode: mode === "security" ? "security" : "chat" });
}
async function runTranslateFromInput() {
  const lang = els.translateLang.value || settings.targetLang || "French";
  let txt = els.input.value.trim();
  const { imgs, textBlock, meta } = takeAttachments();
  // Priority (per request): if NOTHING is typed and there's NO attachment, translate the live
  // WEBSITE in place. With a typed text or an attachment (screenshot / capture / file), translate
  // THAT instead.
  if (!txt && !imgs.length && !textBlock) {
    return translatePageInPlace(lang);
  }
  let displayText = txt;
  if (!txt && textBlock) txt = textBlock; // translate an attached file's text
  else if (textBlock && displayText) txt = `${txt}\n\n${textBlock}`; // typed text + attached file together
  if (!txt && !imgs.length) return addMessage("error", t("err.nothingToTranslateInput"));
  els.input.value = "";
  clearAttachments();
  await sendToModel(displayText, t("prompt.translate", { lang, text: txt || "(see attached image)" }), { runMode: "translate", attImgs: imgs, attMeta: meta });
}

// Parse a numbered translation reply ("12» translated text") back into { index: text }.
function parseNumberedTranslations(out) {
  const map = {};
  for (const ln of String(out || "").split(/\r?\n/)) {
    const m = ln.match(/^\s*(\d+)\s*[»:.)\]\-–]\s*(.*\S)\s*$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

// 🌐 Translate the CURRENT website in place: collect its text nodes (content script), translate
// them in batches with the model, and swap them back in the page. A floating toggle on the page
// flips between original and translation.
async function translatePageInPlace(lang) {
  if (busy) return;
  const tab = await getActiveTab();
  if (!tab) return addMessage("error", t("pick.error"));
  if (isRestrictedUrl(tab.url)) return addMessage("error", t("pick.restricted"));
  let collected;
  try { collected = await sendToTab(tab.id, { type: "tr_collect" }); }
  catch (_) { return addMessage("error", t("region.reload")); }
  if (collected === undefined) return addMessage("error", t("region.reload")); // stale content script
  const items = (collected && collected.items) || [];
  if (!items.length) return addMessage("error", t("err.noReadablePage"));

  addMessage("user", t("label.translatePageLive", { lang }));
  const status = addMessage("tool", "🐝 " + t("tr.translating", { done: 0, total: items.length }));
  startBusy();
  // Pick a capable model: the active Hivey variant's chat tier, else the user's current selection.
  let sel;
  try {
    const hid = activeHiveyId();
    sel = hid ? ensureUsable(parseSel(hiveyTiers(hid).chat), hid) : currentSelection();
  } catch (_) { sel = currentSelection(); }
  // Batch by character budget so each request stays small and fast.
  const chunks = [];
  let cur = [], curLen = 0;
  for (const it of items) {
    cur.push(it); curLen += (it.t ? it.t.length : 0) + 8;
    if (curLen > 2200 || cur.length >= 40) { chunks.push(cur); cur = []; curLen = 0; }
  }
  if (cur.length) chunks.push(cur);
  const labels = { orig: "↺ " + t("tr.showOriginal"), trans: "🐝 " + t("tr.showTranslated") };
  let done = 0, applied = 0;
  try {
    for (const chunk of chunks) {
      if (abortController && abortController.signal && abortController.signal.aborted) break;
      const numbered = chunk.map((it) => `${it.i}» ${String(it.t).replace(/\s+/g, " ")}`).join("\n");
      let out = "";
      try { out = await runUtilityCompletion(sel, t("tr.system", { lang }), numbered, abortController ? abortController.signal : null); }
      catch (_) { done += chunk.length; status.textContent = "🐝 " + t("tr.translating", { done, total: items.length }); continue; }
      const map = parseNumberedTranslations(out);
      if (Object.keys(map).length) {
        try { const r = await sendToTab(tab.id, { type: "tr_apply", map, labels }); if (r && r.applied) applied += r.applied; } catch (_) {}
      }
      done += chunk.length;
      status.textContent = "🐝 " + t("tr.translating", { done, total: items.length });
      scrollMessages();
    }
    status.remove();
    addMessage("tool", t("tr.done", { lang, n: applied }));
    markTabDone(mode);
    maybePlayDone();
  } catch (e) {
    status.remove();
    addMessage("error", t("err.translatePage", { msg: (e && e.message) || String(e) }));
  } finally {
    endBusy();
  }
}
async function runImproveFromInput() {
  const presetId = els.improvePreset.value || settings.improvePreset || "improve";
  let txt = els.input.value.trim();
  const { imgs, textBlock, meta } = takeAttachments();
  if (!txt) txt = await getSelection();
  if (!txt && textBlock) txt = textBlock; // improve an attached file's text
  else if (textBlock) txt = `${txt}\n\n${textBlock}`;
  if (!txt && !imgs.length) return addMessage("error", t("err.typeOrSelect"));
  els.input.value = "";
  clearAttachments();
  const instruction = improveInstruction(presetId, els.improveTone.value || settings.improveTone);
  // Show the user's own text as the message (not the preset label).
  await sendToModel(txt, `${instruction}\n${t("improve.only")}\n\n${t("improve.textLabel")}\n${txt}`, { runMode: "improve", attImgs: imgs, attMeta: meta });
}
async function runImageFromInput() {
  const prompt = els.input.value.trim();
  if (!prompt) return addMessage("error", t("err.describeImage"));
  // Every IN-CONTEXT image becomes an img2img source — one for a simple edit, several to
  // MIX/blend them. All attached images are included by default; untick one in the context
  // panel to leave it out of this generation.
  const initImages = attachments.filter((a) => a.type === "image" && a.ctxIncluded !== false).map((a) => a.dataUrl);
  // Captured AREAS arrive as images (img2img above); picked ELEMENTS also bring TEXT — fold that
  // text in as REFERENCE CONTEXT so the model can ground the image on what was captured.
  const refText = attachments
    .filter((a) => a.type !== "image" && a.ctxIncluded !== false && a.text)
    .map((a) => a.text)
    .join("\n\n")
    .slice(0, 6000);
  // Page reading is ON by default on the Image tab: feed the current page as reference context so
  // generations are grounded in what the user is looking at. (Disable with settings.imagePageCtx=false.)
  let pageRef = "";
  if (settings.imagePageCtx !== false) {
    if (!currentPage) await refreshCurrentPage();
    if (currentPage) pageRef = cleanText(currentPage.text || "").slice(0, 4000);
  }
  clearAttachments();
  els.input.value = "";
  const refBlock = [refText, pageRef && `[Current page: ${currentPage ? currentPage.title || currentPage.url : ""}]\n${pageRef}`].filter(Boolean).join("\n\n");
  const genPrompt = refBlock ? `${prompt}\n\n[Reference context — use it to ground the image]\n${refBlock}` : prompt;
  await runImage(prompt, initImages, genPrompt);
}

// ----- Quick actions / context menus ----------------------------------------
async function runQuickAction(action, providedText) {
  if (busy) return;
  const lang = settings.targetLang || "French";
  if (action === "image") {
    const prompt = providedText || els.input.value.trim();
    if (!prompt) { setMode("image"); els.input.focus(); return; }
    els.input.value = "";
    return runImage(prompt);
  }
  if (action === "summarize") {
    if (!currentPage) await refreshCurrentPage();
    if (!currentPage) return addMessage("error", t("err.noReadablePage"));
    return sendToModel(t("label.summarizePage"), pageContextBlock() + "[Task]\n" + inLang(t("prompt.summarizePage")));
  }
  if (action === "summarize-selection") {
    const txt = providedText || (await getSelection());
    if (!txt) return addMessage("error", t("err.nothingToSummarize"));
    return sendToModel(t("label.summarizeSel"), inLang(t("prompt.summarizeSel", { text: txt })));
  }
  if (action === "translate") {
    const txt = providedText || (await getSelection());
    // No selection → translate the whole WEBSITE in place; a selection → translate just that text.
    if (!txt) return translatePageInPlace(lang);
    return sendToModel(t("label.translateSel"), t("prompt.translate", { lang, text: txt }), { runMode: "translate" });
  }
  if (action === "improve") {
    const txt = providedText || (await getSelection());
    if (!txt) return addMessage("error", t("err.selectToImprove"));
    return sendToModel(t("label.improve"), t("prompt.improve", { text: txt }), { runMode: "improve" });
  }
  if (action === "explain") {
    const txt = providedText || (await getSelection());
    if (!txt) return addMessage("error", t("err.nothingToExplain"));
    return sendToModel(t("label.explain"), t("prompt.explain", { text: txt }));
  }
  if (action === "reply") {
    const txt = providedText || (await getSelection());
    if (!txt) return addMessage("error", t("err.noMessageToReply"));
    return sendToModel(t("label.reply"), t("prompt.reply", { lang, text: txt }));
  }
  if (action === "security" || action === "security-page") {
    let txt = providedText || (await getSelection());
    if (action === "security-page" || !txt) {
      if (!currentPage) await refreshCurrentPage();
      if (currentPage) txt = (txt ? txt + "\n\n" : "") + pageContextBlock();
    }
    if (!txt) return addMessage("error", t("err.nothingToAnalyze"));
    return sendToModel(
      t("label.security"),
      `${t("prompt.security")}\n\n${txt}`,
      { runMode: "security" },
    );
  }
}

// ----- Image generation -----------------------------------------------------
async function runImage(prompt, initImages, genPrompt) {
  const sessMode = mode, imgConvId = convId; // the tab + conversation this generation belongs to (for the "answer ready" dot if the user switches away)
  const genText = genPrompt || prompt; // generation prompt (may carry reference context); `prompt` is what we DISPLAY
  // Normalise to an array (back-compat: a single dataUrl string still works).
  const imgs = Array.isArray(initImages) ? initImages.filter(Boolean) : (initImages ? [initImages] : []);
  // 🐝 Hivey routes image generation to its variant's premium image model
  // (Nano Banana, or Nano Banana Pro on Premium) via OpenRouter.
  const hid = activeHiveyId();
  const himg = hid ? parseSel(hiveyTiers(hid).image) : null;
  const imgSettings = himg
    ? { ...settings, imageProvider: himg.providerId, imageModel: himg.modelId }
    : settings;
  if (currentKeyMissing(imgSettings.imageProvider || "openai")) {
    return addMessage("error", t("err.imageKeyMissing", { label: PROVIDERS[imgSettings.imageProvider || "openai"].label }));
  }
  const uDiv = addMessage("user", prompt, sessMode);
  attachUserActions(uDiv, prompt); // copy / edit / retry on hover, like the Improve tab
  transcript.push({ role: "user", text: prompt });
  lastUserContent = genText; // remember the generation prompt (incl. reference context) to regenerate/compare
  const status = addMessage("tool", t("image.generating") + (himg ? " (🐝 " + prettifyORName({ id: himg.modelId }) + ")" : ""), sessMode);
  startBusy();
  try {
    let urls;
    try {
      urls = await generateImage(imgSettings, { prompt: genText, size: els.imageSize.value, signal: abortController.signal, initImages: imgs });
    } catch (e1) {
      // Some image models can OUTPUT images but not accept image INPUT — OpenRouter then
      // returns "No endpoints found that support image input". Fall back to text-to-image so
      // the request still produces something, and tell the user to pick an img2img model.
      const m1 = (e1 && e1.message) || "";
      if (imgs.length && /image input|support image|no endpoints? found/i.test(m1)) {
        addMessage("tool", t("img.noInputSupport"), sessMode);
        urls = await generateImage(imgSettings, { prompt: genText, size: els.imageSize.value, signal: abortController.signal });
      } else {
        throw e1;
      }
    }
    status.remove();
    const wrap = addMessage("assistant", "", sessMode);
    for (const u of urls) {
      const img = document.createElement("img");
      img.src = u; img.alt = prompt; img.className = "gen-image";
      wrap.appendChild(img);
    }
    transcript.push({ role: "assistant", kind: "image", urls });
    attachImageCompareBar(wrap); // ⚖ compare the result with another image model
    markTabDone(sessMode, imgConvId); // dot on the Image tab if the user has switched to another tab meanwhile
    maybePlayDone();        // optional "answer ready" chime (Settings → Appearance toggle)
  } catch (e) {
    status.remove();
    addMessage("error", t("err.image", { msg: e && e.message ? e.message : String(e) }), sessMode);
  } finally {
    endBusy();
    await saveCurrent();
  }
}

// Image comparison: like the chat "compare" bar, but it regenerates the SAME
// prompt with another connected IMAGE model (cost colour-coded in the picker).
function attachImageCompareBar(el) {
  els.messages.querySelectorAll(".msg-actions").forEach((n) => n.remove());
  if (!el || !lastUserContent) return;
  const list = imageModelChoices();
  if (list.length < 2) return; // nothing to compare against
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const lbl = document.createElement("span");
  lbl.className = "cmp-lbl";
  lbl.textContent = t("compare.with");
  const sel = document.createElement("select");
  sel.className = "cmp-select";
  for (const [pid, mid, mlabel] of list) {
    const o = document.createElement("option");
    const tier = imagePriceTier(pid, mid);
    o.value = pid + "|" + mid;
    o.textContent = tier.emoji + " " + PROVIDERS[pid].label + " · " + mlabel;
    o.style.color = tier.color;
    sel.appendChild(o);
  }
  const cur = (settings.imageProvider || "openai") + "|" + (settings.imageModel || "");
  for (const opt of sel.options) {
    if (opt.value && opt.value !== cur) { sel.value = opt.value; break; }
  }
  const btn = document.createElement("button");
  btn.className = "cmp-btn";
  btn.textContent = t("compare.btn");
  btn.addEventListener("click", () => compareImage(parseSel(sel.value), btn));
  bar.appendChild(lbl);
  bar.appendChild(sel);
  bar.appendChild(btn);
  // Reuse the generated image as context (attach it + switch to chat) so the user
  // can iterate on it with a vision model instead of starting from scratch.
  const genImg = el.querySelector("img.gen-image");
  if (genImg) {
    const useBtn = document.createElement("button");
    useBtn.className = "cmp-iconbtn";
    useBtn.title = t("img.useCtx");
    useBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    useBtn.addEventListener("click", () => reuseImageAsContext(genImg.src));
    bar.appendChild(useBtn);
  }
  el.appendChild(bar);
}

// Attach a generated image as an image attachment and switch to chat, so a vision
// model can see it for the next prompt (iterative editing / photo edits).
async function reuseImageAsContext(src) {
  try {
    let dataUrl = src;
    let mediaType = "image/png";
    if (src.startsWith("data:")) {
      const m = /^data:([^;]+)/.exec(src);
      if (m) mediaType = m[1];
    } else {
      const blob = await (await fetch(src)).blob();
      mediaType = blob.type || "image/png";
      dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    }
    attachments.push({ type: "image", name: t("img.reusedName"), dataUrl, mediaType });
    // Stay on the current tab (e.g. Image) so the user can edit the image in place
    // (img2img); the attached image becomes the edit source for the next generation.
    renderAttachStrip();
    addMessage("tool", t("img.reused"));
    els.input.focus();
  } catch (e) {
    addMessage("error", t("err.image", { msg: e && e.message ? e.message : String(e) }));
  }
}

// ----- Image lightbox (click a generated image to enlarge) ------------------
let lightboxEl = null;
function closeLightbox() {
  if (lightboxEl) { lightboxEl.remove(); lightboxEl = null; }
}
function openLightbox(src, name) {
  closeLightbox();
  const ov = document.createElement("div");
  ov.className = "lightbox";
  ov.addEventListener("click", closeLightbox);
  const tb = document.createElement("div");
  tb.className = "lb-toolbar";
  const dl = document.createElement("a");
  dl.className = "lb-btn";
  dl.href = src;
  dl.download = name || "image.png";
  dl.title = t("lb.download");
  dl.addEventListener("click", (e) => e.stopPropagation());
  dl.innerHTML =
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  const cl = document.createElement("button");
  cl.className = "lb-btn";
  cl.title = t("close.title");
  cl.addEventListener("click", closeLightbox);
  cl.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  tb.appendChild(dl);
  tb.appendChild(cl);
  const img = document.createElement("img");
  img.className = "lb-img";
  img.src = src;
  img.alt = name || "";
  img.addEventListener("click", (e) => e.stopPropagation());
  ov.appendChild(tb);
  ov.appendChild(img);
  document.body.appendChild(ov);
  lightboxEl = ov;
}

async function compareImage(second, btn) {
  if (busy || !lastUserContent) return;
  if (currentKeyMissing(second.providerId)) {
    addMessage("error", t("err.keyMissingFor", { label: PROVIDERS[second.providerId].label }));
    return;
  }
  btn.disabled = true;
  startBusy();
  const badge = `${PROVIDERS[second.providerId].label} · ${second.modelId}`;
  const status = addMessage("tool", t("image.generating"));
  try {
    const urls = await generateImage(
      { ...settings, imageProvider: second.providerId, imageModel: second.modelId },
      { prompt: lastUserContent, size: els.imageSize.value, signal: abortController.signal }
    );
    status.remove();
    const wrap = addMessage("assistant", "");
    const b = document.createElement("div");
    b.className = "model-badge";
    b.textContent = badge;
    wrap.appendChild(b);
    for (const u of urls) {
      const img = document.createElement("img");
      img.src = u; img.alt = lastUserContent; img.className = "gen-image";
      wrap.appendChild(img);
    }
    transcript.push({ role: "assistant", kind: "image", urls, badge });
    attachImageCompareBar(wrap); // compare again with yet another model
  } catch (e) {
    status.remove();
    addMessage("error", t("err.image", { msg: e && e.message ? e.message : String(e) }));
  } finally {
    endBusy();
    btn.disabled = false;
    await saveCurrent();
  }
}

// ----- PDF workspace --------------------------------------------------------
function pdfContextBlock() {
  if (!pdfs.length) return "";
  // Share the context budget across all loaded PDFs.
  const budget = Math.max(2000, Math.floor(PDF_BUDGET / pdfs.length));
  return pdfs.map((p) => `[PDF: ${p.name} (${p.pages} pages)]\n${p.text.slice(0, budget)}\n\n`).join("");
}
function updatePdfInfo() {
  els.pdfInfo.innerHTML = "";
  // Show the PDF actions bar only while at least one PDF is loaded (the composer "+" adds them).
  if (mode === "pdf") els.controls.hidden = pdfs.length === 0;
  if (!pdfs.length) {
    els.pdfSummarize.classList.add("hidden");
    els.pdfImages.classList.add("hidden");
    els.pdfText.classList.add("hidden");
    return;
  }
  const totalPages = pdfs.reduce((n, p) => n + p.pages, 0);
  const count = document.createElement("span");
  count.className = "pdf-count";
  count.textContent = t("pdf.count", { n: pdfs.length, pages: totalPages });
  els.pdfInfo.appendChild(count);
  // Each loaded PDF is a chip with a ✕ to drop it from the context list.
  pdfs.forEach((p, idx) => {
    const chip = document.createElement("span");
    chip.className = "pdf-chip";
    const nm = document.createElement("span");
    nm.className = "pdf-chip-name";
    nm.textContent = p.name;
    nm.title = p.name + " · " + t("pdf.count", { n: 1, pages: p.pages });
    const x = document.createElement("button");
    x.type = "button";
    x.className = "pdf-chip-x";
    x.setAttribute("aria-label", t("pdf.remove"));
    x.title = t("pdf.remove");
    x.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    x.addEventListener("click", () => removePdf(idx));
    chip.appendChild(nm); chip.appendChild(x);
    els.pdfInfo.appendChild(chip);
  });
  els.pdfSummarize.classList.remove("hidden");
  els.pdfImages.classList.remove("hidden");
  els.pdfText.classList.remove("hidden");
}
// Drop one PDF from the in-context list (the ✕ on its chip).
function removePdf(idx) {
  if (idx < 0 || idx >= pdfs.length) return;
  const [gone] = pdfs.splice(idx, 1);
  if (gone) addMessage("tool", t("pdf.removed", { name: gone.name }));
  updatePdfInfo();
}
// Load one or several PDFs and ADD them to the current context (multi-PDF).
async function loadPdfFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!files.length) return;
  if (!window.pdfjsLib) { addMessage("error", t("err.pdf", { msg: "pdf.js not loaded" })); return; }
  els.pdfInfo.textContent = t("pdf.loading");
  if (!pdfWorkerSet) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("vendor/pdf.worker.min.js");
    pdfWorkerSet = true;
  }
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
      let text = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => (it.str || "")).join(" ") + "\n\n";
      }
      pdfs.push({ name: file.name, text: text.trim(), pages: doc.numPages, doc });
      addMessage("tool", t("pdf.loaded", { name: file.name, pages: doc.numPages }));
    } catch (e) {
      addMessage("error", t("err.pdf", { msg: e && e.message ? e.message : String(e) }));
    }
  }
  updatePdfInfo();
  els.input.focus();
}
// Back-compat single-file entry (drag & drop one PDF).
async function onPdfSend() {
  const text = els.input.value.trim();
  if (!text) return;
  if (!pdfs.length) return addMessage("error", t("pdf.none"));
  els.input.value = "";
  await sendToModel(text, pdfContextBlock() + `[Question]\n${text}`, { runMode: "chat" });
}
async function pdfSummarizeAction() {
  if (!pdfs.length) return addMessage("error", t("pdf.none"));
  await sendToModel(t("pdf.summLabel"), pdfContextBlock() + "[Task]\n" + t("pdf.summPrompt"), { runMode: "chat" });
}
function pdfExtractTextAction() {
  if (!pdfs.length) return addMessage("error", t("pdf.none"));
  addMessage("user", t("pdf.textLabel"));
  const el = addMessage("assistant", "");
  const all = pdfs.map((p) => `### ${p.name}\n\n${p.text}`).join("\n\n");
  setHTML(el, renderMarkdown("```text\n" + all.slice(0, 100000) + "\n```"));
  enhanceArtifacts(el);
}
async function pdfExtractImages() {
  if (!pdfs.length) return addMessage("error", t("pdf.none"));
  if (busy) return;
  addMessage("user", t("pdf.imagesLabel"));
  const status = addMessage("tool", t("pdf.extracting"));
  startBusy();
  try {
    const wrap = addMessage("assistant", "");
    for (const p of pdfs) {
      for (let i = 1; i <= p.doc.numPages; i++) {
        const page = await p.doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const img = document.createElement("img");
        img.src = canvas.toDataURL("image/png");
        img.alt = `${p.name} — page ${i}`;
        img.className = "gen-image";
        wrap.appendChild(img);
        scrollMessages();
      }
    }
    status.remove();
  } catch (e) {
    status.remove();
    addMessage("error", t("err.pdf", { msg: e && e.message ? e.message : String(e) }));
  } finally {
    endBusy();
  }
}

// Backstop for the no-FOUC guard: init() reveals the UI early (after the theme is applied); this
// also reveals it if init() ever throws BEFORE that point, so the panel can never stay invisible.
init().finally(() => document.documentElement.classList.add("theme-ready"));
