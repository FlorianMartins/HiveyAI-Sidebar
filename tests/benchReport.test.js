// The benchmark report (lib/bench-report.js): who to pick in one sentence, every family, every
// question missed — and nothing a model name or an error message could smuggle into the page.

import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchReport, rankEntries, scoreTone, probePrompt, pickModel, verdictReason, costValue } from "../src/lib/bench-report.js";
import { normalizeMeasured } from "../src/lib/benchmarkView.js";
import { FAMILIES, probesFor } from "../src/lib/livebench.js";
import { t, setLang } from "../src/lib/i18n.js";

const entry = (label, score, extra = {}) => ({
  key: `openrouter|${label}`, label, provider: "OpenRouter", score, pass: Math.round(score * 20), total: 20, answered: 20, errors: 0,
  byFamily: { reason: { pass: 5, total: 6 }, instruction: { pass: 4, total: 6 }, json: { pass: 4, total: 4 }, tools: { pass: 4, total: 4 } },
  failures: [{ family: "reason", probe: "bat-and-ball", why: "wrong answer" }], ms: 42000, cost: 0.0021, costExact: true, ...extra,
});

test("best first, the unmeasured last", () => {
  const r = rankEntries([entry("b", 0.6), { label: "x", score: null }, entry("a", 0.9)]);
  assert.deepEqual(r.map((e) => e.label), ["a", "b", "x"]);
  assert.equal(scoreTone(0.85), "good");
  assert.equal(scoreTone(0.6), "mid");
  assert.equal(scoreTone(0.2), "bad");
});

test("the report opens on the same verdict as the workspace, then every question missed", () => {
  setLang("fr");
  try {
    const html = buildBenchReport([entry("Grand modèle", 0.9, { cost: 0.05 }), entry("Petit modèle", 0.85, { cost: 0.001 })], { t, lang: "fr" });
    assert.match(html, /Notre conseil : Petit modèle/);
    assert.match(html, /Presque aussi bon que Grand modèle \(85 % contre 90 %\), 50× moins cher\./);
    assert.match(html, /<svg class="chart"/);
    assert.ok(html.includes(probePrompt("reason", "bat-and-ball").slice(0, 30)), "the missed question is quoted");
    assert.match(html, /Logique et calcul/);
    assert.doesNotMatch(html, /<script/i, "the report runs nothing");
  } finally {
    setLang("en");
  }
});

// ── The verdict: « which one should I use? » ──────────────────────────────────────────────

test("among models within one question of the best, the cheapest is the pick", () => {
  const v = pickModel([entry("big", 1, { cost: 0.02 }), entry("small", 0.95, { cost: 0.002 }), entry("weak", 0.6, { cost: 0.0001 })]);
  assert.equal(v.pick.label, "small", "one question behind, ten times cheaper");
  assert.equal(v.vs.label, "big", "compared with the top scorer");
  assert.equal(verdictReason(v, { t, lang: "en" }), "Nearly as good as big (95 % vs 100 %), 10× cheaper.");
});

test("« within one question » means one question of the test that was run, whatever its size", () => {
  const on = (total) => (label, pass, cost) => ({ ...entry(label, pass / total, { cost }), pass, total, answered: total });
  const full = on(39);
  // Two questions behind on 39 is 5 % — once a margin, now a real gap.
  assert.equal(pickModel([full("big", 39, 0.02), full("small", 37, 0.002)]).pick.label, "big");
  assert.equal(pickModel([full("big", 39, 0.02), full("small", 38, 0.002)]).pick.label, "small");
  const five = on(5);
  assert.equal(pickModel([five("big", 5, 0.02), five("small", 4, 0.002)]).pick.label, "small", "one question of five");
});

test("a clearly better score wins even when it costs more, and the sentence says so", () => {
  const v = pickModel([entry("pricey", 1, { cost: 0.02, ms: 10000 }), entry("cheap", 0.7, { cost: 0.002, ms: 40000 })]);
  assert.equal(v.pick.label, "pricey");
  assert.equal(v.vs.label, "cheap", "compared with the runner-up");
  assert.equal(verdictReason(v, { t, lang: "en" }), "Best score (100 % vs 70 % for cheap), 10× more expensive, 4× faster.");
});

test("at the same score and price, the faster model is the pick; free beats paid", () => {
  const same = pickModel([entry("slow", 1, { ms: 60000 }), entry("quick", 1, { ms: 15000 })]);
  assert.equal(same.pick.label, "quick");
  assert.equal(verdictReason(same, { t, lang: "en" }), "As good as slow (100 %), 4× faster.");
  const local = pickModel([entry("cloud", 1, { cost: 0.01, ms: 20000 }), entry("local", 1, { free: true, cost: 0, ms: 20000 })]);
  assert.equal(local.pick.label, "local");
  assert.match(verdictReason(local, { t, lang: "en" }), /, free\.$/);
});

test("with three models, the pick that is also the cheapest or fastest of all says so", () => {
  const v = pickModel([entry("A", 1, { cost: 0.0021, ms: 18000 }), entry("B", 1, { cost: 0.0064, ms: 26000 }), entry("C", 1, { cost: 0.02, ms: 63000 })]);
  assert.equal(v.pick.label, "A");
  assert.equal(verdictReason(v, { t, lang: "en" }), "As good as B (100 %), 3× cheaper, the fastest of all.");
});

test("while the other models are still running, a lone result does not ask for another one", () => {
  const v = pickModel([entry("first", 1)]);
  assert.match(verdictReason(v, { t, lang: "en", running: true }), /being tested/);
});

test("a model whose price is unknown is never taken for the cheapest", () => {
  assert.equal(costValue({ cost: 0 }), null);
  assert.equal(costValue({ free: true }), 0);
  const v = pickModel([entry("unpriced", 1, { cost: 0 }), entry("priced", 1, { cost: 0.01 })]);
  assert.equal(v.pick.label, "priced");
});

test("one model alone gets a result, not a recommendation", () => {
  const v = pickModel([entry("solo", 0.9)]);
  assert.equal(v.vs, null);
  assert.equal(verdictReason(v, { t, lang: "en" }), "90 % right answers (18/20). Add another model to compare.");
  assert.equal(pickModel([]), null);
});

test("a model name or an error message cannot write HTML into the report", () => {
  const html = buildBenchReport([entry('<img src=x onerror=alert(1)>', 0.5, { failures: [{ family: "json", probe: "extract", why: "<b>boom</b>" }] })], { t, lang: "en" });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>boom/);
  assert.match(html, /&lt;img src=x/);
});

test("with no measurement the report says so", () => {
  assert.match(buildBenchReport([], { t, lang: "en" }), /No measured model yet/);
});

test("older results, keyed by an OpenRouter id alone, are kept under the provider's key", () => {
  assert.deepEqual(Object.keys(normalizeMeasured({ "openai/gpt-5": { score: 1 }, "custom|qwen-27b": { score: 0.5 } })), ["openrouter|openai/gpt-5", "custom|qwen-27b"]);
});

test("the new families get a column, a legend, and their missed questions with the model's answer", () => {
  setLang("fr");
  try {
    const e = entry("Modèle", 0.8, {
      byFamily: { ...entry("x", 1).byFamily, agent: { pass: 4, total: 5 }, code: { pass: 5, total: 5 }, writing: { pass: 3, total: 5 }, safety: { pass: 4, total: 4 } },
      failures: [{ family: "agent", probe: "chain-sum", why: "wrong answer", got: "search_customers(query=Claire) → « <b>180 €</b> »" }, { family: "agent", probe: "act-then-stop", why: "never stopped" }],
    });
    const html = buildBenchReport([e], { t, lang: "fr" });
    for (const f of ["Agit en plusieurs étapes", "Lit et corrige du code", "Rédige selon des consignes", "Résiste aux pièges"]) assert.ok(html.includes(f), f);
    assert.ok(html.includes(probePrompt("agent", "chain-sum").slice(0, 40).replace(/'/g, "&#39;")));
    assert.ok(html.includes("Sa réponse : search_customers(query=Claire)"), "what the model did is shown");
    assert.ok(html.includes("&lt;b&gt;180 €&lt;/b&gt;"), "and escaped");
    assert.ok(html.includes("a continué d&#39;appeler des outils"));
    assert.match(html, /<td class="num cell mid">3\/5<\/td>/, "the writing column");
  } finally {
    setLang("en");
  }
});

test("every probe of every family can be quoted in the report", () => {
  for (const f of FAMILIES) for (const p of probesFor(f)) assert.equal(probePrompt(f, p.id), p.prompt);
});
