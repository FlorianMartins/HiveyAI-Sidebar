import { getSettings, setSettings } from "../lib/storage.js";
import { PROVIDERS, PROVIDER_ORDER, IMAGE_SIZES, WRITING_PRESETS, isConnected } from "../lib/models.js";
import { connectOpenRouter } from "../lib/auth.js";
import { listModels } from "../lib/providers.js";
import { clearConversations } from "../lib/history.js";
import { THEMES, CUSTOM_KEYS, applyTheme, effectivePalette, UI_FONTS, applyFont, withOpacity } from "../lib/theme.js";
import { t, setLang, applyDom } from "../lib/i18n.js";
import { SHORTCUT_ACTIONS, defaultShortcuts, comboFromEvent, isBindable, normalizeCombo, comboKeys, isMacPlatform, isReservedCombo, findConflicts } from "../lib/shortcuts.js";
import { encryptSettings, decryptSettings } from "../lib/syncCrypto.js";
import { setHTML } from "../lib/dom.js";
import { memoryModelChoices, MEMORY_ROLES } from "../lib/memory-models.js";
import { QUICK_TOGGLES, QUICK_CATS, quickState, quickPatch } from "../lib/quick-toggles.js";

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
  applyColorScheme(); // native controls follow the theme lightness
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
// ----- Quick access ------------------------------------------------------------------------------
// One switch per setting people flip most (lib/quick-toggles.js). A switch saves on the spot,
// keeps the detailed control further down in step (the debounced auto-save reads those controls,
// so a stale one would write the old value back), and previews on this page when it can.
const QA_ICONS = {
  anon: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/></svg>',
  suggest: '<svg viewBox="0 0 24 24"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  artifacts: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 9-3 3 3 3"/><path d="m15 9 3 3-3 3"/></svg>',
  verify: '<svg viewBox="0 0 24 24"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m22 4-10 10-3-3"/></svg>',
  compact: '<svg viewBox="0 0 24 24"><path d="m4 14 6 0 0 6"/><path d="m20 10-6 0 0-6"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>',
  memory: '<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 8 0v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-4-4z"/><path d="M9 9h6"/><path d="M9 15h6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  tabNotif: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  smooth: '<svg viewBox="0 0 24 24"><path d="M3 12h3l2-6 4 14 3-9 2 4h4"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  neon: '<svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  contour: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/></svg>',
  replyOutline: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/></svg>',
  railRight: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  lang: '<svg viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
};
const QA_CAT_LABEL = { assistant: "opt.qa.catAssistant", feedback: "opt.qa.catAccess", look: "opt.qa.catDesign" };
const qaTiles = {};

// Push a patch written by a quick switch into this page: the settings object, the detailed
// control, and the live preview.
function reflectPatch(patch) {
  Object.assign(settings, patch);
  const chk = (id, v) => { if ($(id)) $(id).checked = v; };
  if ("privacyLevel" in patch && $("privacyLevel")) $("privacyLevel").value = patch.privacyLevel;
  for (const k of ["webSearch", "suggestNext", "compressHistory", "memoryEnabled", "soundOnDone", "tabDoneIndicator", "smoothStream", "textOutlineOn", "contourOn", "msgBorderOn"]) {
    if (k in patch) chk(k, !!patch[k]);
  }
  if ("textOutlineOn" in patch) document.body.classList.toggle("text-outline", !!patch.textOutlineOn);
  if ("contourOn" in patch) document.body.classList.toggle("title-contour", !!patch.contourOn);
  if ("railSide" in patch && $("railSide")) $("railSide").value = patch.railSide;
  if ("theme" in patch) {
    curTheme = patch.theme;
    curColors = { ...(patch.themeColors || {}) };
    if ($("theme")) $("theme").value = curTheme;
    syncColorPickers(); applyThemeLive();
  }
}
function syncQuickAccess() {
  for (const q of QUICK_TOGGLES) {
    const tile = qaTiles[q.id];
    if (!tile) continue;
    const on = quickState(q.id, settings);
    tile.classList.toggle("on", on);
    tile.querySelector("input").checked = on;
    tile.querySelector(".qa-state").textContent = t(on ? "opt.qa.on" : "opt.qa.off");
  }
}
function buildQuickAccess() {
  const host = $("quickToggles");
  if (!host) return;
  host.replaceChildren();
  for (const cat of QUICK_CATS) {
    host.appendChild(el("div", "qa-cat", t(QA_CAT_LABEL[cat])));
    const grid = el("div", "qa-grid");
    for (const q of QUICK_TOGGLES.filter((x) => x.cat === cat)) {
      const tile = el("label", "qa-tile");
      tile.dataset.qa = q.id;
      const ic = el("span", "qa-ic");
      setHTML(ic, QA_ICONS[q.id] || ""); // trusted static SVG
      const txt = el("span", "qa-txt");
      txt.append(el("span", "qa-name", t(q.labelKey)), el("span", "qa-state"));
      const sw = el("span", "switch");
      const inp = el("input");
      inp.type = "checkbox";
      inp.dataset.quick = "1"; // saved here, not by the debounced auto-save
      sw.append(inp, el("span", "track"));
      inp.addEventListener("change", async () => {
        const patch = quickPatch(q.id, inp.checked, settings);
        reflectPatch(patch);
        syncQuickAccess();
        try { await setSettings(patch); flash($("status"), t("opt.savedAuto")); } catch (_) {}
      });
      tile.append(ic, txt, sw);
      grid.appendChild(tile);
      qaTiles[q.id] = tile;
    }
    // The interface language sits with the look: a small picker rather than a switch.
    if (cat === "look") {
      const tile = el("div", "qa-tile qa-lang");
      const ic = el("span", "qa-ic");
      setHTML(ic, QA_ICONS.lang);
      const txt = el("span", "qa-txt");
      txt.append(el("label", "qa-name", t("opt.qa.lang")));
      txt.firstChild.htmlFor = "qaLang";
      const sel = el("select");
      sel.id = "qaLang";
      sel.dataset.quick = "1";
      for (const o of $("uiLang").options) { const c = el("option", null, o.textContent); c.value = o.value; sel.appendChild(c); }
      sel.value = settings.uiLang || "en";
      // Same path as the detailed picker: save, then reload the page in the new language.
      sel.addEventListener("change", () => { $("uiLang").value = sel.value; $("uiLang").dispatchEvent(new Event("change")); });
      txt.appendChild(sel); // under its name: a picker needs more room than a switch
      tile.append(ic, txt);
      grid.appendChild(tile);
    }
    host.appendChild(grid);
  }
  syncQuickAccess();
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
let booted = false; // load() runs again after an OAuth connect: one-time wiring is skipped then
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

// A provider is a collapsible card: its name and connection state in the summary (always
// visible), its fields inside. Twenty open cards made the page several screens long; collapsed,
// the list reads at a glance and a provider opens with one click.
const ddCaret = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "16"); s.setAttribute("height", "16");
  s.setAttribute("class", "dd-caret"); s.setAttribute("aria-hidden", "true");
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", "m6 9 6 6 6-6"); s.appendChild(p);
  return s;
};
// A labelled field (label above its input) inside a provider card.
function field(labelText, inp) {
  const lab = el("label", "field");
  lab.appendChild(el("span", null, labelText));
  lab.appendChild(inp);
  return lab;
}

function buildCard(id) {
  const meta = PROVIDERS[id];
  const sec = el("details", "prov");
  sec.id = "prov_" + id;

  const head = el("summary");
  // "Local (Ollama)" already says it: the suffix only for a local server whose name does not.
  head.appendChild(el("h3", null, meta.label + (meta.local && !/^local\b/i.test(meta.label) ? t("opt.localSuffix") : "")));
  const badges = el("span", "prov-badges");
  if (FREE_TIER.has(id)) badges.appendChild(el("span", "badge free", t("opt.badge.free")));
  const badge = el("span", "badge");
  badges.appendChild(badge);
  head.appendChild(badges);
  head.appendChild(ddCaret());
  sec.appendChild(head);
  const body = el("div", "prov-body");
  sec.appendChild(body);

  // Connect affordance on EVERY cloud provider. P8 — the badge AND this button now
  // reflect the connection state live (as soon as a key is pasted, before saving),
  // so "Se connecter" never lingers next to an already-connected provider.
  let connectBtn = null;
  if (category(id) === "cloud") {
    connectBtn = el("button", "small connect");
    connectBtn.type = "button";
    connectBtn.addEventListener("click", () => connectAccount(id));
    body.appendChild(connectBtn);
    body.appendChild(el("p", "hint", OAUTH.has(id) ? t("opt.hint.oauth") : t("opt.hint.key")));
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
    const lab = el("label", "row row-switch");
    const txt = el("span", "row-text");
    txt.appendChild(el("span", "row-title", t("opt.local.enable")));
    lab.appendChild(txt);
    const sw = el("span", "switch");
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
    sw.appendChild(inp);
    sw.appendChild(el("span", "track"));
    lab.appendChild(sw);
    body.appendChild(lab);
    body.appendChild(el("p", "hint", t("opt.local.hint")));
  }

  // API key.
  if (meta.needsKey || id === "custom") {
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
    body.appendChild(field(meta.needsKey ? t("opt.key.label") : t("opt.key.labelOpt"), inp));
    if (meta.keysUrl) {
      const p = el("p", "muted");
      p.textContent = FREE_TIER.has(id) ? t("opt.key.getFree") : t("opt.key.console");
      const a = document.createElement("a");
      a.href = meta.keysUrl; a.target = "_blank"; a.rel = "noreferrer";
      a.textContent = meta.keysUrl.replace(/^https?:\/\//, "");
      p.appendChild(a);
      body.appendChild(p);
    }
  }

  // Base URL (local / custom).
  if (meta.local || meta.custom) {
    const inp = el("input");
    inp.type = "text";
    inp.id = `url_${id}`;
    inp.placeholder = meta.baseUrl || "https://your-server/v1";
    inp.value = (settings.baseUrls && settings.baseUrls[id]) || "";
    body.appendChild(field(t("opt.url.label"), inp));

    // Manual model name(s) — so a local model can ALWAYS be imported even when the server
    // can't be auto-listed (CORS-blocked Ollama, a custom endpoint with no /models route…).
    const minp = el("input");
    minp.type = "text";
    minp.id = `models_${id}`;
    minp.placeholder = "llama3.1, qwen2.5-coder, mistral…";
    minp.value = ((settings.userModels && settings.userModels[id]) || []).join(", ");
    body.appendChild(field(t("opt.models.label"), minp));
    body.appendChild(el("p", "muted", t("opt.models.hint")));
  }

  // No per-provider "default model" here: the model is chosen in the sidebar's own
  // picker and the LAST-USED one is remembered automatically (per provider). Forcing a
  // default here would override that, so it has been removed on purpose.

  return sec;
}

// Filter the settings as you type: whole sections that match are kept; inside the (long)
// AI providers section, individual provider cards are filtered too — and opened, so the match
// is visible.
function applySettingsFilter(q) {
  q = (q || "").trim().toLowerCase();
  document.querySelectorAll("main > section").forEach((sec) => {
    const title = (sec.querySelector("h2") ? sec.querySelector("h2").textContent : "").toLowerCase();
    const titleHit = !!q && title.includes(q);
    const provDiv = sec.querySelector("#providers");
    if (provDiv) {
      let any = false;
      provDiv.querySelectorAll(".prov").forEach((card) => {
        const hit = !q || titleHit || (card.textContent || "").toLowerCase().includes(q);
        card.style.display = hit ? "" : "none";
        if (q && hit && !titleHit) card.open = true;
        if (hit) any = true;
      });
      provDiv.querySelectorAll(".group-title").forEach((g) => { g.style.display = q && !titleHit ? "none" : ""; });
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
  // Keep the cards the user opened open across a rebuild (a key pasted in the sidebar rebuilds them).
  const open = new Set([...root.querySelectorAll("details.prov[open]")].map((d) => d.id));
  root.innerHTML = "";
  let lastCat = null;
  // Privacy first: your own machine, then your own server, then the clouds.
  const rank = { local: 0, custom: 1, cloud: 2 };
  for (const id of [...PROVIDER_ORDER].sort((a, b) => rank[category(a)] - rank[category(b)])) {
    const cat = category(id);
    if (cat !== lastCat) {
      root.appendChild(el("div", "group-title", t("opt.group." + cat)));
      lastCat = cat;
    }
    const card = buildCard(id);
    if (open.has(card.id)) card.open = true;
    root.appendChild(card);
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
  "sec-quickaccess": '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="6"/><circle cx="16" cy="12" r="3"/></svg>',
  "sec-shortcuts": '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 15h8"/></svg>',
  "sec-sync": '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// Encrypted settings backup/sync (BYOK stays local — nothing is uploaded).
function wireSync() {
  const exportBtn = $("syncExport"), importBtn = $("syncImport"), importInput = $("syncFile");
  if (!exportBtn || exportBtn.dataset.wired) return;
  exportBtn.dataset.wired = "1";
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
    } catch (e) { window.alert(t("opt.sync.exportFail") + " " + (e && e.message || e)); }
  });
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
  importBtn.addEventListener("click", () => importInput.click());
}

// ----- Keyboard shortcuts --------------------------------------------------------------------------
// One row per action: its name, the combo drawn as key caps, a button to disable it and one to
// restore its default. Click the combo to record a new one: the next key press with Ctrl, Alt or ⌘
// is taken; Esc cancels, Backspace/Delete disables. A combo already used by another action moves
// here (and says so); a combo the browser keeps for itself is flagged, because it never reaches
// the sidebar.
const SC_ICON_CLEAR = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const SC_ICON_RESET = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
const IS_MAC = isMacPlatform();
let scMap = null;          // the full map being edited (stored map merged over the defaults)
let scNotes = {};          // actionId → a one-off note ("taken from …")
let scRecording = null;    // { id, btn, onKey, onBlur } while a combo is being recorded

function shortcutLabel(id) {
  const a = SHORTCUT_ACTIONS.find((x) => x.id === id);
  return a ? t(a.labelKey) : id;
}
function drawCombo(btn, combo) {
  btn.replaceChildren();
  const keys = comboKeys(combo, IS_MAC);
  if (!keys.length) { btn.appendChild(el("span", "sc-none", t("opt.shortcuts.none"))); return; }
  keys.forEach((k, i) => {
    if (i) btn.appendChild(el("span", "sc-plus", "+"));
    btn.appendChild(el("kbd", null, k));
  });
}
function saveShortcuts() {
  settings.shortcuts = { ...scMap };
  setSettings({ shortcuts: settings.shortcuts }).then(() => flash($("status"), t("opt.savedAuto"))).catch(() => {});
}
function stopRecording(render = true) {
  if (!scRecording) return;
  const { btn, onKey, onBlur } = scRecording;
  btn.removeEventListener("keydown", onKey, true);
  btn.removeEventListener("blur", onBlur);
  btn.classList.remove("recording");
  btn.setAttribute("aria-pressed", "false");
  scRecording = null;
  if (render) renderShortcuts();
}
function assignShortcut(id, combo) {
  const notes = {};
  if (combo) {
    // One combo, one action: take it from whichever action had it.
    for (const a of SHORTCUT_ACTIONS) {
      if (a.id !== id && normalizeCombo(scMap[a.id]) === combo) {
        scMap[a.id] = "";
        notes[id] = t("opt.shortcuts.moved", { action: shortcutLabel(a.id) });
        notes[a.id] = t("opt.shortcuts.removed", { action: shortcutLabel(id) });
      }
    }
  }
  scMap[id] = combo;
  scNotes = notes;
  saveShortcuts();
}
function startRecording(id, btn) {
  stopRecording(false);
  scNotes = {};
  btn.classList.add("recording");
  btn.setAttribute("aria-pressed", "true");
  btn.replaceChildren(el("span", null, t("opt.shortcuts.recording")));
  const onKey = (e) => {
    // Tab with no modifier leaves the field (keyboard users must never be trapped here).
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) { stopRecording(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { stopRecording(); btn.focus(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) {
      assignShortcut(id, ""); stopRecording(); focusShortcut(id); return;
    }
    const combo = comboFromEvent(e);
    if (!combo) {
      // Modifiers alone: show what is held so far.
      const held = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
      if (held.length) drawCombo(btn, held.join("+") + "+…");
      return;
    }
    if (!isBindable(combo)) {
      btn.replaceChildren(el("span", null, t("opt.shortcuts.needMod")));
      return;
    }
    assignShortcut(id, combo);
    stopRecording();
    focusShortcut(id);
  };
  const onBlur = () => stopRecording();
  btn.addEventListener("keydown", onKey, true);
  btn.addEventListener("blur", onBlur);
  scRecording = { id, btn, onKey, onBlur };
}
function focusShortcut(id) {
  const b = document.querySelector(`.sc-key[data-action="${id}"]`);
  if (b) b.focus();
}
function renderShortcuts() {
  const host = $("shortcutsList");
  if (!host) return;
  if (!scMap) scMap = { ...defaultShortcuts(), ...(settings.shortcuts || {}) };
  const conflicts = findConflicts(scMap);
  host.replaceChildren();
  for (const a of SHORTCUT_ACTIONS) {
    const combo = normalizeCombo(scMap[a.id]);
    const row = el("div", "sc-row");
    const label = el("span", "sc-label", t(a.labelKey));
    label.id = "scl_" + a.id;
    const ctl = el("div", "sc-ctl");
    const btn = el("button", "sc-key");
    btn.type = "button";
    btn.dataset.action = a.id;
    btn.setAttribute("aria-labelledby", label.id);
    btn.setAttribute("aria-pressed", "false");
    btn.title = t("opt.shortcuts.edit");
    drawCombo(btn, combo);
    btn.addEventListener("click", () => {
      if (scRecording && scRecording.id === a.id) { stopRecording(); return; }
      startRecording(a.id, btn);
    });
    const clear = el("button", "sc-icon");
    clear.type = "button";
    clear.title = t("opt.shortcuts.clear");
    clear.setAttribute("aria-label", t("opt.shortcuts.clear") + " — " + t(a.labelKey));
    setHTML(clear, SC_ICON_CLEAR);
    clear.hidden = !combo;
    clear.addEventListener("click", () => { assignShortcut(a.id, ""); renderShortcuts(); });
    const reset = el("button", "sc-icon");
    reset.type = "button";
    reset.title = t("opt.shortcuts.resetOne", { combo: comboKeys(a.def, IS_MAC).join(IS_MAC ? "" : "+") });
    reset.setAttribute("aria-label", reset.title);
    setHTML(reset, SC_ICON_RESET);
    reset.hidden = combo === normalizeCombo(a.def);
    reset.addEventListener("click", () => { assignShortcut(a.id, normalizeCombo(a.def)); renderShortcuts(); });
    ctl.append(btn, clear, reset);
    const note = el("div", "sc-note");
    if (scNotes[a.id]) note.textContent = scNotes[a.id];
    else if (conflicts[a.id]) { note.textContent = t("opt.shortcuts.dup", { action: shortcutLabel(conflicts[a.id]) }); note.classList.add("warn"); }
    else if (combo && isReservedCombo(combo)) { note.textContent = t("opt.shortcuts.reserved"); note.classList.add("warn"); }
    row.append(label, ctl, note);
    host.appendChild(row);
  }
}
function wireShortcuts() {
  const reset = $("shortcutsReset");
  if (reset && !reset.dataset.wired) {
    reset.dataset.wired = "1";
    reset.addEventListener("click", () => { stopRecording(false); scMap = defaultShortcuts(); scNotes = {}; saveShortcuts(); renderShortcuts(); });
  }
  renderShortcuts();
}

// Quick connect is onboarding-only: once any provider is connected, hide it entirely.
function updateQuickConnectVisibility() {
  const quick = document.getElementById("sec-quick");
  if (quick) quick.style.display = anyConnected() ? "none" : "";
}
function anyConnected() {
  try { return (PROVIDER_ORDER || []).some((id) => isConnected(id, settings)); } catch (_) { return false; }
}
// Quick-navigation pins: one per settings section, with smooth scroll + a scroll-spy
// that highlights the section currently in view. Built from <section id> + its <h2>.
let spyBound = false;
function buildQuickNav() {
  const nav = $("quicknav");
  if (!nav) return;
  nav.replaceChildren();
  const links = [];
  document.querySelectorAll("main > section[id]").forEach((sec) => {
    if (sec.style.display === "none") return; // skip hidden sections (e.g. Quick connect once connected)
    const h = sec.querySelector("h2");
    if (!h) return;
    const a = el("a", "qn-pin");
    const ic = el("span", "qn-ic");
    if (SECTION_ICONS[sec.id]) setHTML(ic, SECTION_ICONS[sec.id]); // trusted static SVG
    a.appendChild(ic);
    a.appendChild(el("span", "qn-text", h.textContent.trim()));
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
    const top = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 84) + 24;
    let active = links[0];
    for (const l of links) if (l.sec.style.display !== "none" && l.sec.getBoundingClientRect().top <= top) active = l;
    // At the very bottom the last short sections can never reach the top: light the last one.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = links[links.length - 1];
    links.forEach((l) => l.a.classList.toggle("active", l === active));
    // Narrow layout: keep the active pin visible in the horizontal strip.
    if (active && nav.scrollWidth > nav.clientWidth + 4 && active.a.dataset.shown !== "1") {
      links.forEach((l) => { l.a.dataset.shown = ""; });
      active.a.dataset.shown = "1";
      const strip = nav.closest(".sidenav");
      if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: active.a.offsetLeft - 24, behavior: "smooth" });
    }
  };
  window.__hvSpy = spy;
  if (!spyBound) { window.addEventListener("scroll", () => window.__hvSpy && window.__hvSpy(), { passive: true }); spyBound = true; }
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

// The narrow layout's sticky jump strip sits right under the top bar, whose height changes when
// its search field wraps.
function trackTopbarHeight() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const set = () => document.documentElement.style.setProperty("--topbar-h", bar.offsetHeight + "px");
  set();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(set).observe(bar);
}

// Native controls (select lists, scrollbars, the colour dialog) follow the theme's lightness.
function applyColorScheme() {
  const bg = toHexColor(effectivePalette(curTheme, curColors).bg);
  const n = parseInt(bg.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  document.documentElement.style.colorScheme = lum > 0.5 ? "light" : "dark";
}

async function load() {
  settings = await getSettings();
  curTheme = settings.theme || "dark";
  curColors = { ...(settings.themeColors || {}) };
  applyThemeLive();                        // theme the options page too
  setLang(settings.uiLang || "en");       // English default; other languages via the uiLang setting
  const first = !booted;
  booted = true;
  if (first) {
    applyDom(document);                    // fill all data-i18n static markup
    document.documentElement.lang = settings.uiLang || "en";
    buildThemeControls();                  // listeners + eyedroppers: once (load() runs again after an OAuth connect)
    buildOpacityModal();                   // element-colour opacity popup (Settings → Appearance)
    wireSync();                            // encrypted settings backup / sync
    wireMemory();
    trackTopbarHeight();
  }
  scMap = null; wireShortcuts();           // configurable keyboard shortcuts
  buildQuickAccess();                      // Quick access switches
  updateQuickConnectVisibility();          // Quick connect only until a provider is connected
  buildQuickNav();                         // jump pins to each section
  addSectionIcons();                       // same line icons on each section title
  document.documentElement.classList.add("theme-ready"); // themed + translated: reveal (see options.css)
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
  if ($("msgBorderOn")) $("msgBorderOn").checked = settings.msgBorderOn === true;
  // Neon title outline is its own option (decoupled from icon boxes) — live-preview the h1 outline.
  if ($("textOutlineOn")) {
    $("textOutlineOn").checked = settings.textOutlineOn === true;
    document.body.classList.toggle("text-outline", settings.textOutlineOn === true);
    if (first) $("textOutlineOn").addEventListener("change", () => document.body.classList.toggle("text-outline", $("textOutlineOn").checked));
  }
  // Crisp contour is its own option (own colour), combinable with neon — live-preview the h1.
  if ($("contourOn")) {
    $("contourOn").checked = settings.contourOn === true;
    document.body.classList.toggle("title-contour", settings.contourOn === true);
    if (first) $("contourOn").addEventListener("change", () => document.body.classList.toggle("title-contour", $("contourOn").checked));
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
  $("suggestNext").checked = settings.suggestNext !== false;
  $("privacyLevel").value = settings.privacyLevel || "balanced";
  $("privacyTerms").value = (settings.privacyTerms || []).join("\n");
  $("privacyTrustOwn").checked = settings.privacyTrustOwn !== false;
  $("saveHistory").checked = settings.saveHistory;
  $("includePageContext").checked = settings.includePageContext;
  $("autoReadPage").checked = settings.autoReadPage;
  $("maxPageChars").value = settings.maxPageChars;
  $("cleanContext").checked = settings.cleanContext !== false;
  $("compressHistory").checked = settings.compressHistory !== false;
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
    suggestNext: $("suggestNext").checked,
    privacyLevel: $("privacyLevel").value,
    privacyTerms: $("privacyTerms").value.split("\n").map((w) => w.trim()).filter(Boolean),
    privacyTrustOwn: $("privacyTrustOwn").checked,
    saveHistory: $("saveHistory").checked,
    includePageContext: $("includePageContext").checked,
    autoReadPage: $("autoReadPage").checked,
    maxPageChars: parseInt($("maxPageChars").value, 10) || 12000,
    cleanContext: $("cleanContext").checked,
    compressHistory: $("compressHistory").checked,
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
function scheduleAutoSave(e) {
  // Quick access switches save themselves (one key, at once); the debounced pass is for the rest.
  if (e && e.target && e.target.dataset && e.target.dataset.quick) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      const patch = collectSettings();
      await setSettings(patch);
      Object.assign(settings, patch);
      syncQuickAccess(); // a detailed control changed: its quick switch follows
      flash($("status"), t("opt.savedAuto"));
    } catch (_) {}
  }, 500);
}

// The status line in the top bar: a confirmation for a moment, then back to its resting text.
let flashTimers = new WeakMap();
function flash(node, text) {
  if (!node) return;
  if (!node.dataset.rest) node.dataset.rest = node.id === "status" ? t("opt.autosaveNote") : "";
  node.textContent = text;
  node.classList.toggle("flash", !!text);
  clearTimeout(flashTimers.get(node));
  flashTimers.set(node, setTimeout(() => { node.textContent = node.dataset.rest; node.classList.remove("flash"); }, 2500));
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
  const card = $(`prov_${id}`);
  if (card) card.open = true;
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
    scheduleAutoSave(e);
  }
});
$("quickConnect").addEventListener("click", async () => {
  flash($("quickStatus"), t("opt.dyn.connecting"));
  await connectAccount("openrouter");
  flash($("quickStatus"), isConnected("openrouter", settings) ? t("opt.quick.savedNote") : "");
  if (isConnected("openrouter", settings)) { updateQuickConnectVisibility(); buildQuickNav(); } // hide the now-pointless Quick connect
});
$("clearHistoryBtn").addEventListener("click", async () => {
  await clearConversations();
  flash($("status"), t("opt.cleared"));
});

// Reflect changes made elsewhere: a connection made in the sidebar rebuilds the provider cards;
// a switch flipped in the sidebar (anonymisation badge, Verify chip…) moves its quick switch here.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !settings) return;
  const prefs = ["privacyLevel", "privacyLevelOn", "webSearch", "suggestNext", "artifacts", "verifyAnswers", "compressHistory", "memoryEnabled", "soundOnDone", "tabDoneIndicator", "smoothStream", "textOutlineOn", "contourOn", "msgBorderOn", "railSide"];
  const patch = {};
  for (const k of prefs) if (changes[k] && settings[k] !== changes[k].newValue) patch[k] = changes[k].newValue;
  if (Object.keys(patch).length) { reflectPatch(patch); syncQuickAccess(); }
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
