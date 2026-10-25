// Configurable keyboard shortcuts. Each action has a stable id, a default combo, and an i18n label
// key. The sidebar registers one keydown handler that maps a pressed combo → action id → handler.
// Stored in settings.shortcuts as { actionId: "Ctrl+Shift+N" } ("" = disabled). Local-only, like
// every setting.

export const SHORTCUT_ACTIONS = [
  { id: "newChat", labelKey: "sc.newChat", def: "Ctrl+Shift+O" },
  { id: "focusComposer", labelKey: "sc.focusComposer", def: "Ctrl+Shift+L" },
  { id: "toggleHistory", labelKey: "sc.toggleHistory", def: "Ctrl+Shift+H" },
  // Not Ctrl+Shift+W: both browsers keep it (close the window) and a page never receives it.
  { id: "toggleWeb", labelKey: "sc.toggleWeb", def: "Ctrl+Shift+E" },
  { id: "modeChat", labelKey: "sc.modeChat", def: "Ctrl+Shift+1" },
  { id: "modeTranslate", labelKey: "sc.modeTranslate", def: "Ctrl+Shift+2" },
  { id: "modeImprove", labelKey: "sc.modeImprove", def: "Ctrl+Shift+3" },
  { id: "modeSecurity", labelKey: "sc.modeSecurity", def: "Ctrl+Shift+5" },
  // Not Ctrl+Shift+P: Firefox keeps it (new private window).
  { id: "promptLibrary", labelKey: "sc.promptLibrary", def: "Ctrl+Shift+K" },
];

export function defaultShortcuts() {
  const out = {};
  for (const a of SHORTCUT_ACTIONS) out[a.id] = a.def;
  return out;
}

const MODS = ["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"];
// US-layout shifted digits. With Shift held, e.key is the symbol ("!") rather than the digit, so a
// combo recorded as "Ctrl+Shift+!" never matched the default "Ctrl+Shift+1".
const SHIFTED_DIGITS = { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0" };

// The key part of a combo, independent of the layout quirks that change e.key:
//   - digits come from the physical key (Shift+1 is "!" on QWERTY, "1" on AZERTY),
//   - a letter comes from e.key when it is one, otherwise from the physical key (Alt+N on a Mac
//     types "˜", a Cyrillic layout types "т"),
//   - Space has a name.
function keyPart(e) {
  const code = e.code || "";
  let m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  const key = e.key || "";
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  if (key === " " || code === "Space") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

// Canonical combo string from a keydown event, e.g. "Ctrl+Shift+N". Modifier order is fixed so the
// reverse lookup is stable. Returns "" for a modifier-only press.
export function comboFromEvent(e) {
  if (!e || MODS.includes(e.key)) return "";
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = keyPart(e);
  if (!k || k === "Unidentified" || k === "Dead") return "";
  parts.push(k);
  return parts.join("+");
}

// Bring a stored combo to the canonical form (older builds stored "Ctrl+Shift+!" for Ctrl+Shift+1).
export function normalizeCombo(combo) {
  if (!combo || typeof combo !== "string") return "";
  const parts = combo.split("+");
  // "Ctrl++" (the plus key) splits into an empty tail: keep the "+" as the key.
  let key = parts.pop();
  if (key === "" && parts.length && parts[parts.length - 1] === "") { parts.pop(); key = "+"; }
  const mods = new Set(parts);
  if (mods.has("Shift") && SHIFTED_DIGITS[key]) key = SHIFTED_DIGITS[key];
  if (/^[a-z]$/.test(key)) key = key.toUpperCase();
  const order = ["Ctrl", "Meta", "Alt", "Shift"].filter((m) => mods.has(m));
  return [...order, key].join("+");
}

// A combo is "bindable" only if it carries a non-shift modifier (so plain typing never triggers it).
export function isBindable(combo) {
  return /(?:Ctrl|Meta|Alt)\+/.test(combo || "");
}

// The action a pressed combo triggers, or null. `map` is the stored map merged over the defaults.
// An empty entry is a disabled shortcut. When two actions share a combo the first one listed wins
// (the settings page flags that case).
export function actionForCombo(map, combo) {
  if (!combo) return null;
  for (const a of SHORTCUT_ACTIONS) {
    const c = normalizeCombo(map && map[a.id]);
    if (c && c === combo) return a.id;
  }
  return null;
}

// Combos the browser keeps for itself: a page (and so the sidebar) never receives them, and some
// close the window. Ctrl and ⌘ alike, since Mac users press ⌘.
const RESERVED = new Set([
  "W", "Shift+W", "T", "Shift+T", "N", "Shift+N", "Q", "Shift+Q", "Shift+P", "Tab", "Shift+Tab",
].flatMap((k) => [`Ctrl+${k}`, `Meta+${k}`]).concat(["Alt+F4", "Ctrl+F4",
  "Ctrl+Shift+Y", // opens this very sidebar (manifest command: _execute_sidebar_action on Firefox, _execute_action on Chromium)
]));
export function isReservedCombo(combo) {
  return RESERVED.has(normalizeCombo(combo));
}

// Actions sharing a combo: { actionId: otherActionId } for every action whose combo is also used
// by another one.
export function findConflicts(map) {
  const seen = new Map();
  const out = {};
  for (const a of SHORTCUT_ACTIONS) {
    const c = normalizeCombo(map && map[a.id]);
    if (!c) continue;
    if (seen.has(c)) { out[a.id] = seen.get(c); if (!out[seen.get(c)]) out[seen.get(c)] = a.id; }
    else seen.set(c, a.id);
  }
  return out;
}

// The keys of a combo as the user's keyboard labels them: ⌃ ⌥ ⇧ ⌘ on a Mac, Ctrl / Alt / Shift /
// Win elsewhere. Returns an array of labels (one per key cap).
export function comboKeys(combo, mac) {
  const c = normalizeCombo(combo);
  if (!c) return [];
  const parts = c.split("+");
  if (c.endsWith("++")) { parts.splice(-2, 2, "+"); }
  const names = mac
    ? { Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" }
    : { Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };
  const keys = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: mac ? "↩" : "Enter", Escape: "Esc" };
  return parts.map((p) => names[p] || keys[p] || p);
}

export function isMacPlatform(nav) {
  const n = nav || (typeof navigator !== "undefined" ? navigator : {});
  const p = (n.userAgentData && n.userAgentData.platform) || n.platform || "";
  return /mac|iphone|ipad/i.test(p);
}
