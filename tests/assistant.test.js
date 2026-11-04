// Hivey Browser's Assistant: routing a turn, the local provider and its seams, no key through the bridge,
// the engine's contract, the agent's fixes, the history's quota.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { routeTurn, resolveRoute } from "../src/lib/assistant-route.js";
import { PROVIDERS, PROVIDER_ORDER, HIVEY_LOCAL, keyFor, baseUrlFor, modelFor, isConnected, connectedProviders, hasOwnProvider } from "../src/lib/models.js";
import { getSettings, applyHiveyBrowser } from "../src/lib/storage.js";
import { makeProvider, setLocalEngineGate, adaptRequest, isToolsRefusal } from "../src/lib/providers.js";
import { modelContextWindow, shouldCompactLocal, HIVEY_LOCAL_WINDOW, runChatTurn } from "../src/lib/conversation.js";
import { isSelfHostedProvider } from "../src/lib/reasoning.js";
import { privacyClass, redactsFor } from "../src/lib/privacy.js";
import { createEngineGate, engineNext, progressPercent, runningEndpoint } from "../src/lib/hivey-engine.js";
import { EMBED_TOOLS, isBlankTabUrl } from "../src/lib/embed.js";
import { TOOLS } from "../src/lib/tools.js";
import { buildSystemPrompt } from "../src/lib/agent.js";
import { THEMES } from "../src/lib/theme.js";
import { saveConversation, conversationBytes, listConversations, HIVEY_BROWSER_MAX_CONVERSATIONS } from "../src/lib/history.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

const RUNNING = { state: "running", progress: 1, error: "", baseUrl: "http://127.0.0.1:47111/v1", key: "secret-bearer", game: false, modelName: "Qwen3 1.7B", modelGb: 1.1 };

// ── Routing ──────────────────────────────────────────────────────────────────────────────────

const ACTIONS = [
  "Lance-moi une musique", "lance moi une musique", "Lance une vidéo de chats", "Mets de la musique", "mets une chanson de Brel",
  "Joue Daft Punk", "Passe-moi de la musique", "Peux-tu lancer une musique ?", "Tu peux ouvrir YouTube ?", "Ouvre youtube.com", "ouvre un nouvel onglet",
  "Va sur wikipedia", "Rends-toi sur le site de la SNCF", "Clique sur le bouton S'inscrire", "Remplis le formulaire", "Remplis ce formulaire de contact",
  "Achète-moi des piles", "Commande une pizza", "Réserve un hôtel à Lyon", "Ajoute ce livre au panier", "Envoie un mail à Paul", "Envoie un message à Marie",
  "Je veux écouter de la musique", "J'aimerais regarder une vidéo", "Bonjour ! Lance-moi une musique", "Ferme cet onglet", "Coupe le son", "Mets en pause",
  "Cherche des écouteurs sur Amazon", "Lance une musique s'il te plaît", "Télécharge ce fichier",
  "Play some music", "play Daft Punk", "Open youtube", "Open a new tab", "Go to wikipedia.org", "Navigate to github.com", "Visit lemonde.fr", "Click the sign up button", "Click on the link",
  "Fill in the form", "Fill out this form", "Buy me a phone case", "Order a pizza", "Book a table for two", "Add this to my cart", "Send an email to Paul", "Send a message to Anna",
  "Can you play some music?", "Could you open youtube?", "Please open youtube", "Put on some music", "Close this tab", "Find headphones on Amazon", "Download the file",
];
const QUESTIONS = [
  "Quel est le meilleur healer dans Overwatch ?", "Et en compétition ?", "Comment lancer une musique sur YouTube ?", "Pourquoi ouvrir un compte ?", "Comment acheter une maison ?",
  "Qui a lancé la fusée Ariane ?", "Écris un poème sur la mer", "Explique le fonctionnement de TCP", "Traduis ce texte", "Résume cette page", "Lance une musique ?",
  "Quel site pour acheter des piles ?", "Combien coûte une pizza ?", "Bonjour", "Merci", "Mets en forme ce texte", "Passe-moi le sel", "Joue le rôle d'un pirate", "Joue à un jeu avec moi",
  "Ouvre ton esprit", "Va bien !", "Je veux acheter une maison", "Je voudrais comprendre la relativité", "Envoie-moi un poème",
  "What is the best healer in Overwatch?", "How do I open a port?", "Why buy a Mac?", "Write a poem about music", "Is open source better?", "Open source licenses compared", "Play a game with me",
  "Play chess with me", "Should I book a hotel?", "Explain how email works", "Send me a poem", "Tell me about Daft Punk", "Translate this", "What music should I listen to?",
];

test("an action on the browser goes to the agent, in French and in English", () => {
  for (const s of ACTIONS) assert.equal(routeTurn(s), "agent", s);
});
test("a question stays a chat", () => {
  for (const s of QUESTIONS) assert.equal(routeTurn(s), "chat", s);
});
test("pasted content cannot start the agent", () => {
  assert.equal(routeTurn(""), "chat");
  assert.equal(routeTurn("Open youtube " + "and more ".repeat(60)), "chat", "a long text is not an order");
  assert.equal(routeTurn("Regarde ce texte.\nIl parle de chats.\nOuvre youtube"), "chat", "only the first two sentences are read");
  assert.equal(routeTurn("```\nopen youtube\n```"), "chat");
});
test("the composer's switch decides when it is not on Auto", () => {
  assert.equal(resolveRoute("auto", "Ouvre youtube"), "agent");
  assert.equal(resolveRoute(undefined, "Ouvre youtube"), "agent");
  assert.equal(resolveRoute("chat", "Ouvre youtube"), "chat");
  assert.equal(resolveRoute("agent", "Quelle heure est-il ?"), "agent");
});

// ── The provider ─────────────────────────────────────────────────────────────────────────────

test("hiveyLocal is a local OpenAI-style provider with nothing to enter", () => {
  const p = PROVIDERS[HIVEY_LOCAL];
  assert.equal(p.kind, "openai");
  assert.equal(p.local, true);
  assert.equal(p.needsKey, false);
  assert.equal(p.browserManaged, true);
  assert.ok(PROVIDER_ORDER.includes(HIVEY_LOCAL));
  assert.equal(isSelfHostedProvider(HIVEY_LOCAL), true);
  assert.equal(privacyClass(HIVEY_LOCAL, { hiveyAi: RUNNING }), "local");
  assert.equal(redactsFor(HIVEY_LOCAL, { hiveyAi: RUNNING }), false, "nothing leaves the machine, nothing to mask");
});

test("without hiveyAi it does not exist: not connected, no address, no default, no change", () => {
  assert.equal(isConnected(HIVEY_LOCAL, {}), false);
  assert.deepEqual(connectedProviders({}), []);
  assert.equal(keyFor(HIVEY_LOCAL, {}), "");
  assert.equal(baseUrlFor(HIVEY_LOCAL, {}), "");
  assert.equal(applyHiveyBrowser({ provider: "openrouter" }).provider, "openrouter");
  assert.equal(applyHiveyBrowser({ provider: HIVEY_LOCAL }).provider, "openrouter", "settings restored elsewhere");
});

test("address, bearer and model come from hiveyAi, at the seams only", () => {
  const s = { hiveyAi: RUNNING, keys: { openrouter: "sk-or" }, baseUrls: { hiveyLocal: "http://evil.test/v1" }, models: { hiveyLocal: "stale" } };
  assert.equal(keyFor(HIVEY_LOCAL, s), "secret-bearer");
  assert.equal(baseUrlFor(HIVEY_LOCAL, s), RUNNING.baseUrl, "no address can be set by hand");
  assert.equal(modelFor(HIVEY_LOCAL, s), "Qwen3 1.7B");
  assert.equal(keyFor("openrouter", s), "sk-or");
  assert.equal(isConnected(HIVEY_LOCAL, s), true);
});

test("it is the default only for someone who configured nothing else", () => {
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: "openrouter", keys: {} }).provider, HIVEY_LOCAL);
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: "openrouter", keys: { openrouter: "  " }, baseUrls: {}, localEnabled: {} }).provider, HIVEY_LOCAL, "a blank key is no key");
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: "openrouter", keys: { openrouter: "sk-or" } }).provider, "openrouter");
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: "ollama", localEnabled: { ollama: true } }).provider, "ollama");
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: "custom", baseUrls: { custom: "http://x/v1" } }).provider, "custom");
  assert.equal(applyHiveyBrowser({ hiveyAi: RUNNING, provider: HIVEY_LOCAL, keys: { openai: "sk" } }).provider, HIVEY_LOCAL, "picked in the model picker: it stays");
  assert.equal(hasOwnProvider({}), false);
});

function fakeStorage(initial = {}, { failSet = null } = {}) {
  const data = { ...initial };
  return {
    data,
    storage: {
      local: {
        get: async (k) => {
          if (k === null) return { ...data };
          if (Array.isArray(k)) return Object.fromEntries(k.map((x) => [x, data[x]]));
          return { [k]: data[k] };
        },
        set: async (o) => {
          if (failSet) failSet(o);
          Object.assign(data, o);
        },
        remove: async (k) => { delete data[k]; },
        getBytesInUse: async (k) => (data[k] ? JSON.stringify(data[k]).length : 0),
      },
      onChanged: { addListener() {} },
    },
  };
}

test("getSettings merges at the seam: keys are not touched, nothing about the engine is written", async () => {
  const fake = fakeStorage({ hiveyAi: RUNNING, webOffDefaultMigrated: true, webOnDefaultMigrated: true, railOpenMigrated: true, pageCtxOffMigrated: true, artifactsOffMigrated: true });
  globalThis.browser = fake;
  const s = await getSettings();
  assert.equal(s.provider, HIVEY_LOCAL);
  assert.deepEqual(s.keys, {}, "the bearer is not in keys");
  assert.equal(keyFor(HIVEY_LOCAL, s), "secret-bearer");
  assert.deepEqual(fake.data.keys, undefined, "and keys were not written");
  assert.equal(fake.data.provider, undefined, "the default is not persisted");
  delete globalThis.browser;
});

// ── No key through the bridge ────────────────────────────────────────────────────────────────

async function runBridge(store) {
  const local = new Map();
  const posted = [];
  const listeners = [];
  const sandbox = {
    location: { host: "app.hivey.be", origin: "https://app.hivey.be" },
    localStorage: { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)) },
    document: { documentElement: { dataset: {}, style: { setProperty() {} } } },
    window: { postMessage: (m) => posted.push(m), addEventListener() {} },
    browser: {
      storage: {
        local: {
          get: async (k) => {
            if (k === null) return { ...store };
            if (Array.isArray(k)) return Object.fromEntries(k.map((x) => [x, store[x]]));
            return { [k]: store[k] };
          },
          set: async (o) => Object.assign(store, o),
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
      runtime: { sendMessage() {} },
    },
    JSON, Object, console,
  };
  vm.runInNewContext(read("src/content/hivey-bridge.js"), sandbox);
  await new Promise((r) => setTimeout(r, 20));
  return { local, posted, listeners };
}

test("the bridge copies keys into the page's localStorage: the bearer must never be among them", async () => {
  const store = { keys: { openrouter: "sk-or-user" }, hiveyAi: RUNNING, theme: "graphite" };
  const { local, posted, listeners } = await runBridge(store);
  const everything = JSON.stringify([...local.entries()]) + JSON.stringify(posted);
  assert.match(everything, /sk-or-user/, "the bridge did run");
  assert.doesNotMatch(everything, /secret-bearer/);
  assert.doesNotMatch(everything, /47111/);
  // A change of hiveyAi is not a change of keys: nothing is pushed.
  const before = posted.length;
  for (const fn of listeners) fn({ hiveyAi: { newValue: RUNNING } }, "local");
  await new Promise((r) => setTimeout(r, 10));
  assert.doesNotMatch(JSON.stringify(posted.slice(before)), /secret-bearer/);
  assert.deepEqual(store.keys, { openrouter: "sk-or-user" });
});

test("the bridge's inlined Graphite palette is the theme's", () => {
  const bridge = read("src/content/hivey-bridge.js");
  const line = /graphite: (\{ bg:[^\n]*\}),\n/.exec(bridge);
  assert.ok(line, "inlined");
  for (const k of ["bg", "panel", "panel2", "border", "borderSoft", "text", "muted", "accent", "accent2"]) {
    assert.ok(line[1].includes(`${k}: "${THEMES.graphite[k]}"`), k);
  }
  assert.equal(THEMES.graphite.bg, "#101013");
  assert.equal(THEMES.graphite.panel, "#151518");
  assert.match(THEMES.graphite.gradient, /#3b82f6.*#8b5cf6.*#d946ef/);
});

test("a settings backup does not carry the engine's port and bearer", () => {
  assert.match(read("src/options/options.js"), /for \(const k of \["hiveyAi", "hiveyAiRequest", "hiveyAiBusy"\]\) delete fresh\[k\];/);
});

// ── The requests ─────────────────────────────────────────────────────────────────────────────

const sse = (chunks) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts, body: opts && opts.body ? JSON.parse(opts.body) : null }); return handler(url, opts, calls); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = real; });
}

test("a request goes to the engine's address with its bearer, thinking off, no reasoning fields", async () => {
  setLocalEngineGate(null);
  await withFetch(() => say("ok"), async (calls) => {
    const p = makeProvider({ provider: HIVEY_LOCAL, hiveyAi: RUNNING, models: {} }, { thinkLevel: "high" });
    const r = await p.runTurn({ system: "s", history: [{ role: "user", content: "q" }], tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] });
    assert.equal(r.text, "ok");
    assert.equal(calls[0].url, "http://127.0.0.1:47111/v1/chat/completions");
    assert.equal(calls[0].opts.headers.authorization, "Bearer secret-bearer");
    assert.deepEqual(calls[0].body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(calls[0].body.stream, true);
    assert.equal(calls[0].body.tools[0].function.name, "t");
    for (const f of ["reasoning_effort", "reasoning_budget_tokens", "reasoning"]) assert.ok(!(f in calls[0].body), f);
  });
});

test("the address is read at each request, through the gate: a restart has a new port and bearer", async () => {
  const eps = [{ baseUrl: "http://127.0.0.1:1/v1", key: "a" }, { baseUrl: "http://127.0.0.1:2/v1", key: "b" }];
  let n = 0;
  setLocalEngineGate(async () => eps[n++]);
  await withFetch(() => say("ok"), async (calls) => {
    const p = makeProvider({ provider: HIVEY_LOCAL, hiveyAi: { state: "off" }, models: {} }, {});
    await p.runTurn({ history: [{ role: "user", content: "1" }], tools: [] });
    await p.runTurn({ history: [{ role: "user", content: "2" }], tools: [] });
    assert.equal(calls[0].url, "http://127.0.0.1:1/v1/chat/completions");
    assert.equal(calls[1].url, "http://127.0.0.1:2/v1/chat/completions");
    assert.equal(calls[1].opts.headers.authorization, "Bearer b");
  });
  setLocalEngineGate(null);
});

test("not running, no gate: a clear error, no request to nowhere", async () => {
  setLocalEngineGate(null);
  await withFetch(() => say("x"), async (calls) => {
    const p = makeProvider({ provider: HIVEY_LOCAL, hiveyAi: { state: "off" }, models: {} }, {});
    await assert.rejects(p.runTurn({ history: [], tools: [] }), /not running/);
    assert.equal(calls.length, 0);
  });
});

test("tool messages take the OpenAI shape before the engine is known", () => {
  const p = makeProvider({ provider: HIVEY_LOCAL, hiveyAi: { state: "off" }, models: {} }, {});
  assert.deepEqual(p.formatToolResults([{ id: "1", content: "r" }]), [{ role: "tool", tool_call_id: "1", content: "r" }]);
});

test("the agent's tools refused: an error it can say; the chat's web tool still degrades", async () => {
  assert.equal(isToolsRefusal("tools param requires --jinja flag"), true);
  assert.equal(isToolsRefusal("this model does not support tools"), true);
  assert.equal(isToolsRefusal("something else"), false);
  assert.equal(adaptRequest({ tools: [1] }, "tools param requires --jinja flag").tools, undefined);
  setLocalEngineGate(null);
  const refuse = () => new Response("tools param requires --jinja flag", { status: 400 });
  await withFetch(refuse, async (calls) => {
    const p = makeProvider({ provider: HIVEY_LOCAL, hiveyAi: RUNNING, models: {} }, { requireTools: true });
    const tools = [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }];
    await assert.rejects(p.runTurn({ history: [{ role: "user", content: "q" }], tools }), (e) => e.code === "tools_rejected");
    assert.equal(calls.length, 1, "not sent again without them");
  });
  let n = 0;
  await withFetch(() => (n++ ? say("sans outil") : refuse()), async (calls) => {
    const p = makeProvider({ provider: "custom", baseUrls: { custom: "http://x/v1" }, models: { custom: "m" } }, {});
    const r = await p.runTurn({ history: [{ role: "user", content: "q" }], tools: [{ name: "t", description: "d", input_schema: {} }] });
    assert.equal(r.text, "sans outil");
    assert.ok(!("tools" in calls[1].body));
  });
});

// ── The window ───────────────────────────────────────────────────────────────────────────────

test("the window is the server's: /props first, the first /models entry next, 8 192 at worst", async () => {
  const s = (port) => ({ hiveyAi: { ...RUNNING, baseUrl: `http://127.0.0.1:${port}/v1` } });
  const props = async (url, opts) => {
    assert.equal(opts.headers.authorization, "Bearer secret-bearer");
    assert.ok(String(url).endsWith(":3/props"), url);
    return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } }));
  };
  assert.equal(await modelContextWindow(s(3), HIVEY_LOCAL, "x", props), 16384);
  const models = async (url) => (String(url).endsWith("/props") ? new Response("", { status: 404 }) : new Response(JSON.stringify({ data: [{ id: "/models/q.gguf", meta: { n_ctx: 4096 } }] })));
  assert.equal(await modelContextWindow(s(4), HIVEY_LOCAL, "Qwen3 1.7B", models), 4096, "named by its file, not by the name shown");
  const down = async () => { throw new Error("down"); };
  assert.equal(await modelContextWindow(s(5), HIVEY_LOCAL, "x", down), HIVEY_LOCAL_WINDOW);
  let asked = 0;
  assert.equal(await modelContextWindow({ hiveyAi: { state: "off" } }, HIVEY_LOCAL, "x", async () => { asked++; }), HIVEY_LOCAL_WINDOW, "not running: nothing to ask");
  assert.equal(asked, 0);
});

test("compaction on the small window: before the server refuses, and it really summarizes", async () => {
  assert.equal(shouldCompactLocal(4096, 8192, 3), true);
  assert.equal(shouldCompactLocal(4000, 8192, 3), false);
  assert.equal(shouldCompactLocal(7000, 8192, 2), false, "one exchange and a question: nothing to summarize");
  setLocalEngineGate(null);
  const history = [];
  for (let i = 0; i < 4; i++) history.push({ role: "user", content: `question ${i} ${"x".repeat(5000)}` }, { role: "assistant", content: `answer ${i} ${"y".repeat(4000)}` });
  history.push({ role: "user", content: "la dernière question" });
  const settings = { provider: HIVEY_LOCAL, hiveyAi: { ...RUNNING, baseUrl: "http://127.0.0.1:6/v1" }, models: {} };
  await withFetch((url, opts) => {
    if (String(url).endsWith("/props")) return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 8192 } }));
    const body = JSON.parse(opts.body);
    return say(/Summarize this conversation/.test(JSON.stringify(body.messages)) ? "RÉSUMÉ DENSE" : "la réponse");
  }, async (calls) => {
    const notes = [];
    const p = makeProvider(settings, {});
    const r = await runChatTurn({ provider: p, providerId: HIVEY_LOCAL, modelId: "m", settings, system: "s", history, turnStart: history.length - 1, onCompact: (why, phase) => notes.push(phase) });
    assert.equal(r.text, "la réponse");
    assert.equal(r.window, 8192);
    assert.deepEqual(notes, ["start", "done"]);
    assert.ok(calls.filter((c) => c.body).length === 2, "the summary, then the question");
    const sent = JSON.stringify(calls.filter((c) => c.body).at(-1).body.messages);
    assert.match(sent, /RÉSUMÉ DENSE/);
    assert.match(sent, /la dernière question/);
    assert.doesNotMatch(sent, /question 0/);
  });
});

// ── The engine ───────────────────────────────────────────────────────────────────────────────

function fakeEngine(initial) {
  let ai = initial;
  const requests = [];
  const shown = [];
  const watchers = new Set();
  const timers = [];
  const gate = createEngineGate({
    getAi: () => ai,
    request: (a) => requests.push(a),
    subscribe: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    onState: (s) => shown.push(s && s.state),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
  });
  return { gate, requests, shown, timers, set: (next) => { ai = { ...ai, ...next }; [...watchers].forEach((fn) => fn()); } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("running: it goes through at once, nothing asked", async () => {
  const e = fakeEngine(RUNNING);
  assert.deepEqual(await e.gate(), { baseUrl: RUNNING.baseUrl, key: "secret-bearer" });
  assert.deepEqual(e.requests, []);
});

test("off: start is asked once, the states are shown, the turn goes on when it runs", async () => {
  const e = fakeEngine({ state: "off", game: false });
  const done = e.gate();
  assert.deepEqual(e.requests, ["start"]);
  e.set({ state: "starting" });
  await tick();
  assert.ok(e.shown.includes("starting"));
  e.set({ state: "running", baseUrl: "http://127.0.0.1:9/v1", key: "k" });
  assert.deepEqual(await done, { baseUrl: "http://127.0.0.1:9/v1", key: "k" });
  assert.deepEqual(e.requests, ["start"]);
  assert.equal(e.shown.at(-1), null, "nothing left to show");
});

test("no model: nothing is requested until the click, then the download, the start, and the turn", async () => {
  const e = fakeEngine({ state: "no-model", modelName: "Qwen", modelGb: 1.1 });
  const done = e.gate();
  await tick();
  assert.deepEqual(e.requests, [], "never a download without the click");
  assert.equal(e.shown.at(-1), "no-model");
  // The card's button writes the request; the browser answers with its states.
  e.set({ state: "downloading", progress: 0.4 });
  e.set({ state: "downloading", progress: 0.9 });
  assert.deepEqual(e.requests, []);
  e.set({ state: "off" });
  assert.deepEqual(e.requests, ["start"], "the download is over: the turn goes on by itself");
  e.set({ state: "running", baseUrl: "http://127.0.0.1:9/v1", key: "k" });
  assert.equal((await done).key, "k");
});

test("a failed start or a failed download ends the turn with the browser's words", async () => {
  const e = fakeEngine({ state: "off" });
  const done = e.gate();
  e.set({ state: "failed", error: "GPU out of memory" });
  await assert.rejects(done, (err) => err.code === "engine_failed" && /GPU out of memory/.test(err.message));
  const d = fakeEngine({ state: "downloading", progress: 0.2 });
  const dl = d.gate();
  d.set({ state: "failed", error: "disk full" });
  await assert.rejects(dl, /disk full/);
  assert.deepEqual(d.requests, [], "no start after a failed download");
});

test("failed earlier: a new turn asks again, and only a new failure ends it", async () => {
  const e = fakeEngine({ state: "failed", error: "old" });
  const done = e.gate();
  assert.deepEqual(e.requests, ["start"]);
  e.set({ state: "starting" });
  e.set({ state: "running", baseUrl: "http://x/v1", key: "k" });
  assert.equal((await done).key, "k");
});

test("a browser that does not react is told after a delay, but never during a game", async () => {
  const e = fakeEngine({ state: "off", game: false });
  const done = e.gate();
  assert.equal(e.timers.length, 1);
  e.timers[0].fn();
  await assert.rejects(done, (err) => err.code === "engine_no_reaction");
  const g = fakeEngine({ state: "off", game: true });
  const paused = g.gate();
  assert.equal(g.timers.length, 0, "no clock while suspended for a game");
  g.set({ state: "running", baseUrl: "http://x/v1", key: "k", game: false });
  assert.equal((await paused).key, "k");
  const r = fakeEngine({ state: "off", game: false });
  const reacted = r.gate();
  r.set({ state: "starting" });
  assert.equal(r.timers[0].cleared, true, "any reaction stops the clock: a long start is not a failure");
  r.set({ state: "running", baseUrl: "http://x/v1", key: "k" });
  await reacted;
});

test("Stop ends the wait; several requests of a turn share one start", async () => {
  const e = fakeEngine({ state: "off" });
  const ctl = new AbortController();
  const a = e.gate(ctl.signal), b = e.gate();
  assert.deepEqual(e.requests, ["start"]);
  ctl.abort();
  await assert.rejects(a, (err) => err.name === "AbortError");
  e.set({ state: "running", baseUrl: "http://x/v1", key: "k" });
  assert.equal((await b).key, "k");
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(e.gate(aborted.signal), (err) => err.name === "AbortError");
});

test("Stop with nobody else waiting: nothing is started afterwards, for no turn", async () => {
  const e = fakeEngine({ state: "no-model" });
  const ctl = new AbortController();
  const a = e.gate(ctl.signal);
  ctl.abort();
  await assert.rejects(a, (err) => err.name === "AbortError");
  e.set({ state: "off" });
  await tick();
  assert.deepEqual(e.requests, []);
  // The next turn asks for itself.
  const b = e.gate();
  assert.deepEqual(e.requests, ["start"]);
  e.set({ state: "running", baseUrl: "http://x/v1", key: "k" });
  assert.equal((await b).key, "k");
});

test("the small helpers of the contract", () => {
  assert.equal(engineNext(RUNNING), "ready");
  assert.equal(engineNext({ state: "running" }), "start", "running with no address is not running");
  assert.equal(engineNext({ state: "no-model" }), "ask");
  assert.equal(engineNext({ state: "downloading" }), "wait");
  assert.equal(engineNext({ state: "starting" }), "wait");
  assert.equal(engineNext({ state: "off" }), "start");
  assert.equal(engineNext({ state: "failed" }), "start");
  assert.equal(runningEndpoint({ state: "off" }), null);
  assert.equal(progressPercent(0.426), 43);
  assert.equal(progressPercent(3), 100);
  assert.equal(progressPercent(undefined), 0);
});

// ── The surface ──────────────────────────────────────────────────────────────────────────────

test("the tools menu with Chat, Agent and Web is every workspace; Web is not in it", () => {
  const JS = read("src/sidebar/sidebar.js");
  const RAIL = JSON.parse(/const RAIL_MODES = (\[[^\]]*\]);/.exec(JS)[1]);
  assert.deepEqual([...EMBED_TOOLS, "chat", "agent", "web"].sort(), [...RAIL].sort());
  assert.ok(!EMBED_TOOLS.includes("web"));
});

test("the new tab and blank pages can be used as they are; a real page cannot", () => {
  for (const u of ["chrome://new-tab-page/", "chrome://newtab/", "chrome://newtab", "about:blank", "about:newtab", "about:home", "edge://newtab/"]) assert.equal(isBlankTabUrl(u), true, u);
  for (const u of ["https://www.youtube.com/", "chrome://settings/", "about:config", "", null, undefined]) assert.equal(isBlankTabUrl(u), false, String(u));
});

test("the prompt no longer names Firefox, and the memory tools have a schema", () => {
  assert.doesNotMatch(buildSystemPrompt({ agentMode: true, mode: "chat" }), /Firefox/);
  for (const t of TOOLS) {
    assert.equal(t.input_schema && t.input_schema.type, "object", t.name);
    assert.ok(!("parameters" in t), t.name);
  }
});

test("Hivey Browser's own look is not offered elsewhere, and the rest of the extension keeps its look", () => {
  assert.equal(THEMES.graphite.browserOnly, true);
  const css = read("src/sidebar/sidebar.css");
  const at = css.lastIndexOf("/* ── Hivey Browser's Assistant");
  assert.ok(at > 0);
  const rules = css.slice(at).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => /^[^ \n@}.]/.test(l));
  for (const r of rules) assert.match(r, /^html\.embed-hivey/, r);
});

test("no emoji in the Assistant's own statuses", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  const js = read("src/lib/i18n.js");
  for (const key of ["local.starting", "local.paused", "local.download", "local.downloading", "web.step.title", "web.step.search", "web.step.read", "web.step.done", "web.step.none", "web.step.blocked", "web.sources"]) {
    for (const m of js.matchAll(new RegExp(`"${key.replace(".", "\\.")}": "([^"]*)"`, "g"))) assert.ok(!EMOJI.test(m[1]), `${key}: ${m[1]}`);
  }
});

test("hiveyAiBusy follows startBusy and endBusy, and only in Hivey Browser", () => {
  const JS = read("src/sidebar/sidebar.js");
  const start = /function startBusy\(\) \{[\s\S]*?\n\}/.exec(JS)[0];
  const end = /function endBusy\(\) \{[\s\S]*?\n\}/.exec(JS)[0];
  assert.match(start, /setAiBusy\(true\)/);
  assert.match(end, /setAiBusy\(false\)/);
  assert.match(/function setAiBusy\(on\) \{[\s\S]*?\n\}/.exec(JS)[0], /if \(!settings \|\| !settings\.hiveyAi\) return;/);
});

test("Chromium's package may use more than the default 10 MB: images and long agent runs are in conversations", () => {
  assert.ok(JSON.parse(read("manifest.chrome.json")).permissions.includes("unlimitedStorage"));
});

// ── The history's quota ──────────────────────────────────────────────────────────────────────

let store;
beforeEach(() => { store = null; });

const conv = (id, extra = {}) => ({ id, title: id, transcript: [], ...extra });

test("a full storage: the oldest unpinned conversations make room, and the caller is told", async () => {
  store = fakeStorage({ conversations: [conv("pinned", { pinned: true, updatedAt: 1 }), conv("new", { updatedAt: 30 }), conv("old", { updatedAt: 10 })] }, {
    failSet: (o) => { if (o.conversations && o.conversations.length > 2) throw new Error("QUOTA_BYTES quota exceeded"); },
  });
  globalThis.browser = store;
  const saved = await saveConversation(conv("mine"));
  assert.equal(saved.evicted, 2);
  assert.deepEqual((await listConversations()).map((c) => c.id).sort(), ["mine", "pinned"]);
  delete globalThis.browser;
});

test("when nothing can be freed it says so; another failure stays what it is", async () => {
  store = fakeStorage({ conversations: [] }, { failSet: () => { throw new Error("quota exceeded"); } });
  globalThis.browser = store;
  await assert.rejects(saveConversation(conv("mine")), (e) => e.code === "storage_quota");
  store = fakeStorage({ conversations: [] }, { failSet: () => { throw new Error("disk on fire"); } });
  globalThis.browser = store;
  await assert.rejects(saveConversation(conv("mine")), /disk on fire/);
  delete globalThis.browser;
});

test("the cap stays 60 by default, is higher in Hivey Browser, and never drops a pinned one", async () => {
  const many = (n) => Array.from({ length: n }, (_, i) => conv(`c${i}`, { updatedAt: i }));
  store = fakeStorage({ conversations: many(70) });
  globalThis.browser = store;
  await saveConversation(conv("mine"));
  assert.equal(store.data.conversations.length, 60);
  store = fakeStorage({ conversations: many(70) });
  globalThis.browser = store;
  await saveConversation(conv("mine"), { cap: HIVEY_BROWSER_MAX_CONVERSATIONS });
  assert.equal(store.data.conversations.length, 71);
  delete globalThis.browser;
});

test("the space used: the browser's count, or the JSON's size where it has none", async () => {
  store = fakeStorage({ conversations: [conv("é")] });
  globalThis.browser = store;
  assert.equal(await conversationBytes(), JSON.stringify(store.data.conversations).length);
  delete store.storage.local.getBytesInUse;
  assert.equal(await conversationBytes(), new TextEncoder().encode(JSON.stringify(store.data.conversations)).length);
  store.data.conversations = [];
  assert.equal(await conversationBytes(), 0);
  delete globalThis.browser;
});
