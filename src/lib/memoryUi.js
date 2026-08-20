// 🧠 Memory, as the user sees it.
//
// TWO RULES ABOUT WORDS
// ---------------------
// 1. Action verbs only — consult, find, send, keep. Never verbs of inner state ("is thinking
//    about you", "remembers you fondly"): they are unverifiable, and worse, they would COVER the
//    piece of information that actually matters. "Sending 3 memories to Anthropic" is the fact.
//    Personification may dress that sentence; it may not replace it.
// 2. The number does more reassurance work than the adjective. "3 memories" tells the user the
//    size of what left their machine. "a little context" tells them nothing and sounds like
//    evasion precisely when they are deciding whether to trust the feature.
//
// AND ONE ABOUT UNDO
// ------------------
// Once a memory has been sent, deleting it changes nothing about the request that already left.
// Offering "delete" as though it recalled the message would be a lie the user only discovers
// later. So there are two separate actions — remove it permanently, or exclude it from THIS turn —
// and after a send the honest affordance is "regenerate without it", not "undo".

import { estimateTokens } from "./memory.js";

/**
 * Where the memories are about to go.
 *
 * The distinction the user cares about is not which company, it is whether the text leaves their
 * machine at all. Local providers are named as local; everything else is named by its vendor,
 * because "sent to a third party" is vague in a way that reads as concealment.
 */
export function destinationOf(providerId, modelId = "") {
  const local = providerId === "ollama" || providerId === "lmstudio" || /^local/i.test(providerId);
  if (local) return { local: true, label: providerId === "lmstudio" ? "LM Studio" : "Ollama" };
  const vendor = String(modelId).split("/")[0] || providerId;
  const NAMES = {
    anthropic: "Claude (Anthropic)", openai: "OpenAI", google: "Google", "x-ai": "xAI",
    deepseek: "DeepSeek", mistralai: "Mistral", qwen: "Qwen", "z-ai": "Z.ai",
    moonshotai: "Moonshot", nvidia: "NVIDIA", openrouter: "OpenRouter", poolside: "Poolside",
  };
  return { local: false, label: NAMES[vendor] || vendor || "the provider" };
}

/**
 * The sequence of status lines for one recall.
 *
 * Sequential rather than a single spinner, because two seconds that are ANNOUNCED read very
 * differently from two seconds that are merely endured. Each entry names an action that really
 * happened, with the numbers that make it checkable.
 */
export function statusSteps({ phase, name, count = 0, destination, t }) {
  switch (phase) {
    case "searching":
      return { key: "mem.status.searching", text: t("mem.status.searching", { name }) };
    case "found":
      return { key: "mem.status.found", text: t("mem.status.found", { name, count: String(count) }) };
    case "sending":
      // The one line that must never be softened: it names what left, how much of it, and to whom.
      return destination?.local
        ? { key: "mem.status.local", text: t("mem.status.local", { name }) }
        : { key: "mem.status.sending", text: t("mem.status.sending", { name, count: String(count), provider: destination?.label || "" }) };
    case "none":
      return { key: "mem.status.none", text: t("mem.status.none", { name }) };
    default:
      return null;
  }
}

/** What the transmitted block actually cost, in the currency the user is billed in. They are
 *  BYOK: a feature that spends their money owes them the number. */
export function recallCost(blockText) {
  return estimateTokens(blockText);
}

/**
 * One row of the expandable panel.
 *
 * The text is shown VERBATIM — not a summary of the summary. The panel exists so the user can see
 * what was said about them; paraphrasing it there would defeat the only purpose it has.
 * Provenance and date come with it because an unrecognised memory is a security signal, and the
 * user is the only one who can recognise it.
 */
export function panelRow(episode, { excluded = false } = {}) {
  return {
    id: episode.id,
    text: String(episode.text || ""),
    provenance: episode.provenance || "unknown",
    date: episode.ts ? new Date(episode.ts).toISOString().slice(0, 10) : "",
    kind: episode.kind || "",
    excluded,
    tokens: estimateTokens(episode.text || ""),
  };
}

/**
 * Track which memories the user excluded from this turn.
 *
 * "Not now" is not "never". Without a per-turn exclusion, people delete perfectly good memories
 * to keep them out of one specific conversation — and that loss is permanent while the reason for
 * it was momentary.
 */
export function createExclusions() {
  const perTurn = new Set();
  return {
    exclude(id) { perTurn.add(id); },
    include(id) { perTurn.delete(id); },
    has(id) { return perTurn.has(id); },
    get size() { return perTurn.size; },
    clearTurn() { perTurn.clear(); },
    filter(episodes) { return episodes.filter((e) => !perTurn.has(e.id)); },
  };
}

/**
 * What can honestly be offered about a memory, given where the turn is.
 *
 * Before the request leaves, excluding it genuinely prevents the send. After, it does not — the
 * bytes are gone. Presenting the same button in both states would teach the user that "exclude"
 * undoes a send, which is exactly the belief that gets someone hurt once.
 */
export function actionsFor({ sent }) {
  return sent
    ? { canExclude: false, canDelete: true, offerRegenerate: true, note: "already-sent" }
    : { canExclude: true, canDelete: true, offerRegenerate: false, note: "not-yet-sent" };
}

/**
 * Should we offer to turn memory on?
 *
 * Opt-in with a default of off means nobody discovers it. But a prompt that reappears is not a
 * suggestion, it is nagging — and the answer to nagging is to distrust the feature. So: once,
 * after enough real use that the offer is about something the person has actually experienced.
 */
export function shouldOfferMemory({ enabled, alreadyOffered, sessions = 0, turns = 0 }) {
  if (enabled || alreadyOffered) return false;
  return sessions >= 3 && turns >= 15;
}
