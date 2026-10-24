// The agent's brakes and housekeeping (lib/agent-guards.js): no step cap, the circles stopped
// instead — the rules of hivey-vscode's loop, on the browser tools.

import test from "node:test";
import assert from "node:assert/strict";
import { runConversation } from "../src/lib/agent.js";
import { repeatingTail, shrinkToolResults, toolResultChars, REPEATED_CALL, THOUGHT_LOOPING, CONCLUDE_REPEATING, repeatsSinceChange } from "../src/lib/agent-guards.js";

/**
 * A provider in the OpenAI wire format answering from a script. Each item: { calls: [[name, input]],
 * text, think, interrupted } or a function of the request. Records every request it received.
 */
function scripted(script, { onRequest } = {}) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async runTurn(req) {
      seen.push(JSON.parse(JSON.stringify({ history: req.history, tools: (req.tools || []).length, chore: !!req.chore })));
      if (onRequest) onRequest(req, seen.length);
      const item = typeof script === "function" ? script(req, i++) : script[i++] ?? { text: "fin" };
      if (item.think) {
        // A thought streamed in pieces; the guard may abort the step's signal in between.
        for (const piece of item.think) {
          if (req.signal && req.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
          req.onThink && req.onThink(piece);
        }
        if (req.signal && req.signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      }
      const calls = (item.calls || []).map(([name, input], k) => ({ id: `c${i}-${k}`, name, input }));
      const message = { role: "assistant", content: item.text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) };
      return { message, toolCalls: calls, text: item.text || "", stopReason: calls.length ? "tool_use" : "stop", ...(item.interrupted ? { interrupted: true } : {}) };
    },
    formatToolResults: (rs) => rs.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.content })),
  };
}
const TOOLS = ["read_page", "find_elements", "navigate", "click_element", "list_tabs"].map((name) => ({ name, description: name, input_schema: { type: "object" } }));
const lastUser = (req) => { const h = req.history; for (let k = h.length - 1; k >= 0; k--) if (h[k].role === "user" || h[k].role === "tool") return String(h[k].content); return ""; };

test("no step cap: a task of 40 different steps runs to its end", async () => {
  const p = scripted((req, i) => (i < 40 ? { calls: [["navigate", { url: `https://shop.example/p/${i}` }]] } : { text: "Total : 300" }));
  const r = await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "go" }], tools: TOOLS, execute: async () => ({ ok: true }) });
  assert.equal(r.done, true);
  assert.equal(r.text, "Total : 300");
  assert.equal(r.steps, 41);
});

test("the same read with nothing changed: the third is not run, and insisting ends the turn on a written conclusion", async () => {
  let ran = 0;
  const p = scripted((req, i) => (req.tools && req.tools.length ? { calls: [["read_page", {}]] } : { text: "Je tourne en rond : la page ne change pas. Voici ce que j'ai trouvé." }));
  const r = await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "go" }], tools: TOOLS, execute: async () => { ran++; return { text: "same" }; } });
  assert.equal(ran, 2, "two identical reads run, the rest are refused");
  assert.ok(p.seen.some((s) => s.history.some((m) => m.role === "tool" && m.content.includes(REPEATED_CALL.slice(0, 40)))));
  const last = p.seen.at(-1);
  assert.equal(last.tools, 0, "the conclusion is asked without tools");
  assert.equal(last.history.at(-1).content, CONCLUDE_REPEATING);
  assert.match(r.text, /tourne en rond/);
  assert.equal(r.reason, "repeating");
});

test("after an action the same read may say something new: it is not a repeat", () => {
  const ev = (type, name, input = {}) => ({ type, name, input });
  const events = [ev("tool/call", "read_page"), ev("tool/call", "read_page"), ev("tool/call", "click_element", { ref: "e1" })];
  assert.equal(repeatsSinceChange(events, { name: "read_page", input: {} }), 0);
  assert.equal(repeatsSinceChange(events.slice(0, 2), { name: "read_page", input: {} }), 2);
  assert.equal(repeatsSinceChange(events.slice(0, 2), { name: "read_page", input: { x: 1 } }), 0, "other arguments, another call");
});

test("a thinking that repeats itself is stopped, and the model told to decide", async () => {
  const loop = "Wait, let me reconsider whether the price includes shipping or not, because this matters a lot. ";
  const p = scripted([{ think: Array.from({ length: 60 }, () => loop) }, { text: "Décidé : 323,90 €" }]);
  const r = await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "go" }], tools: TOOLS, execute: async () => ({}) });
  assert.equal(r.text, "Décidé : 323,90 €");
  assert.equal(lastUser({ history: p.seen[1].history }), THOUGHT_LOOPING);
  assert.equal(repeatingTail("a varied thought that goes somewhere new each time, never coming back to the same words."), false);
  assert.equal(repeatingTail(loop.repeat(3)), true);
});

test("a reply cut by the connection is continued", async () => {
  const p = scripted([{ text: "Première partie", interrupted: true }, { text: " et la suite." }]);
  const r = await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "go" }], tools: TOOLS, execute: async () => ({}) });
  assert.equal(r.text, " et la suite.");
  assert.match(lastUser({ history: p.seen[1].history }), /interrupted before you finished/);
});

test("the oldest tool results are shortened first, the latest step's are left whole", () => {
  const big = "x".repeat(10000);
  const msgs = [
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: [{ id: "a" }], _reasoning: "old thought" },
    { role: "tool", tool_call_id: "a", content: big },
    { role: "assistant", content: null, tool_calls: [{ id: "b" }] },
    { role: "tool", tool_call_id: "b", content: big },
  ];
  const out = shrinkToolResults(msgs, 2000);
  assert.ok(out[2].content.length < 2000 && /removed to fit/.test(out[2].content));
  assert.equal(out[4].content, big);
  assert.equal(msgs[2].content, big, "the log's copy is untouched");
  assert.equal(toolResultChars(0), 8000);
  assert.equal(toolResultChars(1000000), 400000);
});

test("near the window the work so far is summarized, and the turn goes on from the summary", async () => {
  const page = "contenu ".repeat(6000); // ~12k tokens per read
  let summaries = 0;
  const p = scripted((req, i) => {
    if (req.chore) { summaries++; return { text: "Pages 0 à 3 lues : stock 41, 17, 8, 63." }; }
    return i < 24 ? { calls: [["navigate", { url: `https://e.example/${i}` }]] } : { text: "Total 129" };
  });
  // Shortening the old results is not enough past a point: then the turn summarizes itself.
  const r = await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "additionne les stocks" }], tools: TOOLS, contextWindow: 16384, execute: async () => ({ text: page }) });
  assert.equal(r.text, "Total 129");
  assert.ok(summaries >= 1, "a live summary was made");
  const after = p.seen.find((s, k) => k > 0 && s.history[0] && String(s.history[0].content).startsWith("[What was done before this point"));
  assert.ok(after, "a later request starts from the summary");
});

test("a correction typed while the agent works is read at its next step, without Stop", async () => {
  const queue = [];
  const p = scripted([{ calls: [["navigate", { url: "https://a.example" }]] }, { text: "Fait, sur b." }], {
    onRequest: (_req, n) => { if (n === 1) queue.push("Non, va plutôt sur b.example"); },
  });
  await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "va sur a" }], tools: TOOLS, execute: async () => ({ ok: true }), steer: () => queue.splice(0) });
  assert.match(p.seen[1].history.map((m) => m.content).join("\n"), /The user sent this while you were working[\s\S]*va plutôt sur b\.example/);
});

test("the reply language is restated after the latest tool results", async () => {
  const p = scripted([{ calls: [["read_page", {}]] }, { text: "Voilà." }]);
  await runConversation({ provider: p, system: "S", history: [{ role: "user", content: "résume" }], tools: TOOLS, replyLanguage: "fr", execute: async () => ({ text: "English page" }) });
  assert.match(p.seen[1].history.at(-1).content, /\[Reply language: French\.[^\]]*Réponds en français/);
});
