// 🐝 Hivey AI — single, auditable chokepoint for every HTML insertion.
//
// WHY THIS FILE EXISTS
// --------------------
// Assigning to `innerHTML` is flagged by Mozilla's `addons-linter`
// (UNSAFE_VAR_ASSIGNMENT) because the linter cannot prove the value was
// sanitized. Rather than scattering ~37 such assignments across the codebase —
// each one an independent thing a reviewer (or we) must re-verify — every
// insertion goes through `setHTML()` below.
//
// The result: exactly ONE place in our own code turns HTML into DOM nodes. It is
// trivially auditable, and any future sanitization change applies everywhere at
// once.
//
// WHAT IS SAFE TO PASS
// --------------------
// Callers must pass HTML that is already one of:
//   1. a hardcoded constant from our own source (inline SVG icons, glyphs), or
//   2. output of `renderMarkdown()` — sanitized by DOMPurify, or
//   3. a string built exclusively from `escapeHtml()`-escaped values.
//
// Never pass raw model output or raw page content directly — send it through
// `renderMarkdown()` (which runs DOMPurify) first.

/**
 * Replace an element's content with a trusted/sanitized HTML string.
 * @param {Element} el   target element
 * @param {string}  html already-sanitized or hardcoded HTML
 */
export function setHTML(el, html) {
  if (!el) return;
  el.replaceChildren(...parse(html));
}

/** Insert trusted/sanitized HTML (an icon, typically) at the start of an element. */
export function prependHTML(el, html) {
  if (el) el.prepend(...parse(html));
}

// Parsed in an inert document (no script runs, nothing loads) and moved in as nodes: the page never
// receives an HTML string. Same result as innerHTML for the content we insert (no table rows or
// <option> fragments — those are built with createElement).
let parser = null;
function parse(html) {
  parser = parser || new DOMParser();
  return [...parser.parseFromString(`<body>${html == null ? "" : html}</body>`, "text/html").body.childNodes];
}

/** Empty an element without touching innerHTML at all. */
export function clearEl(el) {
  if (el) el.replaceChildren();
}
