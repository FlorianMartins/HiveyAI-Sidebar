// 🔌 The MCP tab's side of the sidebar: the services the user connected, their sign-in, their
// tools offered to the model, and the panel that manages them. The protocol itself is in mcp.js.
//
// Where things live: the list of services (name, address, on/off) is a setting (`mcpServers`);
// what proves the user's identity to them — tokens, the registered client — stays in
// storage.local under `mcpSecrets`, never in the settings that an export or a sync could carry.

import {
  MCP_CATALOGUE, McpClient, McpAuthError, toolDefs, resultForModel, discoverAuth, registerClient,
  authorizeUrl, exchangeCode, refreshToken, pkcePair, mcpSystemNote,
} from "./mcp.js";

const SECRETS_KEY = "mcpSecrets";

export function initMcp({ t, getSettings, setSettings, confirm, onChange = () => {} }) {
  const clients = new Map();   // id → McpClient
  const tools = new Map();     // id → tools[]
  const status = new Map();    // id → { state: "ok" | "loading" | "auth" | "error", msg }
  let toolMap = new Map();     // model-facing name → { serverId, tool, readOnly }
  let panel = null;
  let addingToken = null;      // catalogue id whose token field is open

  const servers = () => (getSettings().mcpServers || []).slice();
  const save = (list) => setSettings({ mcpServers: list });
  const secrets = async () => ((await browser.storage.local.get(SECRETS_KEY))[SECRETS_KEY] || {});
  const saveSecret = async (id, patch) => {
    const all = await secrets();
    all[id] = patch === null ? undefined : { ...(all[id] || {}), ...patch };
    if (patch === null) delete all[id];
    await browser.storage.local.set({ [SECRETS_KEY]: all });
  };
  const setStatus = (id, state, msg = "") => { status.set(id, { state, msg }); renderPanel(); onChange(); };

  async function authHeader(s) {
    const sec = (await secrets())[s.id] || {};
    if (sec.token) return "Bearer " + sec.token;
    if (!sec.accessToken) return "";
    if (sec.expiresAt && sec.expiresAt < Date.now() + 60000 && sec.refreshToken && sec.tokenEndpoint) {
      try {
        const tok = await refreshToken({ token_endpoint: sec.tokenEndpoint }, { refreshToken: sec.refreshToken, resource: sec.resource, clientId: sec.clientId, clientSecret: sec.clientSecret });
        await saveSecret(s.id, { ...tok, refreshToken: tok.refreshToken || sec.refreshToken });
        return "Bearer " + tok.accessToken;
      } catch (_) { /* the server will answer 401 and the user signs in again */ }
    }
    return "Bearer " + sec.accessToken;
  }

  function client(s) {
    let c = clients.get(s.id);
    if (!c || c.url !== s.url) {
      c = new McpClient({ url: s.url, getAuthHeader: () => authHeader(s) });
      clients.set(s.id, c);
    }
    return c;
  }

  /** The browser's sign-in window, then the tokens for this service. */
  async function signIn(s, resourceMetadata) {
    const d = await discoverAuth(s.url, { resourceMetadata });
    const redirectUri = browser.identity.getRedirectURL("mcp");
    const sec = (await secrets())[s.id] || {};
    const reg = sec.clientId && sec.redirectUri === redirectUri && sec.tokenEndpoint === d.as.token_endpoint
      ? { clientId: sec.clientId, clientSecret: sec.clientSecret }
      : await registerClient(d.as, redirectUri);
    const { verifier, challenge } = await pkcePair();
    const state = crypto.randomUUID();
    const back = await browser.identity.launchWebAuthFlow({
      url: authorizeUrl({ as: d.as, clientId: reg.clientId, redirectUri, challenge, state, resource: d.resource, scopes: d.scopes }),
      interactive: true,
    });
    const q = new URL(back).searchParams;
    if (q.get("error")) throw new Error(q.get("error_description") || q.get("error"));
    if (q.get("state") !== state || !q.get("code")) throw new Error(t("mcp.errSignIn"));
    const tok = await exchangeCode(d.as, { code: q.get("code"), verifier, redirectUri, resource: d.resource, ...reg });
    await saveSecret(s.id, { ...reg, redirectUri, tokenEndpoint: d.as.token_endpoint, resource: d.resource, ...tok });
    clients.delete(s.id); // a new session with the new token
  }

  /** Handshake + tool list; signs in when the service asks for it and `interactive` allows it. */
  async function load(s, { interactive = false } = {}) {
    setStatus(s.id, "loading");
    try {
      tools.set(s.id, await client(s).listTools());
      setStatus(s.id, "ok");
    } catch (e) {
      if (e instanceof McpAuthError && interactive && s.auth !== "token") {
        try {
          setStatus(s.id, "loading", t("mcp.signingIn"));
          await signIn(s, e.resourceMetadata);
          tools.set(s.id, await client(s).listTools());
          setStatus(s.id, "ok");
        } catch (e2) {
          setStatus(s.id, "error", /register/i.test(String(e2 && e2.message)) ? t("mcp.errNoDcr") : String((e2 && e2.message) || e2));
        }
        return;
      }
      if (e instanceof McpAuthError) setStatus(s.id, "auth", s.auth === "token" ? t("mcp.errTokenRefused") : t("mcp.needSignIn"));
      else setStatus(s.id, "error", String((e && e.message) || e));
    }
  }

  let warmed = null;
  /** Every enabled service's tools, read once per session (and again after a change). */
  function warm() {
    if (!warmed) warmed = Promise.all(servers().filter((s) => s.enabled !== false && !tools.has(s.id)).map((s) => load(s)));
    return warmed;
  }

  /** Called from a click: the host permission must be asked before anything is awaited. */
  async function connect(entry, { token = "" } = {}) {
    const perm = browser.permissions && browser.permissions.request
      ? browser.permissions.request({ origins: ["<all_urls>"] }).catch(() => false)
      : Promise.resolve(true);
    if (!(await perm)) { setStatus(entry.id || "custom", "error", t("mcp.permDenied")); return; }
    const list = servers();
    let id = entry.id || ("srv-" + new URL(entry.url).hostname.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    if (!entry.catalogue) for (let i = 2; list.some((x) => x.id === id && x.url !== entry.url); i++) id = id.replace(/-\d+$/, "") + "-" + i;
    const s = { id, name: entry.name || new URL(entry.url).hostname, url: entry.url, auth: token ? "token" : entry.auth || "oauth", enabled: true };
    const at = list.findIndex((x) => x.id === id);
    if (at >= 0) list[at] = { ...list[at], ...s }; else list.push(s);
    await save(list);
    if (token) await saveSecret(id, { token });
    clients.delete(id);
    await load(s, { interactive: true });
    warmed = null;
  }

  async function remove(id) {
    await save(servers().filter((s) => s.id !== id));
    await saveSecret(id, null);
    clients.delete(id); tools.delete(id); status.delete(id);
    renderPanel(); onChange();
  }

  async function toggle(id, on) {
    await save(servers().map((s) => (s.id === id ? { ...s, enabled: on } : s)));
    if (on && !tools.has(id)) { const s = servers().find((x) => x.id === id); if (s) await load(s); }
    renderPanel(); onChange();
  }

  // ── What a conversation turn gets ──────────────────────────────────────────────────────────
  async function forTurn() {
    await warm();
    const live = servers().filter((s) => s.enabled !== false && tools.has(s.id) && (status.get(s.id) || {}).state === "ok")
      .map((s) => ({ id: s.id, name: s.name, tools: tools.get(s.id) }));
    const { defs, map } = toolDefs(live);
    toolMap = map;
    return { tools: defs, system: mcpSystemNote(live) };
  }

  async function execute(name, input) {
    const info = toolMap.get(name);
    if (!info) return { error: `Unknown tool: ${name}` };
    const s = servers().find((x) => x.id === info.serverId);
    if (!s) return { error: "This service was disconnected." };
    if (!info.readOnly && !(await confirm(s.name, info.tool, input))) return { error: "The user refused this action. Do not retry it; tell the user it was not done." };
    try {
      return resultForModel(await client(s).callTool(info.tool, input));
    } catch (e) {
      if (e instanceof McpAuthError) { setStatus(s.id, "auth", t("mcp.needSignIn")); return { error: `Signed out of ${s.name}: the user must reconnect it in the MCP tab (Services).` }; }
      return { error: String((e && e.message) || e) };
    }
  }

  // ── The panel ──────────────────────────────────────────────────────────────────────────────
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text, onClick, title) => { const b = el("button", cls, text); b.type = "button"; if (title) b.title = title; b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); }); return b; };

  function renderPanel() {
    if (!panel || panel.classList.contains("hidden")) return;
    const body = panel.querySelector(".mcp-body");
    body.replaceChildren();
    const list = servers();

    body.append(el("div", "mcp-sec", t("mcp.connected")));
    if (!list.length) body.append(el("div", "mcp-empty", t("mcp.none")));
    for (const s of list) {
      const st = status.get(s.id) || { state: tools.has(s.id) ? "ok" : "idle", msg: "" };
      const row = el("div", "mcp-row");
      row.append(el("span", "mcp-dot " + st.state));
      const txt = el("div", "mcp-txt");
      txt.append(el("div", "mcp-name", s.name));
      const n = (tools.get(s.id) || []).length;
      txt.append(el("div", "mcp-sub", st.state === "ok" ? t("mcp.tools", { n: String(n) }) : st.state === "loading" ? (st.msg || t("mcp.loading")) : (st.msg || s.url)));
      row.append(txt);
      if (st.state === "auth" || st.state === "error") row.append(btn("mcp-act", t("mcp.reconnect"), () => load(s, { interactive: true })));
      const sw = el("input"); sw.type = "checkbox"; sw.className = "mcp-sw"; sw.checked = s.enabled !== false; sw.title = t("mcp.enabledTitle");
      sw.addEventListener("change", () => toggle(s.id, sw.checked));
      row.append(sw);
      row.append(btn("mcp-x", "✕", () => remove(s.id), t("mcp.remove")));
      body.append(row);
    }

    body.append(el("div", "mcp-sec", t("mcp.add")));
    for (const c of MCP_CATALOGUE.filter((c) => !list.some((s) => s.id === c.id))) {
      const row = el("div", "mcp-row");
      const txt = el("div", "mcp-txt");
      txt.append(el("div", "mcp-name", c.name));
      txt.append(el("div", "mcp-sub", t(c.desc)));
      row.append(txt);
      if (c.auth === "token" && addingToken === c.id) {
        const f = el("form", "mcp-token");
        const inp = el("input"); inp.type = "password"; inp.placeholder = t("mcp.tokenPh"); inp.required = true;
        f.append(inp, btn("mcp-act", t("mcp.connect"), () => f.requestSubmit()));
        f.addEventListener("submit", (e) => { e.preventDefault(); addingToken = null; connect({ ...c, catalogue: true }, { token: inp.value.trim() }); });
        txt.append(f);
        setTimeout(() => inp.focus(), 0);
      } else {
        row.append(btn("mcp-act", t("mcp.connect"), () => {
          if (c.auth === "token") { addingToken = c.id; renderPanel(); return; }
          connect({ ...c, catalogue: true });
        }));
      }
      body.append(row);
    }

    body.append(el("div", "mcp-sec", t("mcp.custom")));
    const f = el("form", "mcp-custom");
    const url = el("input"); url.type = "url"; url.placeholder = t("mcp.urlPh"); url.required = true;
    const tok = el("input"); tok.type = "password"; tok.placeholder = t("mcp.tokenOptPh");
    f.append(url, tok, btn("mcp-act", t("mcp.connect"), () => f.requestSubmit()));
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      let u;
      try { u = new URL(url.value.trim()); } catch (_) { return; }
      if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) { setStatus("custom", "error", t("mcp.errHttps")); return; }
      connect({ url: u.href }, { token: tok.value.trim() });
    });
    body.append(f);
    const cs = status.get("custom");
    if (cs && cs.state === "error") body.append(el("div", "mcp-err", cs.msg));
    body.append(el("p", "mcp-note", t("mcp.note")));
  }

  function openPanel(anchor) {
    if (!panel) {
      panel = el("div", "mcp-panel hidden");
      panel.setAttribute("role", "dialog");
      const head = el("div", "mcp-head");
      head.append(el("span", "mcp-title", t("mcp.panelTitle")), btn("mcp-x", "✕", () => closePanel(), t("close.title")));
      panel.append(head, el("div", "mcp-body"));
      document.body.append(panel);
      document.addEventListener("mousedown", (e) => {
        if (panel && !panel.classList.contains("hidden") && !panel.contains(e.target) && !(anchor && anchor.contains(e.target))) closePanel();
      });
    }
    if (!panel.classList.contains("hidden")) { closePanel(); return; }
    panel.classList.remove("hidden");
    renderPanel();
    warm().then(renderPanel);
    return panel;
  }
  function closePanel() { if (panel) panel.classList.add("hidden"); }

  const connectedCount = () => servers().filter((s) => s.enabled !== false).length;
  return { openPanel, closePanel, forTurn, execute, warm, connectedCount, servers, panel: () => panel };
}
