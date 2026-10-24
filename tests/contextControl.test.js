// Context control (lib/context-control.js): an exchange in standby stays in the history and on
// screen and is not sent; a pinned one survives summaries word for word; a deleted one is gone.

import test from "node:test";
import assert from "node:assert/strict";
import { newTurnId, tagTurn, setTurnState, removeTurn, activeMessages, stripPrivate } from "../src/lib/context-control.js";
import { runConversation } from "../src/lib/agent.js";
import { compactHistory, estimateTokens } from "../src/lib/conversation.js";
import { makeProvider } from "../src/lib/providers.js";

const exchange = (id, q, a) => [{ role: "user", content: q, _turn: id }, { role: "assistant", content: a, _turn: id }];
function recorder(reply = "ok") {
  const seen = [];
  return {
    seen,
    async runTurn(req) { seen.push(JSON.parse(JSON.stringify(req.history))); const text = typeof reply === "function" ? reply(req) : reply; return { message: { role: "assistant", content: text }, toolCalls: [], text, stopReason: "stop" }; },
    formatToolResults: () => [],
  };
}

test("an exchange is tagged as one, put in standby, back, pinned, and deleted as one", () => {
  const h = [{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }];
  const id = newTurnId();
  tagTurn(h, 0, id);
  assert.ok(h.every((m) => m._turn === id));
  assert.equal(setTurnState(h, id, { muted: true }), 2);
  assert.deepEqual(activeMessages(h), []);
  setTurnState(h, id, { muted: false, pinned: true });
  assert.equal(activeMessages(h).length, 2);
  assert.ok(h.every((m) => m._pinned && !m._muted));
  assert.equal(removeTurn(h, id), 2);
  assert.equal(h.length, 0);
});

test("an exchange in standby is not sent, and is written back in place", async () => {
  const history = [...exchange("a", "Mauvaise piste : parle-moi des chats", "Les chats…"), ...exchange("b", "Le projet s'appelle Orion", "Noté"), { role: "user", content: "Quel est le nom du projet ?", _turn: "c" }];
  setTurnState(history, "a", { muted: true });
  const p = recorder("Orion");
  await runConversation({ provider: p, system: "S", history, tools: [] });
  assert.doesNotMatch(JSON.stringify(p.seen[0]), /chats/);
  assert.match(JSON.stringify(p.seen[0]), /Orion/);
  assert.equal(history.length, 6, "the standby exchange is still in the history, with the new answer");
  assert.ok(history[0]._muted && history[0].content.includes("chats"));
});

test("a summary leaves standby exchanges out of it — and in the history — and keeps pinned ones word for word", async () => {
  const history = [
    ...exchange("a", "Un vieux log de 3 000 lignes", "Analysé"),
    ...exchange("b", "La clé du client est le code PX-993", "Noté"),
    ...exchange("c", "Bavardage", "Oui"),
    { role: "user", content: "La question", _turn: "d" },
  ];
  setTurnState(history, "a", { muted: true });
  setTurnState(history, "b", { pinned: true });
  const p = recorder("- résumé");
  assert.equal(await compactHistory(history, { provider: p, keepFrom: 6 }), true);
  assert.doesNotMatch(JSON.stringify(p.seen[0]), /vieux log/, "standby is not summarized");
  assert.equal(history.filter((m) => m._muted).length, 2, "and not lost");
  const head = history.find((m) => !m._muted);
  assert.match(head.content, /Pinned by the user[\s\S]*PX-993/);
  assert.match(head.content, /La question$/);
});

test("« Résumer maintenant »: the whole conversation into one summary, standby kept aside", async () => {
  const history = [...exchange("a", "q1", "a1"), ...exchange("b", "q2", "a2")];
  setTurnState(history, "a", { muted: true });
  assert.equal(await compactHistory(history, { provider: recorder("- l'essentiel"), all: true }), true);
  const active = activeMessages(history);
  assert.equal(active.length, 2);
  assert.match(active[0].content, /l'essentiel/);
  assert.equal(active[1].role, "assistant");
  assert.equal(history.filter((m) => m._muted).length, 2);
});

test("the gauge counts what is sent: standby exchanges weigh nothing", () => {
  const h = [...exchange("a", "x".repeat(40000), "y"), ...exchange("b", "court", "court")];
  const before = estimateTokens(h);
  setTurnState(h, "a", { muted: true });
  assert.ok(estimateTokens(h) < before / 100);
});

test("no exchange id, flag or kept reasoning ever leaves the browser", async () => {
  assert.deepEqual(stripPrivate({ role: "user", content: "x", _turn: "a", _pinned: true }), { role: "user", content: "x" });
  const history = [{ role: "user", content: "q", _turn: "a", _pinned: true }, { role: "assistant", content: "r", _turn: "a", _reasoning: "pensée" }, { role: "user", content: "suite", _turn: "b" }];
  for (const provider of ["custom", "anthropic", "openai"]) {
    let body;
    const real = globalThis.fetch;
    globalThis.fetch = async (_u, o) => {
      body = o.body;
      const enc = new TextEncoder();
      const parts = provider === "anthropic" ? [{ type: "message_stop" }] : [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, "[DONE]"];
      return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); c.close(); } }));
    };
    try {
      await makeProvider({ provider, models: { [provider]: "m" }, keys: { [provider]: "k" }, baseUrls: { custom: "http://127.0.0.1:9/v1" }, privacyLevel: "off" }, {}).runTurn({ system: "", history, tools: [] });
    } finally { globalThis.fetch = real; }
    assert.doesNotMatch(body, /"_turn"|"_pinned"|"_reasoning"|"_muted"/, provider);
  }
});
