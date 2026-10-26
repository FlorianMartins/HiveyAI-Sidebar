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
  for (const q of ["Qui est le PDG de Mistral AI ?", "Qu'est-ce que Hivey ?", "Give one real-world example for each of them"])
    assert.equal(webNeedRule(q), "maybe", q);
  assert.equal(parseWebNeed("YES"), true);
  assert.equal(parseWebNeed("No."), false);
  assert.equal(parseWebNeed(""), false);
});

test("general knowledge that does not change is answered without the paid yes/no question", () => {
  for (const q of ["What are the main differences between TCP and UDP?", "Quelle est la différence entre TCP et UDP ?",
    "Comment fonctionne un moteur diesel ?", "How does HTTPS work?", "Qu'est-ce qu'un trou noir ?", "Qu'est-ce que la photosynthèse ?",
    "What is a monad?", "Explique-moi comment marche la photosynthèse", "Quelle est la capitale de l'Australie ?",
    "Wie funktioniert ein Kühlschrank?", "¿Cuál es la diferencia entre RAM y ROM?"]) assert.equal(webNeedRule(q), "no", q);
});

test("a time cue or a place to go still searches, even in a general-knowledge question", () => {
  for (const q of ["Quelle est la différence entre l'iPhone 18 et le 17 sorti récemment ?", "What is the latest version of Python?",
    "What is a good restaurant in Lyon?", "Un bon bar près de chez moi", "Comment fonctionne la bourse aujourd'hui ?"])
    assert.equal(webNeedRule(q), "yes", q);
});
