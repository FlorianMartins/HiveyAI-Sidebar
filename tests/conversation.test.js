// A chat turn around the agent loop (lib/conversation.js): the budget is the model's real window,
// the conversation is summarized at three quarters of it, a "does not fit" refusal is answered with
// a summary and the question again, a cut reply is continued — hivey-vscode's rules and thresholds.

import test from "node:test";
import assert from "node:assert/strict";
import {
  contextBudget, shouldAutoCompact, contextOverflow, windowOfEntry, catalogWindow, estimateTokens,
  compactHistory, runChatTurn, contextWindowFor, CONTEXT_FLOOR_TOKENS,
} from "../src/lib/conversation.js";
import { detectUserLanguage } from "../src/lib/user-language.js";
import { buildSystemPrompt } from "../src/lib/agent.js";

/** A provider that answers from a script: each item is a reply, an Error to throw, or a function of the request. */
function scripted(replies) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async runTurn(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const r = replies[i++];
      if (r instanceof Error) throw r;
      const v = typeof r === "function" ? r(req) : r;
      const text = typeof v === "string" ? v : v.text;
      return { message: { role: "assistant", content: text }, toolCalls: [], text, stopReason: "stop", ...(v && v.interrupted ? { interrupted: true } : {}) };
    },
    formatToolResults: (rs) => rs.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.content })),
  };
}
const SETTINGS = { provider: "custom", models: { custom: "m" }, baseUrls: { custom: "http://127.0.0.1:9/v1" }, compressHistory: true };

test("the budget is the model's window less a twentieth (never less than one answer); the floor when unknown", () => {
  assert.equal(contextBudget(0), CONTEXT_FLOOR_TOKENS);
  assert.equal(contextBudget(69632), 69632 - 4000);
  assert.equal(contextBudget(1000000), 950000);
  assert.equal(contextBudget(8192), 8000, "a small window keeps the floor");
});

test("summarized by itself at three quarters of the budget, never under 6 000 tokens or 4 exchanges", () => {
  assert.equal(shouldAutoCompact(50000, 65632, 6), true);
  assert.equal(shouldAutoCompact(40000, 65632, 6), false);
  assert.equal(shouldAutoCompact(5000, 6000, 10), false, "too small to be worth it");
  assert.equal(shouldAutoCompact(60000, 65632, 3), false, "two exchanges cannot be summarized into fewer");
  // The old trigger — 28 000 characters, about 7 000 tokens — fired on every model alike.
  assert.equal(shouldAutoCompact(7000, contextBudget(1000000), 8), false, "a million-token model is not summarized after a few exchanges");
});

test("the server's refusal is recognised, and the window it names learned", () => {
  assert.deepEqual(contextOverflow("request (69882 tokens) exceeds the available context size (69632 tokens)"), { window: 69632 });
  assert.deepEqual(contextOverflow("This model's maximum context length is 128000 tokens. However, your messages resulted in 130000"), { window: 128000 });
  assert.equal(contextOverflow("HTTP 401 — invalid key"), undefined);
});

test("a model's window: the catalogue for the clouds, the server's own /models for a self-hosted one", async () => {
  assert.ok(catalogWindow("openrouter", "anthropic/claude-opus-5.5") >= 200000);
  assert.ok(catalogWindow("anthropic", "claude-opus-4-5") > 0, "a native id is read in the catalogue's spelling");
  assert.equal(windowOfEntry({ id: "qwen-27b", meta: { n_ctx: 69632 } }), 69632);
  assert.equal(windowOfEntry({ id: "x", context_length: 32768 }), 32768);
  const fake = async () => new Response(JSON.stringify({ data: [{ id: "qwen-27b", context_length: 69632, meta: { n_ctx: 69632 } }] }), { status: 200 });
  assert.equal(await contextWindowFor({ ...SETTINGS, baseUrls: { custom: "http://gw.example/v1" } }, "custom", "qwen-27b", fake), 69632);
});

test("the summary replaces what came before the question, keeps pinned messages word for word, and the question stays", async () => {
  const history = [
    { role: "user", content: "Le projet s'appelle Orion, budget 12 400 €." },
    { role: "assistant", content: "Noté." },
    { role: "user", content: "Garde ceci", _pinned: true },
    { role: "assistant", content: "OK" },
    { role: "user", content: "La question" },
  ];
  const p = scripted(["- Projet Orion, budget 12 400 €"]);
  assert.equal(await compactHistory(history, { provider: p, keepFrom: 4 }), true);
  assert.equal(history.length, 1);
  assert.match(history[0].content, /Orion, budget 12 400 €[\s\S]*Pinned by the user[\s\S]*Garde ceci[\s\S]*La question$/);
  assert.equal(p.seen[0].chore, true, "a side task: thinking off on the user's own server");
});

test("a batch of tool results is never where the kept part starts", async () => {
  const history = [
    { role: "user", content: "Q1" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_page", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "page" }] },
    { role: "assistant", content: "done" },
    { role: "user", content: "Q2" },
  ];
  await compactHistory(history, { provider: scripted(["sum"]), keepFrom: 2 });
  assert.equal(history.length, 5, "nothing before Q1 to summarize: the kept part may not start on tool results");
});

test("a turn that no longer fits is summarized and asked again — the question, not the summary of it", async () => {
  const history = [
    { role: "user", content: "a".repeat(400) }, { role: "assistant", content: "b" },
    { role: "user", content: "c".repeat(400) }, { role: "assistant", content: "d" },
    { role: "user", content: "La vraie question" },
  ];
  const p = scripted([new Error("HTTP 400 — request (70100 tokens) exceeds the available context size (69632 tokens)"), "résumé", "réponse"]);
  const r = await runChatTurn({ provider: p, providerId: "custom", modelId: "m-overflow", settings: SETTINGS, system: "", history, window: 69632, turnStart: 4 });
  assert.equal(r.text, "réponse");
  assert.equal(r.compacted, true);
  assert.match(p.seen[2].history.at(-1).content, /La vraie question$/);
});

test("a reply whose stream was cut is continued, and the two parts are one answer", async () => {
  const history = [{ role: "user", content: "Explique" }];
  const p = scripted([{ text: "Première moitié, ", interrupted: true }, "seconde moitié."]);
  const r = await runChatTurn({ provider: p, providerId: "custom", modelId: "m", settings: SETTINGS, system: "", history, window: 69632 });
  assert.equal(r.text, "Première moitié, seconde moitié.");
  assert.match(p.seen[1].history.at(-1).content, /interrupted before you finished/);
});

test("nothing is summarized while the conversation fits", async () => {
  const history = [];
  for (let i = 0; i < 6; i++) history.push({ role: "user", content: "q".repeat(4000) }, { role: "assistant", content: "r" });
  history.push({ role: "user", content: "last" });
  const p = scripted(["ok"]);
  const r = await runChatTurn({ provider: p, providerId: "custom", modelId: "m", settings: SETTINGS, system: "", history, window: 200000, turnStart: history.length - 1 });
  assert.equal(r.compacted, false);
  assert.equal(p.seen.length, 1);
  assert.ok(estimateTokens(history) > 6000);
});

// ── The reply language (hivey-vscode, tests/userLanguage.test.ts) ─────────────────────────────

test("each common language is recognised from an ordinary request", () => {
  const samples = [
    ["fr", "Est-ce que tu peux corriger le calcul de la remise dans le panier de la page de commande ?"],
    ["en", "Can you fix the discount calculation in the cart, please? It should not go below zero."],
    ["es", "¿Puedes corregir el cálculo del descuento en el carrito, por favor? Gracias."],
    ["de", "Kannst du bitte die Berechnung des Rabatts im Warenkorb korrigieren? Danke, das ist nicht richtig."],
    ["it", "Puoi correggere il calcolo dello sconto nel carrello per favore? Grazie, non è giusto."],
    ["pt", "Você pode corrigir o cálculo do desconto no carrinho, por favor? Obrigado, não está certo."],
  ];
  for (const [lang, text] of samples) assert.equal(detectUserLanguage(text, "en"), lang, text);
});

test("the prompt names the user's language and says it in their own words; a fixed language wins", () => {
  const es = buildSystemPrompt({ agentMode: false, responseLang: "Auto", mode: "chat", replyLanguage: "es" });
  assert.match(es, /The user writes in Spanish[\s\S]*Responde en español/);
  const fixed = buildSystemPrompt({ agentMode: false, responseLang: "German", mode: "chat", replyLanguage: "es" });
  assert.match(fixed, /in German/);
  assert.doesNotMatch(fixed, /Responde en español/);
});

test("no prompt asks the model to write its reasoning in <think> tags any more", () => {
  for (const thinkLevel of ["off", "high", "max", "medium"]) {
    for (const agentMode of [false, true]) {
      assert.doesNotMatch(buildSystemPrompt({ agentMode, responseLang: "Auto", mode: "chat", thinkLevel }), /THINKING PROTOCOL/);
    }
  }
});
