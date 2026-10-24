// The agent's brakes and its housekeeping, mounted on the harness as plugins — hivey-vscode's loop
// rules (src/core/agent/loop.ts), carried over to the browser tools.
//
// ⚠️ « aucune limite manuelle » — the sidebar's agent stopped after 24 model requests whatever it was
// doing, and cut every tool result to 8 000 characters whatever the model could read. A task that
// needed 25 steps (twelve product pages: open, read, next) ended half done; the answer on line 120
// of a long page was never seen. Neither number stopped the failure it was there for — a model going
// round in circles still spent its 24 steps doing it. So the brakes are on the circles themselves:
//
//   • the same read-only call (same tool, same arguments) made a third time with nothing changed in
//     between is not run — the model is told its result is already above; told twice and insisting,
//     the turn ends, and the model writes where things stand;
//   • a thinking that repeats the same passage three times in a row is stopped, and the model told
//     to decide;
//   • an identical long result comes back as a pointer to the copy already in the conversation.
//
// And the context follows the model: a tool result may take a share of the selected model's window
// (never less than the old 8 000 characters), and when the turn nears the window the oldest results
// are shortened — their head kept — then, if that is not enough, the work so far is summarized and
// the turn goes on from the summary, instead of an error from the server half-way through a task.
// Only Stop, these detectors and the server's real window bound a turn.

/** Tools that only look: after one of these, the page is still what it was. */
export const PURE_READS = new Set(["read_page", "read_selection", "list_tabs", "read_tab", "find_elements", "check_links", "screenshot", "recall", "get_memory"]);

/** See the header: a third identical read with nothing in between is not run; past two refusals the turn ends. */
export const REPEAT_LIMIT = 3;
export const MAX_REPEAT_NUDGES = 2;
export const REPEATED_CALL =
  "You already made this exact call (same tool, same arguments) twice since anything changed on the page, and its result is above. " +
  "Do not repeat it: use what you already have, try a different approach (another element, another page, another source), or give your answer.";
export const CONCLUDE_REPEATING =
  "You were stopped: you kept making the same call and it kept giving the same result. No more tools. Tell the user, in a few lines, " +
  "where things stand — what is done, what you found, what is blocking you, and what you need from them.";
export const THOUGHT_LOOPING =
  "Your thinking started repeating the same passage over and over, and was stopped there. Everything you have found is above: " +
  "do not think it through again. Decide now — make the next tool call, or give your answer.";
const RUNAWAY_NOTES = 2;
const CONTINUE_AFTER_CUT =
  "Your previous reply was cut off by the output limit before you finished, and any tool call you were writing was lost. " +
  "Continue from where you stopped without repeating what you already wrote; split a long answer into shorter steps.";
const CONTINUE_AFTER_INTERRUPT =
  "Your previous reply was interrupted before you finished (the connection to you was closed), and any tool call you were writing was lost. " +
  "Continue exactly from where you stopped, without repeating what you already wrote.";
const MAX_CONTINUATIONS = 2;

/** One tool result's share of the window, at ~4 characters a token; the old fixed cap is the floor. */
export const TOOL_RESULT_FLOOR_CHARS = 8000;
const TOOL_RESULT_SHARE = 0.1;
export function toolResultChars(window) {
  return Math.max(TOOL_RESULT_FLOOR_CHARS, Math.floor((window > 0 ? window : 0) * TOOL_RESULT_SHARE * 4));
}

/** Room kept for the answer once the request fits again, and the head a shortened result keeps. */
const ANSWER_ROOM_TOKENS = 8192;
const KEPT_HEAD_CHARS = 1500;
const MAX_LIVE_COMPACTS = 3;

/** Rough tokens of provider-shaped messages, at ~4 characters a token; an image counts ~1 000. */
export function estimateTokens(messages, system = "") {
  let chars = String(system || "").length;
  let images = 0;
  const walk = (c) => {
    if (typeof c === "string") { chars += c.length; return; }
    if (!Array.isArray(c)) return;
    for (const p of c) {
      if (!p) continue;
      if (p.type === "image" || p.type === "image_url") { images++; continue; }
      chars += String(p.text || p.thinking || "").length;
      if (p.input) chars += JSON.stringify(p.input).length;
      if (p.content !== undefined) walk(p.content);
    }
  };
  for (const m of messages || []) {
    if (!m) continue;
    walk(m.content);
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    if (m._reasoning) chars += m._reasoning.length;
  }
  return Math.ceil(chars / 4) + images * 1000;
}

/**
 * Whether `text` ends on the same passage written three times in a row — a model thinking in a loop
 * (hivey-vscode, `repeatingTail`). Exact repeats of 80 characters or more, white space aside: a
 * sentence coming back once is how people think; the same paragraph three times is a sampler stuck.
 */
export function repeatingTail(text) {
  const flat = String(text || "").replace(/\s+/g, " ");
  const tail = flat.slice(-6000);
  for (let p = 80; p * 3 <= tail.length; p++) {
    const a = tail.slice(-p);
    if (tail.slice(-2 * p, -p) === a && tail.slice(-3 * p, -2 * p) === a) return true;
  }
  return false;
}

const argsKey = (input) => JSON.stringify(input ?? {});

/**
 * How many times `call` — same tool, same arguments — was already made since the page last changed
 * (any action that is not a pure read). Counted since the last change, not over the turn: after a
 * click, the same read may well say something new.
 */
export function repeatsSinceChange(events, call) {
  let n = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "tool/call") continue;
    if (!PURE_READS.has(e.name)) break;
    if (e.name === call.name && argsKey(e.input) === argsKey(call.input)) n++;
  }
  return n;
}

/** What an identical repeated result becomes: a pointer to the copy the model already has. */
export function unchangedNotice(name) {
  return { unchanged: `Exactly the same result as your earlier ${name} call with these arguments, which is still above. Use it rather than asking again.` };
}

const resultText = (r) => JSON.stringify(r && r._image ? { ...r, _image: "[screenshot attached]" } : r);

/** The result of an earlier identical call, when it is the same — and long enough to be worth a pointer. */
export function sameEarlierResult(events, call, result) {
  const text = resultText(result);
  if (text.length < 400) return false;
  const ids = new Set(events.filter((e) => e.type === "tool/call" && e.id !== call.id && e.name === call.name && argsKey(e.input) === argsKey(call.input)).map((e) => e.id));
  return events.some((e) => e.type === "tool/result" && ids.has(e.id) && resultText(e.result) === text);
}

// ── Fitting the window ────────────────────────────────────────────────────────────────────────

/** The text of a tool result message, in either wire format, and a way to put a shorter one back. */
function toolSlots(messages) {
  const slots = [];
  messages.forEach((m, i) => {
    if (!m) return;
    if (m.role === "tool" && typeof m.content === "string") {
      slots.push({ i, get: () => m.content, set: (t) => { messages[i] = { ...messages[i], content: t }; } });
    } else if (m.role === "user" && Array.isArray(m.content)) {
      m.content.forEach((b, j) => {
        if (b && b.type === "tool_result" && typeof b.content === "string") {
          slots.push({
            i,
            get: () => messages[i].content[j].content,
            set: (t) => {
              const content = messages[i].content.slice();
              content[j] = { ...content[j], content: t };
              messages[i] = { ...messages[i], content };
            },
          });
        }
      });
    }
  });
  return slots;
}

/**
 * Shorten the OLDEST tool results of a request until about `tokens` are freed — the latest step's
 * results are left whole, they are what the next step is about. A result keeps its head and says how
 * much was cut, so the model knows it is reading an excerpt and can read the page again. The older
 * steps' thinking goes first. Returns a new array, or null when nothing could be shortened.
 */
export function shrinkToolResults(messages, tokens) {
  const out = messages.slice();
  const target = Math.max(tokens, 1000) * 4;
  let saved = 0;
  const thinkers = out.map((m, i) => ({ m, i })).filter(({ m }) => m && m.role === "assistant" && (m._reasoning || m._reasoningDetails));
  for (const { i } of thinkers.slice(0, -2)) {
    if (saved >= target) break;
    const { _reasoning, _reasoningDetails, ...rest } = out[i];
    saved += String(_reasoning || "").length + JSON.stringify(_reasoningDetails || []).length;
    out[i] = rest;
  }
  const slots = toolSlots(out);
  const lastIndex = slots.length ? slots[slots.length - 1].i : -1;
  for (const s of slots) {
    if (saved >= target) break;
    if (s.i === lastIndex) continue;
    const text = s.get();
    if (text.length <= KEPT_HEAD_CHARS + 200) continue;
    const cut = text.length - KEPT_HEAD_CHARS;
    s.set(`${text.slice(0, KEPT_HEAD_CHARS)}\n[… ${cut} more characters of this result were removed to fit the model's context window — read the page again if you need the rest.]`);
    saved += cut;
  }
  return saved > 0 ? out : null;
}

/** The turn's work as text a model can summarize within `maxChars`: its beginning and its end kept. */
export function transcriptForSummary(messages, maxChars) {
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} […]` : s);
  const lines = [];
  for (const m of messages) {
    if (!m) continue;
    const c = m.content;
    if (m.role === "tool") { lines.push(`RESULT: ${cut(String(c || ""), 800)}`); continue; }
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue;
        if (b.type === "text" && b.text) lines.push(`${m.role.toUpperCase()}: ${cut(b.text, m.role === "user" ? 6000 : 3000)}`);
        else if (b.type === "tool_use") lines.push(`CALL ${b.name} ${cut(JSON.stringify(b.input || {}), 300)}`);
        else if (b.type === "tool_result") lines.push(`RESULT: ${cut(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 800)}`);
      }
    } else if (typeof c === "string" && c.trim()) {
      lines.push(`${m.role.toUpperCase()}: ${cut(c, m.role === "user" ? 6000 : 3000)}`);
    }
    for (const t of m.tool_calls || []) lines.push(`CALL ${t.function && t.function.name} ${cut(String((t.function && t.function.arguments) || ""), 300)}`);
  }
  const all = lines.join("\n");
  if (all.length <= maxChars) return all;
  return `${all.slice(0, Math.floor(maxChars * 0.25))}\n[… the middle of the work, left out to fit …]\n${all.slice(all.length - Math.floor(maxChars * 0.75))}`;
}

export const LIVE_SUMMARY_HEAD =
  "[What was done before this point, summarized: the whole conversation no longer fit your context window. " +
  "It is your own record — work from it, and read a page again only for content you need and no longer have.]";
const LIVE_BRIEF = [
  "Summarize the work of this browser agent so far, so it can carry on after its context window filled up.",
  "Start with the user's latest request, word for word. Then: what was found (facts, numbers, names, URLs — verbatim),",
  "what was done (pages visited, forms filled, actions taken), what failed and why, and the immediate next step.",
  "Be dense: short lines, no pleasantries, under 400 words.",
].join("\n");

/**
 * Mount the guards on a harness. `opts`: { provider, system, contextWindow, signal, replyLanguageName,
 * ownWords, report }. Returns `{ state }` — counters the caller reads once the turn is over.
 */
export function mountAgentGuards(ctx, { provider, system = "", contextWindow = 0, signal, replyLanguageName = "", ownWords = "", report = () => {} } = {}) {
  const state = { repeatNudges: 0, stoppedRepeating: false, runawayNotes: 0, continuations: 0, liveCompacts: 0, shrinks: 0 };
  const limit = contextWindow > 0 ? Math.floor(contextWindow * 0.9) - ANSWER_ROOM_TOKENS : 0;
  let tokenRatio = 1;
  const said = new Set();
  const once = (m) => { if (!said.has(m)) { said.add(m); report(m); } };

  // ── Before each request: the reply-language reminder, and the window ──────────────────────────
  ctx.on("agent/pre-step", async (v, next) => {
    if (state.stoppedRepeating) return { reject: "repeating" };
    let messages = v.messages;
    if (limit > 0) {
      const over = Math.ceil(estimateTokens(messages, system) * tokenRatio) - limit;
      if (over > 0) {
        const shrunk = shrinkToolResults(messages, over);
        if (shrunk) { messages = shrunk; state.shrinks++; once("shrunk"); }
        if (Math.ceil(estimateTokens(messages, system) * tokenRatio) > limit && (await compactLive(messages))) {
          return next({ ...v, messages: ctx.deriveMessages(ctx.get("llm").project) });
        }
      }
    }
    // Restated where the model reads it last, after the latest tool results — the rule in the
    // system prompt alone did not hold through a long run of English pages.
    if (replyLanguageName && messages.length) {
      const reminder = `\n\n[Reply language: ${replyLanguageName}. Every sentence you write for the user is in ${replyLanguageName}.${ownWords ? ` ${ownWords}` : ""}]`;
      const slots = toolSlots(messages.slice());
      const last = slots[slots.length - 1];
      if (last && last.i === messages.length - 1) {
        messages = messages.slice();
        toolSlots(messages)[slots.length - 1].set(last.get() + reminder);
      }
    }
    return next({ ...v, messages });
  }, 50);

  /** Summarize the turn so far and record it in the log; the next derivation starts from it. */
  async function compactLive(messages) {
    if (!contextWindow || state.liveCompacts >= MAX_LIVE_COMPACTS || (signal && signal.aborted)) return false;
    const transcript = transcriptForSummary(messages, Math.floor(contextWindow * 0.5 * 3));
    let summary = "";
    try {
      const r = await provider.runTurn({
        system: "You keep the record of a browser agent's work so that it can carry on after its context window filled up.",
        history: [{ role: "user", content: `${LIVE_BRIEF}\n\n--- the work so far ---\n${transcript}` }],
        tools: [], signal, chore: true,
      });
      summary = String((r && r.text) || "").trim();
    } catch (_) { return false; }
    if (!summary) return false;
    state.liveCompacts++;
    const upTo = ctx.events().at(-1).seq;
    ctx.append("context/compacted", { upTo, text: `${LIVE_SUMMARY_HEAD}\n${summary}\n\nContinue the task where you stopped.` });
    once("compacted");
    return true;
  }

  // ── The request: a thinking loop is stopped, an overflow fitted, a cut reply continued ─────────
  ctx.on("agent/request", async (req, next) => {
    const stepCtl = new AbortController();
    const forward = () => stepCtl.abort();
    if (signal) { if (signal.aborted) stepCtl.abort(); else signal.addEventListener("abort", forward, { once: true }); }
    let thought = "";
    let checkedAt = 0;
    let looped = false;
    const watch = (d) => {
      if (looped || !d) return;
      thought += d;
      if (thought.length - checkedAt >= 1000) {
        checkedAt = thought.length;
        if (repeatingTail(thought)) { looped = true; stepCtl.abort(); }
      }
    };
    let turn;
    try {
      turn = await next({ ...req, signal: stepCtl.signal, onThinkWatch: watch });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (!looped) {
        const over = /exceeds the available context size|larger than the max context size|exceed_context_size|context_length_exceeded|maximum context length|prompt is too long/i.test(String(e && e.message));
        if (over && (await compactLive(req.messages))) {
          return next({ ...req, messages: ctx.deriveMessages(ctx.get("llm").project) });
        }
        throw e;
      }
      turn = { message: { role: "assistant", content: "(thinking stopped: it was repeating itself)" }, toolCalls: [], text: "", looped: true };
    } finally {
      if (signal) signal.removeEventListener("abort", forward);
    }
    if (turn && turn.usage && turn.usage.promptTokens > 0) {
      const est = estimateTokens(req.messages, system);
      if (est > 0) tokenRatio = Math.max(1, turn.usage.promptTokens / est);
    }
    return turn;
  }, 50);

  // ── Each tool call: a real loop is refused, an identical result pointed back ─────────────────
  ctx.on("tools/pre-execute", async (d, next) => {
    if (PURE_READS.has(d.call.name) && repeatsSinceChange(ctx.events().slice(0, -1), d.call) >= REPEAT_LIMIT - 1) {
      state.repeatNudges++;
      if (state.repeatNudges > MAX_REPEAT_NUDGES) state.stoppedRepeating = true;
      once("repeat");
      return next({ ...d, deny: REPEATED_CALL });
    }
    return next(d);
  }, 50);
  ctx.on("tools/post-execute", async (v, next) => {
    const out = await next(v);
    return sameEarlierResult(ctx.events(), v.call, out) ? unchangedNotice(v.call.name) : out;
  }, 50);

  // ── The last word: a stopped thought, a cut reply ─────────────────────────────────────────────
  ctx.on("agent/turn-stopping", async (closing) => {
    const last = ctx.events().filter((e) => e.type === "assistant/message").at(-1);
    if (!last || closing.continue) return;
    if (last.looped && state.runawayNotes < RUNAWAY_NOTES) {
      state.runawayNotes++;
      once("looped");
      closing.continue = true;
      closing.reason = THOUGHT_LOOPING;
      return;
    }
    if ((last.interrupted || last.stopReason === "length") && state.continuations < MAX_CONTINUATIONS) {
      state.continuations++;
      closing.continue = true;
      closing.reason = last.interrupted ? CONTINUE_AFTER_INTERRUPT : CONTINUE_AFTER_CUT;
    }
  }, 150);

  return { state };
}
