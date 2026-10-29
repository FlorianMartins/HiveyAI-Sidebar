// API clients. Two families sharing one interface:
//   runTurn({ system, history, tools, onText, onThink, signal })
//     -> { message, toolCalls:[{id,name,input}], stopReason, text, reasoning, usage, interrupted? }
//   `stopReason` is "tool_use", "length" (cut by the output cap), or the provider's own word.
//   formatToolResults(results) -> native message(s) to push into the history
//
// `history` and `message` stay in each provider's NATIVE wire format (Anthropic
// vs OpenAI) to remain faithful to each API. The agent loop (agent.js) only ever
// touches the normalised `toolCalls` array.
//
// `onThink(delta)` receives reasoning text (Anthropic extended thinking,
// DeepSeek/o-series reasoning_content) so the UI can show it separately.

import { imageConfigOf, imageResolutions } from "./image-sizes.js";
import { PROVIDERS, baseUrlFor, modelFor, keyFor } from "./models.js";
import { anthropicThinking, wireReasoning, selfHostedThinkingBudget, isSelfHostedProvider } from "./reasoning.js";
import { privateProvider, redactsFor } from "./privacy.js";
import { stripPrivate } from "./context-control.js";

// Pull the real, resolvable source URLs out of web-plugin annotations (OpenRouter/OpenAI
// `url_citation`). These are the ACTUAL search-result links — unlike URLs the model types into its
// prose, which are frequently hallucinated or truncated (→ 404). Deduped, in first-seen order.
function extractUrlCitations(annotations) {
  const out = [];
  const seen = new Set();
  for (const a of annotations || []) {
    if (!a) continue;
    const uc = a.url_citation || (a.type === "url_citation" && a.url_citation) || (a.type === "url_citation" ? a : null);
    const url = uc && uc.url;
    if (typeof url === "string" && /^https?:\/\//.test(url) && !seen.has(url)) {
      seen.add(url);
      out.push({ url, title: (uc.title || "").slice(0, 200) });
    }
  }
  return out;
}

// ── No manual limits ──────────────────────────────────────────────────────────────────────────
//
// ⚠️ « il faut s'adapter aux limites des modèles, pas ajouter manuellement des limites » (the rule
// hivey-vscode follows). Every request here used to carry a cap written in source: 4096 output tokens
// on Claude (+ a fixed thinking budget), 8000–32000 on OpenRouter chosen by matching the model's
// NAME, nothing elsewhere. A long answer, a whole artifact, a plan that thought first — cut, on models
// that could write ten times more. Now nothing is sent where the API needs nothing (the model's own
// limit applies), and where it demands a figure — Anthropic's `max_tokens` — a generous one is asked
// and a model that cannot go that far says so ("max_tokens: 64000 > 32000 …"): the request goes again
// at exactly its limit, which is remembered for the session.
const learnedMaxOutput = new Map();
const GENEROUS_MAX_OUTPUT = 64000;

/** The model's own output limit, from a refusal of a larger `max_tokens`; 0 when it is not one. */
export function maxOutputFromRefusal(message) {
  const m = /max_tokens:\s*(\d+)\s*>\s*(\d+)/.exec(String(message || ""));
  return m ? Number(m[2]) : 0;
}

/** The user's level, or none: the legacy values are read as what they asked for. */
function levelOf(v) {
  if (v === "off" || v === false || v == null || v === "") return undefined; // nothing picked
  if (v === true) return "high";
  if (["none", "low", "medium", "high", "xhigh", "max"].includes(v)) return v;
  return undefined;
}

// No host preference on OpenRouter, as in hivey-vscode: OpenRouter routes to the best price among
// the healthy hosts. The sidebar used to pin open-weight models (DeepSeek, Qwen, GLM, Kimi…) to
// fp8-or-better hosts; that also excluded fp4, which it was never meant to, and on DeepSeek V4.1
// Flash the answer cost 5× what hivey-vscode paid for the same request (measured 2026-10-26).

// Generic SSE reader: yields the payloads of "data:" lines.
async function* sseData(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
}

async function ensureOk(response) {
  if (response.ok) return;
  let detail = "";
  try {
    detail = await response.text();
  } catch (_) {}
  throw new Error(`HTTP ${response.status} — ${detail.slice(0, 500)}`);
}

/**
 * The connection closed under a request or a response — not a refusal, not a bad request. Firefox
 * says "NetworkError when attempting to fetch resource", Chromium "Failed to fetch", Node
 * "terminated" or a socket code (from hivey-vscode, providers/openai.ts).
 */
export function isConnectionDrop(err) {
  if (!err || err.name === "AbortError") return false;
  const codes = ["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED"];
  if (codes.includes(String(err.code)) || codes.includes(String(err.cause && err.cause.code))) return true;
  return /^terminated$|other side closed|socket hang up|NetworkError|Failed to fetch|network connection was lost|ERR_CONNECTION_RESET/i.test(String(err.message || ""));
}

/**
 * How long to wait before repeating a 402, when OpenRouter says it is worth repeating: its in-flight
 * spending budget (requests in flight reserve credit), not the balance — "A 402 Payment Required
 * without the header is not a wait-and-retry case". Bounded at thirty seconds.
 */
function retryAfterMs(res) {
  if (res.status !== 402) return undefined;
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) return undefined;
  return Math.max(250, seconds * 1000);
}

const pause = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Auto-retry transient rate limits (429) and upstream hiccups (503). Free models get rate-limited
// upstream for a second or two ("retry_after_seconds":1) — a short retry usually clears it, so the
// right-click quick actions (translate/summarize…) keep working without a paid key.
//
// ⚠️ « read ECONNRESET » — a connection reset before any answer came back ended the turn on an error,
// though the server had not started on it. It is sent again, once: nothing was lost but the place in
// the queue. A 402 with Retry-After waits as OpenRouter documents, twice at most.
async function fetchWithRetry(url, opts, maxRetries = 3) {
  let attempt = 0;
  let resets = 0;
  let waits = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      if (resets < 1 && isConnectionDrop(err) && !(opts.signal && opts.signal.aborted)) { resets++; continue; }
      throw err;
    }
    const after = retryAfterMs(res);
    if (after !== undefined && waits < 2) {
      waits++;
      try { await res.body?.cancel?.(); } catch (_) {}
      await pause(after, opts.signal);
      continue;
    }
    if ((res.status !== 429 && res.status !== 503) || attempt >= maxRetries || (opts.signal && opts.signal.aborted)) return res;
    let waitMs = Math.min(4000, 700 * (attempt + 1));
    const ra = res.headers.get("retry-after");
    if (ra) { const s = parseInt(ra, 10); if (!Number.isNaN(s)) waitMs = Math.min(6000, Math.max(waitMs, (s || 1) * 1000)); }
    try { await res.body?.cancel?.(); } catch (_) {}
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
}

/**
 * What to drop when a server refuses a parameter, read from what it said (hivey-vscode,
 * `adaptRequest`). "OpenAI-compatible" is a family, not a specification: OpenAI refuses `max_tokens`
 * on its reasoning models, several gateways reject a field they have never heard of instead of
 * ignoring it. Nothing is predicted: the request goes out as written, and a field the server names
 * is removed or renamed and the request goes again — at most twice, and only ever by DROPPING
 * something, so a retry can never ask for more than the user did. `undefined` when the complaint is
 * not about a parameter (a missing model, a content filter): repeating those would only waste time.
 */
export function adaptRequest(body, error) {
  const said = String(error || "").toLowerCase();
  const next = { ...body };
  let changed = false;
  const affordable = /can only afford\s+(\d+)/i.exec(String(error || ""));
  if (affordable) {
    const n = Number(affordable[1]);
    const asked = Number(next.max_tokens ?? next.max_completion_tokens ?? 0);
    if (n >= 256 && (!asked || asked > n)) { next.max_tokens = n; delete next.max_completion_tokens; return next; }
    return undefined;
  }
  // A model that cannot think, asked to: Ollama names no field ("does not support thinking").
  if (/does not support thinking|thinking is not supported|reasoning is not supported/.test(said)) {
    for (const field of ["reasoning_effort", "reasoning", "reasoning_budget_tokens", "reasoning_budget_message"]) {
      if (field in next) { delete next[field]; changed = true; }
    }
    if (changed) return next;
  }
  // « thinking or redacted_thinking blocks in the latest assistant message cannot be modified »: Claude
  // signs its thinking, and a history whose thinking came back altered is refused. The thinking of
  // earlier steps is a help, not a requirement: without it the request goes through.
  if (/(thinking|redacted_thinking)\b.{0,80}cannot be modified/.test(said) && Array.isArray(next.messages) && next.messages.some((m) => m && m.reasoning_details)) {
    next.messages = next.messages.map((m) => {
      if (!m || !m.reasoning_details) return m;
      const { reasoning_details, ...rest } = m;
      return rest;
    });
    return next;
  }
  // Some OpenRouter endpoints make reasoning mandatory ("Reasoning is mandatory for this endpoint and
  // cannot be disabled"): the model's own default is the request it accepts.
  if (/reasoning is mandatory|cannot be disabled/.test(said) && next.reasoning) {
    delete next.reasoning;
    return next;
  }
  // DeepSeek thinking with tools refuses a history whose earlier steps lost `reasoning_content`
  // (a conversation from before this version): thinking off is the request it accepts.
  if (said.includes("reasoning_content") && next.thinking && next.thinking.type !== "disabled") {
    next.thinking = { type: "disabled" };
    delete next.reasoning_effort;
    return next;
  }
  if ("max_tokens" in next && said.includes("max_completion_tokens")) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
    changed = true;
  }
  for (const field of ["temperature", "reasoning_effort", "reasoning", "stream_options", "usage", "max_tokens", "reasoning_budget_tokens", "reasoning_budget_message", "thinking", "plugins", "provider"]) {
    if (!(field in next) || !said.includes(field)) continue;
    delete next[field];
    changed = true;
  }
  if (!changed && next.reasoning && /reasoning/.test(said)) { delete next.reasoning; changed = true; }
  return changed ? next : undefined;
}

/**
 * One streamed piece of OpenRouter's `reasoning_details`, added to the ones before it.
 *
 * ⚠️ « Deepseek v4.1 via openrouter semble se perdre trop souvent (il s'éparpille) » — through
 * OpenRouter the model was sent nothing of what it had thought at the step before, so a model that
 * reasons before every action started each step over from the tool results alone. OpenRouter asks
 * for `reasoning_details` back, unchanged, on the assistant message. Streamed, a detail arrives in
 * pieces carrying the same `index`: text, summary or encrypted data concatenated in order, the rest
 * taken as it last came.
 */
export function mergeReasoningDetail(into, piece) {
  if (!piece || typeof piece !== "object") return;
  const last = into[into.length - 1];
  const same = last && piece.index !== undefined && last.index === piece.index && last.type === piece.type;
  if (!same) { into.push({ ...piece }); return; }
  for (const [k, v] of Object.entries(piece)) {
    if (v === null || v === undefined) continue;
    if ((k === "text" || k === "summary" || k === "data") && typeof v === "string") last[k] = String(last[k] ?? "") + v;
    else last[k] = v;
  }
}

/** Whether a tool call's arguments are a whole JSON value — a call cut mid-way is half a call. */
function isCompleteJson(s) {
  try { JSON.parse(s || "{}"); return true; } catch (_) { return false; }
}

/** Rough tokens of a value, at the usual ~4 characters a token. */
const roughTokens = (v) => Math.ceil((typeof v === "string" ? v.length : JSON.stringify(v ?? "").length) / 4);

/**
 * Below this there is nothing worth caching, and a cache write costs 1.25× (hivey-vscode,
 * `CACHE_WORTH_IT_TOKENS`). Anthropic will not cache under about a thousand tokens in any case.
 */
const CACHE_WORTH_IT_TOKENS = 2000;

// ---------------------------------------------------------------------------
// Anthropic (Claude) — native API, + adaptive/extended thinking + server-side web search
// ---------------------------------------------------------------------------
function anthropicProvider({ apiKey, model, baseUrl, thinkLevel, webSearch }) {
  const url = baseUrl.replace(/\/$/, "") + "/messages";
  return {
    id: "anthropic",

    async runTurn({ system, history, tools, onText, onThink, signal, chore }) {
      // Thinking per model family — see reasoning.js, where each rule cites Anthropic's docs. A side
      // task (a summary, a title) is not a level anybody picked: the model's own default.
      const think = anthropicThinking(model, chore ? undefined : thinkLevel);
      // PROMPT CACHE. The system prompt and, on a long conversation or agent turn, everything sent
      // so far are marked: the next request — the next step, the next question — reads them back at
      // a tenth of the input price instead of paying full price for the whole transcript again,
      // which made a long agent turn cost the SQUARE of its length. Marked on a copy: the stored
      // history never carries a breakpoint (Anthropic accepts four).
      // No `_` key leaves the browser (exchange ids, flags — see context-control.js).
      const messages = history.map(stripPrivate);
      const total = roughTokens(system) + roughTokens(history);
      if (total >= CACHE_WORTH_IT_TOKENS && messages.length) {
        const last = messages[messages.length - 1];
        const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : (last.content || []).map((b) => ({ ...b }));
        const i = blocks.length - 1;
        if (i >= 0 && blocks[i].type !== "thinking" && blocks[i].type !== "redacted_thinking") {
          blocks[i] = { ...blocks[i], cache_control: { type: "ephemeral" } };
          messages[messages.length - 1] = { ...last, content: blocks };
        }
      }
      const body = {
        model,
        max_tokens: learnedMaxOutput.get(model) ?? GENEROUS_MAX_OUTPUT,
        system: system ? [{ type: "text", text: system, ...(roughTokens(system) >= 1024 ? { cache_control: { type: "ephemeral" } } : {}) }] : undefined,
        messages,
        stream: true,
      };
      if (!body.system) delete body.system;
      if (think.thinking) body.thinking = think.thinking;
      if (think.effort) body.output_config = { effort: think.effort };
      if (think.headroom) {
        const ceiling = learnedMaxOutput.get(model);
        const wanted = Math.max(body.max_tokens, think.headroom + 4096);
        body.max_tokens = ceiling ? Math.min(wanted, ceiling) : wanted;
      }
      const toolList = [];
      if (tools && tools.length) {
        for (const t of tools)
          toolList.push({ name: t.name, description: t.description, input_schema: t.input_schema });
      }
      if (webSearch) {
        toolList.push({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
      }
      if (toolList.length) body.tools = toolList;

      const send = () => fetchWithRetry(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": String(apiKey || "").trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
      let response = await send();
      if (!response.ok && response.status === 400) {
        const said = await response.text().catch(() => "");
        const limit = maxOutputFromRefusal(said);
        if (!limit) throw new Error(`HTTP 400 — ${said.slice(0, 500)}`);
        learnedMaxOutput.set(model, limit);
        body.max_tokens = limit;
        response = await send();
      }
      await ensureOk(response);

      const blocks = [];
      let stopReason = null;
      let text = "";
      let reasoning = "";
      let finished = false;
      const usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };

      try {
        for await (const data of sseData(response)) {
          if (data === "[DONE]") { finished = true; break; }
          let ev;
          try {
            ev = JSON.parse(data);
          } catch (_) {
            continue;
          }
          switch (ev.type) {
            case "message_start": {
              const u = ev.message && ev.message.usage;
              if (u) {
                usage.promptTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
                usage.cachedTokens = u.cache_read_input_tokens || 0;
              }
              break;
            }
            case "content_block_start":
              blocks[ev.index] = { ...ev.content_block, _partial: "" };
              break;
            case "content_block_delta": {
              const b = blocks[ev.index];
              if (!b) break;
              const d = ev.delta;
              if (d.type === "text_delta") {
                b.text = (b.text || "") + d.text;
                text += d.text;
                onText && onText(d.text);
              } else if (d.type === "thinking_delta") {
                b.thinking = (b.thinking || "") + d.thinking;
                reasoning += d.thinking;
                onThink && onThink(d.thinking);
              } else if (d.type === "signature_delta") {
                b.signature = (b.signature || "") + d.signature;
              } else if (d.type === "input_json_delta") {
                b._partial += d.partial_json;
              }
              break;
            }
            case "content_block_stop": {
              const b = blocks[ev.index];
              if (b && b.type === "tool_use") {
                try {
                  b.input = JSON.parse(b._partial || "{}");
                } catch (_) {
                  b.input = null; // cut mid-call: dropped below
                }
              }
              if (b) delete b._partial;
              break;
            }
            case "message_delta":
              if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
              if (ev.usage && ev.usage.output_tokens) usage.completionTokens = ev.usage.output_tokens;
              break;
            case "message_stop":
              finished = true;
              break;
            case "error":
              throw new Error((ev.error && ev.error.message) || "stream error");
          }
        }
      } catch (err) {
        // A connection cut mid-answer does not END the stream, reading it throws: kept as an
        // interrupted reply, which the turn asks the model to continue, instead of an error.
        if ((signal && signal.aborted) || !isConnectionDrop(err)) throw err;
      }

      // Keep ALL blocks (including thinking with its signature, which the API
      // requires on the next turn) so the conversation stays valid. A tool call cut mid-way is
      // half a call and is dropped.
      const content = blocks.filter(Boolean).filter((b) => !(b.type === "tool_use" && b.input === null)).map((b) => {
        if (b.type === "tool_use")
          return { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
        if (b.type === "text") return { type: "text", text: b.text || "" };
        if (b.type === "thinking")
          return { type: "thinking", thinking: b.thinking || "", signature: b.signature || "" };
        if (b.type === "redacted_thinking")
          return { type: "redacted_thinking", data: b.data };
        return b;
      });

      const toolCalls = content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      return {
        message: { role: "assistant", content },
        toolCalls,
        stopReason: stopReason === "max_tokens" ? "length" : stopReason,
        text,
        reasoning,
        usage,
        ...(!finished && !(signal && signal.aborted) ? { interrupted: true } : {}),
      };
    },

    formatToolResults(results) {
      return {
        role: "user",
        content: results.map((r) => {
          const block = { type: "tool_result", tool_use_id: r.id, is_error: !!r.isError };
          const m = r.image && /^data:([^;]+);base64,(.*)$/.exec(r.image);
          // Anthropic supports image blocks inside a tool_result → the model actually SEES the screenshot.
          block.content = m
            ? [{ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }, { type: "text", text: r.content }]
            : r.content;
          return block;
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Generic OpenAI-compatible (OpenAI, OpenRouter, Gemini, Mistral, Groq,
// DeepSeek, Ollama, LM Studio, self-hosted…)
// ---------------------------------------------------------------------------
function openaiProvider({ apiKey, model, baseUrl, webSearch, providerId, thinkLevel }) {
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const selfHosted = isSelfHostedProvider(providerId);
  const ollama = /:11434(\/|$)/.test(baseUrl) || /ollama/i.test(baseUrl) || providerId === "ollama";
  const headers = { "content-type": "application/json" };
  // Trim the key: a stray space/newline in a pasted or OAuth key makes OpenRouter reject it with a
  // cryptic 401 "User not found".
  if (apiKey && String(apiKey).trim()) headers.authorization = `Bearer ${String(apiKey).trim()}`;
  // OpenRouter attribution headers (ignored by other providers). They carry no
  // user data — just the app name/repo. CRITICAL: only send them to OpenRouter.
  // On a LOCAL server (Ollama/LM Studio) these are non-simple request headers that
  // force a CORS preflight (OPTIONS) which local servers reject → every local call
  // fails. Restricting them to OpenRouter lets local requests stay "simple" CORS.
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/FlorianMartins/firefox-ai-sidebar";
    headers["X-Title"] = "Hivey AI";
  }

  // The thinking behind an earlier step, back to the model that had it. Kept on the stored message
  // under private keys and put on the wire only where the API takes it: Qwen's template renders it
  // (and the server's prompt cache then holds from one step and one question to the next), DeepSeek
  // REQUIRES it with tools and thinking on, OpenRouter asks for `reasoning_details` back unchanged.
  const wire = (m) => {
    if (!m || typeof m !== "object") return m;
    const { _reasoning, _reasoningDetails } = m;
    const rest = { ...stripPrivate(m) };
    if (m.role !== "assistant") return rest;
    if (_reasoning && (selfHosted || providerId === "deepseek")) rest.reasoning_content = _reasoning;
    else if (_reasoningDetails && _reasoningDetails.length && providerId === "openrouter") rest.reasoning_details = _reasoningDetails;
    return rest;
  };

  return {
    id: "openai",

    async runTurn({ system, history, tools, onText, onThink, signal, chore }) {
      const messages = (system ? [{ role: "system", content: system }, ...history] : [...history]).map(wire);
      const body = { model, messages, stream: true };
      // Web search: OpenRouter exposes a universal "web" plugin that works with
      // ANY model (including the free ones), so a fast free model can search the
      // web. Perplexity's Sonar models are online by default (nothing to add).
      if (webSearch && providerId === "openrouter") {
        body.plugins = [{ id: "web", max_results: 5 }];
      }
      // Reasoning: what the level is for THIS provider and THIS model — the field, the word, and
      // whether thinking can be off at all. One table, with the vendors' documentation: reasoning.js.
      // Nothing picked on a cloud = nothing sent, the model's own default, as before.
      const level = levelOf(thinkLevel) ?? (selfHosted ? "medium" : undefined);
      const thinking = wireReasoning(providerId, model, level, { tools: Boolean(tools && tools.length), ...(chore ? { chore: true } : {}) });
      Object.assign(body, thinking.fields);
      // The level's thinking budget on the user's own server: llama.cpp closes the thought itself
      // when it is spent, so "Bref" really is brief (measured on Qwen3.8 in hivey-vscode: as precise,
      // 29 % faster). Not for a side task, whose thinking is off already; not for Ollama.
      if (selfHosted && !ollama && !chore) Object.assign(body, selfHostedThinkingBudget(level));
      if (providerId === "openrouter") body.usage = { include: true };
      // The accounting. A server that does not know the field ignores it, or names it and it goes.
      body.stream_options = { include_usage: true };
      if (tools && tools.length) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        }));
      }

      let attempt = body;
      let response;
      for (let tries = 0; ; tries++) {
        response = await fetchWithRetry(url, { method: "POST", signal, headers, body: JSON.stringify(attempt) });
        if (response.ok || (response.status !== 400 && response.status !== 402 && response.status !== 422) || tries >= 2) break;
        const said = await response.text().catch(() => "");
        const fixed = adaptRequest(attempt, said);
        if (!fixed) throw new Error(`HTTP ${response.status} — ${said.slice(0, 500)}`);
        attempt = fixed;
      }
      await ensureOk(response);

      let text = "";
      let reasoning = "";
      let finishReason = null;
      let finished = false;
      const toolAcc = {};
      const details = [];
      const usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
      const annotations = []; // web-plugin citations (url_citation) — the REAL, resolvable source URLs

      try {
        for await (const data of sseData(response)) {
          if (data === "[DONE]") { finished = true; break; }
          let chunk;
          try {
            chunk = JSON.parse(data);
          } catch (_) {
            continue;
          }
          if (chunk.error) throw new Error(chunk.error.message || String(chunk.error));
          if (chunk.usage) {
            usage.promptTokens = chunk.usage.prompt_tokens ?? usage.promptTokens;
            usage.completionTokens = chunk.usage.completion_tokens ?? usage.completionTokens;
            usage.cachedTokens = (chunk.usage.prompt_tokens_details && chunk.usage.prompt_tokens_details.cached_tokens) ?? usage.cachedTokens;
            if (typeof chunk.usage.cost === "number") usage.costUsd = chunk.usage.cost;
          }
          const choice = chunk.choices && chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (Array.isArray(delta.reasoning_details)) for (const d of delta.reasoning_details) mergeReasoningDetail(details, d);
          // Reasoning text (DeepSeek / llama.cpp: reasoning_content ; OpenRouter: reasoning)
          const reason = delta.reasoning_content || delta.reasoning;
          if (typeof reason === "string" && reason) {
            reasoning += reason;
            onThink && onThink(reason);
          }
          // OpenRouter web plugin returns url_citation annotations (real source URLs) on the delta
          // and/or the final message — capture them so callers get resolvable links, not model-typed ones.
          if (Array.isArray(delta.annotations)) annotations.push(...delta.annotations);
          if (choice.message && Array.isArray(choice.message.annotations)) annotations.push(...choice.message.annotations);
          if (delta.content) {
            text += delta.content;
            onText && onText(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              if (!toolAcc[i]) toolAcc[i] = { id: tc.id, name: "", args: "" };
              if (tc.id) toolAcc[i].id = tc.id;
              if (tc.function && tc.function.name) toolAcc[i].name = tc.function.name;
              if (tc.function && tc.function.arguments) toolAcc[i].args += tc.function.arguments;
            }
          }
          if (choice.finish_reason) { finishReason = choice.finish_reason; finished = true; }
        }
      } catch (err) {
        // « terminated » — a connection cut mid-answer: what arrived is kept as an interrupted
        // reply, which the turn asks the model to continue, rather than shown as an error.
        if ((signal && signal.aborted) || !isConnectionDrop(err)) throw err;
      }

      // Cut by the output cap or by the connection: a call still being written is half a call.
      const cut = finishReason === "length" || (!finished && !(signal && signal.aborted));
      const nativeToolCalls = Object.values(toolAcc)
        .filter((t) => t.name && (!cut || isCompleteJson(t.args)))
        .map((t, i) => ({
          id: t.id || `call_${i}`,
          type: "function",
          function: { name: t.name, arguments: t.args || "{}" },
        }));

      const message = { role: "assistant", content: text || null };
      if (nativeToolCalls.length) message.tool_calls = nativeToolCalls;
      if (reasoning) message._reasoning = reasoning;
      if (details.length) message._reasoningDetails = details;

      const toolCalls = nativeToolCalls.map((t) => {
        let input = {};
        try {
          input = JSON.parse(t.function.arguments || "{}");
        } catch (_) {}
        return { id: t.id, name: t.function.name, input };
      });

      return {
        message,
        toolCalls,
        stopReason: finishReason === "tool_calls" || (nativeToolCalls.length && !cut) ? "tool_use" : finishReason,
        text,
        reasoning,
        usage,
        citations: extractUrlCitations(annotations),
        ...(!finished && !(signal && signal.aborted) ? { interrupted: true } : {}),
      };
    },

    formatToolResults(results) {
      const msgs = results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.content }));
      // OpenAI tool messages can't carry images → append the screenshot(s) as a user message so
      // vision-capable models (gpt-4o, Gemini, etc.) can see them.
      const imgs = results.filter((r) => r.image);
      if (imgs.length) {
        msgs.push({
          role: "user",
          content: [
            { type: "text", text: "(Screenshot(s) returned by the tool above — read them visually.)" },
            ...imgs.map((r) => ({ type: "image_url", image_url: { url: r.image } })),
          ],
        });
      }
      return msgs;
    },
  };
}

// Build the provider for the current conversation.
export function makeProvider(settings, opts = {}) {
  const id = settings.provider;
  const meta = PROVIDERS[id] || PROVIDERS.anthropic;
  const apiKey = keyFor(id, settings);
  const model = modelFor(id, settings);
  const baseUrl = baseUrlFor(id, settings);

  // The level the user picked — "none" | "low" | "medium" | "high" | "xhigh" | "max" — or nothing
  // (the legacy "off" included): on a cloud the model's own default, on the user's own server
  // "Standard" (see `levelOf` and reasoning.js). The legacy boolean `thinking` still reads.
  const lvl = opts.thinkLevel != null ? opts.thinkLevel : opts.thinking;

  const provider = meta.kind === "anthropic"
    ? anthropicProvider({
      apiKey,
      model,
      baseUrl,
      thinkLevel: meta.supportsThinking ? levelOf(lvl) : undefined,
      webSearch: !!opts.webSearch && meta.supportsWebSearch,
    })
    : openaiProvider({
      apiKey,
      model,
      baseUrl,
      providerId: id,
      webSearch: !!opts.webSearch && !!meta.supportsWebSearch,
      thinkLevel: lvl,
    });
  // Privacy first: every request to a cloud is pseudonymized here, whichever tab or side task made
  // it — see privacy.js. The user's own machine and gateway are sent as they are.
  const level = redactsFor(id, settings);
  return level ? privateProvider(provider, { level, customTerms: settings.privacyTerms || [], ...(opts.privacy || {}) }) : provider;
}

// OpenRouter: rich model list with vendor, display name and per-token pricing.
// Used to build the hierarchical menu (OpenRouter › vendor › model + cost).
export async function listOpenRouterRich(settings) {
  const baseUrl = baseUrlFor("openrouter", settings);
  const apiKey = keyFor("openrouter", settings);
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/models", { headers });
  await ensureOk(res);
  const json = await res.json();
  return (json.data || []).map((m) => {
    const outMods = (m.architecture && m.architecture.output_modalities) || [];
    return {
      id: m.id,
      name: m.name || m.id,
      prompt: parseFloat((m.pricing && m.pricing.prompt) || "0"),
      completion: parseFloat((m.pricing && m.pricing.completion) || "0"),
      // Can this model OUTPUT images? (used to populate the Image tab dynamically)
      image: Array.isArray(outMods) && outMods.includes("image"),
    };
  });
}

// -------- Dynamic model listing (OpenAI /models format) ---------------------
export async function listModels(providerId, settings) {
  const meta = PROVIDERS[providerId];
  if (!meta) throw new Error("Fournisseur inconnu");
  const baseUrl = baseUrlFor(providerId, settings);
  if (!baseUrl) throw new Error("Base URL manquante.");
  const apiKey = keyFor(providerId, settings);
  const url = baseUrl.replace(/\/$/, "") + "/models";

  // Anthropic uses its own auth headers (no Bearer) for GET /v1/models.
  const headers =
    meta.kind === "anthropic"
      ? {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : apiKey
        ? { authorization: `Bearer ${apiKey}` }
        : {};

  try {
    const res = await fetch(url, { headers });
    await ensureOk(res);
    const json = await res.json();
    const data = json.data || json.models || [];
    const ids = data.map((m) => m.id || m.name).filter(Boolean).sort();
    if (ids.length) return ids;
    // Empty list on a local server → fall through to the native endpoint below.
    if (providerId === "ollama") throw new Error("empty");
    return ids;
  } catch (err) {
    // Native Ollama fallback: older/proxied Ollama builds don't serve the
    // OpenAI-compatible /v1/models. Its native /api/tags always lists installed
    // models. Strip a trailing /v1 from the base URL to reach the native root.
    if (providerId === "ollama") {
      const root = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
      const res2 = await fetch(root + "/api/tags");
      await ensureOk(res2);
      const j2 = await res2.json();
      return (j2.models || []).map((m) => m.name || m.model).filter(Boolean).sort();
    }
    throw err;
  }
}

// -------- Audio transcription (Whisper-style /audio/transcriptions) ----------
// Powers the composer's voice-dictation fallback when the browser has no Web Speech
// API (e.g. Firefox). Posts the recorded audio to a connected OpenAI- or Groq-
// compatible endpoint and returns the recognised text. 100% BYOK — uses the user's
// own key and goes straight to the provider they chose.
export async function transcribeAudio(settings, blob) {
  const providerId = settings.provider;
  const meta = PROVIDERS[providerId];
  if (!meta) throw new Error("No transcription provider connected.");
  const baseUrl = baseUrlFor(providerId, settings);
  const apiKey = keyFor(providerId, settings);
  if (meta.needsKey && !apiKey) throw new Error(`API key missing for ${meta.label}.`);
  const model = providerId === "groq" ? "whisper-large-v3" : "whisper-1";
  const ext = (blob.type || "").includes("ogg") ? "ogg" : (blob.type || "").includes("mp4") ? "mp4" : "webm";
  const fd = new FormData();
  fd.append("file", blob, `audio.${ext}`);
  fd.append("model", model);
  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/audio/transcriptions", { method: "POST", headers, body: fd });
  await ensureOk(res);
  const json = await res.json();
  return (json && (json.text || (json.results && json.results[0] && json.results[0].text))) || "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
// Dictation via a CHAT model that accepts AUDIO input (e.g. Gemini Flash on OpenRouter) — lets the
// mic work with just the OpenRouter key (OpenRouter has no Whisper /audio/transcriptions endpoint).
export async function transcribeAudioViaChat(settings, blob, modelId) {
  const providerId = "openrouter";
  const meta = PROVIDERS[providerId];
  if (!meta) throw new Error("OpenRouter not available.");
  const baseUrl = baseUrlFor(providerId, settings);
  const apiKey = keyFor(providerId, settings);
  if (!apiKey) throw new Error("OpenRouter API key missing.");
  const type = (blob.type || "").toLowerCase();
  const fmt = type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("m4a") ? "mp4" : type.includes("wav") ? "wav" : type.includes("mp3") ? "mp3" : "webm";
  const b64 = await blobToBase64(blob);
  const body = {
    model: modelId || "google/gemini-2.0-flash-001",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Transcribe the following audio verbatim into text. Output ONLY the transcription — no preamble, no quotes, no commentary." },
        { type: "input_audio", input_audio: { data: b64, format: fmt } },
      ],
    }],
  };
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  const json = await res.json();
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  const c = msg && msg.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.map((p) => (p && (p.text || p.content)) || "").join("").trim();
  return "";
}

// -------- Image generation (OpenAI-compatible /images/generations) ----------
// Returns a list of data: (or http) URLs to display.
export async function generateImage(settings, { prompt, size, signal, initImage, initImages }) {
  // Accept one image (initImage) or several (initImages, for "mix these images" requests).
  const inputImages = (initImages && initImages.length) ? initImages : (initImage ? [initImage] : []);
  // size === "" (or unset) means: no fixed size — let the model use the dimensions
  // described in the prompt (and providers fall back to their own default).
  size = size != null ? size : (settings.imageSize || "");
  const providerId = settings.imageProvider || "openai";
  const meta = PROVIDERS[providerId];
  if (!meta || !meta.supportsImages) {
    throw new Error(
      `Le fournisseur d'images « ${providerId} » n'est pas supporté. Choisissez OpenAI dans les réglages.`
    );
  }
  const baseUrl = baseUrlFor(providerId, settings);
  const apiKey = keyFor(providerId, settings);
  if (meta.needsKey && !apiKey) throw new Error(`Clé API manquante pour ${meta.label}.`);

  // Some providers (OpenRouter, Google) generate images through the chat-completions
  // API with image "modalities" rather than /images/generations. Those models have
  // no size parameter, so — as requested — we pass the size to the model as a plain
  // INSTRUCTION inside the prompt.
  const model = settings.imageModel || (meta.imageModels && meta.imageModels[0][0]);
  if (meta.imageVia === "chat") {
    return generateImageViaChat({ baseUrl, apiKey, providerId, model, prompt, size, signal, initImages: inputImages });
  }

  // img2img / edit: when input image(s) are provided, use the /images/edits endpoint.
  if (inputImages.length) {
    return generateImageEdit({ baseUrl, apiKey, model, prompt, size, signal, initImages: inputImages });
  }

  const body = {
    model,
    prompt,
    n: 1,
  };
  if (size) body.size = size; // omit when "—" (custom): the provider uses its default
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await fetch(baseUrl.replace(/\/$/, "") + "/images/generations", {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  const json = await res.json();
  const out = [];
  for (const item of json.data || []) {
    if (item.b64_json) out.push(`data:image/png;base64,${item.b64_json}`);
    else if (item.url) out.push(item.url);
  }
  if (!out.length) throw new Error("Aucune image renvoyée par l'API.");
  return out;
}

// Image generation through the chat-completions API with image modalities
// (OpenRouter, Google "Nano Banana", etc.). These models have no size parameter,
// so the requested size is appended to the prompt as an instruction. Returns a
// list of data: / http image URLs.
// OpenAI-compatible image EDIT (img2img): multipart /images/edits with an input image.
async function generateImageEdit({ baseUrl, apiKey, model, prompt, size, signal, initImages }) {
  const imgs = initImages || [];
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", prompt);
  fd.append("n", "1");
  if (size) fd.append("size", size);
  // OpenAI-compatible edits accept several reference images via image[] (used to blend/mix).
  for (let i = 0; i < imgs.length; i++) {
    const blob = await (await fetch(imgs[i])).blob();
    fd.append(imgs.length > 1 ? "image[]" : "image", blob, `image${i}.png`);
  }
  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/images/edits", { method: "POST", signal, headers, body: fd });
  await ensureOk(res);
  const json = await res.json();
  const out = [];
  for (const item of json.data || []) {
    if (item.b64_json) out.push(`data:image/png;base64,${item.b64_json}`);
    else if (item.url) out.push(item.url);
  }
  if (!out.length) throw new Error("Aucune image renvoyée par l'API.");
  return out;
}

async function generateImageViaChat({ baseUrl, apiKey, providerId, model, prompt, size, signal, initImages }) {
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/FlorianMartins/firefox-ai-sidebar";
    headers["X-Title"] = "Hivey AI";
  }
  // A format (alone or with a quality) → its ratio; a quality alone says nothing in words; pixels → pixels.
  const fmt = /^(\d+:\d+)?(?:@\dK)?$/.exec(size || "");
  const sizeHint = !size ? "" : fmt ? (fmt[1] ? ` Target aspect ratio: ${fmt[1]}.` : "") : ` Target size/aspect: ${size} pixels.`;
  const imgs = initImages || [];
  // With input image(s), send a multimodal message so the model EDITS/MIXES them (img2img).
  const text = imgs.length > 1
    ? `Combine/blend these ${imgs.length} images into a single new image as instructed: ${prompt}.${sizeHint}`
    : imgs.length === 1
      ? `Edit this image as instructed: ${prompt}.${sizeHint}`
      : `Generate an image: ${prompt}.${sizeHint}`;
  const content = imgs.length
    ? [{ type: "text", text }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))]
    : text;
  const body = {
    model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content }],
  };
  // The format and resolution, as parameters where the model takes them (Gemini via OpenRouter,
  // up to real 4K); otherwise the hint in the prompt is all there is.
  const cfg = providerId === "openrouter" ? imageConfigOf(size) : null;
  if (cfg) {
    if (cfg.image_size && !imageResolutions(model).includes(cfg.image_size)) delete cfg.image_size;
    if (Object.keys(cfg).length) body.image_config = cfg;
  }
  const res = await fetch(url, { method: "POST", signal, headers, body: JSON.stringify(body) });
  await ensureOk(res);
  const json = await res.json();
  const out = [];
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  // OpenRouter/Gemini return generated images under message.images[].image_url.url
  for (const im of (msg && msg.images) || []) {
    const u = im && (im.image_url ? im.image_url.url : im.url);
    if (u) out.push(u);
  }
  // Some return a data URL directly in the content.
  if (!out.length && typeof (msg && msg.content) === "string") {
    const m = msg.content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    if (m) out.push(m[0]);
  }
  if (!out.length) throw new Error("Aucune image renvoyée par le modèle (essayez un autre modèle d'image).");
  return out;
}
