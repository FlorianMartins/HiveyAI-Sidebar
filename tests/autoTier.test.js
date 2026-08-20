// Tests for the auto-tiering DECISION logic.
//
// The measuring half needs the network and costs money; the deciding half is pure, and it is the
// half that can quietly do damage — promote a model that cannot call tools, triple the bill of a
// tier advertised as cheap, or churn the assignment nightly on differences that are noise. Those
// are the rules pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES, passesGates, withinBudget, shortlist, decidePromotion } from "../scripts/auto-tier.mjs";

const model = (over = {}) => ({
  id: "vendor/model-1",
  created: 1_700_000_000,
  context_length: 128_000,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "temperature"],
  pricing: { prompt: "0.000001", completion: "0.000003" },
  ...over,
});

// ── Capability gates ───────────────────────────────────────────────────────────────────────

test("every role declares a category that the curated index can be asked for", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    assert.ok(spec.category, `${role} has no category`);
  }
});

test("the agent role refuses a model that cannot call tools", () => {
  assert.equal(passesGates(model(), "agent"), true);
  assert.equal(passesGates(model({ supported_parameters: ["temperature"] }), "agent"), false);
});

test("the image role requires image OUTPUT, the vision role image INPUT", () => {
  const imageOut = model({ architecture: { input_modalities: ["text"], output_modalities: ["image"] } });
  const imageIn = model({ architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } });
  assert.equal(passesGates(imageOut, "image"), true);
  assert.equal(passesGates(imageIn, "image"), false);
  assert.equal(passesGates(imageIn, "vision"), true);
  assert.equal(passesGates(imageOut, "vision"), false);
});

test("a text role refuses a model that cannot produce text", () => {
  const imageOnly = model({ architecture: { input_modalities: ["text"], output_modalities: ["image"] } });
  assert.equal(passesGates(imageOnly, "chat"), false);
});

test("a context window smaller than the role needs disqualifies the model", () => {
  assert.equal(passesGates(model({ context_length: 4_000 }), "agent"), false);
  assert.equal(passesGates(model({ context_length: 4_000 }), "router"), false);
  assert.equal(passesGates(model({ context_length: 8_000 }), "router"), true);
});

test("moving aliases and non-shippable SKUs are never eligible", () => {
  for (const id of ["~vendor/model-latest", "vendor/model-preview", "vendor/model:batch", "vendor/model-exp", "vendor/model-20260420"]) {
    assert.equal(passesGates(model({ id }), "chat"), false, `${id} should be excluded`);
  }
});

test("an unknown role is refused rather than defaulted", () => {
  assert.equal(passesGates(model(), "nonexistent-role"), false);
});

// ── The price envelope ─────────────────────────────────────────────────────────────────────

test("a free tier stays exactly free — a cheap paid model is not close enough", () => {
  assert.equal(withinBudget(0, 0), true);
  assert.equal(withinBudget(0, 0.01), false, "Free must never start billing");
});

test("a paid tier tolerates a moderate rise, not a multiplication", () => {
  assert.equal(withinBudget(3, 4.5), true);
  assert.equal(withinBudget(3, 4.51), false);
  assert.equal(withinBudget(75, 100), true, "Pro may stay expensive");
});

// ── Shortlisting ───────────────────────────────────────────────────────────────────────────

const pool = [
  model({ id: "anthropic/claude-opus-5", created: 1_700_000_000 }),
  model({ id: "unknown-vendor/brand-new-model", created: 1_800_000_000 }),
  model({ id: "anthropic/claude-haiku-4.5", created: 1_650_000_000 }),
  model({ id: "vendor/incumbent", created: 1_600_000_000 }),
  model({ id: "~vendor/alias-latest", created: 1_900_000_000 }),
];

test("the shortlist is bounded and never contains a moving alias", () => {
  // The bound is: `size` slots ranked by the prior, plus ONE reserved for the newest eligible
  // model, plus the incumbent when it would not otherwise rank. Bounded, because every entry
  // costs real calls against a rate-limited API.
  const out = shortlist(pool, "chat", null, { size: 3, newest: 1_900_000_000 });
  assert.ok(out.length <= 4, `expected at most size+1, got ${out.length}`);
  assert.ok(out.length >= 3);
  assert.ok(out.every((m) => !m.id.startsWith("~")), "a moving alias is not a stable id to commit");
  assert.equal(new Set(out.map((m) => m.id)).size, out.length, "no duplicates");
});

test("with the incumbent outside the ranking, the list grows by exactly one more", () => {
  const out = shortlist(pool, "chat", "vendor/incumbent", { size: 2, newest: 1_900_000_000 });
  assert.ok(out.length <= 4);
  assert.ok(out.some((m) => m.id === "vendor/incumbent"));
});

test("a brand-new model the curated index has never heard of still reaches the shortlist", () => {
  // The whole failure this guards: the hand-written index scored the best free coder at 62 and a
  // worse one at 60. If recency did not lift newcomers, the bench would never get to speak.
  const out = shortlist(pool, "code", null, { size: 2, newest: 1_900_000_000 });
  assert.ok(out.some((m) => m.id === "unknown-vendor/brand-new-model"),
    "a newcomer must be measurable, not filtered out by a table that predates it");
});

test("the incumbent is always measured, even when the prior would exclude it", () => {
  const out = shortlist(pool, "chat", "vendor/incumbent", { size: 2, newest: 1_900_000_000 });
  assert.ok(out.some((m) => m.id === "vendor/incumbent"),
    "comparing a fresh challenger against a stale recorded score compares the weather");
});

test("the incumbent is not added twice when it already ranks", () => {
  const out = shortlist(pool, "chat", "anthropic/claude-opus-5", { size: 3, newest: 1_900_000_000 });
  assert.equal(out.filter((m) => m.id === "anthropic/claude-opus-5").length, 1);
});

test("shortlisting for a role nothing can satisfy returns nothing rather than guessing", () => {
  const textOnly = pool.map((m) => ({ ...m, architecture: { input_modalities: ["text"], output_modalities: ["text"] } }));
  assert.deepEqual(shortlist(textOnly, "image", null, { size: 3, newest: 1 }), []);
});

// ── Promotion ──────────────────────────────────────────────────────────────────────────────

const inc = { id: "vendor/incumbent", score: 0.70, price: 3, ms: 1000 };

test("a clear win promotes", () => {
  const d = decidePromotion(inc, [inc, { id: "vendor/better", score: 0.95, price: 3, ms: 900 }]);
  assert.equal(d.promote, true);
  assert.equal(d.to.id, "vendor/better");
});

test("a hair's-breadth win does NOT promote", () => {
  // These models are not deterministic; a 2-point difference is noise, and swapping the model
  // nightly makes the product feel different for a reason the user cannot see.
  const d = decidePromotion(inc, [inc, { id: "vendor/marginal", score: 0.72, price: 3, ms: 900 }]);
  assert.equal(d.promote, false);
  assert.match(d.reason, /margin/);
});

test("a better model that breaks the price envelope is refused, and says why", () => {
  const d = decidePromotion(inc, [inc, { id: "vendor/lavish", score: 1, price: 30, ms: 900 }]);
  assert.equal(d.promote, false);
  assert.match(d.reason, /budget/);
});

test("a tie leaves the job with whoever already holds it", () => {
  const d = decidePromotion(inc, [inc, { id: "vendor/equal", score: 0.70, price: 3, ms: 10 }]);
  assert.equal(d.promote, false);
});

test("among equals, the faster model wins the shortlist ordering", () => {
  const d = decidePromotion(inc, [
    inc,
    { id: "vendor/slow", score: 0.95, price: 3, ms: 5000 },
    { id: "vendor/fast", score: 0.95, price: 3, ms: 500 },
  ]);
  assert.equal(d.to.id, "vendor/fast");
});

test("a model that could not be measured is ignored rather than scored zero", () => {
  const d = decidePromotion(inc, [inc, { id: "vendor/unmeasured", score: null, price: 3, ms: 0 }]);
  assert.equal(d.promote, false);
  assert.match(d.reason, /incumbent still best/);
});

test("an incumbent that scored 0 can still be replaced — that is the broken-tier case", () => {
  // Exactly what a dead model id looks like once it is measured: it answers nothing.
  const dead = { id: "vendor/gone", score: 0, price: 0, ms: 0 };
  const d = decidePromotion(dead, [dead, { id: "vendor/alive", score: 0.9, price: 0, ms: 800 }]);
  assert.equal(d.promote, true);
  assert.equal(d.to.id, "vendor/alive");
});

test("the price envelope filters BEFORE anything is measured, not after", () => {
  // Caught by a real dry run: the free variant shortlisted Opus and GLM, spent $0.016 measuring
  // them, then discarded both for being paid. Money spent to learn what the catalogue knew.
  const mixed = [
    model({ id: "free/one", pricing: { prompt: "0", completion: "0" } }),
    model({ id: "free/two", pricing: { prompt: "0", completion: "0" }, created: 1_750_000_000 }),
    model({ id: "anthropic/claude-opus-5", pricing: { prompt: "0.000015", completion: "0.000075" } }),
  ];
  const out = shortlist(mixed, "chat", null, { size: 3, newest: 1_800_000_000, incumbentPrice: 0 });
  assert.ok(out.every((m) => +m.pricing.completion === 0), "a free tier may only shortlist free models");
  assert.ok(out.length >= 2);
});

test("without an incumbent price, nothing is filtered on price", () => {
  const mixed = [model({ id: "a/b" }), model({ id: "c/d", pricing: { prompt: "1", completion: "1" } })];
  assert.equal(shortlist(mixed, "chat", null, { size: 5, newest: 1 }).length, 2);
});
