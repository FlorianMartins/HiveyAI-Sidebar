// 🔗 Hivey Code ↔ sidebar sync bridge.
// Runs only on app.hivey.be (the greenfield Hivey Code) and the legacy code.hivey.be. It keeps the
// OpenRouter key in sync BOTH ways between this extension's storage (settings.keys.openrouter) and
// the web app's localStorage ("hivey.orKey"), so the sidebar and Hivey Code share one key/budget —
// a single account. Runs at document_start so the key is in place before the app reads it.
(async function () {
  try {
    if (!/(^|\.)hivey\.be$/.test(location.host)) return;
    const LS_KEY = "hivey.orKey";

    const store = await browser.storage.local.get("keys");
    const extKey = (store && store.keys && store.keys.openrouter) || "";
    let pageKey = "";
    try {
      pageKey = localStorage.getItem(LS_KEY) || "";
    } catch (_) {}

    // Push ALL provider keys (openrouter, anthropic, openai, google, groq…) to the app.
    function pushKeysToApp(allKeys) {
      const k = (allKeys && allKeys.openrouter) || "";
      try {
        localStorage.setItem(LS_KEY, k);
        localStorage.setItem("hivey.keys", JSON.stringify(allKeys || {}));
      } catch (_) {}
      try {
        // SECURITY: target THIS page's origin (not "*") so only the first-party Hivey Code app can
        // receive the keys — a cross-origin frame (e.g. Hivey Code's untrusted preview iframe) can't.
        window.postMessage({ source: "hivey-bridge", type: "keys", keys: allKeys || {} }, location.origin);
      } catch (_) {}
    }

    if (store && store.keys && Object.keys(store.keys).length) {
      pushKeysToApp(store.keys); // sidebar → app (all providers)
    } else if (!extKey && pageKey) {
      // app → sidebar : the user set a key in Hivey Code; save it back to the sidebar.
      const keys = (store && store.keys) || {};
      keys.openrouter = pageKey;
      try {
        await browser.storage.local.set({ keys });
      } catch (_) {}
    }

    // ── Shared THEME: mirror the sidebar's accent colour into Hivey Code (sidebar = source of truth
    // for the common colour). Hivey Code reads `hivey.accent` on load.
    const THEME_ACCENT = { dark: "#8b5cf6", hive: "#d97706", modern: "#0d9488", neon: "#06b6d4", sunset: "#e11d48", light: "#3b82f6" };
    function syncAccent(theme, themeColors) {
      const accent = (themeColors && themeColors.accent) || THEME_ACCENT[theme] || "#8b5cf6";
      try {
        localStorage.setItem("hivey.accent", accent);
        document.documentElement && document.documentElement.style.setProperty("--accent", accent);
      } catch (_) {}
    }
    try {
      const th = await browser.storage.local.get(["theme", "themeColors"]);
      syncAccent(th.theme, th.themeColors);
    } catch (_) {}

    // ── Shared FULL PALETTE: mirror the ENTIRE sidebar theme (not just the accent) into Hivey Code.
    // Content scripts can't import ES modules, so the palettes are inlined (kept in sync with
    // src/lib/theme.js THEMES). themeColors overrides win. Sent as { type:"theme", palette }.
    const THEME_PALETTES = {
      dark:   { bg: "#09090b", panel: "rgba(26,25,34,0.86)", panel2: "rgba(38,36,50,0.88)", border: "rgba(255,255,255,0.10)", borderSoft: "rgba(255,255,255,0.05)", text: "#f4f2fc", muted: "rgba(236,232,248,0.64)", accent: "#6366f1", accent2: "#8b5cf6" },
      hive:   { bg: "#0f1115", panel: "#1a1d24", panel2: "#242832", border: "#2c313c", borderSoft: "#20242d", text: "#f9fafb", muted: "#9ca3af", accent: "#d97706", accent2: "#f59e0b" },
      modern: { bg: "#090d16", panel: "#121b2c", panel2: "#1b2840", border: "#243349", borderSoft: "#182338", text: "#f4f4f5", muted: "#8b9bb0", accent: "#0d9488", accent2: "#14b8a6" },
      neon:   { bg: "#05050a", panel: "#0f0f1a", panel2: "#18182a", border: "#232342", borderSoft: "#1a1a30", text: "#ffffff", muted: "#9a9ac4", accent: "#06b6d4", accent2: "#d946ef" },
      sunset: { bg: "#110e18", panel: "#1d1827", panel2: "#2a2236", border: "#382c44", borderSoft: "#261e30", text: "#fafafa", muted: "#b5a6b8", accent: "#e11d48", accent2: "#ea580c" },
      light:  { bg: "#f4f5f7", panel: "#ffffff", panel2: "#f4f4f5", border: "#e2e8f0", borderSoft: "#eef1f5", text: "#18181b", muted: "#64748b", accent: "#6366f1", accent2: "#8b5cf6" },
    };
    function syncTheme(theme, themeColors) {
      const base = THEME_PALETTES[theme] || THEME_PALETTES.dark;
      const palette = Object.assign({}, base, themeColors || {});
      try { localStorage.setItem("hivey.themePalette", JSON.stringify(palette)); } catch (_) {}
      try { window.postMessage({ source: "hivey-bridge", type: "theme", palette }, location.origin); } catch (_) {}
    }
    try {
      const th2 = await browser.storage.local.get(["theme", "themeColors"]);
      syncTheme(th2.theme, th2.themeColors);
    } catch (_) {}
    // Flag the presence of the bridge so the web app can show "Open all settings" only when installed.
    try { if (document.documentElement) document.documentElement.dataset.hiveyBridge = "1"; } catch (_) {}

    // ── Shared LANGUAGE: mirror the sidebar's UI language (top-level `uiLang`) into Hivey Code, so the
    // web app follows the same FR/EN choice. Hivey Code reads `hivey.lang` on load.
    function syncLang(uiLang) {
      const lang = uiLang === "fr" ? "fr" : "en";
      try {
        localStorage.setItem("hivey.lang", lang);
      } catch (_) {}
      try {
        window.postMessage({ source: "hivey-bridge", type: "lang", lang }, location.origin);
      } catch (_) {}
    }

    // ── Shared APPEARANCE: map the sidebar's display settings (custom colours + background auras) to
    // Hivey Code's UiPrefs shape and push them live, so the two products stay visually identical.
    const AURA_BY_THEME = { dark: "#8b5cf6", hive: "#d97706", modern: "#0d9488", neon: "#06b6d4", sunset: "#e11d48", light: "#3b82f6" };
    function toHex(c) {
      if (typeof c !== "string") return null;
      c = c.trim();
      if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
      if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("").toLowerCase();
      const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
      if (m) { const h = (n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, "0"); return "#" + h(m[1]) + h(m[2]) + h(m[3]); }
      return null;
    }
    function alphaOf(c, def) { const m = typeof c === "string" && c.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/i); return m ? parseFloat(m[1]) : def; }
    function syncUi(s) {
      s = s || {};
      const tc = s.themeColors || {};
      const ui = {};
      const setHex = (k, c) => { const h = toHex(c); if (h) ui[k] = h; };
      ui.accent = toHex(tc.accent) || AURA_BY_THEME[s.theme] || "#6366f1";
      setHex("accent2", tc.accent2);
      setHex("bg", tc.bg);
      setHex("text", tc.text);
      setHex("muted", tc.muted);
      if (tc.panel) { const h = toHex(tc.panel); if (h) { ui.surfaceColor = h; ui.surfaceAlpha = alphaOf(tc.panel, 0.9); } }
      if (tc.border) { const h = toHex(tc.border); if (h) { ui.borderColor = h; ui.borderAlpha = alphaOf(tc.border, 0.1); } }
      if (s.auraColor) { const h = toHex(s.auraColor); if (h) ui.auraColor = h; }
      if (typeof s.auraOpacity === "number") ui.auraOpacity = s.auraOpacity;
      if (typeof s.auraSize === "number") ui.auraSize = s.auraSize;
      try { if (ui.accent) localStorage.setItem("hivey.accent", ui.accent); } catch (_) {}
      try {
        const prev = JSON.parse(localStorage.getItem("hivey.ui.theme") || "{}");
        const rest = Object.assign({}, ui); delete rest.accent;
        localStorage.setItem("hivey.ui.theme", JSON.stringify(Object.assign(prev, rest)));
      } catch (_) {}
      try { window.postMessage({ source: "hivey-bridge", type: "ui", ui }, location.origin); } catch (_) {}
    }

    const UI_KEYS = ["uiLang", "theme", "themeColors", "auraColor", "auraOpacity", "auraSize"];
    try {
      const st = await browser.storage.local.get(UI_KEYS);
      syncLang(st.uiLang);
      syncUi(st);
    } catch (_) {}

    // Keep key + theme + language + appearance fresh if the user changes them while this tab is open.
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.keys) pushKeysToApp(changes.keys.newValue || {});
        if (changes.theme || changes.themeColors) {
          browser.storage.local.get(["theme", "themeColors"]).then((th) => { syncAccent(th.theme, th.themeColors); syncTheme(th.theme, th.themeColors); });
        }
        if (changes.uiLang) syncLang(changes.uiLang.newValue);
        if (UI_KEYS.some((k) => changes[k])) browser.storage.local.get(UI_KEYS).then((st) => syncUi(st));
      });
    } catch (_) {}

    // Relay Hivey Code's "open sidebar settings" request to the background (which opens the options page).
    try {
      window.addEventListener("message", (e) => {
        // Only accept same-origin messages from the page itself (not from cross-origin frames).
        if (e.origin !== location.origin || e.source !== window) return;
        const d = e.data;
        if (d && d.source === "hivey-app" && d.action === "open-settings") {
          try {
            browser.runtime.sendMessage({ type: "hivey-open-options" });
          } catch (_) {}
        }
      });
    } catch (_) {}
  } catch (_) {
    // never break the page
  }
})();
