import { calculate } from "../src/lib/calc.js";
import { guardPage } from "../src/lib/page-guard.js";
import { webContextBlock } from "../src/lib/web-search.js";
// A simulated browser for the bench: the agent's real tools, answered from fixture sites.
//
// The sidebar's agent acts on real pages through a content script, which a bench cannot drive
// without a browser — and a real site changes from one run to the next, so a score would measure
// the web as much as the model. Here every tool of src/lib/tools.js is answered from a small,
// deterministic world: pages with text and interactive elements, forms that keep what was typed,
// tabs, a search engine over the fixture sites, and the same payment guard as content.js.
//
// The result shapes are those of content.js and tools.js — `{title,url,description,text}` for
// read_page (long text in parts of 20 000 characters, as there), `{count,elements:[{ref,tag,type,text,href}]}`
// for find_elements (60 at most), `{ok:true}` or `{error}` for actions — so the model reads exactly
// what it would read in the extension. What the agent did is kept in `log`, and the world's state
// in `state`, for the task's check to decide on facts rather than on what the model claims.

const PAGE_TEXT_MAX = 20000;
const ELEMENTS_MAX = 60;
const PAY_RE = /\b(pay now|payer|paiement|payment|checkout|check out|place order|passer (la )?commande|confirmer (la )?commande|confirm order|valider (la )?commande|proceed to payment)\b/i;

/** "https://shop.example/p?id=3#x" → "https://shop.example/p?id=3" */
function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return String(url || "");
  }
}

/**
 * `sites` maps a URL (or a URL prefix ending in `*`) to a page factory `(ctx) => page`, where ctx is
 * `{ url, query, state, browser }` and a page is `{ title, text, description?, elements?: [...] }`.
 * An element is `{ tag, text, href?, type?, name?, payment?, onClick?(ctx), onSubmit?(ctx) }`.
 */
// A page in parts, the way src/content/content.js gives it.
function pagePart(full, from) {
  const start = Math.max(0, Number(from) || 0);
  const end = start + PAGE_TEXT_MAX;
  return {
    text: full.slice(start, end),
    ...(end < full.length ? { more: `The page goes on: ${full.length - end} more characters. Call again with from=${end} to read them, and do not conclude that something is absent before you have.` } : {}),
  };
}

export function createBrowser({ sites = {}, tabs = [], search = [], initial = {} } = {}) {
  const state = { fields: {}, ...structuredClone(initial) };
  const log = [];
  let nextTab = 1;
  const openTabs = [];
  let active = null;
  let refs = new Map();

  function resolve(url) {
    const n = normalize(url);
    const u = (() => { try { return new URL(n); } catch { return null; } })();
    const bare = u ? `${u.origin}${u.pathname}`.replace(/\/$/, "") : n;
    if (sites[n]) return sites[n];
    if (sites[bare]) return sites[bare];
    for (const key of Object.keys(sites)) {
      if (key.endsWith("*") && n.startsWith(key.slice(0, -1))) return sites[key];
    }
    if (u && /(^|\.)duckduckgo\.com$|(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$/.test(u.hostname)) return searchPage;
    return null;
  }

  // The search engine: every fixture result whose words meet the query, best match first.
  function searchPage(ctx) {
    const q = (ctx.query.get("q") || "").toLowerCase();
    if (!q) return { title: "Search", text: "Type your search: add ?q=your+words to the address.", elements: [] };
    const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
    const scored = search
      .map((r) => ({ r, s: words.filter((w) => `${r.title} ${r.snippet}`.toLowerCase().includes(w)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return {
      title: `${q} at DuckDuckGo`,
      text: scored.length
        ? scored.map(({ r }, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n")
        : "No results found.",
      elements: scored.map(({ r }) => ({ tag: "a", text: r.title, href: r.url })),
    };
  }

  function render(tab) {
    const factory = resolve(tab.url);
    let url;
    try { url = new URL(tab.url); } catch { url = null; }
    const ctx = { url: tab.url, query: url ? url.searchParams : new URLSearchParams(), state, browser: api };
    const page = factory
      ? factory(ctx)
      : { title: "404 Not Found", text: "404 — This page does not exist.", elements: [] };
    return { title: page.title || "", description: page.description || "", text: String(page.text || ""), elements: page.elements || [] };
  }

  function load(tab, url) {
    tab.url = normalize(url);
    tab.history.push(tab.url);
    log.push({ type: "visit", url: tab.url, tab: tab.id });
  }

  function open(url, activate = true) {
    const tab = { id: nextTab++, url: "", history: [] };
    openTabs.push(tab);
    load(tab, url);
    if (activate || !active) active = tab;
    return tab;
  }

  for (const t of tabs) open(t, false);
  if (!active && openTabs.length) active = openTabs[0];

  const plain = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const byLabel = (nodes, words) => {
    const want = plain(words);
    if (!want) return null;
    const named = nodes.map((el) => [el, plain(el.text || el.name || el.placeholder)]).filter(([, label]) => label);
    const hit = named.find(([, label]) => label === want) || named.find(([, label]) => label.includes(want) || want.includes(label));
    return hit ? hit[0] : null;
  };

  const api = {
    // As tools.js with `observe`: a page comes with its actions, an action with what it leads to.
    observe: false,
    state,
    log,
    tabs: openTabs,
    get active() { return active; },
    /** Everything the agent visited, in order. */
    visited: () => log.filter((e) => e.type === "visit").map((e) => e.url),
    /** The page the active tab shows now — what the sidebar sends as [Active page context]. */
    activePage() {
      if (!active) return null;
      const p = render(active);
      return { title: p.title, url: active.url, description: p.description, text: p.text };
    },
    navigate(url) { if (!active) open(url); else load(active, url); },
  };

  const elementsOf = (query) => {
    if (!active) return { count: 0, elements: [] };
    refs = new Map();
    const q = String(query || "").toLowerCase().trim();
    const out = [];
    let n = 0;
    for (const el of render(active).elements) {
      const label = el.text || el.name || el.placeholder || "";
      if (q && !`${label} ${el.href || ""} ${el.name || ""}`.toLowerCase().includes(q)) continue;
      const ref = `e${++n}`;
      refs.set(ref, el);
      const payment = el.payment || PAY_RE.test(label) || undefined;
      out.push({ ref, tag: el.tag, type: el.type, text: label, href: el.href, payment });
      if (out.length >= ELEMENTS_MAX) break;
    }
    return { count: out.length, elements: out };
  };

  const ctxFor = () => {
    let url;
    try { url = new URL(active.url); } catch { url = null; }
    return { url: active.url, query: url ? url.searchParams : new URLSearchParams(), state, browser: api };
  };

  const pageNow = (from) => {
    const p = render(active);
    return guardPage({ title: p.title, url: active.url, description: p.description, ...pagePart(p.text.replace(/\n{3,}/g, "\n\n"), from), ...(api.observe ? { actions: elementsOf("").elements } : {}) });
  };
  const thenPage = (res) => (api.observe && res.ok && active ? { ...res, ...pageNow() } : res);
  const pressed = (el) => {
    log.push({ type: "click", label: el.text, href: el.href });
    if (el.onClick) {
      const to = el.onClick(ctxFor());
      if (typeof to === "string") api.navigate(new URL(to, active.url).toString());
    } else if (el.href) {
      api.navigate(new URL(el.href, active.url).toString());
    }
  };

  /** The executor handed to runConversation: same name, same input, same result shapes as tools.js. */
  async function execute(name, input = {}) {
    log.push({ type: "tool", name, input });
    switch (name) {
      case "read_page": {
        if (!active) return { error: "No active tab." };
        return pageNow(input && input.from);
      }
      case "read_selection":
        return { selection: "" };
      case "calculate":
        try { return { result: calculate(input && input.expression) }; } catch (e) { return { error: e.message }; }
      case "list_tabs":
        return { tabs: openTabs.map((t) => ({ id: t.id, title: render(t).title, url: t.url, active: t === active })) };
      case "read_tab": {
        const t = openTabs.find((x) => x.id === Number(input.tabId));
        if (!t) return { error: `No tab with id ${input.tabId}.` };
        const p = render(t);
        return guardPage({ title: p.title, url: t.url, ...pagePart(p.text, input && input.from) });
      }
      case "find_elements":
        return elementsOf(input.query);
      // The sidebar dedicates ONE tab to the agent: open_tab navigates it (see tools.js).
      case "open_tab":
      case "navigate": {
        if (!input.url) return { error: "url is required." };
        api.navigate(input.url);
        return thenPage(name === "open_tab" ? { ok: true, tabId: active.id, reusedTab: true } : { ok: true });
      }
      case "switch_tab": {
        const t = openTabs.find((x) => x.id === Number(input.tabId));
        if (!t) return { error: `No tab with id ${input.tabId}.` };
        active = t;
        return { ok: true };
      }
      case "close_tab": {
        const i = openTabs.findIndex((x) => x.id === Number(input.tabId));
        if (i < 0) return { error: `No tab with id ${input.tabId}.` };
        const [t] = openTabs.splice(i, 1);
        if (active === t) active = openTabs[0] || null;
        return { ok: true };
      }
      case "click_element": {
        const el = refs.get(String(input.ref));
        if (!el) return { error: `No element with ref ${input.ref} — call find_elements first.` };
        if (el.payment || PAY_RE.test(el.text || "")) {
          log.push({ type: "blocked-payment", label: el.text });
          return { error: "Blocked by safety guardrail: payment/checkout action is not allowed.", blocked: true };
        }
        pressed(el);
        return thenPage({ ok: true, clicked: el.text || el.href || el.tag });
      }
      case "fill_input": {
        const el = refs.get(String(input.ref));
        if (!el) return { error: `No element with ref ${input.ref} — call find_elements first.` };
        if (el.payment || /card|carte|cvv|cvc|iban/i.test(`${el.name || ""} ${el.text || ""}`)) {
          log.push({ type: "blocked-payment", label: el.text });
          return { error: "Blocked by safety guardrail: card/payment field is not allowed.", blocked: true };
        }
        const key = el.name || el.text;
        state.fields[key] = String(input.value ?? "");
        log.push({ type: "fill", field: key, value: state.fields[key] });
        if (input.submit) {
          log.push({ type: "submit", field: key });
          const form = render(active).elements.find((e) => e.onSubmit);
          if (form) {
            const to = form.onSubmit(ctxFor());
            if (typeof to === "string") api.navigate(new URL(to, active.url).toString());
          }
        }
        return { ok: true, filled: el.text || key };
      }
      case "fill_form": {
        if (!active) return { error: "No active tab." };
        const nodes = render(active).elements;
        const fields = nodes.filter((el) => el.tag === "input" || el.tag === "textarea" || el.tag === "select");
        const filled = [], missing = [], refused = [];
        for (const [label, value] of Object.entries(input.fields || {})) {
          const el = byLabel(fields, label);
          if (!el) { missing.push(label); continue; }
          if (el.payment || /card|carte|cvv|cvc|iban/i.test(`${el.name || ""} ${el.text || ""}`)) { log.push({ type: "blocked-payment", label: el.text }); refused.push(label); continue; }
          state.fields[el.name || el.text] = String(value ?? "");
          log.push({ type: "fill", field: el.name || el.text, value: String(value ?? "") });
          filled.push(label);
        }
        const result = { ok: filled.length > 0 || !Object.keys(input.fields || {}).length, filled, ...(missing.length ? { missing, fields: fields.map((f) => f.text || f.name).filter(Boolean) } : {}), ...(refused.length ? { refused, note: "Card and payment fields are left to the user." } : {}) };
        if (!input.submit || missing.length) return result;
        const buttons = nodes.filter((el) => el.tag === "button" || el.tag === "a");
        const button = byLabel(buttons, input.submit);
        if (!button) return { ...result, ok: false, error: `No button called « ${input.submit} »`, buttons: buttons.map((b) => b.text).filter(Boolean).slice(0, 30) };
        if (button.payment || PAY_RE.test(button.text || "")) {
          log.push({ type: "blocked-payment", label: button.text });
          return { ...result, ok: false, error: "Blocked by safety guardrail: payment/checkout action is not allowed.", blocked: true };
        }
        pressed(button);
        return thenPage({ ...result, clicked: button.text });
      }
      case "web_search": {
        const found = searchPage({ query: new URLSearchParams({ q: String((input && input.query) || "") }) });
        const hits = found.elements.slice(0, 5);
        if (!hits.length) return { error: "The search found nothing useful; try other words or open a page." };
        const sources = hits.map((h, i) => {
          const p = render({ url: normalize(h.href) });
          return { n: i + 1, url: h.href, title: h.text, passages: [guardPage({ text: p.text }).text.slice(0, 3000)] };
        });
        log.push(...hits.map((h) => ({ type: "visit", url: normalize(h.href), tab: 0, background: true })));
        return { results: webContextBlock({ query: String(input.query || ""), sources }), sources: sources.map((s) => ({ url: s.url, title: s.title })) };
      }
      case "scroll_page":
        return { ok: true };
      case "check_links": {
        const urls = Array.isArray(input.urls) ? input.urls.slice(0, 5) : [];
        return {
          ok: true,
          results: urls.map((u) => {
            const factory = resolve(u);
            if (!factory) return { url: u, finalUrl: u, ok: false, title: "404 Not Found", snippet: "404" };
            const p = render({ url: normalize(u) });
            return { url: u, finalUrl: normalize(u), ok: true, title: p.title, snippet: p.text.slice(0, 300) };
          }),
        };
      }
      case "control_media":
        return { error: "There is no media player on this page." };
      case "screenshot":
      case "click_at":
        return { error: "Screenshots are not available here — use read_page and find_elements." };
      case "recall":
      case "get_memory":
        return { error: "Memory is turned off in Settings." };
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  api.execute = execute;
  return api;
}
