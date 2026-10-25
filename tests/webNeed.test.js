// With « Web » on, a search runs only when the request needs it (lib/web-need.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { webNeedRule, parseWebNeed } from "../src/lib/web-need.js";

test("clear cases are decided for free: time, prices, news, links, an explicit ask → search", () => {
  for (const q of ["Quel est le prix du bitcoin aujourd'hui ?", "Les dernières nouvelles sur l'IA", "Météo à Lyon demain",
    "Cherche sur le web les horaires du musée d'Orsay", "Résume https://example.org/article", "Who won the elections in 2026?",
    "What's the latest version of Node.js?"]) assert.equal(webNeedRule(q), "yes", q);
});

test("work on what is given never searches: write, translate, code, compute, rephrase, greet", () => {
  for (const q of ["Écris un haïku sur l'automne", "Traduis ce texte en anglais : bonjour", "Écris une fonction JS qui trie un tableau",
    "Calcule 17 × 23", "Reformule cette phrase plus poliment", "Merci !", "Explique ce code ci-dessous"]) assert.equal(webNeedRule(q), "no", q);
});

test("the rest is asked to a cheap model, whose one word decides", () => {
  assert.equal(webNeedRule("Quelle est la capitale de l'Australie ?"), "maybe");
  assert.equal(parseWebNeed("YES"), true);
  assert.equal(parseWebNeed("No."), false);
  assert.equal(parseWebNeed(""), false);
});
