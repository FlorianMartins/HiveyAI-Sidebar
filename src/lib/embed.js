// Hivey Browser embedding: the side panel contract.
//
// Hivey Browser shows this sidebar in its side panel and switches workspaces from its own vertical
// « Hivey bar ». It loads `src/sidebar/sidebar.html?embed=hivey`, then changes only the fragment to
// `#mode=<workspace>` — a same-document navigation: no reload, a `hashchange` event. So:
//
//   * `?embed=hivey` hides the workspace rail (the browser's bar replaces it): the class below goes
//     on <html>, set by embed-early.js before the stylesheet paints so the rail never flashes;
//   * `#mode=<id>` selects a known workspace exactly as a click on its rail tab would — on load and
//     on every `hashchange`, embedded or not. An unknown or empty mode is ignored.
//
// No DOM here beyond what the caller passes in, so the contract is tested without a browser.

export const EMBED_PARAM = "embed";
export const EMBED_HIVEY = "hivey";
export const EMBED_CLASS = "embed-hivey";

/**
 * The workspaces of the Assistant's small tools menu. Chat and Agent are the Assistant itself, and the
 * providers' web chats have their own button in the browser (`#mode=web`). Together with those three,
 * this is every workspace of the rail: nothing is lost without it (a test holds that).
 */
export const EMBED_TOOLS = ["translate", "improve", "image", "pdf", "security", "wisebase", "benchmark", "mcp"];

/** A tab with nothing in it: the browser's new tab or a blank page. An agent run can use it as it is. */
export function isBlankTabUrl(url) {
  const u = String(url || "").trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/$/, "");
  if (!u) return false;
  return ["about:blank", "about:newtab", "about:home", "chrome://newtab", "chrome://new-tab-page", "chrome://new-tab-page-third-party", "edge://newtab", "brave://newtab", "vivaldi://newtab", "hivey://newtab"].includes(u);
}

/** Is this page embedded in Hivey Browser's side panel? `search` is `location.search`. */
export function isHiveyEmbed(search) {
  try { return new URLSearchParams(search || "").get(EMBED_PARAM) === EMBED_HIVEY; } catch (_) { return false; }
}

/** Put the embed class on `root` (<html>) when embedded. Returns whether it is. Idempotent. */
export function applyEmbedClass(root, search) {
  const on = isHiveyEmbed(search);
  if (on && root && root.classList) root.classList.add(EMBED_CLASS);
  return on;
}

/** The workspace a fragment asks for (`#mode=agent` → "agent"), or null when it names none of `known`. */
export function modeFromHash(hash, known) {
  let id = null;
  try { id = new URLSearchParams(String(hash || "").replace(/^#/, "")).get("mode"); } catch (_) { return null; }
  return id && known.includes(id) ? id : null;
}

/**
 * Follow the fragment: select the workspace it names now, and again on every `hashchange`.
 * `select` is the rail tab's own click path. Returns the workspace selected now, or null.
 */
export function bindWorkspaceHash(win, known, select) {
  const apply = () => {
    const m = modeFromHash(win.location.hash, known);
    if (m) select(m);
    return m;
  };
  win.addEventListener("hashchange", apply);
  return apply();
}
