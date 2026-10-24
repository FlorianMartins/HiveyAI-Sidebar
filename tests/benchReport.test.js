// The benchmark report (lib/bench-report.js): who to pick in one sentence, every family, every
// question missed — and nothing a model name or an error message could smuggle into the page.

import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchReport, rankEntries, scoreTone, probePrompt } from "../src/lib/bench-report.js";
import { normalizeMeasured } from "../src/lib/benchmarkView.js";
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

test("the report names the best model, a cheaper near-equal, and the questions missed", () => {
  setLang("fr");
  const html = buildBenchReport([entry("Grand modèle", 0.9, { cost: 0.05 }), entry("Petit modèle", 0.85, { cost: 0.001 })], { t, lang: "fr" });
  assert.match(html, /Meilleur : Grand modèle, 90 %/);
  assert.match(html, /moins cher : Petit modèle \(85 %\)/);
  assert.match(html, /<svg class="chart"/);
  assert.ok(html.includes(probePrompt("reason", "bat-and-ball").slice(0, 30)), "the missed question is quoted");
  assert.match(html, /Raisonnement/);
  assert.doesNotMatch(html, /<script/i, "the report runs nothing");
  setLang("en");
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
