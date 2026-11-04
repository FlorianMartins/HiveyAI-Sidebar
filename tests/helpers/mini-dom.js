// A very small HTML parser for tests: the part of DOMParser that lib/web-search.js relies on, with no
// dependency (the repository has none, and Node has no DOM). Elements know their tag, attributes, parent,
// children and text; selectors are `tag`, `.class`, `tag.class`, `tag#id`, `#id`, and comma lists.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à" };
const decode = (s) => s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

class TextNode {
  constructor(value, parent) { this.nodeType = 3; this.nodeValue = value; this.parentNode = parent; }
  get textContent() { return this.nodeValue; }
}

class Element {
  constructor(tag, attrs = {}, parent = null) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.parentNode = parent;
    this.childNodes = [];
  }
  getAttribute(name) { const v = this.attrs[name.toLowerCase()]; return v === undefined ? null : v; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  get nextElementSibling() {
    const kids = this.parentNode ? this.parentNode.children : [];
    return kids[kids.indexOf(this) + 1] || null;
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      const m = /^([a-z0-9]*)(?:#([\w-]+))?((?:\.[\w-]+)*)$/i.exec(part.trim());
      if (!m) throw new Error(`mini-dom: unsupported selector ${part}`);
      const [, tag, id, classes] = m;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (id && this.getAttribute("id") !== id) return false;
      const have = String(this.getAttribute("class") || "").split(/\s+/);
      return classes.split(".").filter(Boolean).every((c) => have.includes(c));
    });
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (c.matches(selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (el.matches(selector)) return el;
    return null;
  }
}

/** `parseHtml(html)` → a document: `querySelector(All)`, `body`, like what DOMParser gives. */
export function parseHtml(html) {
  const root = new Element("html");
  let cur = root;
  const src = String(html);
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { cur.childNodes.push(new TextNode(decode(src.slice(i)), cur)); break; }
    if (lt > i) cur.childNodes.push(new TextNode(decode(src.slice(i, lt)), cur));
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") { const e = src.indexOf(">", lt); i = e < 0 ? src.length : e + 1; continue; }
    const end = src.indexOf(">", lt);
    if (end < 0) break;
    const inner = src.slice(lt + 1, end);
    i = end + 1;
    if (inner[0] === "/") {
      const tag = inner.slice(1).trim().toUpperCase();
      for (let el = cur; el; el = el.parentNode) if (el.tagName === tag) { cur = el.parentNode || root; break; }
      continue;
    }
    const m = /^([a-z0-9-]+)([\s\S]*?)(\/?)$/i.exec(inner);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const attrs = {};
    for (const a of m[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    if (tag === "html") { Object.assign(root.attrs, attrs); continue; }
    const el = new Element(tag, attrs, cur);
    cur.childNodes.push(el);
    if (VOID.has(tag) || m[3]) continue;
    if (RAW.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, i);
      const stop = close < 0 ? src.length : close;
      el.childNodes.push(new TextNode(tag === "title" ? decode(src.slice(i, stop)) : src.slice(i, stop), el));
      const gt = src.indexOf(">", stop);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    cur = el;
  }
  root.body = root.querySelector("body") || root;
  return root;
}
