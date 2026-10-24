// A chat turn, around the agent loop: how much of the conversation the model gets, when it is
// summarized, and what happens when the window fills or the connection drops.
//
// This used to live inside sidebar.js, which is why nothing measured it: a conversation was
// compacted when its history passed 28 000 CHARACTERS — about 7 000 tokens, the same figure for an
// 8k local model and a million-token Claude — so on the large models a conversation was replaced by
// a 200-word summary of itself after a few exchanges, and on a small one it could still outgrow the
// window and end on an error. The rules are hivey-vscode's now (core/context/budget.ts,
// core/session/digest.ts): the budget is the window of the model actually in use, less what the
// answer needs; the conversation is summarized by itself at three quarters of it; a server that
// still refuses it ("exceeds the available context size") gets a summary and the question again,
// and says how big its window really is, which is remembered.
//
// The sidebar and the bench (scripts/bench.mjs) both call this module, so what is measured is what
// ships.

import { runConversation, buildSystemPrompt, activeTools } from "./agent.js";
import { buildTurn } from "./untrusted.js";
import { CONTEXT_WINDOWS } from "./model-catalog.generated.js";
import { baseUrlFor, keyFor } from "./models.js";
import { isSelfHostedProvider } from "./reasoning.js";
import { makeProvider } from "./providers.js";
import { detectUserLanguage } from "./user-language.js";
import { t } from "./i18n.js";

// ── The window ────────────────────────────────────────────────────────────────────────────────

/** What is used when nothing is known about the model: the old flat default of hivey-vscode. */
export const CONTEXT_FLOOR_TOKENS = 8000;
/** What the window keeps back for the answer: a twentieth, never less than one answer. */
const RESERVE_SHARE = 0.05;
const ANSWER_TOKENS = 4000;

/** Windows learned from the servers themselves — their /models list or their refusal. */
const learned = new Map();
const keyOf = (providerId, modelId, settings) => `${baseUrlFor(providerId, settings || {}) || providerId}::${modelId}`;

/** The catalogue's window for a model id, any spelling: `anthropic/claude-opus-4.5`, `claude-opus-4-5`, `gpt-5`. */
export function catalogWindow(providerId, modelId) {
  const id = String(modelId || "");
  if (CONTEXT_WINDOWS[id]) return CONTEXT_WINDOWS[id];
  const vendor = { anthropic: "anthropic", openai: "openai", google: "google", mistral: "mistralai", deepseek: "deepseek", xai: "x-ai", perplexity: "perplexity", cohere: "cohere" }[providerId];
  const dotted = id.replace(/^models\//, "").replace(/-(\d+)-(\d+)(?=$|-)/, "-$1.$2").replace(/-\d{8}$/, "");
  for (const c of vendor ? [`${vendor}/${id}`, `${vendor}/${dotted}`] : [dotted]) if (CONTEXT_WINDOWS[c]) return CONTEXT_WINDOWS[c];
  return 0;
}

/** The runtime window a /models entry reports (llama.cpp, llama-swap, LM Studio, vLLM), 0 when none. */
export function windowOfEntry(entry) {
  const e = entry || {};
  for (const v of [e.context_length, e.context_window, e.meta && e.meta.n_ctx, e.max_context_length, e.max_model_len]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

/**
 * The model's context window in tokens, 0 when unknown. A self-hosted server is asked once — its
 * runtime window is what refuses a request, not the model's training maximum.
 */
export async function contextWindowFor(settings, providerId, modelId, fetchImpl = globalThis.fetch) {
  const key = keyOf(providerId, modelId, settings);
  if (learned.has(key)) return learned.get(key);
  let n = providerId === "openrouter" || !isSelfHostedProvider(providerId) ? catalogWindow(providerId, modelId) : 0;
  if (!n && isSelfHostedProvider(providerId)) {
    try {
      const base = baseUrlFor(providerId, settings);
      const apiKey = keyFor(providerId, settings);
      const res = await fetchImpl(base.replace(/\/$/, "") + "/models", { headers: apiKey ? { authorization: `Bearer ${String(apiKey).trim()}` } : {} });
      if (res.ok) {
        const json = await res.json();
        n = windowOfEntry((json.data || json.models || []).find((m) => m && (m.id === modelId || m.name === modelId)));
      }
    } catch (_) { n = 0; }
  }
  learned.set(key, n);
  return n;
}

export function learnWindow(settings, providerId, modelId, tokens) {
  if (tokens > 0) learned.set(keyOf(providerId, modelId, settings), Math.floor(tokens));
}

/** The budget for a turn: the window less the reserve; the floor when the window is unknown. */
export function contextBudget(window) {
  if (!Number.isFinite(window) || window <= 0) return CONTEXT_FLOOR_TOKENS;
  return Math.max(CONTEXT_FLOOR_TOKENS, window - Math.max(Math.floor(window * RESERVE_SHARE), ANSWER_TOKENS));
}

/**
 * The server's "does not fit" refusal, and the window it names when it names one — llama.cpp says
 * "request (69882 tokens) exceeds the available context size (69632 tokens)", OpenAI
 * "maximum context length is 128000 tokens".
 */
export function contextOverflow(message) {
  const m = String(message || "");
  if (!/exceeds the available context size|larger than the max context size|exceed_context_size|context_length_exceeded|maximum context length|context window|prompt is too long|too many tokens/i.test(m)) return undefined;
  const pair = /\((\d+) tokens\)[^(]*\((\d+) tokens\)/.exec(m);
  const max = /maximum context length is (\d+)/i.exec(m) || /context (?:size|window|length)[^\d]{0,20}(\d{4,})/i.exec(m);
  return { window: pair ? Number(pair[2]) : max ? Number(max[1]) : 0 };
}

// ── Size ──────────────────────────────────────────────────────────────────────────────────────

/** Rough tokens of the messages, at ~4 characters a token; images count as ~1 000 each. */
export function estimateTokens(messages, system = "") {
  let chars = String(system || "").length;
  let images = 0;
  for (const m of messages || []) {
    const c = m && m.content;
    if (typeof c === "string") chars += c.length;
    else if (Array.isArray(c)) {
      for (const p of c) {
        if (!p) continue;
        if (p.type === "image" || p.type === "image_url") images++;
        else chars += String(p.text || p.thinking || "").length + (p.input ? JSON.stringify(p.input).length : 0) + (typeof p.content === "string" ? p.content.length : 0);
      }
    }
    if (m && m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    if (m && m._reasoning) chars += m._reasoning.length;
  }
  return Math.ceil(chars / 4) + images * 1000;
}

/** How many questions the history holds — summarizing two exchanges into fewer is not possible. */
const exchanges = (h) => (h || []).filter((m) => m && m.role === "user" && !(Array.isArray(m.content) && m.content.every((p) => p && p.type === "tool_result"))).length;

/** hivey-vscode's thresholds: summarized by itself at 75 % of the budget, from 6 000 tokens and 4 exchanges. */
export const AUTO_COMPACT_RATIO = 0.75;
export const COMPACT_FLOOR_TOKENS = 6000;
export function shouldAutoCompact(tokens, budget, count) {
  if (budget <= 0 || tokens < COMPACT_FLOOR_TOKENS || count < 4) return false;
  return tokens / budget >= AUTO_COMPACT_RATIO;
}

// ── The summary ───────────────────────────────────────────────────────────────────────────────

/** What the summary is asked to keep (hivey-vscode, core/session/digest.ts `compactBrief`). */
export function compactBrief() {
  return [
    "Summarize this conversation so it can replace the transcript in your own context.",
    "Write it for yourself, not for the user: it is the only record you will have of what came before.",
    "Cover, as sections and in this order:",
    "1. What the user is trying to achieve, in their terms.",
    "2. Facts, names, numbers, dates, references and identifiers the user gave or that were established — verbatim.",
    "3. Decisions already taken, and the reasoning that settled them.",
    "4. Approaches tried and rejected, with why — so they are not tried again.",
    "5. What is still open, and the immediate next step.",
    "Keep every identifier, number and name verbatim. Prefer omitting a pleasantry to omitting a fact.",
    "Do not address the user, do not apologize, and do not describe the conversation as a conversation.",
    "Be dense. Use short lines and fragments, not paragraphs. Aim for under 400 words, and never",
    "exceed a fifth of the length of what you were given. Drop anything the next step does not need.",
  ].join("\n");
}

const SUMMARY_HEAD = "[Earlier conversation, summarized — older messages no longer fit and were compacted. It is your own record: work from it.]";

const plain = (m) => {
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && (p.text || (typeof p.content === "string" ? p.content : ""))) || "").join(" ");
  return "";
};

/**
 * Summarize every message before `keepFrom` and put the summary at the head of the message that
 * starts the kept part (a user message, so the roles still alternate on strict APIs). Messages the
 * user pinned are kept word for word inside the summary's message. Returns whether it compacted.
 */
export async function compactHistory(history, { provider, signal, keepFrom = history.length - 1, maxChars = 200000 }) {
  // The kept part starts on a question — a user message that is not a batch of tool results, whose
  // calls would then be summarized away from them.
  const isQuestion = (m) => m.role === "user" && !(Array.isArray(m.content) && m.content.some((p) => p && p.type === "tool_result"));
  let cut = Math.max(0, Math.min(keepFrom, history.length - 1));
  while (cut > 0 && !isQuestion(history[cut])) cut--;
  if (!isQuestion(history[cut])) return false;
  if (cut <= 0 || cut >= history.length) return false;
  const older = history.slice(0, cut);
  let transcript = older.map((m) => `${m.role === "assistant" ? "ASSISTANT" : m.role === "tool" ? "RESULT" : "USER"}: ${plain(m)}`).join("\n");
  if (transcript.length > maxChars) transcript = `${transcript.slice(0, maxChars * 0.25)}\n[… the middle, left out to fit …]\n${transcript.slice(-maxChars * 0.75)}`;
  if (!transcript.trim()) return false;
  let summary = "";
  try {
    const r = await provider.runTurn({
      system: "You keep the record of a conversation so that it can carry on after the context window filled up.",
      history: [{ role: "user", content: `${compactBrief()}\n\n--- the conversation so far ---\n${transcript}` }],
      tools: [],
      signal,
      chore: true,
    });
    summary = String((r && r.text) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } catch (e) {
    if (signal && signal.aborted) throw e;
    summary = "";
  }
  if (!summary) return false;
  const pinned = older.filter((m) => m._pinned).map((m) => `[Pinned by the user — kept word for word]\n${plain(m)}`);
  const note = [SUMMARY_HEAD, summary, ...pinned, "[End of summary]"].join("\n\n");
  const tail = history.slice(cut);
  const first = { ...tail[0] };
  if (typeof first.content === "string") first.content = `${note}\n\n${first.content}`;
  else if (Array.isArray(first.content)) {
    const ti = first.content.findIndex((p) => p && p.type === "text");
    first.content = ti >= 0
      ? first.content.map((p, i) => (i === ti ? { ...p, text: `${note}\n\n${p.text}` } : p))
      : [{ type: "text", text: note }, ...first.content];
  }
  tail[0] = first;
  history.length = 0;
  history.push(...tail);
  return true;
}

// ── The turn ──────────────────────────────────────────────────────────────────────────────────

const CONTINUE_AFTER_INTERRUPT =
  "Your previous reply was interrupted before you finished (the connection to you was closed). " +
  "Continue exactly from where you stopped, without repeating what you already wrote.";
const MAX_CONTINUATIONS = 2;

/**
 * One question, answered. `history` is the conversation in the provider's native format and is
 * updated in place (the sidebar persists that same array). Before the question: summarized if it
 * nears the budget. On a "does not fit" refusal: the window it names is learned, the conversation
 * is summarized, and the question asked again — once. A reply whose stream was cut is continued.
 *
 * Returns `{ text, compacted, window, usage }` plus what runConversation returned.
 */
export async function runChatTurn({ provider, providerId, modelId, settings, system, history, tools = [], signal, onText, onThink, onCompact, window, turnStart = history.length - 1, ...rest }) {
  const win = window ?? (await contextWindowFor(settings, providerId, modelId));
  const budget = contextBudget(win);
  let compacted = false;
  if (settings.compressHistory !== false && shouldAutoCompact(estimateTokens(history, system), budget, exchanges(history))) {
    onCompact && onCompact("auto");
    compacted = await compactHistory(history, { provider, signal, keepFrom: turnStart });
  }
  let result;
  for (let tries = 0; ; tries++) {
    try {
      result = await runConversation({ provider, system, history, tools, signal, onText, onThink, ...rest });
      break;
    } catch (e) {
      const over = contextOverflow(e && e.message);
      if (!over || tries > 0 || (signal && signal.aborted)) throw e;
      if (over.window) learnWindow(settings, providerId, modelId, over.window);
      onCompact && onCompact("overflow");
      // A turn that throws writes nothing back, so the history is as it was: what came before the
      // question is summarized, and the question — kept out of the summary — is asked again.
      if (!(await compactHistory(history, { provider, signal, keepFrom: turnStart }))) throw e;
      compacted = true;
    }
  }
  // Cut, not finished: what arrived is half an answer that reads as a whole one. Continuing a text
  // has no side effect, so it is asked for, a bounded number of times.
  let text = result.text || "";
  for (let n = 0; result.interrupted && !(signal && signal.aborted) && n < MAX_CONTINUATIONS; n++) {
    history.push({ role: "user", content: CONTINUE_AFTER_INTERRUPT });
    result = await runConversation({ provider, system, history, tools, signal, onText, onThink, ...rest });
    text += result.text || "";
  }
  return { ...result, text, compacted, window: win };
}

// ── The bench's entry point ───────────────────────────────────────────────────────────────────

const pageBlock = (page, max) => `[Active page context]\nTitle: ${page.title}\nURL: ${page.url}\n${String(page.text || "").slice(0, max)}\n\n`;
const stripThink = (s) => String(s || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** The language a turn's answer must be in: the user's own, whatever they write in. */
export function replyLanguageOf(text, settings) {
  if (settings && settings.responseLang && settings.responseLang !== "Auto") return undefined;
  return detectUserLanguage(String(text || ""), "en");
}

/**
 * The bench's driver (scripts/bench.mjs): each tab run through the functions the sidebar runs it
 * through. `task.tab` is chat, security, wisebase or agent; `browser` is the simulated web.
 */
export async function benchTurns({ task, settings, browser, page, signal, thinkLevel, wisebaseSystem = t("wb.system") }) {
  const providerId = settings.provider;
  const modelId = settings.models[providerId];
  const provider = makeProvider(settings, { thinkLevel, webSearch: false });
  const agent = task.tab === "agent";
  const history = [];
  const answers = [];
  let pageSent = false;
  for (const text of task.turns) {
    let content = text;
    if (task.tab === "wisebase") {
      const ctxBlock = task.passages.map((h, i) => `[${i + 1}] Source: ${h.title}\n${h.text}`).join("\n\n");
      content = `${wisebaseSystem}\n\n[Context passages]\n${ctxBlock}\n\n[Question]\n${text}`;
    }
    const current = agent ? browser.activePage() : page;
    const untrusted = current && !pageSent && task.tab !== "wisebase" ? [{ kind: "web page", source: current.url, text: pageBlock(current, settings.maxPageChars || 12000) }] : [];
    pageSent = pageSent || untrusted.length > 0;
    const before = untrusted.length ? buildTurn({ userText: "", untrusted }).messages.slice(0, -1) : [];
    history.push(...before, { role: "user", content });
    const system = buildSystemPrompt({
      agentMode: agent, responseLang: settings.responseLang, mode: task.tab === "security" ? "security" : "chat",
      blockPayments: true, artifacts: true, thinkLevel, replyLanguage: replyLanguageOf(text, settings),
    });
    const r = await runChatTurn({
      provider, providerId, modelId, settings, system, history, signal,
      tools: agent ? activeTools({ agentMode: true }) : [],
      ...(agent ? { confirmActions: false, confirmFn: null, guard: { blockPayments: true }, execute: (name, input) => browser.execute(name, input) } : {}),
    });
    answers.push(stripThink(r.text));
  }
  return { answers };
}

