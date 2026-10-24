#!/usr/bin/env node
// The chat + agent bench: does a change make the sidebar's answers better, worse, or neither?
//
// Twenty-seven tasks over the four tabs that talk to a model — Chat, Agent, Sécurité, Wisebase —
// each decided by a fact (a number, a name, a language, code that runs, what the agent submitted,
// visited or paid), never by a judge model's taste. The agent acts on a simulated web
// (bench/browser.mjs) through the extension's real tools, so a score measures the model and the
// extension, not the state of the internet that day.
//
// The code under test is loaded from `--root`, so the same bench runs on two checkouts — main and a
// branch — side by side, against the same server at the same moment. Each tab is driven the way
// sidebar.js drives it; when the version under test has `src/lib/conversation.js`, the bench calls
// that module — the one the sidebar itself calls — instead of its own replica.
//
// Usage:
//   node scripts/bench.mjs --url http://127.0.0.1:18080/v1 --model qwen-27b [--root DIR] [--only id,id] [--as label]
//   BENCH_KEY=sk-or-… node scripts/bench.mjs --provider openrouter --model deepseek/deepseek-v4.1
//
// Prints one line per task — `[id] PASS 12.3s 4 req 38 kB` — and writes the results as JSON to
// `--out` (default bench-results/<label>.json). The total is the score; the rule is that a change
// merges only if it does not lower it.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHAT_TASKS } from "../bench/tasks-chat.mjs";
import { AGENT_TASKS } from "../bench/tasks-agent.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

const ROOT = resolve(arg("root", "."));
const PROVIDER = arg("provider", "custom");
const MODEL = arg("model", "qwen-27b");
const URL_ = arg("url", "http://127.0.0.1:18080/v1");
const KEY = process.env.BENCH_KEY || "";
const LABEL = arg("as", "run");
const ONLY = (arg("only", "") || "").split(",").filter(Boolean);
const JOBS = Math.max(1, Number(arg("jobs", "1")));
const TIMEOUT_S = Number(arg("timeout", "900"));
const LEVEL = arg("level", ""); // a reasoning level to pick; empty = the extension's default
const OUT = arg("out", join("bench-results", `${LABEL}.json`));

const lib = (f) => import(pathToFileURL(join(ROOT, "src", "lib", f)).href);
const { buildSystemPrompt, activeTools, runConversation } = await lib("agent.js");
const { makeProvider } = await lib("providers.js");
const { buildTurn } = await lib("untrusted.js");
const i18n = await lib("i18n.js");
i18n.setLang("fr");
const storage = await lib("storage.js").catch(() => null);
const conversation = existsSync(join(ROOT, "src", "lib", "conversation.js")) ? await lib("conversation.js") : null;

// The settings a new install has — read from the version under test when it exports them.
const DEFAULTS = (storage && (storage.DEFAULTS || storage.DEFAULT_SETTINGS)) || {};
const settings = {
  ...DEFAULTS,
  provider: PROVIDER,
  models: { ...(DEFAULTS.models || {}), [PROVIDER]: MODEL },
  baseUrls: { ...(DEFAULTS.baseUrls || {}), ...(PROVIDER === "custom" ? { custom: URL_ } : {}) },
  keys: { ...(DEFAULTS.keys || {}), ...(KEY ? { [PROVIDER]: KEY } : {}) },
  responseLang: "Auto",
  blockPayments: true,
  compressHistory: true,
  cleanContext: true,
  maxPageChars: DEFAULTS.maxPageChars || 12000,
  ...(LEVEL ? { thinkLevel: LEVEL } : {}),
};
const thinkLevel = settings.thinkLevel ?? "off";

// What left for the model: requests, and characters sent — the bill's proxy on every provider.
const meter = { requests: 0, sent: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (/\/(chat\/completions|messages)$/.test(String(url))) {
    meter.requests++;
    meter.sent += typeof opts.body === "string" ? opts.body.length : 0;
  }
  return realFetch(url, opts);
};

const stripThink = (s) => String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
const provider = () => makeProvider(settings, { thinkLevel, webSearch: false });

// ── The sidebar's own drivers, replicated for versions that do not export them yet ────────────
// Mirrors sidebar.js on main: maybeCompressSession (28 000 characters, six messages kept), the page
// sent once per conversation as an untrusted block, and the system prompt of the tab.
const COMPRESS_TRIGGER_CHARS = 28000;
const COMPRESS_KEEP_TAIL = 6;
const historyChars = (h) => h.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content || "").length), 0);
async function legacyCompress(history, signal) {
  if (history.length <= COMPRESS_KEEP_TAIL + 2 || historyChars(history) < COMPRESS_TRIGGER_CHARS) return;
  let cut = Math.max(1, history.length - COMPRESS_KEEP_TAIL);
  while (cut < history.length && history[cut].role !== "user") cut++;
  if (cut >= history.length) return;
  const olderText = history.slice(0, cut).map((m) => {
    const c = m.content;
    const txt = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && p.text) || "").join(" ") : "";
    return `${m.role === "assistant" ? "Assistant" : "User"}: ${txt}`;
  }).join("\n").slice(0, 24000);
  let summary = "";
  try {
    const r = await provider().runTurn({
      system: "You compress chat history. Produce a dense, faithful summary that preserves names, facts, decisions, code identifiers and open questions, so the assistant can continue seamlessly. No preamble.",
      history: [{ role: "user", content: `Summarise the earlier part of this conversation in under 200 words:\n\n${olderText}` }],
      tools: [], signal,
    });
    summary = stripThink(r.text);
  } catch { summary = ""; }
  if (!summary) summary = olderText.slice(0, 1500);
  const note = `[Earlier conversation summary — older messages were compacted to save tokens]\n${summary}\n\n[End of summary]`;
  const tail = history.slice(cut);
  if (typeof tail[0].content === "string") tail[0].content = `${note}\n\n${tail[0].content}`;
  history.length = 0;
  history.push(...tail);
}

const pageBlock = (page) => `[Active page context]\nTitle: ${page.title}\nURL: ${page.url}\n${String(page.text || "").slice(0, settings.maxPageChars)}\n\n`;

async function legacyChat(task, signal) {
  const history = [];
  const answers = [];
  let pageSent = false;
  for (const text of task.turns) {
    await legacyCompress(history, signal);
    const untrusted = [];
    if (task.page && !pageSent) {
      untrusted.push({ kind: "web page", source: task.page.url, text: pageBlock(task.page) });
      pageSent = true;
    }
    const before = untrusted.length ? buildTurn({ userText: "", untrusted }).messages.slice(0, -1) : [];
    history.push(...before, { role: "user", content: text });
    const system = buildSystemPrompt({ agentMode: false, responseLang: "Auto", mode: task.tab === "security" ? "security" : "chat", blockPayments: true, artifacts: true, thinkLevel });
    const r = await runConversation({ provider: provider(), system, history, tools: [], signal });
    answers.push(stripThink(r.text));
  }
  return { answers };
}

async function legacyWisebase(task, signal) {
  const q = task.turns[0];
  const ctxBlock = task.passages.map((h, i) => `[${i + 1}] Source: ${h.title}\n${h.text}`).join("\n\n");
  const modelContent = `${i18n.t("wb.system")}\n\n[Context passages]\n${ctxBlock}\n\n[Question]\n${q}`;
  const system = buildSystemPrompt({ agentMode: false, responseLang: "Auto", mode: "chat", blockPayments: true, artifacts: true });
  const turn = await provider().runTurn({ system, history: [{ role: "user", content: modelContent }], tools: [], signal });
  return { answers: [stripThink(turn.text)] };
}

async function legacyAgent(task, browser, signal) {
  const history = [];
  const answers = [];
  let pageSent = false;
  for (const text of task.turns) {
    const page = browser.activePage();
    const untrusted = page && !pageSent ? [{ kind: "web page", source: page.url, text: pageBlock(page) }] : [];
    pageSent = true;
    const before = untrusted.length ? buildTurn({ userText: "", untrusted }).messages.slice(0, -1) : [];
    history.push(...before, { role: "user", content: text });
    const system = buildSystemPrompt({ agentMode: true, responseLang: "Auto", mode: "chat", blockPayments: true, artifacts: true, thinkLevel });
    const r = await runConversation({
      provider: provider(), system, history, tools: activeTools({ agentMode: true }), signal,
      confirmActions: false, confirmFn: null, guard: { blockPayments: true },
      execute: (name, input) => browser.execute(name, input),
    });
    answers.push(stripThink(r.text));
  }
  return { answers };
}

// ── One task ──────────────────────────────────────────────────────────────────────────────────
async function runTask(task) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_S * 1000);
  const started = Date.now();
  const at = { ...meter };
  const browser = task.world ? task.world() : null;
  let out;
  let error = "";
  try {
    const page = task.page || (browser && browser.activePage()) || null;
    if (conversation && conversation.benchTurns) {
      out = await conversation.benchTurns({ task, settings, browser, page, signal: ctl.signal, thinkLevel });
    } else if (task.tab === "agent") out = await legacyAgent(task, browser, ctl.signal);
    else if (task.tab === "wisebase") out = await legacyWisebase(task, ctl.signal);
    else out = await legacyChat(task, ctl.signal);
  } catch (e) {
    error = ctl.signal.aborted ? `timeout after ${TIMEOUT_S}s` : String((e && e.message) || e).slice(0, 300);
    out = { answers: [] };
  } finally {
    clearTimeout(timer);
  }
  const answer = (out.answers || []).at(-1) || "";
  let verdict;
  try {
    verdict = error ? { pass: false, why: error } : task.check({ answer, answers: out.answers || [], browser });
  } catch (e) {
    verdict = { pass: false, why: `check failed: ${e.message}` };
  }
  return {
    id: task.id,
    tab: task.tab,
    pass: verdict.pass,
    why: verdict.why,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    requests: meter.requests - at.requests,
    sentChars: meter.sent - at.sent,
    answer: answer.slice(0, 2000),
    actions: browser ? browser.log.filter((e) => e.type === "tool").length : 0,
  };
}

const tasks = [...CHAT_TASKS, ...AGENT_TASKS].filter((t) => !ONLY.length || ONLY.includes(t.id));
const results = [];
let next = 0;
async function worker() {
  while (next < tasks.length) {
    const task = tasks[next++];
    const r = await runTask(task);
    results.push(r);
    console.log(`[${r.id}] ${r.pass ? "PASS" : "FAIL"} ${r.seconds}s ${r.requests} req ${Math.round(r.sentChars / 1000)} kB${r.why ? ` — ${r.why}` : ""}`);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));

results.sort((a, b) => tasks.findIndex((t) => t.id === a.id) - tasks.findIndex((t) => t.id === b.id));
const passed = results.filter((r) => r.pass).length;
const seconds = results.reduce((n, r) => n + r.seconds, 0);
const sent = results.reduce((n, r) => n + r.sentChars, 0);
console.log(`\n${LABEL}: ${passed}/${results.length} — ${Math.round(seconds)} s, ${results.reduce((n, r) => n + r.requests, 0)} requests, ${Math.round(sent / 1000)} kB sent (${PROVIDER} ${MODEL}, root ${ROOT})`);
mkdirSync(resolve(OUT, ".."), { recursive: true });
writeFileSync(OUT, JSON.stringify({ label: LABEL, provider: PROVIDER, model: MODEL, root: ROOT, passed, total: results.length, seconds, sent, results }, null, 2));
