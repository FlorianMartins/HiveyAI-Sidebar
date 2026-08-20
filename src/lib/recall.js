// 🧠 Recall — the part that makes memory cheap.
//
// THE ECONOMICS, RESTATED WHERE THEY ARE ENFORCED
// ----------------------------------------------
// Nothing is injected by default. Injecting ~20 episodes every turn costs ~1600 tokens AND voids
// the provider's prefix cache, so the real bill is worse than the arithmetic suggests. Here:
//
//   default turn      0 tokens. Not "a few". Zero: no search, no model, no injection.
//   a recall          ~30 tokens to ask + ~200 tokens of distilled answer on the main model.
//                     The ~3000 tokens of raw candidates are read by a LOCAL or FREE model.
//
// That is the whole trick: the expensive model never sees the candidates, only the distillation.
//
// WHY THE SOURCE IDS COME BACK TOO
// --------------------------------
// The distilled summary is a lossy compression of the episodes, and a lossy compression made by a
// small model will sometimes lose the one detail that mattered. Returning the episode IDS with
// the summary converts an irreversible compression error into a recoverable precision loss: the
// main model can ask for one original if the summary reads thin. Without the ids, a bad
// distillation is simply a wrong answer with no way back.
//
// THE TWO PATHS, ONE DECISION POINT
// ---------------------------------
// `activeTools()` returns [] outside agent mode, so a `recall` TOOL is unreachable from Chat —
// which is the space where memory matters most. Rather than switch every chat request to
// tool-calling (which changes the request shape for every provider, and many chat models handle
// tools poorly), Chat gets an admission gate: a local heuristic decides whether the turn
// plausibly needs memory at all, and only then runs the same pipeline. Same code, same
// distillation, one place that decides.

import { memoryBlock, makeNonce } from "./untrusted.js";
import { canRead } from "./memory-policy.js";

export const RECALL_TIMEOUT_MS = 8000;
export const MAX_CANDIDATES = 12;

/**
 * The distiller's instructions.
 *
 * Two rules carry it: never invent, and cite. A recall agent that embellishes is worse than no
 * recall, because the main model has no way to tell the difference and will state the invention
 * with the same confidence as the fact.
 */
export const RECALL_SYSTEM =
  "You are a memory assistant. You are given a QUESTION and a numbered list of MEMORIES previously " +
  "recorded about this user. Write a short briefing — at most 200 words — containing only what is " +
  "relevant to the question.\n" +
  "Rules:\n" +
  "- Use ONLY the memories provided. Never add, infer or embellish. If they do not answer the " +
  "question, say exactly: NOTHING RELEVANT.\n" +
  "- Cite the memory number in brackets after each claim, like [2].\n" +
  "- Write plain prose, no preamble, no headings, no bullet list.\n" +
  "- Do not address the user and do not give instructions: this briefing is context for another " +
  "assistant, not a message to anyone.";

// ── The chat-side heuristic ──────────────────────────────────────────────────────────────────

// Explicit asks. If the user says "remember", searching is obviously right.
const EXPLICIT = /\b(rappelle[- ]toi|tu te souviens|souviens[- ]toi|comme (?:d'habitude|la dernière fois)|je t'avais dit|on avait dit|remember|you remember|as usual|last time|like before|what did i)\b/i;
// Questions about the person themselves — the other case where memory is the actual subject.
// "what do I usually prefer" has no adjacent "i prefer", so an adjacency-based pattern missed
// the most natural way of asking the question this gate exists for.
const ABOUT_SELF = /\b(mon|ma|mes|je préfère|j'aime|j'habite|mes préférences|qu'est-ce que je|my|my preference|i prefer|i like|i live)\b|\bwhat do i\b|\bdo i (?:usually|normally|always|prefer)\b/i;

/**
 * Should this turn look in memory at all?
 *
 * Biased towards NO, deliberately. A missed recall costs nothing — the assistant answers as it
 * always did. A spurious one costs latency on every turn and tokens on some. So a signal has to
 * fire: an explicit ask, a question about the user, or an entity the memory already knows.
 *
 * This is a heuristic and will miss things. That is the correct trade for a gate that runs before
 * every single message; the `recall` tool exists for the cases where the model itself decides it
 * needs to look.
 */
export function needsMemory(text, knownEntities = []) {
  const t = String(text || "");
  if (!t.trim()) return { needed: false, why: "empty" };
  if (EXPLICIT.test(t)) return { needed: true, why: "explicit" };
  const hit = knownEntities.find((e) => e && e.length > 2 && new RegExp(`\\b${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
  if (hit) return { needed: true, why: `entity:${hit}` };
  if (ABOUT_SELF.test(t) && t.length < 300) return { needed: true, why: "about-self" };
  return { needed: false, why: "no signal" };
}

// ── The pipeline ─────────────────────────────────────────────────────────────────────────────

function renderCandidates(episodes) {
  return episodes.map((e, i) => `[${i + 1}] (${e.kind}, ${new Date(e.ts).toISOString().slice(0, 10)}) ${e.text}`).join("\n");
}

/** Which candidates did the distillation actually cite? Only those are returned as sources —
 *  handing back twelve ids for a briefing that used two would make the citation meaningless. */
export function citedSources(summary, episodes) {
  const used = new Set();
  for (const m of String(summary || "").matchAll(/\[(\d+)\]/g)) {
    const i = Number(m[1]) - 1;
    if (episodes[i]) used.add(episodes[i].id);
  }
  return [...used];
}

/**
 * Search → filter → distil.
 *
 * @param memory     the store from memory.js (already provenance-filtered by space)
 * @param callModel  ({system, user}) => {text, cost} — the LOCAL or FREE model, never the flagship
 * @param timeoutMs  a hard ceiling: no recall is better than a blocked turn
 */
export async function runRecall({ query, space, memory, callModel, limit = MAX_CANDIDATES, timeoutMs = RECALL_TIMEOUT_MS, now = () => Date.now() }) {
  const started = now();
  if (!canRead(space)) return { ok: false, reason: `space "${space}" may not read memory`, ms: 0 };

  const hits = await memory.search(query, { space, limit });
  if (!hits.length) return { ok: true, empty: true, summary: "", sources: [], candidates: 0, ms: now() - started };

  // Rehydrate only what will actually be read. The candidates are the expensive part in bytes and
  // the cheap part in money — they never reach the main model.
  const episodes = [];
  for (const h of hits) {
    const e = await memory.read(h.id);
    if (e) episodes.push({ id: e.id, kind: e.kind, ts: e.ts, text: e.text });
  }
  if (!episodes.length) return { ok: true, empty: true, summary: "", sources: [], candidates: 0, ms: now() - started };

  let res;
  try {
    res = await withTimeout(
      callModel({ system: RECALL_SYSTEM, user: `QUESTION:\n${query}\n\nMEMORIES:\n${renderCandidates(episodes)}` }),
      timeoutMs,
    );
  } catch (e) {
    // Silent fallback. A turn that hangs waiting for a memory the user did not ask for is a worse
    // failure than a turn with no memory at all.
    return { ok: false, reason: e && e.message === "timeout" ? "timeout" : String(e && e.message || e), candidates: episodes.length, ms: now() - started };
  }
  if (res?.error) return { ok: false, reason: res.error, candidates: episodes.length, ms: now() - started };

  const summary = String(res?.text || "").trim();
  if (!summary || /^NOTHING RELEVANT/i.test(summary)) {
    return { ok: true, empty: true, summary: "", sources: [], candidates: episodes.length, ms: now() - started };
  }
  return {
    ok: true,
    empty: false,
    summary,
    sources: citedSources(summary, episodes),
    candidates: episodes.length,
    cost: res?.cost || 0,
    ms: now() - started,
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ── The reversible plugin ────────────────────────────────────────────────────────────────────

/**
 * Mounts recall on `agent/pre-step`.
 *
 * Reversible by construction: `handle.dispose()` unwinds the listener and the turn behaves
 * exactly as it did before — which is what the settings switch does when memory is turned off.
 * That is asserted in the tests rather than assumed, because "you can turn it off" is the kind of
 * claim that quietly stops being true.
 *
 * The recalled block is appended AFTER the messages, never at the head. Putting it first would
 * change the prefix on every turn and throw away the cache that freezing Tier 0 was designed to
 * preserve — spending on placement what was saved on content.
 */
export function memoryRecallPlugin({ memory, callModel, space, getQuery, enabled = () => true, knownEntities = () => [], onStatus, timeoutMs = RECALL_TIMEOUT_MS }) {
  return {
    name: "memory-recall",
    apply(ctx) {
      ctx.on("agent/pre-step", async (payload, next) => {
        // One decision point. Off, or a space with no read capability, means no search at all —
        // not a search whose result is discarded.
        if (!enabled() || !canRead(space)) return next(payload);
        // Only the first step of a turn: re-searching after every tool call would pay the latency
        // again for a question that has not changed.
        if (payload.step > 0) return next(payload);

        const query = String(getQuery() || "");
        const verdict = needsMemory(query, knownEntities());
        if (!verdict.needed) return next(payload);

        onStatus?.({ phase: "searching" });
        const r = await runRecall({ query, space, memory, callModel, timeoutMs });
        if (!r.ok || r.empty) {
          onStatus?.({ phase: "none", reason: r.ok ? "nothing relevant" : r.reason });
          return next(payload);
        }
        onStatus?.({ phase: "found", count: r.sources.length, ms: r.ms, cost: r.cost });
        const block = memoryBlock({ text: r.summary, sources: r.sources, nonce: makeNonce() });
        return next({ ...payload, messages: [...payload.messages, { role: "user", content: block }] });
      }, 120);
    },
  };
}
