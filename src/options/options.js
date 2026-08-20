import { getSettings, setSettings } from "../lib/storage.js";
import { PROVIDERS, PROVIDER_ORDER, IMAGE_SIZES, WRITING_PRESETS, isConnected } from "../lib/models.js";
import { connectOpenRouter } from "../lib/auth.js";
import { listModels } from "../lib/providers.js";
import { clearConversations } from "../lib/history.js";
import { THEMES, CUSTOM_KEYS, applyTheme, effectivePalette, UI_FONTS, applyFont, withOpacity } from "../lib/theme.js";
import { t, setLang, applyDom } from "../lib/i18n.js";
import { SHORTCUT_ACTIONS, defaultShortcuts, comboFromEvent, isBindable } from "../lib/shortcuts.js";
import { encryptSettings, decryptSettings } from "../lib/syncCrypto.js";
import { setHTML } from "../lib/dom.js";
import { memoryModelChoices, MEMORY_ROLES } from "../lib/memory-models.js";

const $ = (id) => document.getElementById(id);

// Request host permission for a local server's origin (Firefox MV3 needs this before
// the page can fetch http://localhost:… without CORS blocking). Covers the provider's
// configured base URL plus both loopback hosts, so localhost/127.0.0.1 both work.
async function requestLocalHostPermission(id, settings) {
  try {
    if (!(typeof browser !== "undefined" && browser.permissions && browser.permissions.request)) return true;
    const origins = new Set(["http://localhost/*", "http://127.0.0.1/*"]);
    const base = (settings.baseUrls && settings.baseUrls[id]) || (PROVIDERS[id] && PROVIDERS[id].baseUrl) || "";
    try { if (base) origins.add(new URL(base).origin + "/*"); } catch (_) {}
    return await browser.permissions.request({ origins: [...origins] });
  } catch (_) { return false; }
}

// ----- Theme + custom colours -----------------------------------------------
let curTheme = "dark";
let curColors = {}; // overrides applied on top of the theme
const COL_IDS = { accent: "col_accent", accent2: "col_accent2", bg: "col_bg", panel: "col_panel", text: "col_text", muted: "col_muted" };
// <input type="color"> only accepts "#rrggbb". Theme tokens can be rgb()/rgba() (e.g. panel,
// muted) — convert to a 6-digit hex (alpha dropped) before assigning, or the input rejects it.
function toHexColor(c) {
  if (typeof c !== "string") return "#000000";
  c = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0");
    return "#" + h(m[1]) + h(m[2]) + h(m[3]);
  }
  return "#000000";
}
function syncColorPickers() {
  const pal = effectivePalette(curTheme, curColors);
  for (const k of CUSTOM_KEYS) { const el = $(COL_IDS[k]); if (el) el.value = toHexColor(pal[k]); }
}
function applyThemeLive() {
  applyTheme(curTheme, curColors, {
    gradientOn: settings.gradientOn !== false,
    gradientSplit: (typeof settings.gradientSplit === "number") ? settings.gradientSplit : -1,
  });
  applyTopIconsLive(); // top-bar icon colours/gradient
}
// Clear the custom MENU-icon and TOP-BAR-icon colours so they follow the (newly picked) theme.
function resetElementColors() {
  const pal = effectivePalette(curTheme, curColors);
  ["railIconColor", "topIconColor", "topIconColor2"].forEach((k) => { settings[k] = ""; try { setSettings({ [k]: "" }); } catch (_) {} });
  const root = document.documentElement.style;
  ["--rail-icon", "--rail-icon-dim", "--top-icon-1", "--top-icon-2"].forEach((v) => root.removeProperty(v));
  if ($("railIconColor")) $("railIconColor").value = "#6b7280";
  if ($("topIconColor")) $("topIconColor").value = toHexColor(pal.accent || "#8b5cf6");
  if ($("topIconColor2")) $("topIconColor2").value = toHexColor(pal.accent2 || "#6366f1");
  applyTopIconsLive();
}
// Drive the --top-icon-1/2 vars on the OPTIONS page so the (live) preview reflects choices, and
// they take effect in the sidebar via the saved settings + its own applyTopIcons.
function applyTopIconsLive() {
  const root = document.documentElement.style;
  const c1 = (settings.topIconColor || "").trim();
  const grad = settings.topIconGradient !== false;
  const c2 = (settings.topIconColor2 || "").trim();
  if (c1) root.setProperty("--top-icon-1", c1); else root.removeProperty("--top-icon-1");
  if (!grad) root.setProperty("--top-icon-2", c1 || "var(--accent)");
  else if (c2) root.setProperty("--top-icon-2", c2);
  else root.removeProperty("--top-icon-2");
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Real eyedropper for browsers without the EyeDropper API (Firefox): capture the
// screen, freeze a snapshot, and let the user click the exact colour to pick — works
// for any app on screen (Discord, etc.). Returns a #hex string, or null if cancelled.
async function screenEyedropper() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return null;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (_) { return null; } // user cancelled the share prompt
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  try { await video.play(); } catch (_) {}
  await new Promise((r) => setTimeout(r, 220)); // let a frame paint
  const w = video.videoWidth || 1, h = video.videoHeight || 1;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  stream.getTracks().forEach((tk) => tk.stop());

  return await new Promise((resolve) => {
    const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    const dw = Math.round(w * scale), dh = Math.round(h * scale);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#000;cursor:crosshair";
    const img = document.createElement("img");
    img.src = canvas.toDataURL();
    img.draggable = false;
    img.style.cssText = "width:" + dw + "px;height:" + dh + "px;display:block";
    overlay.appendChild(img);
    const badge = document.createElement("div");
    badge.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:10px;background:#161922;color:#fff;font:13px/1 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.55)";
    const sw = document.createElement("span");
    sw.style.cssText = "width:22px;height:22px;border-radius:5px;border:1px solid rgba(255,255,255,.25);background:#000";
    const lbl = document.createElement("span");
    lbl.textContent = t("opt.theme.pickHint");
    badge.appendChild(sw); badge.appendChild(lbl);
    overlay.appendChild(badge);
    const colorAt = (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / scale), y = Math.floor((e.clientY - r.top) / scale);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const d = ctx.getImageData(x, y, 1, 1).data;
      return rgbToHex(d[0], d[1], d[2]);
    };
    const cleanup = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(null); } };
    overlay.addEventListener("mousemove", (e) => { const hx = colorAt(e); if (hx) { sw.style.background = hx; lbl.textContent = hx; } });
    overlay.addEventListener("click", (e) => { const hx = colorAt(e); cleanup(); resolve(hx); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
  });
}

function buildThemeControls() {
  const sel = $("theme");
  if (sel) {
    sel.innerHTML = "";
    for (const [key, th] of Object.entries(THEMES)) {
      const o = document.createElement("option");
      o.value = key; o.textContent = th.label;
      sel.appendChild(o);
    }
    sel.value = curTheme;
    sel.addEventListener("change", () => {
      curTheme = sel.value;
      curColors = {}; // a fresh theme starts from its own palette
      resetElementColors(); // the menu icons + top-bar icons follow the new theme too
      syncColorPickers(); applyThemeLive(); saveColorsNow();
    });
  }
  // UI font picker — bundled modern webfonts (see UI_FONTS in theme.js). Value persists via
  // collectSettings; we apply it live on change for an instant preview.
  const fsel = $("uiFont");
  if (fsel) {
    fsel.innerHTML = "";
    for (const f of UI_FONTS) {
      const o = document.createElement("option");
      o.value = f.key; o.textContent = f.label; o.style.fontFamily = f.stack;
      fsel.appendChild(o);
    }
    fsel.addEventListener("change", () => applyFont(fsel.value));
  }
  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;
  for (const k of CUSTOM_KEYS) {
    const el = $(COL_IDS[k]);
    if (!el) continue;
    el.addEventListener("input", () => { curColors = { ...curColors, [k]: el.value }; applyThemeLive(); });
    // Persist the FINAL picked colour immediately (not just via the 500ms debounce) so it
    // can't be lost if Settings is closed right after picking — that was the "colours not
    // kept on reopen" bug.
    el.addEventListener("change", () => { curColors = { ...curColors, [k]: el.value }; saveColorsNow(); });
    // Eyedropper button: pick ANY colour on screen (e.g. Discord's). On Chromium it
    // uses the native EyeDropper API (one-click pick anywhere). On Firefox (no EyeDropper
    // API) it captures the screen and lets you click the colour on a frozen snapshot.
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "eyedrop";
    drop.title = t("opt.theme.pick");
    drop.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
    drop.addEventListener("click", async () => {
      let hex = null;
      if (hasEyeDropper) {
        try { const res = await new window.EyeDropper().open(); hex = res && res.sRGBHex; } catch (_) { /* cancelled */ }
      } else {
        hex = await screenEyedropper();
      }
      if (hex) {
        el.value = hex;
        curColors = { ...curColors, [k]: hex };
        applyThemeLive();
        saveColorsNow(); // persist immediately — the screen-capture flow can blur/close the page
      }
    });
    el.insertAdjacentElement("afterend", drop);
  }
  const reset = $("themeReset");
  if (reset) reset.addEventListener("click", () => { curColors = {}; resetElementColors(); syncColorPickers(); applyThemeLive(); saveColorsNow(); });
  // Reply-bubble outline colour persists on its own (kept out of collectSettings so the
  // "" = follow-theme default isn't overwritten by a swatch the user never touched).
  const mbc = $("msgBorderColor");
  if (mbc) mbc.addEventListener("input", () => {
    try { setSettings({ msgBorderColor: mbc.value }); } catch (_) {}
    document.documentElement.style.setProperty("--msg-border", mbc.value); // live-preview the neon title outline colour
  });
  // Menu (rail) icon colour persists on its own too ("" default kept out of collectSettings).
  const setColor = (key, hex, after) => { settings[key] = hex; try { setSettings({ [key]: hex }); } catch (_) {} if (after) after(); };
  const ric = $("railIconColor");
  if (ric) ric.addEventListener("input", () => setColor("railIconColor", ric.value));
  const cc = $("contourColor");
  if (cc) cc.addEventListener("input", () => setColor("contourColor", cc.value, () => document.documentElement.style.setProperty("--contour-color", cc.value)));
  // Top-bar icon colours (1 / 2) + gradient toggle — live preview via --top-icon-*.
  const ti1 = $("topIconColor"), ti2 = $("topIconColor2"), tig = $("topIconGradient");
  if (ti1) ti1.addEventListener("input", () => setColor("topIconColor", ti1.value, applyTopIconsLive));
  if (ti2) ti2.addEventListener("input", () => setColor("topIconColor2", ti2.value, applyTopIconsLive));
  if (tig) tig.addEventListener("change", () => { settings.topIconGradient = tig.checked; try { setSettings({ topIconGradient: tig.checked }); } catch (_) {} applyTopIconsLive(); });
  const gOn = $("gradientOn");
  if (gOn) gOn.addEventListener("change", () => { settings.gradientOn = gOn.checked; try { setSettings({ gradientOn: gOn.checked }); } catch (_) {} applyThemeLive(); });
  const gSplit = $("gradientSplit");
  if (gSplit) gSplit.addEventListener("input", () => {
    const v = parseInt(gSplit.value, 10); settings.gradientSplit = v;
    if ($("gradientSplitVal")) $("gradientSplitVal").textContent = v + "%";
    try { setSettings({ gradientSplit: v }); } catch (_) {} applyThemeLive();
  });
  // Eyedropper on EVERY element colour swatch (like the theme swatches).
  attachEyedropper($("railIconColor"), (hex) => setColor("railIconColor", hex, () => { if (ric) ric.value = hex; }));
  attachEyedropper($("topIconColor"), (hex) => setColor("topIconColor", hex, () => { if (ti1) ti1.value = hex; applyTopIconsLive(); }));
  attachEyedropper($("topIconColor2"), (hex) => setColor("topIconColor2", hex, () => { if (ti2) ti2.value = hex; applyTopIconsLive(); }));
  attachEyedropper($("msgBorderColor"), (hex) => setColor("msgBorderColor", hex, () => { const e = $("msgBorderColor"); if (e) e.value = hex; document.documentElement.style.setProperty("--msg-border", hex); }));
  attachEyedropper($("contourColor"), (hex) => setColor("contourColor", hex, () => { if (cc) cc.value = hex; document.documentElement.style.setProperty("--contour-color", hex); }));

  // Background aura — colour / intensity / size. Saved for the sidebar (its applyAura reacts live) and
  // mirrored into Hivey Code by the bridge. Also previewed on this page via the same CSS vars.
  const applyAuraLive = () => {
    const r = document.documentElement.style;
    const pal = effectivePalette(curTheme, curColors);
    r.setProperty("--aura-1", (settings.auraColor || "").trim() || toHexColor(pal.accent) || "#6366f1");
    r.setProperty("--aura-2", toHexColor(pal.accent2) || "#8b5cf6");
    r.setProperty("--aura-op", String(typeof settings.auraOpacity === "number" ? settings.auraOpacity : 0.12));
    r.setProperty("--aura-size", (typeof settings.auraSize === "number" ? settings.auraSize : 720) + "px");
  };
  const auraC = $("auraColor"), auraO = $("auraOpacity"), auraS = $("auraSize");
  if (auraC) {
    auraC.value = (settings.auraColor || "").trim() || toHexColor(effectivePalette(curTheme, curColors).accent) || "#6366f1";
    auraC.addEventListener("input", () => setColor("auraColor", auraC.value, applyAuraLive));
    attachEyedropper(auraC, (hex) => setColor("auraColor", hex, () => { auraC.value = hex; applyAuraLive(); }));
  }
  if (auraO) {
    const op0 = typeof settings.auraOpacity === "number" ? settings.auraOpacity : 0.12;
    auraO.value = String(Math.round(op0 * 100));
    if ($("auraOpacityVal")) $("auraOpacityVal").textContent = Math.round(op0 * 100) + "%";
    auraO.addEventListener("input", () => {
      const v = Math.round(parseInt(auraO.value, 10)) / 100; settings.auraOpacity = v;
      if ($("auraOpacityVal")) $("auraOpacityVal").textContent = Math.round(v * 100) + "%";
      try { setSettings({ auraOpacity: v }); } catch (_) {} applyAuraLive();
    });
  }
  if (auraS) {
    const sz0 = typeof settings.auraSize === "number" ? settings.auraSize : 720;
    auraS.value = String(sz0);
    if ($("auraSizeVal")) $("auraSizeVal").textContent = sz0 + "px";
    auraS.addEventListener("input", () => {
      const v = parseInt(auraS.value, 10); settings.auraSize = v;
      if ($("auraSizeVal")) $("auraSizeVal").textContent = v + "px";
      try { setSettings({ auraSize: v }); } catch (_) {} applyAuraLive();
    });
  }
  applyAuraLive();

  syncColorPickers();
}
// Reusable eyedropper button placed after a <input type=color> — native EyeDropper on Chromium,
// screen-capture fallback on Firefox. Calls onPick(hex) with the chosen colour.
function attachEyedropper(el, onPick) {
  if (!el) return;
  const drop = document.createElement("button");
  drop.type = "button"; drop.className = "eyedrop"; drop.title = t("opt.theme.pick");
  drop.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
  drop.addEventListener("click", async () => {
    let hex = null;
    if (typeof window !== "undefined" && "EyeDropper" in window) {
      try { const res = await new window.EyeDropper().open(); hex = res && res.sRGBHex; } catch (_) {}
    } else { hex = await screenEyedropper(); }
    if (hex) { el.value = hex; onPick(hex); }
  });
  el.insertAdjacentElement("afterend", drop);
}

// Element-colour opacity popup: a slider per element colour (top bar / menu icons / reply
// outline / title contour). Persists live; the sidebar re-applies via onSettingsChanged.
function buildOpacityModal() {
  const modal = $("opacityModal");
  if (!modal) return;
  const open = () => { syncOpacity(); modal.classList.remove("hidden"); };
  const close = () => modal.classList.add("hidden");
  if ($("opacityBtn")) $("opacityBtn").addEventListener("click", open);
  if ($("opacityClose")) $("opacityClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  const map = { op_railIcon: "railIconOpacity", op_msgBorder: "msgBorderOpacity", op_contour: "contourOpacity" };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id); if (!el) continue;
    el.addEventListener("input", () => {
      const v = parseInt(el.value, 10);
      settings[key] = v; try { setSettings({ [key]: v }); } catch (_) {}
      const val = el.parentElement.querySelector(".op-val"); if (val) val.textContent = v + "%";
      previewOpacity();
    });
  }
}
function syncOpacity() {
  const map = { op_railIcon: "railIconOpacity", op_msgBorder: "msgBorderOpacity", op_contour: "contourOpacity" };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id); if (!el) continue;
    const v = (typeof settings[key] === "number") ? settings[key] : 100;
    el.value = v; const val = el.parentElement.querySelector(".op-val"); if (val) val.textContent = v + "%";
  }
}
// Live-preview the opacities that affect elements present on the options page (the h1 contour/outline).
function previewOpacity() {
  const pal = effectivePalette(curTheme, curColors);
  const root = document.documentElement.style;
  if (settings.msgBorderColor) root.setProperty("--msg-border", withOpacity(settings.msgBorderColor, settings.msgBorderOpacity));
  if (settings.contourColor) root.setProperty("--contour-color", withOpacity(settings.contourColor, settings.contourOpacity));
}
// Top-right one-tap toggles for the options people flip most. Each chip toggles a setting,
// reflects its state (.on), keeps the detailed control in sync, and live-previews on this page.
function buildQuickActions() {
  const setOn = (el, on) => el && el.classList.toggle("on", !!on);
  const neon = $("qaNeon"), contour = $("qaContour"), sound = $("qaSound"), rail = $("qaRail");
  const smooth = $("qaSmooth"), replyOutline = $("qaReplyOutline"), tabNotif = $("qaTabNotif");
  setOn(neon, settings.textOutlineOn === true);
  setOn(contour, settings.contourOn === true);
  setOn(sound, settings.soundOnDone === true);
  setOn(smooth, settings.smoothStream !== false);
  setOn(replyOutline, settings.msgBorderOn === true);
  setOn(tabNotif, settings.tabDoneIndicator !== false);
  setOn(rail, settings.railSide === "right");
  if (smooth) smooth.addEventListener("click", () => {
    const on = !(settings.smoothStream !== false); settings.smoothStream = on;
    setSettings({ smoothStream: on }); setOn(smooth, on);
    if ($("smoothStream")) $("smoothStream").checked = on;
  });
  if (replyOutline) replyOutline.addEventListener("click", () => {
    const on = !(settings.msgBorderOn === true); settings.msgBorderOn = on;
    setSettings({ msgBorderOn: on }); setOn(replyOutline, on);
    if ($("msgBorderOn")) $("msgBorderOn").checked = on;
  });
  if (tabNotif) tabNotif.addEventListener("click", () => {
    const on = !(settings.tabDoneIndicator !== false); settings.tabDoneIndicator = on;
    setSettings({ tabDoneIndicator: on }); setOn(tabNotif, on);
  });
  if (neon) neon.addEventListener("click", () => {
    const on = !(settings.textOutlineOn === true); settings.textOutlineOn = on;
    setSettings({ textOutlineOn: on }); setOn(neon, on);
    document.body.classList.toggle("text-outline", on);
    if ($("textOutlineOn")) $("textOutlineOn").checked = on;
  });
  if (contour) contour.addEventListener("click", () => {
    const on = !(settings.contourOn === true); settings.contourOn = on;
    setSettings({ contourOn: on }); setOn(contour, on);
    document.body.classList.toggle("title-contour", on);
    if ($("contourOn")) $("contourOn").checked = on;
  });
  if (sound) sound.addEventListener("click", () => {
    const on = !(settings.soundOnDone === true); settings.soundOnDone = on;
    setSettings({ soundOnDone: on }); setOn(sound, on);
    if ($("soundOnDone")) $("soundOnDone").checked = on;
  });
  if (rail) rail.addEventListener("click", () => {
    const right = !(settings.railSide === "right"); settings.railSide = right ? "right" : "left";
    setSettings({ railSide: settings.railSide }); setOn(rail, right);
    if ($("railSide")) $("railSide").value = settings.railSide;
  });
}

// Most-spoken languages for the AI response language (English first / default).
// Canonical English names — MUST match the values of the Translate tab's language <select> so the
// choice made there (saved as settings.targetLang) is reflected here, and vice-versa.
const LANGUAGES = [
  "French", "English", "Spanish", "German", "Italian", "Portuguese", "Dutch", "Arabic", "Chinese",
  "Traditional Chinese", "Japanese", "Korean", "Russian", "Hindi", "Bengali", "Turkish", "Polish",
  "Ukrainian", "Romanian", "Greek", "Czech", "Swedish", "Danish", "Norwegian", "Finnish", "Hungarian",
  "Hebrew", "Thai", "Vietnamese", "Indonesian", "Malay", "Filipino", "Persian", "Urdu", "Swahili",
  "Catalan", "Croatian", "Serbian", "Slovak", "Slovenian", "Bulgarian", "Lithuanian", "Latvian",
  "Estonian", "Icelandic", "Irish", "Welsh", "Afrikaans", "Tamil", "Telugu", "Marathi", "Gujarati",
  "Punjabi", "Kannada", "Malayalam", "Nepali", "Sinhala", "Khmer", "Lao", "Burmese", "Mongolian",
  "Kazakh", "Azerbaijani", "Georgian", "Armenian", "Albanian", "Macedonian", "Belarusian", "Basque",
  "Galician", "Esperanto", "Latin",
];

// Providers with a free tier (free API key / free models).
const FREE_TIER = new Set(["google", "groq", "openrouter", "mistral", "cerebras"]);
// Providers with a real in-app account OAuth (the rest log in on the provider's
// own site to copy an API key).
const OAUTH = new Set(["openrouter"]);

// Sign-in / console page for each provider. We use the provider's CONSOLE (which
// redirects to its login when the user isn't authenticated) rather than raw auth
// endpoints like auth.openai.com — those reject direct access ("session ended").
// After signing in with their account, the user creates an API key there.
const LOGIN_URL = {
  anthropic: "https://console.anthropic.com/",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  mistral: "https://console.mistral.ai/api-keys",
  groq: "https://console.groq.com/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  xai: "https://console.x.ai/",
  perplexity: "https://www.perplexity.ai/settings/api",
  together: "https://api.together.ai/settings/api-keys",
  fireworks: "https://fireworks.ai/",
  deepinfra: "https://deepinfra.com/dash/api_keys",
  cerebras: "https://cloud.cerebras.ai/",
  cohere: "https://dashboard.cohere.com/api-keys",
};

let settings;
let modelLists = {};

function category(id) {
  const meta = PROVIDERS[id];
  if (meta.local) return "local";
  if (meta.custom) return "custom";
  return "cloud";
}


function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildCard(id) {
  const meta = PROVIDERS[id];
  const sec = el("section", "provider-card");

  const head = el("div", "provider-head");
  head.appendChild(el("h3", null, meta.label + (meta.local ? t("opt.localSuffix") : "")));
  const badge = el("span", "badge");
  head.appendChild(badge);
  if (FREE_TIER.has(id)) head.appendChild(el("span", "badge free", t("opt.badge.free")));
  sec.appendChild(head);

  // Connect affordance on EVERY cloud provider. P8 — the badge AND this button now
  // reflect the connection state live (as soon as a key is pasted, before saving),
  // so "Se connecter" never lingers next to an already-connected provider.
  let connectBtn = null;
  if (category(id) === "cloud") {
    connectBtn = el("button", "small connect");
    connectBtn.addEventListener("click", () => connectAccount(id));
    sec.appendChild(connectBtn);
    sec.appendChild(el("p", "muted hint", OAUTH.has(id) ? t("opt.hint.oauth") : t("opt.hint.key")));
  }

  // Reflect connected/disconnected state on the badge + connect button.
  const applyConnState = (connectedNow) => {
    badge.className = "badge " + (connectedNow ? "ok" : "off");
    badge.textContent = connectedNow ? t("opt.badge.connected") : t("opt.badge.off");
    if (id === "openrouter") updateQuickConnect(connectedNow);
    if (!connectBtn) return;
    if (connectedNow) {
      connectBtn.className = "ghost small connect connected";
      connectBtn.textContent = OAUTH.has(id) ? t("opt.connect.oauthReconnect") : t("opt.connect.keyReconnect", { label: meta.label });
    } else {
      connectBtn.className = "grad small connect";
      connectBtn.textContent = OAUTH.has(id) ? t("opt.connect.oauth") : t("opt.connect.key", { label: meta.label });
    }
  };
  applyConnState(isConnected(id, settings));

  // Local server: explicit opt-in.
  if (meta.local) {
    const lab = el("label", "switch");
    const inp = el("input");
    inp.type = "checkbox";
    inp.id = `local_${id}`;
    inp.checked = !!(settings.localEnabled && settings.localEnabled[id]);
    inp.addEventListener("change", async () => {
      applyConnState(inp.checked);
      // Firefox MV3 grants NO host permission at install, so a fetch from this page
      // to http://localhost:11434 would be CORS-blocked. The toggle is a user gesture,
      // so we can request access to the local origin right here (resolves instantly if
      // already granted). Without this, local models silently fail.
      if (inp.checked) {
        const ok = await requestLocalHostPermission(id, settings);
        if (!ok) {
          inp.checked = false;
          applyConnState(false);
          alert(t("opt.local.permDenied"));
        }
      }
    });
    lab.appendChild(inp);
    lab.appendChild(el("span", "track"));
    lab.appendChild(el("span", "lbl", t("opt.local.enable")));
    sec.appendChild(lab);
    const hint = el("p", "hint", t("opt.local.hint"));
    sec.appendChild(hint);
  }

  // API key.
  if (meta.needsKey || id === "custom") {
    const lab = el("label", null, meta.needsKey ? t("opt.key.label") : t("opt.key.labelOpt"));
    const inp = el("input");
    // Masked TEXT field instead of type=password: API keys are not login credentials, so
    // we don't want Firefox/Chrome to pop "save this password?" on the Settings page. CSS
    // text-security masks the value; the password manager ignores non-password fields.
    inp.type = "text";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.setAttribute("autocapitalize", "off");
    inp.setAttribute("autocorrect", "off");
    inp.setAttribute("data-lpignore", "true"); // LastPass ignore
    inp.setAttribute("data-1p-ignore", "true"); // 1Password ignore
    inp.style.setProperty("-webkit-text-security", "disc");
    inp.style.setProperty("text-security", "disc");
    inp.id = `key_${id}`;
    inp.placeholder = meta.keyHint || "key…";
    inp.value = (settings.keys && settings.keys[id]) || "";
    // Live feedback: a non-empty key counts as "Connecté(e)" immediately (P8).
    inp.addEventListener("input", () => applyConnState(!!inp.value.trim() || isConnected(id, settings)));
    lab.appendChild(inp);
    sec.appendChild(lab);
    if (meta.keysUrl) {
      const p = el("p", "muted");
      const tag = FREE_TIER.has(id) ? t("opt.key.getFree") : t("opt.key.console");
      p.textContent = tag;
      const a = document.createElement("a");
      a.href = meta.keysUrl; a.target = "_blank"; a.rel = "noreferrer";
      a.textContent = meta.keysUrl.replace(/^https?:\/\//, "");
      p.appendChild(a);
      sec.appendChild(p);
    }
  }

  // Base URL (local / custom).
  if (meta.local || meta.custom) {
    const lab = el("label", null, t("opt.url.label"));
    const inp = el("input");
    inp.type = "text";
    inp.id = `url_${id}`;
    inp.placeholder = meta.baseUrl || "https://your-server/v1";
    inp.value = (settings.baseUrls && settings.baseUrls[id]) || "";
    lab.appendChild(inp);
    sec.appendChild(lab);

    // Manual model name(s) — so a local model can ALWAYS be imported even when the server
    // can't be auto-listed (CORS-blocked Ollama, a custom endpoint with no /models route…).
    const mlab = el("label", null, t("opt.models.label"));
    const minp = el("input");
    minp.type = "text";
    minp.id = `models_${id}`;
    minp.placeholder = "llama3.1, qwen2.5-coder, mistral…";
    minp.value = ((settings.userModels && settings.userModels[id]) || []).join(", ");
    mlab.appendChild(minp);
    sec.appendChild(mlab);
    const hint = el("p", "muted");
    hint.textContent = t("opt.models.hint");
    sec.appendChild(hint);
  }

  // No per-provider "default model" here: the model is chosen in the sidebar's own
  // picker and the LAST-USED one is remembered automatically (per provider). Forcing a
  // default here would override that, so it has been removed on purpose.

  return sec;
}

// Filter the settings as you type: whole sections that match are kept; inside the (long)
// AI providers section, individual provider cards are filtered too.
function applySettingsFilter(q) {
  q = (q || "").trim().toLowerCase();
  document.querySelectorAll("main > section").forEach((sec) => {
    const title = (sec.querySelector("h2") ? sec.querySelector("h2").textContent : "").toLowerCase();
    const titleHit = !!q && title.includes(q);
    const provDiv = sec.querySelector("#providers");
    if (provDiv) {
      let any = false;
      provDiv.querySelectorAll(":scope > *").forEach((card) => {
        const hit = !q || titleHit || (card.textContent || "").toLowerCase().includes(q);
        card.style.display = hit ? "" : "none";
        if (hit) any = true;
      });
      sec.style.display = !q || titleHit || any ? "" : "none";
      return;
    }
    sec.style.display = !q || (sec.textContent || "").toLowerCase().includes(q) ? "" : "none";
  });
}
function wireSettingsSearch() {
  const inp = $("settingsSearch");
  if (!inp || inp.dataset.wired) return;
  inp.dataset.wired = "1";
  inp.addEventListener("input", () => applySettingsFilter(inp.value));
}

function buildProviderFields() {
  const root = $("providers");
  root.innerHTML = "";
  let lastCat = null;
  for (const id of PROVIDER_ORDER) {
    const cat = category(id);
    if (cat !== lastCat) {
      root.appendChild(el("h2", "group-title", t("opt.group." + cat)));
      lastCat = cat;
    }
    root.appendChild(buildCard(id));
  }
}

function fillSelect(sel, items, value) {
  sel.innerHTML = "";
  for (const [val, label] of items) {
    const o = el("option", null, label);
    o.value = val;
    sel.appendChild(o);
  }
  if (value != null) sel.value = value;
}

function buildImageProvider() {
  const imgProviders = PROVIDER_ORDER.filter((id) => PROVIDERS[id].supportsImages).map((id) => [id, PROVIDERS[id].label]);
  fillSelect($("imageProvider"), imgProviders, settings.imageProvider || "openai");
  // "—" (empty) = no fixed size; the model uses the dimensions described in the prompt.
  fillSelect($("imageSize"), [["", t("size.none")], ...IMAGE_SIZES], settings.imageSize || "");
}

// Agent-model picker: "Auto" + the catalogue models of every CONNECTED provider.
// Lets the user pin a tool-capable model for agent mode (many free models can't
// call tools). Mirrors buildSearchModelSelect.
function buildAgentModelSelect() {
  const sel = $("agentModel");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = el("option", null, t("opt.agent.auto"));
  auto.value = "";
  sel.appendChild(auto);
  for (const id of PROVIDER_ORDER) {
    if (!isConnected(id, settings)) continue;
    const meta = PROVIDERS[id];
    if (!meta.models || !meta.models.length) continue;
    const group = document.createElement("optgroup");
    group.label = meta.label;
    for (const [mid, mlabel] of meta.models) {
      const o = el("option", null, mlabel);
      o.value = id + "|" + mid;
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
  sel.value = settings.agentModel || "";
}

// Web-search model picker: "Auto" + the catalogue models of every CONNECTED
// provider (using the curated catalogue, not the huge live OpenRouter list, to
// keep it usable). Perplexity Sonar and OpenRouter free models are the good picks.
function buildSearchModelSelect() {
  const sel = $("searchModel");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = el("option", null, t("opt.search.auto"));
  auto.value = "";
  sel.appendChild(auto);
  for (const id of PROVIDER_ORDER) {
    if (!isConnected(id, settings)) continue;
    const meta = PROVIDERS[id];
    if (!meta.models || !meta.models.length) continue;
    const group = document.createElement("optgroup");
    group.label = meta.label + (meta.supportsWebSearch ? " · web" : "");
    for (const [mid, mlabel] of meta.models) {
      const o = el("option", null, mlabel);
      o.value = id + "|" + mid;
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
  sel.value = settings.searchModel || "";
}

// Utility (housekeeping) model picker: "Auto" + the catalogue models of every
// CONNECTED provider. Used for summaries / history compaction when smart routing
// is on, so the premium model is reserved for the actual answers.
function buildUtilityModelSelect() {
  const sel = $("utilityModel");
  if (!sel) return;
  sel.innerHTML = "";
  const auto = el("option", null, t("opt.eff.utilityAuto"));
  auto.value = "";
  sel.appendChild(auto);
  for (const id of PROVIDER_ORDER) {
    if (!isConnected(id, settings)) continue;
    const meta = PROVIDERS[id];
    if (!meta.models || !meta.models.length) continue;
    const group = document.createElement("optgroup");
    group.label = meta.label;
    for (const [mid, mlabel] of meta.models) {
      const o = el("option", null, mlabel);
      o.value = id + "|" + mid;
      group.appendChild(o);
    }
    sel.appendChild(group);
  }
  sel.value = settings.utilityModel || "";
}

// Fetch live model lists for connected providers, then refresh the dropdowns.
async function refreshModelLists() {
  const ids = PROVIDER_ORDER.filter((id) => isConnected(id, settings));
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        const list = await listModels(id, settings);
        if (list && list.length) modelLists[id] = list;
      } catch (_) {}
    })
  );
  await setSettings({ modelLists: { ...(settings.modelLists || {}), ...modelLists } });
}

// Reflect the OpenRouter quick-connect button state at the top of the page (it used
// to stay "Connect…" even once connected).
function updateQuickConnect(connectedNow) {
  const btn = $("quickConnect");
  if (!btn) return;
  if (connectedNow) {
    btn.className = "ghost";
    btn.textContent = t("opt.quick.btnConnected");
  } else {
    btn.className = "grad";
    btn.textContent = t("opt.quick.btn");
  }
}

// Monochrome line icons (Lucide-style) for each settings section, mirroring the
// sidebar rail. Keyed by the section's id.
const SECTION_ICONS = {
  "sec-quick": '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  "sec-providers": '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/></svg>',
  "sec-memory": '<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4z"/><path d="M9 9h6"/><path d="M9 15h6"/></svg>',
  "sec-agent": '<svg viewBox="0 0 24 24"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13v2"/><path d="M15 13v2"/></svg>',
  "sec-web": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/></svg>',
  "sec-image": '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
  "sec-code": '<svg viewBox="0 0 24 24"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>',
  "sec-lang": '<svg viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
  "sec-appearance": '<svg viewBox="0 0 24 24"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>',
  "sec-security": '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  "sec-behavior": '<svg viewBox="0 0 24 24"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>',
  "sec-efficiency": '<svg viewBox="0 0 24 24"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
};

// Quick-navigation pins: one per settings section, with smooth scroll + a scroll-spy
// that highlights the section currently in view. Built from <section id> + its <h2>.
// Reorder the settings sections so the things people touch most / accessibility sit at the TOP
// and the set-once / advanced stuff sinks to the BOTTOM. Done in JS (re-append in order, before
// the footer note) so the markup stays simple and the quick-nav follows automatically.
const SECTION_ORDER = [
  "sec-quick",       // connect (onboarding) — hidden once a provider is connected
  "sec-appearance",  // theme / font / colours / neon — accessibility, adjusted most
  "sec-lang",        // language & writing
  "sec-behavior",    // everyday behaviour
  "sec-agent",       // per-feature configs…
  "sec-memory",
  "sec-web",
  "sec-image",
  "sec-efficiency",
  "sec-security",
  "sec-code",        // least-consulted → bottom
  "sec-shortcuts",   // keyboard shortcuts
  "sec-sync",        // encrypted backup / sync
  "sec-providers",   // API keys → bottom
];

// Encrypted settings backup/sync (BYOK stays local — nothing is uploaded).
function buildSyncSection() {
  const main = document.querySelector("main");
  if (!main || document.getElementById("sec-sync")) return;
  const sec = el("section", null); sec.id = "sec-sync";
  sec.appendChild(el("h3", null, t("opt.sync.title")));
  sec.appendChild(el("p", "hint", t("opt.sync.hint")));
  const row = el("div", "sync-row");

  const exportBtn = el("button", "link-btn", t("opt.sync.export"));
  exportBtn.addEventListener("click", async () => {
    const pass = window.prompt(t("opt.sync.passSet"));
    if (!pass) return;
    try {
      const fresh = await getSettings();
      const blob = await encryptSettings(fresh, pass);
      const b = new Blob([blob], { type: "application/json" });
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url; a.download = "hivey-settings.hivey"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { window.alert("Export failed: " + (e && e.message || e)); }
  });

  const importInput = el("input"); importInput.type = "file"; importInput.accept = ".hivey,application/json"; importInput.style.display = "none";
  importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = "";
    if (!file) return;
    const pass = window.prompt(t("opt.sync.passEnter"));
    if (!pass) return;
    try {
      const text = await file.text();
      const obj = await decryptSettings(text, pass);
      if (!obj || typeof obj !== "object") throw new Error("empty");
      await setSettings(obj);
      window.alert(t("opt.sync.imported"));
      location.reload();
    } catch (e) { window.alert(t("opt.sync.importFail") + " " + (e && e.message || e)); }
  });
  const importBtn = el("button", "link-btn", t("opt.sync.import"));
  importBtn.addEventListener("click", () => importInput.click());

  row.appendChild(exportBtn); row.appendChild(importBtn); row.appendChild(importInput);
  sec.appendChild(row);
  main.appendChild(sec);
}

// Build the "Keyboard shortcuts" section: one row per action; click a field then press a combo.
function buildShortcutsSection() {
  const main = document.querySelector("main");
  if (!main || document.getElementById("sec-shortcuts")) return;
  const map = { ...defaultShortcuts(), ...(settings.shortcuts || {}) };
  const sec = el("section", null); sec.id = "sec-shortcuts";
  const h3 = el("h3", null, t("opt.shortcuts.title")); sec.appendChild(h3);
  const hint = el("p", "hint", t("opt.shortcuts.hint")); sec.appendChild(hint);
  const save = () => { settings.shortcuts = map; setSettings({ shortcuts: map }); };
  for (const a of SHORTCUT_ACTIONS) {
    const row = el("div", "sc-row");
    row.appendChild(el("span", "sc-label", t(a.labelKey)));
    const inp = el("input", "sc-input");
    inp.type = "text"; inp.readOnly = true; inp.value = map[a.id] || "";
    inp.placeholder = t("opt.shortcuts.record");
    inp.addEventListener("focus", () => { inp.value = t("opt.shortcuts.record"); });
    inp.addEventListener("blur", () => { inp.value = map[a.id] || ""; });
    inp.addEventListener("keydown", (e) => {
      e.preventDefault();
      if (e.key === "Backspace" || e.key === "Delete") { map[a.id] = ""; inp.value = ""; save(); inp.blur(); return; }
      const combo = comboFromEvent(e);
      if (!combo || !isBindable(combo)) return; // ignore modifier-only / non-modified keys
      map[a.id] = combo; inp.value = combo; save(); inp.blur();
    });
    const clear = el("button", "sc-clear", "✕");
    clear.title = "Disable"; clear.addEventListener("click", () => { map[a.id] = ""; inp.value = ""; save(); });
    row.appendChild(inp); row.appendChild(clear);
    sec.appendChild(row);
  }
  const reset = el("button", "link-btn", t("opt.shortcuts.reset"));
  reset.addEventListener("click", () => { Object.assign(map, defaultShortcuts()); save(); sec.remove(); buildShortcutsSection(); reorderSections(); });
  sec.appendChild(reset);
  main.appendChild(sec);
}
function reorderSections() {
  const main = document.querySelector("main");
  if (!main) return;
  const anchor = main.querySelector(".actions"); // keep sections above the "changes saved" footer
  SECTION_ORDER.forEach((id) => { const sec = document.getElementById(id); if (sec) main.insertBefore(sec, anchor); });
  // Quick connect is onboarding-only: once any provider is connected, hide it entirely.
  const quick = document.getElementById("sec-quick");
  if (quick) quick.style.display = anyConnected() ? "none" : "";
}
function anyConnected() {
  try { return (PROVIDER_ORDER || []).some((id) => isConnected(id, settings)); } catch (_) { return false; }
}
function buildQuickNav() {
  const nav = $("quicknav");
  if (!nav) return;
  nav.innerHTML = "";
  nav.appendChild(el("span", "qn-label", t("opt.nav.label")));
  const links = [];
  document.querySelectorAll("main > section[id]").forEach((sec) => {
    if (sec.style.display === "none") return; // skip hidden sections (e.g. Quick connect once connected)
    const h = sec.querySelector("h2");
    if (!h) return;
    const label = h.textContent.trim();
    const a = el("a", "qn-pin");
    const ic = el("span", "qn-ic");
    if (SECTION_ICONS[sec.id]) setHTML(ic, SECTION_ICONS[sec.id]); // trusted static SVG
    a.appendChild(ic);
    a.appendChild(el("span", "qn-text", label));
    a.href = "#" + sec.id;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", "#" + sec.id);
    });
    nav.appendChild(a);
    links.push({ a, sec });
  });
  const spy = () => {
    let active = links[0];
    for (const l of links) if (l.sec.getBoundingClientRect().top <= 96) active = l;
    links.forEach((l) => l.a.classList.toggle("active", l === active));
  };
  window.addEventListener("scroll", spy, { passive: true });
  spy();
}

// Put the same monochrome line icon (from SECTION_ICONS) in front of each section
// title, so the cards echo the quick-nav. Runs after applyDom so the icon isn't
// wiped by the data-i18n text fill.
function addSectionIcons() {
  document.querySelectorAll("main > section[id]").forEach((sec) => {
    const h = sec.querySelector("h2");
    if (!h || h.querySelector(".h2-ic")) return;
    const icon = SECTION_ICONS[sec.id];
    if (!icon) return;
    const ic = document.createElement("span");
    ic.className = "h2-ic";
    setHTML(ic, icon); // trusted static SVG
    h.insertBefore(ic, h.firstChild);
  });
}

async function load() {
  settings = await getSettings();
  curTheme = settings.theme || "dark";
  curColors = { ...(settings.themeColors || {}) };
  applyThemeLive();                        // theme the options page too
  setLang(settings.uiLang || "en");       // English default; other languages via the uiLang setting
  applyDom(document);                      // fill all data-i18n static markup
  document.documentElement.lang = settings.uiLang || "en";
  buildShortcutsSection();                 // configurable keyboard shortcuts (built before reorder)
  buildSyncSection();                      // encrypted settings backup / sync
  reorderSections();                       // most-used / accessibility at top, advanced at bottom
  buildThemeControls();
  buildOpacityModal();                     // element-colour opacity popup (Settings → Appearance)
  buildQuickActions();                     // top-right one-tap toggles (neon / contour / sound / menu side)
  buildQuickNav();                         // jump pins to each section (follows the new order)
  addSectionIcons();                       // same line icons on each section title
  wireMemory();
  modelLists = { ...(settings.modelLists || {}) };
  buildProviderFields();
  buildImageProvider();
  buildSearchModelSelect();
  buildAgentModelSelect();
  wireSettingsSearch();
  buildUtilityModelSelect();
  fillSelect($("responseLang"), [["Auto", t("opt.lang.respAuto")], ...LANGUAGES.map((l) => [l, l])], settings.responseLang || "Auto");
  fillSelect($("targetLang"), LANGUAGES.map((l) => [l, l]), settings.targetLang || "French");
  fillSelect($("improvePreset"), WRITING_PRESETS.map((p) => [p[0], t("preset." + p[0])]), settings.improvePreset || "improve");
  updateQuickConnect(isConnected("openrouter", settings));
  $("imageModel").value = settings.imageModel || "";
  $("uiLang").value = settings.uiLang || "en";
  if ($("uiFont")) $("uiFont").value = settings.uiFont || "";
  applyFont(settings.uiFont); // apply the saved UI font to the options page itself
  $("railSide").value = settings.railSide === "right" ? "right" : "left";
  buildRailTabsList();
  // Reply-bubble outline customisation.
  if ($("msgBorderOn")) $("msgBorderOn").checked = settings.msgBorderOn !== false;
  // Neon title outline is its own option (decoupled from icon boxes) — live-preview the h1 outline.
  if ($("textOutlineOn")) {
    $("textOutlineOn").checked = settings.textOutlineOn === true;
    document.body.classList.toggle("text-outline", settings.textOutlineOn === true);
    $("textOutlineOn").addEventListener("change", () => document.body.classList.toggle("text-outline", $("textOutlineOn").checked));
  }
  // Crisp contour is its own option (own colour), combinable with neon — live-preview the h1.
  if ($("contourOn")) {
    $("contourOn").checked = settings.contourOn === true;
    document.body.classList.toggle("title-contour", settings.contourOn === true);
    $("contourOn").addEventListener("change", () => document.body.classList.toggle("title-contour", $("contourOn").checked));
  }
  if ($("smoothStream")) $("smoothStream").checked = settings.smoothStream !== false;
  if ($("soundOnDone")) $("soundOnDone").checked = settings.soundOnDone === true;
  if ($("tabDoneIndicator")) $("tabDoneIndicator").checked = settings.tabDoneIndicator !== false;
  // Preview the chosen neon colour on the title outline (falls back to accent when unset).
  if (settings.msgBorderColor) document.documentElement.style.setProperty("--msg-border", settings.msgBorderColor);
  if (settings.contourColor) document.documentElement.style.setProperty("--contour-color", settings.contourColor);
  if ($("msgBorderColor")) $("msgBorderColor").value = toHexColor(settings.msgBorderColor || effectivePalette(curTheme, curColors).border || "#30334d");
  if ($("contourColor")) $("contourColor").value = toHexColor(settings.contourColor || effectivePalette(curTheme, curColors).text || "#f8fafc");
  if ($("railIconColor")) $("railIconColor").value = toHexColor(settings.railIconColor || "#6b7280");
  const pal0 = effectivePalette(curTheme, curColors);
  if ($("topIconColor")) $("topIconColor").value = toHexColor(settings.topIconColor || pal0.accent || "#8b5cf6");
  if ($("topIconColor2")) $("topIconColor2").value = toHexColor(settings.topIconColor2 || pal0.accent2 || "#6366f1");
  if ($("topIconGradient")) $("topIconGradient").checked = settings.topIconGradient !== false;
  applyTopIconsLive();
  if ($("gradientOn")) $("gradientOn").checked = settings.gradientOn !== false;
  if ($("gradientSplit")) {
    const sp = (typeof settings.gradientSplit === "number" && settings.gradientSplit >= 0) ? settings.gradientSplit : Math.round(((effectivePalette(curTheme, curColors).split ?? 0.4)) * 100);
    $("gradientSplit").value = sp;
    if ($("gradientSplitVal")) $("gradientSplitVal").textContent = sp + "%";
  }
  if ($("targetLang")) $("targetLang").value = settings.targetLang || "French";
  $("webSearch").checked = settings.webSearch;
  $("webDefault").checked = !!settings.webDefault;
  $("orFreeOnly").checked = settings.orFreeOnly !== false;
  $("agentPermission").value = settings.agentPermission || "manual";
  if ($("memoryEnabled")) $("memoryEnabled").checked = settings.memoryEnabled === true;
  if ($("memoryRecallBudget")) $("memoryRecallBudget").value = settings.memoryRecallBudget ?? 300;
  if ($("memoryReviewEvery")) $("memoryReviewEvery").value = settings.memoryReviewEvery ?? 4;
  if ($("memoryQuotaMb")) $("memoryQuotaMb").value = settings.memoryQuotaMb ?? 50;
  if ($("memoryAgentName")) $("memoryAgentName").value = settings.memoryAgentName || "";
  if ($("memoryEncrypt")) $("memoryEncrypt").checked = settings.memoryEncrypt === true;
  fillMemoryModels();
  renderMemoryAudit();
  if ($("agentVerify")) $("agentVerify").checked = settings.agentVerify === true;
  if ($("agentInteractive")) $("agentInteractive").checked = !!settings.agentInteractive;
  $("codeAppUrl").value = settings.codeAppUrl != null ? settings.codeAppUrl : "";
  $("judge0Endpoint").value = settings.judge0Endpoint != null ? settings.judge0Endpoint : "";
  $("judge0Key").value = settings.judge0Key != null ? settings.judge0Key : "";
  $("judge0Key").style.setProperty("-webkit-text-security", "disc"); // mask without type=password
  $("blockPayments").checked = settings.blockPayments;
  $("saveHistory").checked = settings.saveHistory;
  $("includePageContext").checked = settings.includePageContext;
  $("autoReadPage").checked = settings.autoReadPage;
  $("maxPageChars").value = settings.maxPageChars;
  $("cleanContext").checked = settings.cleanContext !== false;
  $("compressHistory").checked = settings.compressHistory !== false;
  $("autoScroll").checked = settings.autoScroll !== false;
  $("smartRouting").checked = settings.smartRouting !== false;
  refreshModelLists();
}

// Workspace icons to show/hide in the sidebar's tabs rail (Appearance section).
const RAIL_TABS = [
  ["chat", "Chat"], ["web", "Web"], ["agent", "Agent"], ["translate", "Traduire"],
  ["improve", "Améliorer"], ["image", "Image"], ["pdf", "PDF"], ["code", "Code"],
];
function railTabLabel(mode, fallback) {
  const k = "rail." + mode;
  const v = t(k);
  return v && v !== k ? v : fallback;
}
function buildRailTabsList() {
  const host = $("railTabsList");
  if (!host) return;
  host.innerHTML = "";
  const hidden = new Set(Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : []);
  for (const [mode, fallback] of RAIL_TABS) {
    const lab = document.createElement("label");
    lab.className = "rail-tab-row";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = mode; cb.checked = !hidden.has(mode); cb.dataset.railtab = "1";
    const sp = document.createElement("span");
    sp.textContent = railTabLabel(mode, fallback);
    lab.appendChild(cb); lab.appendChild(sp);
    host.appendChild(lab);
  }
}
function collectRailTabsHidden() {
  const host = $("railTabsList");
  if (!host) return Array.isArray(settings.railTabsHidden) ? settings.railTabsHidden : [];
  const hidden = [];
  host.querySelectorAll('input[data-railtab="1"]').forEach((cb) => { if (!cb.checked) hidden.push(cb.value); });
  return hidden;
}

// Read every control into a settings object. `models` is intentionally NOT written —
// the sidebar remembers the last-used model per provider, and overwriting it here
// would undo that.
function collectSettings() {
  const keys = {};
  const baseUrls = {};
  const localEnabled = {};
  const userModels = {};
  for (const id of PROVIDER_ORDER) {
    const k = $(`key_${id}`);
    if (k && k.value.trim()) keys[id] = k.value.trim();
    const u = $(`url_${id}`);
    if (u && u.value.trim()) baseUrls[id] = u.value.trim();
    const lc = $(`local_${id}`);
    if (lc && lc.checked) localEnabled[id] = true;
    const mm = $(`models_${id}`);
    if (mm && mm.value.trim()) userModels[id] = mm.value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return {
    keys, baseUrls, localEnabled, userModels,
    imageProvider: $("imageProvider").value,
    imageModel: $("imageModel").value.trim() || "gpt-image-1",
    imageSize: $("imageSize").value,
    improvePreset: $("improvePreset").value,
    uiLang: $("uiLang").value,
    theme: curTheme,
    themeColors: curColors,
    railSide: $("railSide").value === "right" ? "right" : "left",
    uiFont: $("uiFont") ? $("uiFont").value : "",
    railTabsHidden: collectRailTabsHidden(),
    msgBorderOn: $("msgBorderOn") ? $("msgBorderOn").checked : true,
    textOutlineOn: $("textOutlineOn") ? $("textOutlineOn").checked : false,
    contourOn: $("contourOn") ? $("contourOn").checked : false,
    smoothStream: $("smoothStream") ? $("smoothStream").checked : true,
    soundOnDone: $("soundOnDone") ? $("soundOnDone").checked : false,
    tabDoneIndicator: $("tabDoneIndicator") ? $("tabDoneIndicator").checked : true,
    responseLang: $("responseLang").value,
    targetLang: $("targetLang").value.trim() || "French",
    webSearch: $("webSearch").checked,
    webDefault: $("webDefault").checked,
    orFreeOnly: $("orFreeOnly").checked,
    searchModel: $("searchModel").value,
    agentModel: $("agentModel").value,
    agentPermission: $("agentPermission").value,
    confirmActions: $("agentPermission").value !== "auto",
    memoryEnabled: $("memoryEnabled") ? $("memoryEnabled").checked : false,
    memoryModels: readMemoryModels(),
    memoryRecallBudget: Number($("memoryRecallBudget") ? $("memoryRecallBudget").value : 300) || 300,
    memoryReviewEvery: Number($("memoryReviewEvery") ? $("memoryReviewEvery").value : 4) || 4,
    memoryQuotaMb: Number($("memoryQuotaMb") ? $("memoryQuotaMb").value : 50) || 50,
    memoryAgentName: $("memoryAgentName") ? $("memoryAgentName").value.trim().slice(0, 24) : "",
    memoryEncrypt: $("memoryEncrypt") ? $("memoryEncrypt").checked : false,
    agentVerify: $("agentVerify") ? $("agentVerify").checked : false,
    agentInteractive: $("agentInteractive") ? $("agentInteractive").checked : false,
    codeAppUrl: $("codeAppUrl").value.trim(),
    judge0Endpoint: $("judge0Endpoint").value.trim(),
    judge0Key: $("judge0Key").value.trim(),
    blockPayments: $("blockPayments").checked,
    saveHistory: $("saveHistory").checked,
    includePageContext: $("includePageContext").checked,
    autoReadPage: $("autoReadPage").checked,
    maxPageChars: parseInt($("maxPageChars").value, 10) || 12000,
    cleanContext: $("cleanContext").checked,
    compressHistory: $("compressHistory").checked,
    autoScroll: $("autoScroll").checked,
    smartRouting: $("smartRouting").checked,
    utilityModel: $("utilityModel").value,
  };
}

// Auto-save: persist on any change, debounced, WITHOUT the heavy rebuilds (so typing a
// key isn't disrupted). The sidebar reacts live via its storage listener.
// Persist theme + custom colours IMMEDIATELY (merge write — doesn't touch other settings).
async function saveColorsNow() {
  try { await setSettings({ theme: curTheme, themeColors: curColors }); } catch (_) {}
}
let autoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try { await setSettings(collectSettings()); flash($("status"), t("opt.savedAuto")); } catch (_) {}
  }, 500);
}

// Explicit Save button: persist + refresh the model pickers + confirm.
async function save() {
  await setSettings(collectSettings());
  settings = await getSettings();
  modelLists = { ...(settings.modelLists || {}) };
  buildProviderFields();
  buildSearchModelSelect();
  buildAgentModelSelect();
  buildUtilityModelSelect();
  refreshModelLists();
  flash($("status"), t("opt.saved"));
}

function flash(node, text) {
  node.textContent = text;
  setTimeout(() => (node.textContent = ""), 2500);
}

// "Connect": OpenRouter via in-app OAuth; other providers open their own console
// (the user logs in with their account there, creates a key, and pastes it).
async function connectAccount(id) {
  const status = $("status");
  if (OAUTH.has(id)) {
    status.textContent = t("opt.dyn.connecting");
    try {
      const key = await connectOpenRouter();
      const cur = await getSettings();
      cur.keys = cur.keys || {};
      cur.keys[id] = key;
      await setSettings({ keys: cur.keys, provider: id });
      await load();
      flash(status, t("opt.dyn.connected", { label: PROVIDERS[id].label }));
    } catch (e) {
      flash(status, t("opt.dyn.failed", { msg: e && e.message ? e.message : e }));
    }
    return;
  }
  // Non-OAuth: open the provider's LOGIN page directly (the user signs in with
  // their account), then focus the key field for the key they create there.
  const meta = PROVIDERS[id];
  const url = LOGIN_URL[id] || meta.keysUrl;
  if (url) window.open(url, "_blank", "noopener");
  const f = $(`key_${id}`);
  if (f) { f.focus(); f.scrollIntoView({ block: "center" }); }
  flash(status, t("opt.dyn.identify", { label: meta.label }));
}

// Switching the interface language: persist everything, then reload so the WHOLE page
// (static markup, jump-nav pins and dynamic dropdowns) is rebuilt in the new language.
$("uiLang").addEventListener("change", async () => {
  try { await setSettings(collectSettings()); } catch (_) {}
  location.reload();
});
// Auto-save: persist on any control change (debounced) so the user never has to click
// a Save button (it has been removed — saving is automatic now).
document.addEventListener("change", scheduleAutoSave);
document.addEventListener("input", (e) => {
  if (e.target && e.target.matches &&
      e.target.matches('input[type="color"],input[type="text"],input[type="password"],input[type="number"],textarea')) {
    scheduleAutoSave();
  }
});
$("quickConnect").addEventListener("click", async () => {
  flash($("quickStatus"), t("opt.dyn.connecting"));
  await connectAccount("openrouter");
  flash($("quickStatus"), isConnected("openrouter", settings) ? t("opt.quick.savedNote") : "");
  if (isConnected("openrouter", settings)) { reorderSections(); buildQuickNav(); } // hide the now-pointless Quick connect
});
$("clearHistoryBtn").addEventListener("click", async () => {
  await clearConversations();
  flash($("status"), t("opt.cleared"));
});

// Reflect connections made elsewhere (e.g. the sidebar's quick-connect): when the
// stored keys / providers change, rebuild the cards so the new API key shows up
// here without a manual refresh.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!(changes.keys || changes.baseUrls || changes.localEnabled || changes.provider)) return;
  getSettings().then((s) => {
    settings = s;
    modelLists = { ...(s.modelLists || {}) };
    buildProviderFields();
    buildImageProvider();
    buildSearchModelSelect();
    buildAgentModelSelect();
    refreshModelLists();
  });
});

load();


function wireMemory() {
  if ($("memoryAuditFilter")) $("memoryAuditFilter").addEventListener("change", renderMemoryAudit);
  if ($("memoryPurge")) {
    $("memoryPurge").addEventListener("click", async () => {
      // Irreversible and it says so. A confirm that understates what it destroys is worse than none.
      if (!confirm(t("opt.mem.purgeConfirm"))) return;
      try {
        await browser.storage.local.remove(["memoryProfile", "memoryAudit"]);
        indexedDB.deleteDatabase("hivey-memory");
      } catch (_) {}
      renderMemoryAudit();
      alert(t("opt.mem.purged"));
    });
  }
}

// ── Memory ─────────────────────────────────────────────────────────────────────────────────────
// The picker offers everything the user's key can reach, with prices visible. Suggestions, never
// a cage: hiding the expensive options would be making the decision instead of informing it — and
// the free routes are listed first because that is what keeps a lookup from costing anything.

const MEM_SELECTS = {
  "memory-recall": "memoryModelRecall",
  "memory-extract": "memoryModelExtract",
  "memory-consolidate": "memoryModelConsolidate",
};

let memCatalogue = [];

async function fillMemoryModels() {
  if (!$("memoryModelRecall")) return;
  if (!memCatalogue.length) {
    // Public endpoint: the list works before any key is entered, and simply stays short if it fails.
    try {
      const r = await fetch("https://openrouter.ai/api/v1/models");
      if (r.ok) memCatalogue = ((await r.json()).data || []).filter((m) => m && m.id);
    } catch (_) { memCatalogue = []; }
  }
  for (const [role, id] of Object.entries(MEM_SELECTS)) {
    const sel = $(id);
    if (!sel) continue;
    const chosen = (settings.memoryModels || {})[role] || "";
    sel.replaceChildren();
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = t("opt.mem.auto");
    sel.append(auto);
    for (const c of memoryModelChoices(role, { catalogue: memCatalogue })) {
      const o = document.createElement("option");
      o.value = c.id;
      // Price in the label, always. They are BYOK: a picker that hides the cost is asking them to
      // choose blind about their own money.
      const price = c.price ? ` — $${c.price.toFixed(2)}/M` : ` — ${t("opt.mem.free")}`;
      o.textContent = `${c.label}${price}`;
      if (c.id === chosen) o.selected = true;
      sel.append(o);
    }
  }
}

function readMemoryModels() {
  const out = {};
  for (const [role, id] of Object.entries(MEM_SELECTS)) {
    const v = $(id) ? $(id).value : "";
    if (v) out[role] = v;
  }
  return out;
}

async function renderMemoryAudit() {
  const host = $("memoryAuditList");
  if (!host) return;
  let log = [];
  try { log = (await browser.storage.local.get("memoryAudit")).memoryAudit || []; } catch (_) {}
  const filter = $("memoryAuditFilter") ? $("memoryAuditFilter").value : "";
  const rows = log.filter((e) => !filter || e.op === filter).slice(-200).reverse();
  host.replaceChildren();
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = t("opt.mem.auditEmpty");
    host.append(p);
    return;
  }
  for (const e of rows) {
    const row = document.createElement("div");
    row.className = "mem-audit-row";
    const when = document.createElement("span");
    when.className = "mem-when";
    when.textContent = e.t ? new Date(e.t).toISOString().slice(0, 16).replace("T", " ") : "";
    const op = document.createElement("span");
    op.className = `mem-op mem-op-${e.op}`;
    op.textContent = e.op || "";
    const what = document.createElement("span");
    what.className = "mem-what";
    // An entry is either what was stored, or WHY something was refused. A refusal with no reason
    // is indistinguishable from a bug, which is the whole point of keeping this log.
    what.textContent = e.reason ? e.reason : [e.space, e.kind, e.id].filter(Boolean).join(" · ");
    row.append(when, op, what);
    host.append(row);
  }
}
