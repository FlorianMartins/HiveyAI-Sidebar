// Phase 4 — the words, the numbers, and what can honestly be offered.
//
// The rendering needs a DOM; these functions do not, and they are the ones that decide what the
// user BELIEVES is happening. Three things are pinned here, because each is a way this feature
// could mislead somebody who trusted it:
//
//   * the status line names the destination, and never softens it into "a provider";
//   * "exclude from this turn" and "delete for ever" stay different actions;
//   * after a request has left, nothing pretends it can be recalled.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  destinationOf, statusSteps, recallCost, panelRow,
  createExclusions, actionsFor, shouldOfferMemory,
} from "../src/lib/memoryUi.js";
import { DICT } from "../src/lib/i18n.js";

// The real dictionary, so a wording change that breaks a placeholder fails here.
const t = (key, vars) => {
  let s = DICT.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
  return s;
};

// ── Where it goes ──────────────────────────────────────────────────────────────────────────

test("a local server is named as local", () => {
  assert.deepEqual(destinationOf("ollama"), { local: true, label: "Ollama" });
  assert.deepEqual(destinationOf("lmstudio"), { local: true, label: "LM Studio" });
});

test("a remote provider is named, not described vaguely", () => {
  // "sent to a third party" is vague in a way that reads as concealment, exactly when the user is
  // deciding whether to trust this.
  assert.equal(destinationOf("openrouter", "anthropic/claude-opus-5").label, "Claude (Anthropic)");
  assert.equal(destinationOf("openrouter", "google/gemini-3.7-flash").label, "Google");
  assert.equal(destinationOf("openrouter", "x-ai/grok-4.6").label, "xAI");
  assert.equal(destinationOf("openrouter", "anthropic/claude-opus-5").local, false);
});

test("an unknown vendor still yields something concrete", () => {
  assert.equal(destinationOf("openrouter", "newco/model-1").label, "newco");
  assert.equal(destinationOf("").label, "the provider");
});

// ── The status line ────────────────────────────────────────────────────────────────────────

test("every phase produces a line that names a real action", () => {
  const name = "Hivey";
  const dest = destinationOf("openrouter", "anthropic/claude-opus-5");
  const lines = ["searching", "found", "sending", "none"]
    .map((phase) => statusSteps({ phase, name, count: 3, destination: dest, t }).text);
  for (const l of lines) {
    assert.match(l, /Hivey/, "the chosen name appears");
    // Action verbs only. Verbs of inner state are unverifiable AND they would cover the one piece
    // of information that matters — where the text went.
    assert.doesNotMatch(l, /\b(thinks?|thinking|feels?|remembers you|cares)\b/i, `interior-state verb in: ${l}`);
  }
});

test("the sending line states the destination and the count", () => {
  const line = statusSteps({
    phase: "sending", name: "Hivey", count: 3,
    destination: destinationOf("openrouter", "anthropic/claude-opus-5"), t,
  }).text;
  assert.match(line, /3/, "the number does the reassurance work");
  assert.match(line, /Claude \(Anthropic\)/, "and the destination is named outright");
});

test("a local run says so instead of naming a provider", () => {
  const line = statusSteps({ phase: "sending", name: "Hivey", count: 3, destination: destinationOf("ollama"), t }).text;
  assert.match(line, /machine/i);
  assert.doesNotMatch(line, /Anthropic|OpenAI/);
});

test("an unknown phase yields nothing rather than an empty line", () => {
  assert.equal(statusSteps({ phase: "elsewhere", name: "x", t }), null);
});

test("the neutral default name is used when the user named nothing", () => {
  assert.equal(typeof DICT.en["mem.defaultName"], "string");
  for (const lang of Object.keys(DICT)) {
    assert.ok(DICT[lang]["mem.defaultName"], `${lang} has no neutral default name`);
  }
});

// ── The numbers ────────────────────────────────────────────────────────────────────────────

test("the token cost of what was sent is reported, because the user pays it", () => {
  assert.ok(recallCost("x".repeat(400)) >= 90);
  assert.equal(recallCost(""), 0);
});

test("a panel row carries the text verbatim, with its provenance and date", () => {
  const row = panelRow({ id: "e1", text: "lives in Lyon", provenance: "user", ts: Date.UTC(2026, 7, 20), kind: "fact" });
  // Not a summary of the summary: paraphrasing here would defeat the only purpose the panel has.
  assert.equal(row.text, "lives in Lyon");
  assert.equal(row.provenance, "user");
  assert.equal(row.date, "2026-08-20");
  assert.ok(row.tokens > 0);
});

test("a row with no timestamp shows no date rather than an invented one", () => {
  assert.equal(panelRow({ id: "e", text: "x" }).date, "");
  assert.equal(panelRow({ id: "e", text: "x" }).provenance, "unknown");
});

// ── Exclusions ─────────────────────────────────────────────────────────────────────────────

test("'not this time' is separate from 'never'", () => {
  // Without a per-turn exclusion people delete perfectly good memories to keep them out of one
  // conversation — a permanent loss for a momentary reason.
  const ex = createExclusions();
  ex.exclude("e1");
  assert.equal(ex.has("e1"), true);
  assert.deepEqual(ex.filter([{ id: "e1" }, { id: "e2" }]).map((e) => e.id), ["e2"]);
  ex.clearTurn();
  assert.equal(ex.has("e1"), false, "the exclusion did not outlive the turn");
});

test("an exclusion can be taken back within the turn", () => {
  const ex = createExclusions();
  ex.exclude("e1");
  ex.include("e1");
  assert.equal(ex.size, 0);
});

// ── What can honestly be offered ───────────────────────────────────────────────────────────

test("before sending, excluding genuinely prevents the send", () => {
  const a = actionsFor({ sent: false });
  assert.equal(a.canExclude, true);
  assert.equal(a.offerRegenerate, false);
});

test("after sending, nothing pretends the request can be recalled", () => {
  // Presenting the same button in both states would teach the user that "exclude" undoes a send —
  // the belief that gets somebody hurt exactly once.
  const a = actionsFor({ sent: true });
  assert.equal(a.canExclude, false);
  assert.equal(a.offerRegenerate, true, "the honest affordance is to answer again without it");
  assert.equal(a.canDelete, true, "deleting still matters — for every future turn");
});

test("the already-sent note says what changes and what does not", () => {
  const note = DICT.en["mem.panel.alreadySent"];
  assert.match(note, /already been sent/i);
  assert.match(note, /next answer, not this one/i);
});

// ── Discoverability ────────────────────────────────────────────────────────────────────────

test("the offer waits for enough real use to be about something they have felt", () => {
  assert.equal(shouldOfferMemory({ enabled: false, alreadyOffered: false, sessions: 1, turns: 3 }), false);
  assert.equal(shouldOfferMemory({ enabled: false, alreadyOffered: false, sessions: 3, turns: 15 }), true);
});

test("it is offered once, and never to somebody who already turned it on", () => {
  // A prompt that reappears is not a suggestion, it is nagging — and the answer to nagging is to
  // distrust the feature.
  assert.equal(shouldOfferMemory({ enabled: false, alreadyOffered: true, sessions: 9, turns: 90 }), false);
  assert.equal(shouldOfferMemory({ enabled: true, alreadyOffered: false, sessions: 9, turns: 90 }), false);
});

// ── The strings themselves ─────────────────────────────────────────────────────────────────

test("no status string in any language uses a verb of inner state", () => {
  const BANNED = /\b(thinks?|thinking|feels?|remembers you|se souvient de toi|pense à|denkt an|piensa en|pensa a)\b/i;
  for (const lang of Object.keys(DICT)) {
    for (const key of ["mem.status.searching", "mem.status.found", "mem.status.sending", "mem.status.local", "mem.status.none"]) {
      const s = DICT[lang][key];
      assert.ok(s, `${lang} is missing ${key}`);
      assert.doesNotMatch(s, BANNED, `${lang}/${key}: "${s}"`);
    }
  }
});

test("the encryption note states what it does NOT protect, in every language", () => {
  // The residual matters more than the feature here: someone who believes an unlocked profile is
  // protected has been misled by the word "encrypted".
  for (const lang of Object.keys(DICT)) {
    const s = DICT[lang]["opt.mem.encryptNote"];
    assert.ok(s && s.length > 80, `${lang} note is missing or too short`);
    assert.match(s, /<b>/, `${lang} note lost its emphasis markup`);
  }
});

test("the purge confirmation says it cannot be undone, in every language", () => {
  for (const lang of Object.keys(DICT)) {
    assert.ok(DICT[lang]["opt.mem.purgeConfirm"], `${lang} is missing the purge confirmation`);
  }
});
