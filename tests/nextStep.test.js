// The suggested next request, read from a small model's reply (hivey-vscode, tests/nextStep.test.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { nextStepMessages, parseNextStep } from "../src/lib/next-step.js";

test("the suggestion is one clean line, and NONE means nothing", () => {
  assert.equal(parseNextStep("Compare aussi les prix sur Amazon"), "Compare aussi les prix sur Amazon");
  assert.equal(parseNextStep('Next: "Check the reviews"\nbecause…'), "Check the reviews");
  assert.equal(parseNextStep("- Résume la deuxième page"), "Résume la deuxième page");
  assert.equal(parseNextStep("<think>hmm</think>\nTraduis-le en anglais"), "Traduis-le en anglais");
  assert.equal(parseNextStep("NONE"), undefined);
  assert.equal(parseNextStep("  \n"), undefined);
  assert.ok(parseNextStep("x".repeat(400)).length <= 140, "a composer line, not a paragraph");
});

test("the request carries the question, the answer and the language", () => {
  const m = nextStepMessages("Résume cette page", "Voici le résumé.", "fr");
  assert.match(m.system, /web browser/);
  assert.match(m.history[0].content, /Résume cette page/);
  assert.match(m.history[0].content, /in French/);
  assert.match(nextStepMessages("q", "a", "de").history[0].content, /in German/);
  assert.ok(nextStepMessages("q", "a".repeat(20000), "en").history[0].content.length < 7000, "a long answer is cut from the middle");
});
