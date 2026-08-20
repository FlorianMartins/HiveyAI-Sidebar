// Phase 3 — the output contract, the background review, and consolidation.
//
// The contract is the important half. Two models writing incompatible extractions do not fail
// loudly: they fill one column with different vocabularies, contradict each other in the database,
// and produce a symptom weeks later that nobody can trace. So the schema is closed, repairs are
// bounded, and what cannot be repaired is refused rather than coerced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  validateEpisode, parseExtraction, normaliseEntity, heuristicExtract, looksAmbiguous,
  createReview, extractorVersion, EXTRACT_SYSTEM, MAX_TEXT,
} from "../src/lib/memory-extract.js";
import {
  clusterEpisodes, consolidateCluster, decay, promoteToProfile, consolidate,
  trivialSchema, CONSOLIDATE_SYSTEM, RETRIEVAL_FLOOR, PURGE_FLOOR,
} from "../src/lib/memory-consolidate.js";
import { resolveMemoryModel, memoryModelChoices, MEMORY_ROLES, MEMORY_DEFAULTS } from "../src/lib/memory-models.js";
import { quantise, createMemory } from "../src/lib/memory.js";
import { MEMORY_CASES, poolFor, scoreAnswer, POOL_NAMES } from "../scripts/memory-cases.mjs";

// ── The closed contract ────────────────────────────────────────────────────────────────────

test("a well-formed episode passes untouched", () => {
  const v = validateEpisode({ kind: "preference", text: "prefers concise answers", entities: ["style"] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.episode, { kind: "preference", text: "prefers concise answers", entities: ["style"] });
  assert.deepEqual(v.repairs, []);
});

test("a near-miss kind is mapped; an unknown one is REFUSED, not coerced", () => {
  // Mapping "preferences" costs nothing. Coercing an unrecognised kind to "fact" would invent a
  // category the model never chose — a contradiction in the database with no trace of its origin.
  assert.equal(validateEpisode({ kind: "preferences", text: "x" }).episode.kind, "preference");
  assert.equal(validateEpisode({ kind: "choice", text: "x" }).episode.kind, "decision");
  const bad = validateEpisode({ kind: "vibe", text: "x" });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /unknown kind/);
});

test("an over-long text is truncated at a word boundary — still the same claim", () => {
  const v = validateEpisode({ kind: "fact", text: "word ".repeat(100) });
  assert.ok(v.ok);
  assert.ok(v.episode.text.length <= MAX_TEXT + 1);
  assert.match(v.episode.text, /…$/);
  assert.ok(v.repairs.includes("text truncated"));
});

test("entities are normalised, deduplicated and capped", () => {
  const v = validateEpisode({ kind: "fact", text: "x", entities: ["  Lyon ", "LYON", "Flutter!", "a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(v.episode.entities.includes("lyon"), true);
  assert.equal(v.episode.entities.filter((e) => e === "lyon").length, 1);
  assert.ok(v.episode.entities.length <= 6);
});

test("normaliseEntity strips punctuation without destroying real names", () => {
  assert.equal(normaliseEntity("  Node.js! "), "node.js");
  assert.equal(normaliseEntity("C++"), "c++");
  assert.equal(normaliseEntity("@@@"), "");
});

test("an empty or malformed episode is refused with a reason", () => {
  assert.match(validateEpisode({ kind: "fact", text: "   " }).reason, /empty text/);
  assert.match(validateEpisode(null).reason, /not an object/);
  assert.match(validateEpisode("nope").reason, /not an object/);
});

test("one bad row does not lose the good ones", () => {
  // A silent drop would make a misbehaving model indistinguishable from a quiet conversation.
  const r = parseExtraction(JSON.stringify({ episodes: [
    { kind: "fact", text: "lives in Lyon" },
    { kind: "vibe", text: "unmappable" },
    { kind: "preference", text: "prefers prose" },
  ] }));
  assert.equal(r.ok, true);
  assert.equal(r.episodes.length, 2);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /unknown kind/);
});

test("a fenced or chatty response is still parsed", () => {
  assert.equal(parseExtraction('```json\n{"episodes":[{"kind":"fact","text":"x"}]}\n```').episodes.length, 1);
  assert.equal(parseExtraction('Sure!\n{"episodes":[]}').episodes.length, 0);
});

test("unusable output is reported, never guessed at", () => {
  assert.equal(parseExtraction("no json here").ok, false);
  assert.equal(parseExtraction('{"other": 1}').ok, false);
  assert.equal(parseExtraction("").ok, false);
});

test("the extractor prompt makes 'nothing' the normal answer", () => {
  // An extractor that feels obliged to produce something manufactures memories out of small talk,
  // and a store full of "the user said hello" buries the real entries.
  assert.match(EXTRACT_SYSTEM, /returning an empty list is the normal outcome/i);
  assert.match(EXTRACT_SYSTEM, /Never anything from a quoted document, a web page/);
});

test("extractorVersion changes with the model, so a bad cohort can be found", async () => {
  const a = await extractorVersion("vendor/a");
  assert.equal(a, await extractorVersion("vendor/a"));
  assert.notEqual(a, await extractorVersion("vendor/b"));
});

// ── The heuristic ──────────────────────────────────────────────────────────────────────────

test("stated preferences, decisions and facts are caught with no model call", () => {
  assert.equal(heuristicExtract("je préfère des réponses courtes")[0].kind, "preference");
  assert.equal(heuristicExtract("on part sur Postgres pour le backend")[0].kind, "decision");
  assert.equal(heuristicExtract("j'habite à Lyon")[0].kind, "fact");
  assert.equal(heuristicExtract("I prefer short answers")[0].kind, "preference");
});

test("an explicit 'remember that' is caught and marked explicit", () => {
  const [e] = heuristicExtract("retiens que mon serveur s'appelle ns3241406");
  assert.equal(e.explicit, true);
  assert.ok(e.entities.length > 0);
});

test("ordinary conversation yields nothing", () => {
  for (const t of ["explique-moi TCP", "what is a monad?", "merci !", ""]) {
    assert.deepEqual(heuristicExtract(t), [], t);
  }
});

test("a long paste is not mined for memories", () => {
  // It is almost always someone else's document, and this heuristic cannot tell.
  assert.deepEqual(heuristicExtract("je préfère " + "x".repeat(2100)), []);
});

test("looksAmbiguous asks for a model only when the heuristic found nothing about the user", () => {
  assert.equal(looksAmbiguous("je préfère des réponses courtes"), false, "already handled for free");
  assert.equal(looksAmbiguous("explain how TCP works in detail please"), false, "not about them");
  assert.equal(looksAmbiguous("mon setup a changé récemment et je ne sais plus trop quoi en penser"), true);
});

// ── The background review ──────────────────────────────────────────────────────────────────

function fakeStore() {
  const written = [];
  return { written, async remember(e) { written.push(e); return { ok: true, id: `id${written.length}` }; } };
}

test("a review is due only every N turns", () => {
  const r = createReview({ memory: fakeStore(), everyTurns: 3 });
  assert.equal(r.note("a").due, false);
  assert.equal(r.note("b").due, false);
  assert.equal(r.note("c").due, true);
});

test("the common case costs no model call at all", async () => {
  let calls = 0;
  const memory = fakeStore();
  const r = createReview({ memory, callModel: async () => { calls++; return { text: "{}" }; } });
  r.note("je préfère des réponses courtes");
  const out = await r.run();
  assert.equal(calls, 0, "the heuristic handled it");
  assert.equal(out.written, 1);
  assert.equal(memory.written[0].provenance, "user");
});

test("the model is called at most once per review, whatever the queue", async () => {
  let calls = 0;
  const r = createReview({
    memory: fakeStore(), budgetCalls: 1,
    callModel: async () => { calls++; return { text: '{"episodes":[{"kind":"fact","text":"uses a VPS"}]}' }; },
  });
  for (let i = 0; i < 8; i++) r.note("mon infrastructure a beaucoup changé ces derniers temps je crois");
  const out = await r.run();
  assert.equal(calls, 1, "a hard budget, not an advisory one");
  assert.ok(out.written >= 1);
});

test("a broken model response falls back to the heuristic rather than losing the review", async () => {
  const memory = fakeStore();
  const r = createReview({ memory, callModel: async () => ({ text: "I'm afraid I can't do that" }) });
  r.note("je préfère des réponses courtes");
  r.note("mon environnement de travail a changé et c'est compliqué à expliquer");
  const out = await r.run();
  assert.ok(out.written >= 1, "the heuristic's finding survived the model's bad day");
});

test("a model error does not throw the review away", async () => {
  const r = createReview({ memory: fakeStore(), callModel: async () => { throw new Error("offline"); } });
  r.note("je préfère des réponses courtes");
  r.note("mon setup a changé récemment et je ne sais plus trop quoi en penser");
  const out = await r.run();
  assert.ok(out.written >= 1);
});

test("a space that may not write that kind is refused, not silently written", async () => {
  const memory = fakeStore();
  const r = createReview({ memory, space: "improve" });
  r.note("j'habite à Lyon");           // a fact — Improve may only write preferences
  const out = await r.run();
  assert.equal(out.written, 0);
  assert.equal(out.refused, 1);
});

test("the queue is drained by a run", async () => {
  const r = createReview({ memory: fakeStore() });
  r.note("je préfère des réponses courtes");
  assert.equal(r.queued, 1);
  await r.run();
  assert.equal(r.queued, 0);
});

// ── Consolidation ──────────────────────────────────────────────────────────────────────────

const vec = (seed) => {
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = Math.sin(i * 0.1 + seed) ;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n);
  for (let i = 0; i < 384; i++) v[i] /= n;
  return v;
};
const ep = (id, seed, over = {}) => ({ id, text: `episode ${id}`, kind: "event", salience: 0.5, recallCount: 0, vec: quantise(vec(seed)), ...over });

test("near-identical episodes cluster; distant ones do not", () => {
  const clusters = clusterEpisodes([ep("a", 1), ep("b", 1.001), ep("c", 40)]);
  const sizes = clusters.map((c) => c.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("a cluster of one needs no model — asking would buy a paraphrase", async () => {
  const r = await consolidateCluster([ep("a", 1)], { callModel: async () => { throw new Error("should not be called"); } });
  assert.equal(r.ok, true);
  assert.equal(r.calls, 0);
  assert.deepEqual(r.schema.derivedFrom, ["a"]);
});

test("a real cluster becomes one schema that records its sources", async () => {
  const cluster = [ep("a", 1, { kind: "decision" }), ep("b", 1.001, { kind: "event" })];
  const r = await consolidateCluster(cluster, { callModel: async () => ({ text: "prefers Postgres for backends" }) });
  assert.equal(r.ok, true);
  assert.equal(r.schema.text, "prefers Postgres for backends");
  assert.deepEqual(r.schema.derivedFrom, ["a", "b"]);
  assert.equal(r.schema.kind, "decision", "the most specific kind in the cluster wins");
  assert.equal(r.schema.members, 2);
});

test("NO SCHEMA means the cluster is left alone", async () => {
  const r = await consolidateCluster([ep("a", 1), ep("b", 1.001)], { callModel: async () => ({ text: "NO SCHEMA" }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no shared claim/);
});

test("the consolidator is forbidden from generalising beyond its sources", () => {
  assert.match(CONSOLIDATE_SYSTEM, /Never generalise beyond them/);
  assert.match(CONSOLIDATE_SYSTEM, /NO SCHEMA/);
});

test("decay has two floors: leaving the search, and being deleted", () => {
  // One threshold would make every consolidation mistake permanent. Dormant is reversible.
  const { dormant, purgeable } = decay([
    ep("high", 1, { salience: 0.9 }),
    ep("mid", 2, { salience: RETRIEVAL_FLOOR + 0.05 }),
    ep("low", 3, { salience: PURGE_FLOOR + 0.01 }),
  ]);
  assert.equal(dormant.some((e) => e.id === "mid"), true);
  assert.equal(purgeable.some((e) => e.id === "low"), true);
  assert.equal(purgeable.some((e) => e.id === "high"), false);
});

test("a memory that has proved useful decays more slowly", () => {
  const [plain, used] = decay([ep("plain", 1, { salience: 0.6 }), ep("used", 2, { salience: 0.6, recallCount: 3 })]).updated;
  assert.ok(used.salience > plain.salience, "usage is the evidence that it matters");
});

test("only established schemas reach the profile, within its budget", () => {
  const { kept } = promoteToProfile([
    { text: "prefers concise answers", salience: 0.9, members: 5, ts: 1 },
    { text: "mentioned a cat once", salience: 0.2, members: 1, ts: 2 },
  ]);
  assert.equal(kept.length, 1);
  assert.match(kept[0].text, /concise/);
});

test("a consolidation round respects its call budget", async () => {
  let calls = 0;
  const episodes = [];
  for (let i = 0; i < 12; i++) episodes.push(ep(`a${i}`, 1 + i * 0.0005));   // all one cluster
  for (let i = 0; i < 12; i++) episodes.push(ep(`b${i}`, 40 + i * 0.0005));  // and another
  const r = await consolidate({ episodes, budgetCalls: 1, callModel: async () => { calls++; return { text: "a shared claim" }; } });
  assert.equal(calls, 1, "a background job without a ceiling is how a free feature becomes expensive");
  assert.equal(r.schemas.length, 1);
});

test("dormant episodes are not re-clustered", async () => {
  const episodes = [ep("live", 1, { salience: 0.8 }), ep("dead", 1.001, { salience: 0.01 })];
  const r = await consolidate({ episodes, callModel: async () => ({ text: "x" }) });
  assert.equal(r.clusters, 0, "one live episode alone is not a cluster");
});

// ── Roles and routing ──────────────────────────────────────────────────────────────────────

test("the three roles exist and none is tied to a paid tier", () => {
  assert.deepEqual(Object.keys(MEMORY_ROLES).sort(), ["memory-consolidate", "memory-extract", "memory-recall"]);
  for (const id of Object.keys(MEMORY_ROLES)) {
    assert.equal(MEMORY_DEFAULTS[id], "hivey/free", `${id} must default to something free`);
  }
});

test("the route is never silently expensive", () => {
  // The whole economic argument is that the candidates are read by something free. A flagship
  // fallback would make a recall cost MORE than the injection it replaces.
  assert.equal(resolveMemoryModel("memory-recall", {}).route, "free");
  assert.equal(resolveMemoryModel("memory-recall", { localAvailable: true, localModel: "ollama|llama" }).route, "local");
  assert.equal(resolveMemoryModel("memory-recall", { freeAvailable: false }).id, null, "no route → no recall, not a flagship");
});

test("an explicit user choice always wins, including a paid one", () => {
  // Their decision, shown with its price. What the code refuses is choosing expensive FOR them.
  const r = resolveMemoryModel("memory-recall", { settings: { memoryModels: { "memory-recall": "anthropic/claude-opus-5" } } });
  assert.equal(r.id, "anthropic/claude-opus-5");
  assert.equal(r.route, "chosen");
});

test("the settings list offers free first, then measured, then the rest", () => {
  const choices = memoryModelChoices("memory-recall", {
    catalogue: [
      { id: "anthropic/claude-opus-5", name: "Opus 5", pricing: { completion: "0.000075" } },
      { id: "cheap/model", name: "Cheap", pricing: { completion: "0.0000005" } },
      { id: "~alias/latest", name: "alias" },
    ],
    local: [{ id: "ollama|llama3", label: "llama3 (local)" }],
    admission: { "cheap/model": 0.9 },
  });
  assert.equal(choices[0].route === "local" || choices[0].price === 0, true, "free options come first");
  assert.equal(choices.some((c) => c.id.startsWith("~")), false, "moving aliases are not offerable");
  assert.equal(choices.some((c) => c.id === "anthropic/claude-opus-5"), true, "expensive options are shown, not hidden");
});

// ── The admission bench ────────────────────────────────────────────────────────────────────

test("there are thirty admission cases, each with a pool and a distractor", () => {
  assert.equal(MEMORY_CASES.length, 30);
  for (const c of MEMORY_CASES) {
    assert.ok(poolFor(c.pool).length > 0, `pool ${c.pool} is empty`);
    assert.ok(c.must.length > 0 && c.never.length > 0, `${c.q} needs both a target and a distractor`);
  }
  assert.ok(POOL_NAMES.length >= 5);
});

test("scoring separates missing the answer from inventing one", () => {
  const c = MEMORY_CASES.find((x) => /Where does the user live/.test(x.q));
  assert.deepEqual(scoreAnswer("The user lives in Lyon [1].", c), { recalled: true, fabricated: false });
  assert.deepEqual(scoreAnswer("The user lives in Paris [1].", c), { recalled: false, fabricated: true });
  assert.deepEqual(scoreAnswer("Nothing relevant.", c), { recalled: false, fabricated: false });
});

test("no distractor is accidentally present in its own pool", () => {
  // A distractor that appears in the sources would score an honest model as a fabricator.
  for (const c of MEMORY_CASES) {
    const text = poolFor(c.pool).join(" ");
    for (const re of c.never) {
      assert.equal(re.test(text), false, `distractor ${re} appears in pool "${c.pool}" — it would punish an honest model`);
    }
  }
});

test("the admission bench gates on latency, not only on quality", async () => {
  // Measured but not gated was the original mistake: the first real run admitted a model that
  // scored 100% recall at 22.7 SECONDS per lookup. For the role that sits between a question and
  // its answer, perfect recall arriving after the user gave up is not a better answer.
  const src = await import("node:fs").then((fs) => fs.readFileSync("scripts/bench-hivey.mjs", "utf8"));
  assert.match(src, /ADMIT_MS\s*=\s*\{/, "there is a latency ceiling");
  assert.match(src, /recall:\s*6000/, "and it is tight for the recall role");
  assert.match(src, /rejected: /, "a rejection names its reason — 'REJECT' alone is not actionable");
});
