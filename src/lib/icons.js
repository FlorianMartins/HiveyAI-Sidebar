// Line icons in place of emoji, so the interface reads as a tool and not as a chat app.
//
// The strings keep their emoji (they are short, they travel well through the six translations and
// the code that builds labels); what is DRAWN is an icon. `startIconizer` watches the page and
// swaps each known emoji in the interface's own text for an inline SVG of the same line style as
// the rest of the UI (24-grid, 2 px stroke, currentColor). Where an icon cannot go — a field's
// value, a <select> option, a tooltip — the emoji is simply dropped.
//
// Never inside what the model wrote or the user typed: `SKIP` lists those containers.

const P = (...d) => d.map((x) => (x.startsWith("<") ? x : `<path d="${x}"/>`)).join("");

/** name → inner SVG (24×24 grid). */
export const ICONS = {
  hive: '<g fill="currentColor" stroke="none"><rect x="4.25" y="2.25" width="15.5" height="3.5" rx="1.75"/><rect x="2" y="7.5" width="20" height="3.5" rx="1.75"/><rect x="3" y="12.75" width="18" height="3.5" rx="1.75"/><rect x="5.75" y="18" width="12.5" height="3.5" rx="1.75"/></g>',
  brain: P("M12 5a3 3 0 1 0-6 .1 4 4 0 0 0-2.5 5.8 4 4 0 0 0 .6 6.6A4 4 0 1 0 12 18Z", "M12 5a3 3 0 1 1 6 .1 4 4 0 0 1 2.5 5.8 4 4 0 0 1-.6 6.6A4 4 0 1 1 12 18Z", "M12 5v13"),
  search: P('<circle cx="11" cy="11" r="7"/>', "m20 20-4-4"),
  pen: P("M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"),
  eye: P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z", '<circle cx="12" cy="12" r="3"/>'),
  gift: P('<rect x="3" y="8" width="18" height="4" rx="1"/>', "M12 8v13", "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7", "M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"),
  image: P('<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="9" cy="9" r="2"/>', "m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"),
  file: P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6", "M16 13H8", "M16 17H8"),
  clip: P("m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"),
  folder: P("M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"),
  pin: P("M12 17v5", "M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"),
  book: P("M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"),
  sparkle: P("M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"),
  zap: P("M13 2 3 14h9l-1 8 10-12h-9l1-8Z"),
  target: P('<circle cx="12" cy="12" r="10"/>', '<circle cx="12" cy="12" r="6"/>', '<circle cx="12" cy="12" r="2"/>'),
  shield: P("M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"),
  ok: P('<circle cx="12" cy="12" r="10"/>', "m9 12 2 2 4-4"),
  ko: P('<circle cx="12" cy="12" r="10"/>', "m15 9-6 6", "m9 9 6 6"),
  laptop: P("M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.3 2.6a1 1 0 0 1-.9 1.4H3.6a1 1 0 0 1-.9-1.4L4 16"),
  repeat: P("m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"),
  pause: P('<rect x="6" y="4" width="4" height="16" rx="1"/>', '<rect x="14" y="4" width="4" height="16" rx="1"/>'),
  mouse: P('<rect x="5" y="2" width="14" height="20" rx="7"/>', "M12 6v4"),
  keyboard: P('<rect x="2" y="6" width="20" height="12" rx="2"/>', "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"),
  globe: P('<circle cx="12" cy="12" r="10"/>', "M2 12h20", "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"),
  camera: P("M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z", '<circle cx="12" cy="13" r="3"/>'),
  plug: P("M9 2v6", "M15 2v6", "M6 8h12v3a6 6 0 0 1-12 0Z", "M12 17v5"),
  gear: P('<circle cx="12" cy="12" r="3"/>', "M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"),
  thought: P("M7.9 20A9 9 0 1 0 4 16.1L2 22Z"),
  home: P("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"),
  lock: P('<rect x="3" y="11" width="18" height="11" rx="2"/>', "M7 11V7a5 5 0 0 1 10 0v4"),
  cloud: P("M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"),
  note: P("M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4", "M2 6h4M2 10h4M2 14h4M2 18h4", "M21.4 5.6a2.1 2.1 0 1 0-3-3l-5 5-1 4 4-1Z"),
  mic: P('<rect x="9" y="2" width="6" height="12" rx="3"/>', "M5 11a7 7 0 0 0 14 0", "M12 18v3"),
  compress: P("M4 14h6v6", "M20 10h-6V4", "m14 10 7-7", "m3 21 7-7"),
  hourglass: P("M5 22h14M5 2h14", "M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22", "M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"),
  mute: P("M11 5 6 9H2v6h4l5 4Z", "m22 9-6 6", "m16 9 6 6"),
  volume: P("M11 5 6 9H2v6h4l5 4Z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"),
  pointer: P("M9 11V5a2 2 0 0 1 4 0v5", "M13 10V9a2 2 0 0 1 4 0v2", "M17 11a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-2a7 7 0 0 1-5.6-2.8L4 16.4a2 2 0 0 1 3.2-2.4L9 16"),
  compass: P('<circle cx="12" cy="12" r="10"/>', "m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3Z"),
  puzzle: P("M19.4 15a1.7 1.7 0 0 0 0-3.4H18V8a2 2 0 0 0-2-2h-3.4V4.6a1.7 1.7 0 0 0-3.4 0V6H6a2 2 0 0 0-2 2v3.4h1.4a1.7 1.7 0 0 1 0 3.4H4V18a2 2 0 0 0 2 2h3.6v-1.4a1.7 1.7 0 0 1 3.4 0V20H16a2 2 0 0 0 2-2v-3Z"),
  download: P("M12 3v12", "m7 10 5 5 5-5", "M5 21h14"),
  key: P('<circle cx="7.5" cy="15.5" r="5.5"/>', "m21 2-9.6 9.6", "m15.5 7.5 3 3L22 7l-3-3"),
  alert: P("M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "M12 9v4", "M12 17h.01"),
  bot: P('<rect x="3" y="8" width="18" height="12" rx="2"/>', "M12 8V4H8", "M2 14h2M20 14h2M9 13v2M15 13v2"),
  bulb: P("M9 18h6", "M10 22h4", "M15.1 14c.2-1 .7-1.7 1.4-2.5A4.6 4.6 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"),
  mail: P('<rect x="2" y="4" width="20" height="16" rx="2"/>', "m22 7-10 6L2 7"),
  bell: P("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.9 1.9 0 0 0 3.4 0"),
  tabs: P('<rect x="3" y="7" width="14" height="14" rx="2"/>', "M7 3h12a2 2 0 0 1 2 2v12"),
  coins: P('<circle cx="8" cy="8" r="6"/>', "M18.1 10.4A6 6 0 1 1 10.3 18", "M7 6h1v4"),
  tag: P("M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z", '<circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),
  link: P("M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"),
  flag: P("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z", "M4 22v-7"),
  timer: P('<circle cx="12" cy="14" r="8"/>', "M10 2h4", "m12 14 3-3"),
  chart: P("M3 3v18h18", "M7 16v-3", "M12 16V8", "M17 16v-6"),
  users: P('<circle cx="9" cy="7" r="4"/>', "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2", "M16 3.1a4 4 0 0 1 0 7.8", "M21 21v-2a4 4 0 0 0-3-3.9"),
  ban: P('<circle cx="12" cy="12" r="10"/>', "m4.9 4.9 14.2 14.2"),
  dot: '<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>',
};

/** emoji → [icon, colour?]. Price tiers keep their colour as a dot. */
export const EMOJI_ICON = {
  "🐝": ["hive"], "🧠": ["brain"], "🔎": ["search"], "🔍": ["search"], "✍": ["pen"], "✏": ["pen"],
  "👁": ["eye"], "🎁": ["gift"], "🖼": ["image"], "📄": ["file"], "📎": ["clip"], "🗂": ["folder"],
  "📌": ["pin"], "📚": ["book"], "📖": ["book"], "✨": ["sparkle"], "⚡": ["zap"], "🎯": ["target"],
  "🛡": ["shield"], "✅": ["ok"], "❌": ["ko"], "💻": ["laptop"], "🔁": ["repeat"], "⏸": ["pause"],
  "🖱": ["mouse"], "⌨": ["keyboard"], "🌐": ["globe"], "📸": ["camera"], "🔌": ["plug"], "⚙": ["gear"],
  "💭": ["thought"], "🏠": ["home"], "🔒": ["lock"], "🔐": ["lock"], "☁": ["cloud"], "📝": ["note"],
  "🎙": ["mic"], "🗜": ["compress"], "⏳": ["hourglass"], "🔇": ["mute"], "🔊": ["volume"], "👆": ["pointer"],
  "🧭": ["compass"], "🧩": ["puzzle"], "⬇": ["download"], "🔑": ["key"], "⚠": ["alert"], "🤖": ["bot"],
  "💡": ["bulb"], "✉": ["mail"], "🔔": ["bell"], "📑": ["tabs"], "💰": ["coins"], "🏷": ["tag"],
  "🔗": ["link"], "🏁": ["flag"], "⏱": ["timer"], "📊": ["chart"], "👥": ["users"], "⛔": ["ban"], "🚫": ["ban"],
  "🟢": ["dot", "#34d399"], "🟡": ["dot", "#fbbf24"], "🟠": ["dot", "#fb923c"], "🔴": ["dot", "#f87171"], "⚪": ["dot", "#9aa0b4"],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Any known emoji, with its variation selector if present. */
export const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_ICON).sort((a, b) => b.length - a.length).map(esc).join("|")})\\uFE0F?`, "gu");

export function iconSvg(name, color = "") {
  const inner = ICONS[name] || ICONS.dot;
  return `<svg class="ui-ic ui-ic-${name}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${color ? ` style="color:${color}"` : ""}>${inner}</svg>`;
}

/** The text without its emoji (and the space that followed it) — for fields, options, tooltips. */
export function stripEmoji(s) {
  return String(s == null ? "" : s).replace(new RegExp(EMOJI_RE.source + "\\s?", "gu"), "").replace(/^\s+/, "");
}

/** Text the model wrote or the user typed: left exactly as it is. */
export const SKIP = ".ai-body, .think-body, .umsg-text, .htitle, .sr-title, .sr-snippet, .agent-act-head, .agent-act-res, .agent-actions-label, pre, code, textarea, input, select, [contenteditable], .no-iconize";

const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
function svgNode(name, color) {
  const doc = parser.parseFromString(iconSvg(name, color).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '), "image/svg+xml");
  return document.importNode(doc.documentElement, true);
}

function iconizeText(node) {
  const text = node.nodeValue;
  EMOJI_RE.lastIndex = 0;
  if (!text || !EMOJI_RE.test(text)) return;
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  if (parent.tagName === "OPTION") { node.nodeValue = stripEmoji(text); return; }
  const frag = document.createDocumentFragment();
  let at = 0;
  EMOJI_RE.lastIndex = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    if (m.index > at) frag.append(text.slice(at, m.index));
    const [name, color] = EMOJI_ICON[m[1]];
    frag.append(svgNode(name, color));
    at = m.index + m[0].length;
  }
  if (at < text.length) frag.append(text.slice(at));
  node.replaceWith(frag);
}

const ATTRS = ["title", "placeholder", "aria-label"];
function iconizeAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v) { EMOJI_RE.lastIndex = 0; if (EMOJI_RE.test(v)) el.setAttribute(a, stripEmoji(v)); }
  }
}

/** Every emoji under `root` (outside SKIP) becomes its icon; attributes lose theirs. */
export function iconizeTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { iconizeText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.closest && root.closest(SKIP) && !root.matches("input, textarea, select")) return;
  iconizeAttrs(root);
  for (const el of root.querySelectorAll("[title], [placeholder], [aria-label]")) iconizeAttrs(el);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  texts.forEach(iconizeText);
}

/** Watches the page: whatever is added or rewritten later is converted too. */
export function startIconizer(root = document.body) {
  iconizeTree(root);
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") iconizeText(m.target);
      else if (m.type === "attributes") iconizeAttrs(m.target);
      else m.addedNodes.forEach(iconizeTree);
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return obs;
}
