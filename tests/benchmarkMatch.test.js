// Tests for joining a published leaderboard row to a live OpenRouter model id.
//
// This join is the one place in the Benchmark workspace that can lie. A missing score shows as a
// blank cell, which is honest; a WRONG score shows as a number, which is worse than nothing —
// somebody picks a model on it. The first version of this matcher attached Aider's "grok-4 (high)"
// result to `x-ai/grok-4.6`, a model released months later. These tests exist so that cannot
// happen again quietly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, versions, matchModel } from "../scripts/update-benchmarks.mjs";
import { BENCHMARK_WEB, BENCHMARK_SOURCES, BENCHMARK_UNCOVERED } from "../src/lib/benchmark-web.js";

const CATALOGUE = [
  "x-ai/grok-4", "x-ai/grok-4.6", "openai/gpt-5", "openai/gpt-5.6-luna",
  "anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "deepseek/deepseek-v3.2",
  "google/gemini-3.1-flash-lite", "qwen/qwen-2.5-coder-32b-instruct", "openai/o3",
];

// ── Normalising ────────────────────────────────────────────────────────────────────────────

test("a parenthesised configuration is not part of the model's identity", () => {
  assert.equal(normalise("grok-4 (high)"), normalise("grok-4"));
  assert.equal(normalise("DeepSeek-V3.2-Exp (Chat)"), normalise("deepseek-v3.2"));
});

test("free/beta suffixes and filler words are dropped", () => {
  assert.equal(normalise("qwen-2.5-coder-32b-instruct"), normalise("Qwen2.5-Coder-32B"));
  assert.equal(normalise("gemini-3.1-flash-lite-preview"), normalise("gemini-3.1-flash-lite"));
});

// ── Version identity ───────────────────────────────────────────────────────────────────────

test("the numbers in a name are extracted in order", () => {
  assert.equal(versions("grok4.6"), "4.6");
  assert.equal(versions("qwen2.5coder32b"), "2.5,32");
  assert.equal(versions("claudeopus"), "");
});

test("a model is NEVER joined to a different version of itself", () => {
  // The regression, named: Aider tested grok-4; the score must not land on grok-4.6.
  assert.equal(matchModel("grok-4 (high)", CATALOGUE), "x-ai/grok-4");
  assert.equal(matchModel("grok-4.6", CATALOGUE), "x-ai/grok-4.6");
  assert.equal(matchModel("gpt-5 (high)", CATALOGUE), "openai/gpt-5");
  assert.notEqual(matchModel("gpt-5 (high)", CATALOGUE), "openai/gpt-5.6-luna");
});

test("a version the catalogue does not carry matches nothing rather than the nearest", () => {
  assert.equal(matchModel("grok-4.2", CATALOGUE), null);
  assert.equal(matchModel("claude-opus-4.1", CATALOGUE), null);
});

// ── Matching ───────────────────────────────────────────────────────────────────────────────

test("a leaderboard name in human form joins its API id", () => {
  assert.equal(matchModel("DeepSeek-V3.2-Exp (Chat)", CATALOGUE), "deepseek/deepseek-v3.2");
  assert.equal(matchModel("Qwen2.5-Coder-32B-Instruct", CATALOGUE), "qwen/qwen-2.5-coder-32b-instruct");
});

test("a short name does not swallow a longer unrelated one", () => {
  // "o3" is a substring of a great many ids; the length guard is what stops it spreading.
  const out = matchModel("o3", CATALOGUE);
  assert.ok(out === "openai/o3" || out === null, `unexpected join: ${out}`);
});

test("an unknown model yields null, not a guess", () => {
  assert.equal(matchModel("SomeVendor MegaModel 9000", CATALOGUE), null);
  assert.equal(matchModel("", CATALOGUE), null);
  assert.equal(matchModel("x", CATALOGUE), null);
});

// ── The shipped data ───────────────────────────────────────────────────────────────────────

test("every harvested score is attached to a real catalogue-shaped id", () => {
  for (const id of Object.keys(BENCHMARK_WEB)) {
    assert.match(id, /^[a-z0-9._-]+\/[A-Za-z0-9.:_-]+$/, `${id} is not a model id`);
  }
});

test("every source states how fresh it actually is", () => {
  // The number people forget to ask for. A leaderboard can be updated daily and still cover
  // nothing released this year — which is the case for one of these two.
  for (const [key, s] of Object.entries(BENCHMARK_SOURCES)) {
    assert.ok(s.label && s.url && s.about, `${key} is missing its description`);
    assert.ok(s.total > 0, `${key} harvested nothing`);
    assert.ok(s.newestModelCovered, `${key} does not say how fresh it is`);
    assert.match(s.newestModelCovered, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("no source claims to cover more than it matched", () => {
  for (const [key, s] of Object.entries(BENCHMARK_SOURCES)) {
    assert.ok(s.matched <= s.total, `${key}: matched ${s.matched} of ${s.total}`);
  }
});

test("the uncovered list holds models no source scored — the gap the live test fills", () => {
  assert.ok(BENCHMARK_UNCOVERED.length > 0);
  for (const id of BENCHMARK_UNCOVERED) {
    assert.equal(BENCHMARK_WEB[id], undefined, `${id} is listed as uncovered but has a published score`);
  }
});

test("a published score is a plausible number, not a parsing accident", () => {
  for (const [id, v] of Object.entries(BENCHMARK_WEB)) {
    if (v.aider) {
      assert.ok(v.aider.pass >= 0 && v.aider.pass <= 100, `${id} aider pass ${v.aider.pass}`);
      assert.ok(v.aider.as, "the original leaderboard name must be kept, so a join can be audited");
    }
    if (v.vectara) {
      assert.ok(v.vectara.hallucination >= 0 && v.vectara.hallucination <= 100, `${id} hallucination`);
      assert.ok(v.vectara.as);
    }
  }
});
