// Agent tool definitions + the browser-side executor.
//
// Definitions are provider-neutral (plain JSON Schema); providers.js adapts them
// to the Anthropic or OpenAI wire format. The executor runs in the sidebar
// context, which holds the privileged `browser.*` APIs.
//
// SAFETY: every tool is tagged `write:true/false`. Write tools (the ones that
// change state — clicking, typing, navigating, opening/closing tabs) go through
// an optional confirmation prompt. On top of that, a hard-coded payment guardrail
// (see content.js) refuses checkout/payment actions when enabled, so the agent
// can fill a cart but can never complete a purchase.

import { isWebChatUrl } from "./memory-policy.js";

export const TOOLS = [
  {
    name: "read_page",
    description:
      "Read the visible text of the ACTIVE tab (title, URL, text). Use this to answer questions about the page the user is looking at.",
    write: false,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_selection",
    description:
      "Get the text currently selected by the user in the active tab.",
    write: false,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_tabs",
    description:
      "List the open tabs of the current window (id, title, URL, active).",
    write: false,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_tab",
    description:
      "Read the visible text of a SPECIFIC tab by its id (obtained from list_tabs), without switching to it. Use to compare or gather context across several tabs.",
    write: false,
    input_schema: {
      type: "object",
      properties: { tabId: { type: "integer" } },
      required: ["tabId"],
    },
  },
  {
    name: "find_elements",
    description:
      "List interactive elements on the page (links, buttons, inputs) each with a 'ref' to use in click_element / fill_input. Pass 'query' (text to look for) to narrow the list.",
    write: false,
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text/label to filter elements by (optional).",
        },
      },
      required: [],
    },
  },
  {
    name: "open_tab",
    description: "Open a new tab at the given URL.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL (https://...)" },
        active: { type: "boolean", description: "Bring the tab to front (default true)." },
      },
      required: ["url"],
    },
  },
  {
    name: "check_links",
    description:
      "Verify candidate URLs in HIDDEN background tabs WITHOUT disturbing the user's tab: each URL is " +
      "opened in the background, loaded, its FINAL url + page title + a short content snippet are read, " +
      "then the tab is CLOSED. Returns one result per URL so you can pick the one that actually WORKS and " +
      "shows the right content (e.g. a film/show really available on a LEGAL platform, not an error or " +
      "geo-block), THEN navigate the main tab to the best one. Read-only; only for legitimate/legal sites.",
    write: false,
    input_schema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "Up to 5 full https URLs to test." },
      },
      required: ["urls"],
    },
  },
  {
    name: "switch_tab",
    description: "Activate (bring to front) the tab with the given id.",
    write: true,
    input_schema: {
      type: "object",
      properties: { tabId: { type: "integer" } },
      required: ["tabId"],
    },
  },
  {
    name: "close_tab",
    description: "Close the tab with the given id.",
    write: true,
    input_schema: {
      type: "object",
      properties: { tabId: { type: "integer" } },
      required: ["tabId"],
    },
  },
  {
    name: "navigate",
    description: "Navigate the active tab to the given URL.",
    write: true,
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "click_element",
    description:
      "Click an element identified by its 'ref' (from find_elements). Payment/checkout buttons are refused by the safety guardrail.",
    write: true,
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "fill_input",
    description:
      "Type text into a field identified by its 'ref'. submit=true then submits the form. Card/payment fields are refused by the safety guardrail.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        value: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["ref", "value"],
    },
  },
  {
    name: "scroll_page",
    description: "Scroll the active tab: 'up', 'down', 'top' or 'bottom'.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      },
      required: ["direction"],
    },
  },
  {
    name: "control_media",
    description:
      "Control the page's media player (works on YouTube and standard HTML5 video/audio). " +
      "action: 'play' starts/plays the video, 'pause' pauses it, 'autoplay_on'/'autoplay_off' " +
      "toggle YouTube's autoplay-next setting, and 'autoplay_status' READS the current autoplay " +
      "state (returns {autoplay:true|false}) — call it before claiming whether autoplay is on/off " +
      "instead of guessing. To play a specific song/video, call play with " +
      "`query` (e.g. {action:'play', query:'song name'}) — it searches YouTube, OPENS the first " +
      "result and starts playback by itself in this ONE call, from ANY page. Use this to launch a " +
      "video or enable autoplay; never use a search engine to play media.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "pause", "autoplay_on", "autoplay_off", "autoplay_status"] },
        query: { type: "string", description: "What to play (song/video name). When set with action 'play', searches YouTube and plays the first result automatically." },
      },
      required: ["action"],
    },
  },
  {
    name: "screenshot",
    description:
      "Capture a SCREENSHOT of the current page (the visible viewport) and SEE it. Use this ONLY " +
      "when the DOM tools aren't enough: content rendered on a <canvas>/in an image/PDF/video, a " +
      "captcha or visual layout you must read, to VISUALLY VERIFY a result, or to decide WHERE to " +
      "click when refs are ambiguous. Prefer read_page / find_elements first — this is the fallback " +
      "for visual reasoning. (Vision-capable models only, e.g. Claude.)",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why a screenshot is needed (what you're trying to see/verify)." },
        marks: { type: "boolean", description: "Set-of-Marks: overlay NUMBERED labels on every clickable element and return a legend [n → {x,y,label}]. Then click with click_at using a mark's x,y. Use this when you must click something the DOM refs can't reach." },
      },
    },
  },
  {
    name: "click_at",
    description:
      "Click at exact viewport COORDINATES (x,y in CSS pixels). Use this as a fallback when " +
      "find_elements/click_element can't reach the target (canvas, iframe, custom widget, captcha), " +
      "typically after a `screenshot {marks:true}` — click the x,y of the numbered mark you want.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        x: { type: "number", description: "X coordinate in CSS pixels (viewport)." },
        y: { type: "number", description: "Y coordinate in CSS pixels (viewport)." },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "recall",
    description:
      "Search the user's long-term memory for anything relevant to a question, and get back a short "
      + "briefing plus the ids of the memories it came from. Use it when the user refers to something "
      + "from an earlier conversation, or asks about their own preferences, decisions or history. "
      + "The briefing is a summary: if it seems thin or you need exact wording, call get_memory with "
      + "one of the returned ids.",
    write: false,
    parameters: { type: "object", properties: { query: { type: "string", description: "What to look for." } }, required: ["query"] },
  },
  {
    name: "get_memory",
    description:
      "Fetch one memory verbatim by its id, as returned by recall. Use it when the briefing lost a "
      + "detail you need exactly.",
    write: false,
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

// 🔒 Agent focus: while the agent works, it stays PINNED to the tab it started on, so the
// user can switch to other tabs / browse freely without the agent acting on the wrong page.
let agentPinnedTab = null;
export function setAgentTab(id) { agentPinnedTab = typeof id === "number" ? id : null; }
export function clearAgentTab() { agentPinnedTab = null; }
export function getAgentTab() { return agentPinnedTab; }
async function getActiveTab() {
  if (agentPinnedTab != null) {
    try {
      const t = await browser.tabs.get(agentPinnedTab);
      if (t) return t; // operate on the pinned tab even if it's in the background
    } catch (_) { agentPinnedTab = null; } // tab was closed → fall back to the live active tab
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab.");
  return tab;
}

// Send a message to a tab's content script, injecting it on the fly if it is not
// present yet (freshly loaded or restricted page).
async function sendToTab(tabId, message) {
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ["src/content/content.js"],
      });
      return await browser.tabs.sendMessage(tabId, message);
    } catch (e2) {
      throw new Error("Cannot access this page (protected or not loaded).");
    }
  }
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  return sendToTab(tab.id, message);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve once a tab has finished loading (status 'complete'), bounded by a timeout so we
// never hang the agent. Used after navigations so the next tool sees a loaded page.
function waitForTabLoad(tabId, timeout = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      try { browser.tabs.onUpdated.removeListener(listener); } catch (_) {}
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    try { browser.tabs.onUpdated.addListener(listener); } catch (_) {}
    // Already loaded? resolve immediately.
    browser.tabs.get(tabId).then((t) => { if (t && t.status === "complete") finish(); }).catch(() => {});
    setTimeout(finish, timeout);
  });
}

// Robust, model-independent "play media" orchestration. From ANY starting page:
//   • optional `query` → navigate to YouTube search results,
//   • the content script returns the first result's watchUrl → real navigation to it,
//   • wait for load, then drive playback (with one retry if the player isn't ready yet).
// Doing this in the tool (not by chaining model turns) is why playback is now reliable.
async function playMedia(query) {
  const tab = await getActiveTab();
  // The starting tab is often UN-scriptable (a fresh "new tab", the extension page, or any
  // protected URL the agent was pinned to) — there sendToTab THROWS. Don't let that abort the
  // whole action: swallow it and, if we know what to play, just navigate this tab to YouTube.
  const tryPlay = async () => {
    try { return await sendToTab(tab.id, { type: "control_media", action: "play" }); }
    catch (_) { return null; }
  };
  // Poll a few times after a navigation: a freshly-loaded YouTube page (SPA) often isn't ready
  // — the content script may not have injected yet, or the result list is still rendering.
  const poll = async (ok) => {
    let r = await tryPlay();
    for (let i = 0; i < 6 && !(r && ok(r)); i++) { await delay(650); r = await tryPlay(); }
    return r;
  };
  let res = await tryPlay();

  // Nothing playable here (no player, or page unreachable) and we know WHAT to play → go to
  // YouTube results IN THIS TAB (works even from a protected page: we only change its URL).
  if (query && !(res && res.watchUrl) && !(res && res.playing)) {
    // YouTube's default RELEVANCE order (no &sp=) surfaces the best-matching result for the query
    // (official soundtracks, full versions…), not just the most-viewed — the agent refines the
    // query itself when it wants a specific quality.
    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
    await browser.tabs.update(tab.id, { url });
    await waitForTabLoad(tab.id);
    res = await poll((r) => r.watchUrl || r.playing);
  }

  // On a results/home page the content script hands back the first video's URL → open it for
  // real (with autoplay=1) and drive playback once the player has mounted.
  if (res && res.watchUrl) {
    const watch = res.watchUrl + (res.watchUrl.includes("?") ? "&" : "?") + "autoplay=1";
    await browser.tabs.update(tab.id, { url: watch });
    await waitForTabLoad(tab.id);
    res = await poll((r) => r.ok || r.playing);
  }
  if (!res) throw new Error(query
    ? "Couldn't start playback (the player was blocked or didn't load)."
    : "No media on this page — pass a `query` (song/video name) so I can search YouTube.");
  return res;
}

// ── Authenticated chat tabs are off limits to the agent ──────────────────────────────────────
// The Web chats workspace works by embedding sites the user is LOGGED INTO. An agent able to
// drive those tabs would hold all three ingredients of the classic problem at once: private data,
// untrusted content, and an outbound capability — it could read a private conversation and act on
// what it read there. The refusal is CODE, not a line in a prompt, for the same reason the
// anti-purchase guard is code: a prompt is not a control.
const TAB_ACTING = new Set([
  "read_page", "read_selection", "read_tab", "find_elements", "click_element",
  "fill_input", "scroll_page", "control_media", "screenshot", "extract_data",
]);
function webChatRefused(url) {
  return {
    error: "Refused: that tab is one of the signed-in AI chat sites the Web chats workspace uses. "
      + "The agent may not read or act on an authenticated chat session.",
    blocked: true,
    url: String(url).slice(0, 200),
  };
}
async function webChatRefusal(name, input) {
  const urlish = input && (input.url || input.href);
  if (urlish && isWebChatUrl(urlish)) return webChatRefused(urlish);
  // Tools that act on "the current tab" resolve it themselves, so the URL has to be looked up.
  if (TAB_ACTING.has(name)) {
    try {
      const tab = input && typeof input.tabId === "number"
        ? await browser.tabs.get(input.tabId)
        : await getActiveTab();
      if (tab && isWebChatUrl(tab.url)) return webChatRefused(tab.url);
    } catch (_) { /* tab gone: the tool's own error path reports it */ }
  }
  return null;
}

// A navigation/open that triggers a file download (or a blob/data download) is a
// "very sensitive" action and is confirmed even in "Allow" mode.
function isSensitiveUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (/^(blob:|data:)/i.test(url)) return true;
  return /\.(zip|exe|dmg|msi|pkg|apk|iso|deb|rpm|7z|rar|tar|gz|jar|bin|app)(\?|#|$)/i.test(url);
}

// Execute a tool call.
// Options:
//   confirmActions / confirmFn : confirmation gate for write tools.
//     - confirmActions=true  (manual mode): confirm EVERY write action up-front.
//     - confirmActions=false ("Allow" mode): run freely, BUT still confirm very
//       sensitive actions (downloads via URL, and sensitive clicks/submits flagged
//       by the content script — reserve / book / delete / sign-up / install…).
//   guard : { blockPayments } — forwarded to the page so the content script can
//           refuse payment/checkout interactions in code (defence in depth).
export async function executeTool(name, input, opts = {}) {
  const { confirmActions, confirmFn, guard = {} } = opts;
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { error: `Unknown tool: ${name}` };

  // Checked BEFORE any confirmation prompt: this is not a decision to delegate to the user
  // mid-run, and asking would only train them to approve it.
  const blocked = await webChatRefusal(name, input);
  if (blocked) return blocked;

  // Manual mode: confirm every write action. If approved, mark it confirmed so the
  // sensitive-action gate below (and in the page) doesn't prompt a second time.
  let confirmed = false;
  if (def.write && confirmActions && confirmFn) {
    const ok = await confirmFn(name, input);
    if (!ok) return { error: "Action declined by the user." };
    confirmed = true;
  }

  // "Allow" mode: still confirm a sensitive NAVIGATION/download before doing it.
  if (!confirmed && confirmFn && (name === "navigate" || name === "open_tab") && isSensitiveUrl(input && input.url)) {
    const ok = await confirmFn(name, { sensitive: "download", url: input.url });
    if (!ok) return { error: "Action declined by the user." };
    confirmed = true;
  }

  try {
    switch (name) {
      // ── Memory ──────────────────────────────────────────────────────────────────────────────
      // Both are read-only and both refuse clearly when memory is off, rather than returning an
      // empty result that the model would read as "the user has no such memory".
      case "recall": {
        if (!opts.recall) return { error: "Memory is turned off in Settings." };
        return await opts.recall(String((input && input.query) || ""));
      }
      case "get_memory": {
        if (!opts.getMemory) return { error: "Memory is turned off in Settings." };
        const e = await opts.getMemory(String((input && input.id) || ""));
        return e || { error: "No memory with that id (it may have been deleted)." };
      }
      case "read_page":
        return await sendToActiveTab({ type: "read_page" });
      case "read_selection":
        return await sendToActiveTab({ type: "read_selection" });
      case "read_tab":
        return await sendToTab(input.tabId, { type: "read_page" });
      case "find_elements":
        return await sendToActiveTab({ type: "find_elements", query: input.query || "" });
      case "click_element": {
        let res = await sendToActiveTab({ type: "click_element", ref: input.ref, guard, confirmed });
        // The page flagged a very sensitive control → confirm, then re-issue.
        if (res && res.confirm && confirmFn) {
          const ok = await confirmFn("click_element", { sensitive: res.action, label: res.label });
          if (!ok) return { error: "Action declined by the user." };
          res = await sendToActiveTab({ type: "click_element", ref: input.ref, guard, confirmed: true });
        }
        return res;
      }
      case "fill_input": {
        const payload = { type: "fill_input", ref: input.ref, value: input.value, submit: !!input.submit, guard };
        let res = await sendToActiveTab({ ...payload, confirmed });
        if (res && res.confirm && confirmFn) {
          const ok = await confirmFn("fill_input", { sensitive: res.action, label: res.label });
          if (!ok) return { error: "Action declined by the user." };
          res = await sendToActiveTab({ ...payload, confirmed: true });
        }
        return res;
      }
      case "scroll_page":
        return await sendToActiveTab({ type: "scroll_page", direction: input.direction });
      case "control_media":
        if (input.action === "play") return await playMedia(input.query);
        return await sendToActiveTab({ type: "control_media", action: input.action });

      case "screenshot": {
        // Hybrid vision: capture the agent's (active) tab so a vision model can SEE the page.
        const tab = await getActiveTab();
        try { await browser.tabs.update(tab.id, { active: true }); } catch (_) {} // must be visible to capture
        let legend = null;
        if (input.marks) { // Set-of-Marks: number the clickable elements first
          try { const r = await sendToTab(tab.id, { type: "mark_elements" }); legend = r && r.marks; } catch (_) {}
          await delay(150); // let the overlay paint before capture
        }
        let dataUrl;
        try { dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 72 }); }
        catch (e) { try { await sendToTab(tab.id, { type: "unmark_elements" }); } catch (_) {} return { error: "Couldn't capture the page (it may be a protected/restricted page)." }; }
        if (input.marks) { try { await sendToTab(tab.id, { type: "unmark_elements" }); } catch (_) {} }
        if (!dataUrl) return { error: "Screenshot failed." };
        return {
          ok: true, _image: dataUrl, marks: (legend && legend.length) ? legend : undefined,
          note: input.marks
            ? "Numbered clickable elements are overlaid on the screenshot — call click_at with the x,y of the mark you want."
            : "Screenshot of the current page is attached — read it visually.",
        };
      }
      case "click_at":
        return await sendToActiveTab({ type: "click_at", x: input.x, y: input.y });

      case "list_tabs": {
        const tabs = await browser.tabs.query({ currentWindow: true });
        return {
          tabs: tabs.map((t) => ({
            id: t.id,
            title: t.title,
            url: t.url,
            active: t.active,
          })),
        };
      }
      case "open_tab": {
        // The agent works inside its ONE dedicated tab — reuse it (navigate) instead of
        // spawning new tabs, so the user can keep browsing / run other agent tasks elsewhere.
        const tab = await getActiveTab();
        await browser.tabs.update(tab.id, { url: input.url, ...(input.active === true ? { active: true } : {}) });
        await waitForTabLoad(tab.id);
        return { ok: true, tabId: tab.id, reusedTab: true };
      }
      case "check_links": {
        // Probe candidate URLs in HIDDEN background tabs (active:false), read title/final-url/snippet,
        // then close each tab. Never touches the agent's pinned tab.
        const urls = Array.isArray(input.urls) ? input.urls.slice(0, 5) : [];
        const results = [];
        for (const url of urls) {
          if (typeof url !== "string" || !/^https?:\/\//i.test(url)) { results.push({ url, ok: false, error: "not an http(s) url" }); continue; }
          let tabId = null;
          try {
            const created = await browser.tabs.create({ url, active: false });
            tabId = created.id;
            await waitForTabLoad(tabId, 15000);
            let info = null;
            try { info = await browser.tabs.get(tabId); } catch (_) {}
            let title = info ? info.title : "";
            let snippet = "";
            try {
              const page = await sendToTab(tabId, { type: "read_page" });
              if (page && page.title) title = page.title;
              if (page && page.text) snippet = String(page.text).replace(/\s+/g, " ").trim().slice(0, 400);
            } catch (_) {}
            results.push({ url, ok: true, finalUrl: info ? info.url : url, title, snippet });
          } catch (e) {
            results.push({ url, ok: false, error: (e && e.message) || String(e) });
          } finally {
            if (tabId != null) { try { await browser.tabs.remove(tabId); } catch (_) {} }
          }
        }
        return { ok: true, results };
      }
      case "switch_tab": {
        await browser.tabs.update(input.tabId, { active: true });
        return { ok: true };
      }
      case "close_tab": {
        await browser.tabs.remove(input.tabId);
        return { ok: true };
      }
      case "navigate": {
        const tab = await getActiveTab();
        await browser.tabs.update(tab.id, { url: input.url });
        await waitForTabLoad(tab.id); // resolve only once the page has actually loaded
        return { ok: true };
      }
      default:
        return { error: `Tool not implemented: ${name}` };
    }
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}
