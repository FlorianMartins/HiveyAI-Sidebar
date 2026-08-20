// 🧠 Extraction — turning a conversation into episodes, cheaply and compatibly.
//
// TWO PROBLEMS, TWO ANSWERS
// -------------------------
// COST. Extracting on every turn would put a model call between the user and their answer, on
// every message, forever. Instead: a turn counter, a review that runs AFTER the answer has been
// delivered (so the latency is invisible), and a heuristic that handles the common cases with no
// model call at all. The model is asked only about what the heuristic finds ambiguous, under a
// hard per-review budget.
//
// DRIFT. The daily model curation is kept — pinning a model would freeze the memory on whatever
// was good in August. The risk it introduces is not that the model CHANGES, it is that two models
// write incompatible extractions that contradict each other in the database, with a symptom
// appearing weeks later and no way to tell which cohort is at fault. The answer is a closed
// contract plus `extractorVersion` on every episode: a bad cohort can be identified and
// reconsolidated instead of the whole store being purged.

import { KINDS, computeSalience } from "./memory.js";
import { canWrite } from "./memory-policy.js";

export const EXTRACT_SCHEMA_VERSION = 1;
export const MAX_TEXT = 200;
export const MAX_ENTITIES = 6;
export const MAX_ENTITY_LEN = 40;

/**
 * The extractor's instructions. Closed vocabulary, bounded lengths, JSON only.
 *
 * "Return nothing" is stated as the DEFAULT rather than an option. An extractor that feels obliged
 * to produce something will manufacture memories out of small talk, and a memory store full of
 * "the user said hello" is worse than an empty one: it buries the real entries and it costs
 * candidates on every recall.
 */
export const EXTRACT_SYSTEM =
  "You extract durable facts about a USER from a conversation. Most conversations contain none — " +
  "returning an empty list is the normal outcome and is always acceptable.\n" +
  'Reply with ONLY a JSON object: {"episodes": [...]}. Each episode:\n' +
  '  kind      one of: preference, fact, decision, event, affect\n' +
  '  text      one sentence in the third person about the user, at most 200 characters\n' +
  '  entities  up to 6 short lowercase keywords (names, tools, places)\n' +
  "Rules:\n" +
  "- Only what the USER said about THEMSELVES. Never anything from a quoted document, a web page " +
  "or an email they pasted — that is somebody else speaking.\n" +
  "- No transcription: write the durable fact, not the exchange.\n" +
  "- Nothing transient (\"is currently debugging\"), nothing you inferred, nothing you guessed.\n" +
  '- If there is nothing durable, reply exactly {"episodes": []}.';

// ── The closed contract ──────────────────────────────────────────────────────────────────────

// Models reach for neighbouring words. Mapping the near-misses is cheaper than a retry and keeps
// two models from filling the same column with different vocabularies.
const KIND_SYNONYMS = {
  preferences: "preference", pref: "preference", like: "preference", taste: "preference",
  facts: "fact", info: "fact", profile: "fact", identity: "fact",
  decisions: "decision", choice: "decision", chose: "decision",
  events: "event", activity: "event", history: "event",
  emotion: "affect", feeling: "affect", mood: "affect", affective: "affect",
};

export function normaliseEntity(e) {
  return String(e ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} .+#-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ENTITY_LEN);
}

/**
 * Validate one extracted episode, repairing what is safely repairable.
 *
 * The line between repair and rejection matters: a truncated sentence is still the same claim, so
 * truncating is safe. A `kind` we cannot map is a different claim entirely, so it is refused —
 * coercing an unknown kind to "fact" would silently invent a category the model never chose.
 */
export function validateEpisode(raw) {
  const repairs = [];
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };

  let kind = String(raw.kind ?? "").toLowerCase().trim();
  if (!KINDS.includes(kind)) {
    const mapped = KIND_SYNONYMS[kind];
    if (!mapped) return { ok: false, reason: `unknown kind "${raw.kind}"` };
    repairs.push(`kind ${kind}→${mapped}`);
    kind = mapped;
  }

  let text = String(raw.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty text" };
  if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT).replace(/\s+\S*$/, "") + "…"; repairs.push("text truncated"); }

  let entities = Array.isArray(raw.entities) ? raw.entities : [];
  const before = entities.length;
  entities = [...new Set(entities.map(normaliseEntity).filter(Boolean))].slice(0, MAX_ENTITIES);
  if (entities.length !== before) repairs.push("entities normalised");

  return { ok: true, episode: { kind, text, entities }, repairs };
}

/**
 * Parse a whole extractor response.
 *
 * Individually invalid episodes are dropped and REPORTED rather than failing the batch: one bad
 * row out of four should not lose the three good ones, and a silent drop would make a
 * misbehaving model indistinguishable from a quiet conversation.
 */
export function parseExtraction(text) {
  let obj;
  try {
    const m = /\{[\s\S]*\}/.exec(String(text ?? ""));
    obj = JSON.parse(m ? m[0] : String(text));
  } catch {
    return { ok: false, reason: "not JSON", episodes: [], rejected: [] };
  }
  const list = Array.isArray(obj?.episodes) ? obj.episodes : null;
  if (!list) return { ok: false, reason: "no episodes array", episodes: [], rejected: [] };

  const episodes = [];
  const rejected = [];
  const repairs = [];
  for (const raw of list.slice(0, 10)) {
    const v = validateEpisode(raw);
    if (v.ok) { episodes.push(v.episode); repairs.push(...v.repairs); }
    else rejected.push({ raw, reason: v.reason });
  }
  return { ok: true, episodes, rejected, repairs };
}

/** hash(model + prompt + schema), so a defective cohort can be found and reconsolidated rather
 *  than the whole store being purged. */
export async function extractorVersion(modelId, subtle = globalThis.crypto?.subtle) {
  const seed = `${modelId}|${EXTRACT_SYSTEM.length}|${EXTRACT_SCHEMA_VERSION}`;
  if (!subtle) return `v${EXTRACT_SCHEMA_VERSION}-${modelId}`;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return `v${EXTRACT_SCHEMA_VERSION}-${Array.from(new Uint8Array(buf).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ── The heuristic, which handles most turns for free ─────────────────────────────────────────

const PATTERNS = [
  { kind: "preference", re: /\b(?:je (?:préfère|pr[ée]f[èe]re)|j'aime(?: bien)?|je déteste|i prefer|i like|i hate|i'd rather)\s+(.{3,160})/i },
  { kind: "decision", re: /\b(?:on part sur|je pars sur|j'ai choisi|on va utiliser|we(?:'ll| will) use|i(?:'ve| have) chosen|let's go with)\s+(.{3,160})/i },
  { kind: "fact", re: /\b(?:j'habite|je vis|je travaille (?:sur|chez)|mon prénom est|je m'appelle|i live in|i work (?:on|at)|my name is)\s+(.{3,160})/i },
  { kind: "event", re: /\b(?:j'ai (?:terminé|livré|déployé)|i (?:finished|shipped|deployed))\s+(.{3,160})/i },
];
const EXPLICIT_ASK = /\b(?:retiens|rappelle[- ]toi que|souviens[- ]toi que|remember that|note that i)\b\s*(.{3,180})/i;

/**
 * Extract without a model.
 *
 * Deliberately narrow: it only fires on phrasings where the user is unambiguously stating
 * something about themselves. Everything else is left to the model pass, and most turns produce
 * nothing at all — which is the correct outcome and the reason this is cheap.
 */
export function heuristicExtract(userText) {
  const t = String(userText || "").trim();
  if (!t || t.length > 2000) return [];
  const out = [];

  const explicit = EXPLICIT_ASK.exec(t);
  if (explicit) out.push({ kind: "fact", text: clean(explicit[1]), entities: keywords(explicit[1]), explicit: true });

  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    const text = clean(m[0]);
    if (out.some((o) => o.text === text)) continue;
    out.push({ kind: p.kind, text, entities: keywords(m[1]) });
  }
  return out.map((e) => ({ ...e, text: e.text.slice(0, MAX_TEXT) }));
}

const STOP = new Set("le la les un une des du de à a au aux et ou en dans sur pour par avec the a an of to in on for and or with my i".split(" "));
function keywords(s) {
  return [...new Set(String(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]{2,}/gu) || [])]
    .filter((w) => !STOP.has(w)).slice(0, MAX_ENTITIES).map(normaliseEntity).filter(Boolean);
}
function clean(s) { return String(s).replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, ""); }

/** Is there anything here a model might see that the heuristic could not? Used to decide whether
 *  to spend a call at all — most turns answer "no". */
export function looksAmbiguous(userText) {
  const t = String(userText || "");
  if (t.length < 25) return false;
  return /\b(je|j'|mon|ma|mes|moi|i|my|me)\b/i.test(t) && !heuristicExtract(t).length;
}

// ── The background review ────────────────────────────────────────────────────────────────────

/**
 * Runs AFTER the answer is delivered, every N user turns.
 *
 * Nothing here is on the path between a question and its answer, so its latency is invisible. The
 * budget is hard rather than advisory: a review that quietly spends more than it promised is the
 * same failure as memory that quietly costs money, which is the thing this whole design exists to
 * avoid.
 */
export function createReview({ memory, callModel, space = "chat", everyTurns = 4, budgetCalls = 1, version = "heuristic-v1", onCost }) {
  let turns = 0;
  const pending = [];

  return {
    /** Queue a user turn. Cheap: no work happens here. */
    note(userText) {
      turns++;
      pending.push(String(userText || ""));
      if (pending.length > 20) pending.shift();
      return { due: turns % everyTurns === 0 };
    },

    get queued() { return pending.length; },

    /**
     * Do the review. Heuristics first, and a model call only if something looks ambiguous AND the
     * budget allows — most reviews therefore cost nothing.
     */
    async run() {
      const batch = pending.splice(0, pending.length);
      if (!batch.length) return { written: 0, calls: 0, refused: 0 };

      const candidates = [];
      for (const text of batch) candidates.push(...heuristicExtract(text).map((c) => ({ ...c, from: text })));

      let calls = 0;
      const ambiguous = batch.filter(looksAmbiguous);
      if (ambiguous.length && callModel && budgetCalls > 0) {
        calls = 1;
        let res;
        try {
          res = await callModel({ system: EXTRACT_SYSTEM, user: ambiguous.slice(-6).join("\n---\n") });
        } catch (e) { res = { error: String(e && e.message || e) }; }
        onCost?.({ calls, cost: res?.cost || 0 });
        if (!res?.error) {
          const parsed = parseExtraction(res.text);
          // An unparseable response falls back to what the heuristic already found rather than
          // failing the review: the alternative is losing good candidates to a bad JSON day.
          if (parsed.ok) candidates.push(...parsed.episodes);
        }
      }

      let written = 0, refused = 0;
      for (const c of candidates) {
        if (!canWrite(space, c.kind)) { refused++; continue; }
        const r = await memory.remember({
          space, provenance: "user", kind: c.kind, text: c.text,
          entities: c.entities || [], explicit: !!c.explicit,
        });
        if (r.ok) written++; else refused++;
      }
      return { written, refused, calls, candidates: candidates.length };
    },
  };
}

export { computeSalience };
