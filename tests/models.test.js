// Tests for the Hivey routing layer.
//
// This is the code that decides WHICH model answers, so a silent mistake here is invisible in
// the UI and shows up only as "Hivey feels worse than picking a model myself". The bench in
// scripts/bench-hivey.mjs measures whether the dispatcher CLASSIFIES correctly; these tests
// check that the classification is then actually USED — which for four of the eight categories
// it was not.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HIVEY_VARIANTS, HIVEY_ROUTER_SYSTEM, isHivey, hiveyVariant, hiveyTiers,
  hiveyTierFor, hiveyTierForLabel, hiveyRouterModel,
} from "../src/lib/models.js";
import { HIVEY_MODELS } from "../src/lib/hivey-models.js";

// A tier value is "<providerId>|<modelId>" (orTiers prefixes the provider it must be sent to);
// the bare model id is what the API sees.
const bare = (v) => String(v).split("|").pop();

// The categories the dispatcher prompt tells the model to choose from. Parsed from the prompt
// itself so the test cannot drift from what the model is actually asked.
const CATEGORIES = (() => {
  const m = /Output ONLY one of: ([^.]+)\./.exec(HIVEY_ROUTER_SYSTEM);
  assert.ok(m, "the dispatcher prompt must state its allowed outputs");
  return m[1].split(",").map((s) => s.trim());
})();

test("the dispatcher offers the eight categories the router is scored on", () => {
  assert.deepEqual(CATEGORIES, ["light", "normal", "code", "test", "math", "search", "creative", "hard"]);
});

test("EVERY category the dispatcher can emit maps to a real model", () => {
  for (const variant of Object.keys(HIVEY_VARIANTS)) {
    for (const cat of CATEGORIES) {
      const model = hiveyTierForLabel(variant, cat);
      assert.ok(model && typeof model === "string", `${variant}/${cat} resolved to nothing`);
      assert.match(bare(model), /^[a-z0-9~._-]+\/[A-Za-z0-9.:_-]+$/, `${variant}/${cat} is not a model id: ${model}`);
    }
  }
});

test("a category with a dedicated model is not silently downgraded to chat", () => {
  // The regression this pins: "test", "math", "search" and "creative" all used to fall through
  // to T.chat, so the models configured for them were dead weight in every variant.
  for (const variant of Object.keys(HIVEY_VARIANTS)) {
    const T = hiveyTiers(variant);
    for (const cat of ["test", "math", "search", "creative", "code", "hard"]) {
      const expected = cat === "hard" ? T.reasoning : T[cat];
      if (!expected || expected === T.chat) continue; // nothing dedicated to lose
      assert.equal(hiveyTierForLabel(variant, cat), expected,
        `${variant}: "${cat}" must reach its own model, not the chat one`);
    }
  }
});

test("an unknown or empty router answer falls back to chat rather than crashing", () => {
  const T = hiveyTiers("hivey/smart");
  for (const junk of ["", null, undefined, "banana", "NORMAL", "  normal  ", "🤖"]) {
    assert.equal(hiveyTierForLabel("hivey/smart", junk), T.chat);
  }
});

test("the router word is matched case- and punctuation-insensitively", () => {
  const T = hiveyTiers("hivey/smart");
  for (const said of ["code", "Code", "CODE.", " code\n", "code!"]) {
    assert.equal(hiveyTierForLabel("hivey/smart", said), T.code);
  }
});

test("isHivey recognises the variants and rejects real model ids", () => {
  assert.equal(isHivey("hivey/smart"), true);
  assert.equal(isHivey("anthropic/claude-opus-5"), false);
  assert.equal(isHivey(""), false);
  assert.equal(isHivey(null), false);
});

test("an unknown hivey/* id resolves to a variant instead of being sent to the API raw", () => {
  // A stale id must never reach OpenRouter — "hivey/…" is not a model and answers HTTP 400.
  const v = hiveyVariant("hivey/does-not-exist");
  assert.ok(v && v.tiers, "an unknown variant still resolves");
  assert.ok(Object.values(v.tiers).every((m) => !String(m).startsWith("hivey/")),
    "no tier may point back at a hivey/* pseudo-model");
});

test("no tier anywhere points at another hivey/* pseudo-model", () => {
  for (const [variant, roles] of Object.entries(HIVEY_MODELS)) {
    for (const [role, id] of Object.entries(roles)) {
      assert.doesNotMatch(id, /^hivey\//, `${variant}.${role} would recurse`);
    }
  }
});

test("the heuristic fallback routes obvious prompts without the dispatcher", () => {
  const T = hiveyTiers("hivey/smart");
  assert.equal(hiveyTierFor("hivey/smart", "chat", "écris une fonction javascript"), T.code);
  assert.equal(hiveyTierFor("hivey/smart", "chat", "analyse la sécurité de ce système"), T.reasoning);
  assert.equal(hiveyTierFor("hivey/smart", "chat", "bonjour"), T.chat);
  assert.equal(hiveyTierFor("hivey/smart", "image", "n'importe quoi"), T.image);
  assert.equal(hiveyTierFor("hivey/smart", "agent", "n'importe quoi"), T.agent);
  assert.equal(hiveyTierFor("hivey/smart", "translate", "x"), T.utility);
});

test("a very long prompt is treated as deep work even without keywords", () => {
  const T = hiveyTiers("hivey/smart");
  assert.equal(hiveyTierFor("hivey/smart", "chat", "a".repeat(2000)), T.reasoning);
});

test("the router model is defined for every variant and is never a hivey/* id", () => {
  for (const variant of Object.keys(HIVEY_VARIANTS)) {
    const m = hiveyRouterModel(variant);
    assert.ok(m, `${variant} has no router model`);
    assert.doesNotMatch(bare(m), /^hivey\//);
  }
});

test("the free variant is entirely free — a paid id there would bill a user who chose Free", () => {
  for (const [role, id] of Object.entries(HIVEY_MODELS["hivey/free"])) {
    // The image role is the documented exception: no free image model exists on the catalogue.
    if (role === "image") continue;
    assert.match(id, /:free$/, `hivey/free.${role} = ${id} is NOT a free model`);
  }
});

test("every variant defines every role, so no lookup can return undefined", () => {
  const roles = Object.keys(HIVEY_MODELS["hivey/smart"]);
  for (const [variant, map] of Object.entries(HIVEY_MODELS)) {
    for (const r of roles) assert.ok(map[r], `${variant} is missing the "${r}" role`);
  }
});
