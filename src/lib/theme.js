// Colour themes + per-user custom-colour overrides.
//
// A theme is just a palette; applyTheme() writes it onto CSS custom properties on
// :root, so BOTH the sidebar and the options page restyle live. Users can pick a
// theme AND override individual colours on top of it (stored in settings.themeColors).

// Each theme defines a 5-colour palette (background, surface, accent, accent2, text);
// the rest (panel2 / borders / muted) is tuned per theme. `split` controls the brand
// gradient: `accent` is the base majority and `accent2` only the end touch, where
// `split` is the % of the gradient held solid by accent before it transitions
// (0 → a balanced accent↔accent2; 0.4 → ~70% accent / 30% accent2).
export const THEMES = {
  dark:   { label: "Default (dark)",   bg: "#09090b", panel: "rgba(26,25,34,0.86)", panel2: "rgba(38,36,50,0.88)", border: "rgba(255,255,255,0.10)", borderSoft: "rgba(255,255,255,0.05)", text: "#f4f2fc", muted: "rgba(236,232,248,0.64)", accent: "#6366f1", accent2: "#8b5cf6", split: 0.4 },
  hive:   { label: "Hivey (Brand)",    bg: "#0f1115", panel: "#1a1d24", panel2: "#242832", border: "#2c313c", borderSoft: "#20242d", text: "#f9fafb", muted: "#9ca3af", accent: "#d97706", accent2: "#f59e0b", split: 0.4 },
  modern: { label: "Modern (Teal)",    bg: "#090d16", panel: "#121b2c", panel2: "#1b2840", border: "#243349", borderSoft: "#182338", text: "#f4f4f5", muted: "#8b9bb0", accent: "#0d9488", accent2: "#14b8a6", split: 0.4 },
  neon:   { label: "Neon / Cyberpunk", bg: "#05050a", panel: "#0f0f1a", panel2: "#18182a", border: "#232342", borderSoft: "#1a1a30", text: "#ffffff", muted: "#9a9ac4", accent: "#06b6d4", accent2: "#d946ef", split: 0.0 },
  sunset: { label: "Midnight Sunset",  bg: "#110e18", panel: "#1d1827", panel2: "#2a2236", border: "#382c44", borderSoft: "#261e30", text: "#fafafa", muted: "#b5a6b8", accent: "#e11d48", accent2: "#ea580c", split: 0.2 },
  // Hivey Browser's Assistant (html.embed-hivey): near-black neutral surfaces and hairlines; colour is
  // kept for what moves or is active, in the Hivey gradient. Not offered outside the browser.
  graphite: { label: "Graphite", bg: "#101013", panel: "#151518", panel2: "#1b1b1f", border: "rgba(255,255,255,0.09)", borderSoft: "rgba(255,255,255,0.05)", text: "#ececee", muted: "rgba(236,236,238,0.56)", accent: "#3b82f6", accent2: "#d946ef", gradient: "linear-gradient(90deg, #3b82f6, #8b5cf6, #d946ef)", browserOnly: true, split: 0.5 },
  light:  { label: "Light (Premium)",  bg: "#f4f5f7", panel: "#ffffff", panel2: "#f4f4f5", border: "#e2e8f0", borderSoft: "#eef1f5", text: "#18181b", muted: "#64748b", accent: "#6366f1", accent2: "#8b5cf6", split: 0.4 },
};

// The colour keys a user can override (shown as pickers in Settings).
export const CUSTOM_KEYS = ["accent", "accent2", "bg", "panel", "text", "muted"];

export function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
// A colour with an optional opacity (0–100). 100 (or unset) → the raw hex unchanged.
export function withOpacity(hex, op) {
  if (op == null || op >= 100 || !hex) return hex;
  return hexToRgba(hex, Math.max(0, op) / 100);
}
// Relative luminance (0 = black … 1 = white) for picking a contrasting foreground.
function luminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  if (!m) return 0.5;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16));
}
// A readable foreground (near-white or near-black) for a given surface colour — so buttons and
// gradient chips stay legible whatever accent / text colour the user picks.
function onColor(hex) { return luminance(hex) > 0.55 ? "#0b0b14" : "#ffffff"; }

// Effective palette = theme defaults with the user's overrides applied on top.
export function effectivePalette(themeKey, custom) {
  const base = THEMES[themeKey] || THEMES.dark;
  return { ...base, ...(custom || {}) };
}

// ── UI font picker ────────────────────────────────────────────────────────────
// A curated set of the most-used MODERN web/UI typefaces (2025 norms). Each is bundled
// locally as a variable woff2 in vendor/fonts (loaded via vendor/fonts/fonts.css) so it
// works offline with no external request — the `key` matches the @font-face family.
// "" = the OS system stack (no webfont).
export const UI_FONTS = [
  { key: "",        label: "Système (par défaut)", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { key: "inter",   label: "Inter",                stack: '"Inter", system-ui, sans-serif' },
  { key: "manrope", label: "Manrope",              stack: '"Manrope", system-ui, sans-serif' },
  { key: "jakarta", label: "Plus Jakarta Sans",    stack: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { key: "dmsans",  label: "DM Sans",              stack: '"DM Sans", system-ui, sans-serif' },
  { key: "outfit",  label: "Outfit",               stack: '"Outfit", system-ui, sans-serif' },
  { key: "figtree", label: "Figtree",              stack: '"Figtree", system-ui, sans-serif' },
];
export function fontStack(key) {
  const f = UI_FONTS.find((x) => x.key === (key || ""));
  return (f || UI_FONTS[0]).stack;
}
// Apply the chosen UI font live by setting --ui-font on the root (body CSS reads it).
export function applyFont(key) {
  document.documentElement.style.setProperty("--ui-font", fontStack(key));
}

export function applyTheme(themeKey, custom, opts) {
  const c = effectivePalette(themeKey, custom);
  const o = opts || {};
  const r = document.documentElement.style;
  const set = (k, v) => r.setProperty(k, v);
  set("--bg", c.bg);
  set("--panel", c.panel);
  set("--panel-2", c.panel2);
  set("--border", c.border);
  set("--border-soft", c.borderSoft);
  set("--text", c.text);
  set("--muted", c.muted);
  set("--accent", c.accent);
  set("--accent-2", c.accent2);
  set("--accent-3", c.accent2); // compat: legacy 3-stop gradients use accent-3 as the end touch
  // Brand gradient: accent is the base majority, accent2 only the end touch. `gradientOn:false`
  // → flat accent; `gradientSplit` (0–100) lets the user push the two-colour ratio (lower =
  // more aggressive accent2 spread).
  const gradOn = o.gradientOn !== false;
  const split = (typeof o.gradientSplit === "number" && o.gradientSplit >= 0)
    ? Math.max(0, Math.min(100, Math.round(o.gradientSplit)))
    : Math.round(((typeof c.split === "number") ? c.split : 0.4) * 100);
  if (gradOn) {
    // `split` is the % of the bar held by accent (colour 1): it's the gradient's interpolation
    // MIDPOINT hint, so split=5 → ~5% accent / 95% accent2, split=95 → ~95% accent / 5% accent2,
    // split=50 → an even blend.
    // EXPLICIT midpoint colour (a 50/50 blend via color-mix) at `split`% — NOT a bare CSS
    // colour-hint (`accent 0%, 55%, accent2 100%`). The hint form was being dropped by the
    // renderer, leaving --grad stuck at its stylesheet fallback, so changing the colour or the
    // slider appeared to "do nothing". A real 3-stop gradient always renders and tracks the slider.
    const mid = (a, b) => `color-mix(in srgb, ${a}, ${b})`;
    set("--grad", `linear-gradient(135deg, ${c.accent} 0%, ${mid(c.accent, c.accent2)} ${split}%, ${c.accent2} 100%)`);
    set("--grad-soft", `linear-gradient(135deg, ${hexToRgba(c.accent, 0.16)} 0%, ${mid(hexToRgba(c.accent, 0.16), hexToRgba(c.accent2, 0.16))} ${split}%, ${hexToRgba(c.accent2, 0.16)} 100%)`);
    set("--user", `linear-gradient(135deg, ${c.accent} 0%, ${mid(c.accent, c.accent2)} ${split}%, ${c.accent2} 100%)`);
    if (c.gradient) set("--grad", c.gradient);
  } else {
    set("--grad", `linear-gradient(135deg, ${c.accent}, ${c.accent})`); // flat accent (no gradient)
    set("--grad-soft", `linear-gradient(135deg, ${hexToRgba(c.accent, 0.16)}, ${hexToRgba(c.accent, 0.16)})`);
    set("--user", c.accent);
  }
  // Sync the brand mark (#hiveLogoA) with the gradient settings (split moves the midpoint, OFF =
  // solid accent). The header icons (#histg/#gearg) are NOT synced here — they have their own
  // colours via --top-icon-1/2 (see applyTopIcons in the sidebar).
  if (typeof document !== "undefined") {
    const g = document.getElementById("hiveLogoA");
    if (g) {
      const stops = g.querySelectorAll("stop");
      if (stops.length >= 3) {
        stops[0].setAttribute("style", `stop-color:${c.accent}`);
        stops[1].setAttribute("style", `stop-color:${c.accent}`);
        stops[1].setAttribute("offset", (split / 100).toFixed(3));
        stops[2].setAttribute("style", `stop-color:${gradOn ? c.accent2 : c.accent}`);
      }
    }
  }
  // Auto-contrasting foregrounds so controls never go invisible (e.g. white text on a light
  // accent, or a white text colour on a light panel). `--on-accent` = readable on the brand
  // gradient (judged on the dominant `accent`); `--on-surface` = readable on panel buttons.
  set("--on-accent", onColor(c.accent));
  set("--on-surface", onColor(c.panel2));
  if (document.body) document.body.classList.toggle("theme-light", themeKey === "light" && !(custom && custom.bg));
}
