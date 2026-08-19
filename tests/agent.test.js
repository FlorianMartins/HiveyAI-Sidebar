// Integration tests for runConversation — the function every agent turn in the sidebar goes
// through. It was rewritten on top of the reasoning kernel, so these tests pin the OBSERVABLE
// contract the UI depends on: what the provider receives, what the caller's history array holds
// afterwards, when tools run, and when they are refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runConversation, buildSystemPrompt, activeTools } from "../src/lib/agent.js";

// A provider in the shape of the real ones (Anthropic/OpenAI wire format, native messages).
function fakeProvider(script) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async runTurn({ system, history, tools, onText }) {
      calls.push({ system, history: history.slice(), tools });
      const r = script[Math.min(i, script.length - 1)];
      i++;
      if (onText && r.text) onText(r.text);
      return {
        text: r.text || "",
        message: { role: "assistant", content: r.text || "" },
        toolCalls: r.toolCalls || [],
        stopReason: (r.toolCalls || []).length ? "tool_use" : "end_turn",
      };
    },
    // The real providers wrap a step's results in one message; mirror that.
    formatToolResults(results) {
      return { role: "user", content: results.map((r) => `[${r.name}#${r.id}] ${r.content}`).join("\n") };
    },
  };
}

test("a plain chat turn returns the text and leaves the history complete", async () => {
  const provider = fakeProvider([{ text: "bonjour" }]);
  const history = [{ role: "user", content: "salut" }];
  const r = await runConversation({ provider, system: "SYS", history, tools: [] });

  assert.equal(r.text, "bonjour");
  assert.equal(r.done, true);
  assert.equal(r.steps, 1);
  // The provider saw the system prompt and the seeded history, unchanged.
  assert.equal(provider.calls[0].system, "SYS");
  assert.deepEqual(provider.calls[0].history, [{ role: "user", content: "salut" }]);
  // The caller's array is updated in place — call sites persist that same reference.
  assert.deepEqual(history, [
    { role: "user", content: "salut" },
    { role: "assistant", content: "bonjour" },
  ]);
  assert.equal(r.history, history, "the very same array object is returned");
});

test("streamed text reaches onText", async () => {
  const provider = fakeProvider([{ text: "hello" }]);
  let streamed = "";
  await runConversation({ provider, system: "S", history: [{ role: "user", content: "x" }], tools: [], onText: (d) => { streamed += d; } });
  assert.equal(streamed, "hello");
});

test("a tool call runs, is reported, and its result is fed back in the provider's format", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "t1", name: "read_page", input: { a: 1 } }] },
    { text: "voilà" },
  ]);
  const started = [], ended = [];
  const r = await runConversation({
    provider, system: "S", history: [{ role: "user", content: "lis la page" }],
    tools: [{ name: "read_page" }],
    onToolStart: (c) => started.push(c.name),
    onToolEnd: (c, out) => ended.push([c.name, out.title]),
    execute: async (name, input) => ({ title: "Page", name, input }),
  });

  assert.equal(r.steps, 2);
  assert.deepEqual(started, ["read_page"]);
  assert.deepEqual(ended, [["read_page", "Page"]]);
  // Second request carries the tool result, formatted by the provider itself.
  const second = provider.calls[1].history;
  assert.equal(second.length, 3, "user + assistant + tool-result message");
  assert.match(second[2].content, /\[read_page#t1\].*"title":"Page"/);
  assert.equal(r.text, "voilà");
});

test("parallel tool calls of one step are batched into a single provider message", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [
      { id: "a", name: "list_tabs", input: {} },
      { id: "b", name: "read_page", input: {} },
    ] },
    { text: "done" },
  ]);
  await runConversation({
    provider, system: "S", history: [{ role: "user", content: "go" }],
    tools: [{ name: "list_tabs" }, { name: "read_page" }],
    execute: async (name) => ({ ok: name }),
  });
  const second = provider.calls[1].history;
  assert.equal(second.length, 3, "one message for BOTH results, not two");
  assert.match(second[2].content, /\[list_tabs#a\][\s\S]*\[read_page#b\]/);
});

test("a screenshot is kept out of the text dump and handed to the vision path", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "s", name: "screenshot", input: {} }] },
    { text: "vu" },
  ]);
  let formatted = null;
  provider.formatToolResults = (results) => { formatted = results; return { role: "user", content: "ok" }; };
  await runConversation({
    provider, system: "S", history: [{ role: "user", content: "capture" }],
    tools: [{ name: "screenshot" }],
    execute: async () => ({ _image: "data:image/png;base64,AAAA", w: 100 }),
  });
  assert.equal(formatted[0].image, "data:image/png;base64,AAAA", "the image goes to the vision channel");
  assert.match(formatted[0].content, /\[screenshot attached\]/);
  assert.doesNotMatch(formatted[0].content, /base64,AAAA/, "the data URL never enters the text context");
});

test("a tool result is truncated so one huge page cannot blow the context", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "x", name: "read_page", input: {} }] },
    { text: "ok" },
  ]);
  let formatted = null;
  provider.formatToolResults = (r) => { formatted = r; return { role: "user", content: "" }; };
  await runConversation({
    provider, system: "S", history: [{ role: "user", content: "go" }],
    tools: [{ name: "read_page" }],
    execute: async () => ({ text: "x".repeat(50000) }),
  });
  assert.equal(formatted[0].content.length, 8000);
});

test("the step budget is enforced", async () => {
  const provider = fakeProvider([{ text: "", toolCalls: [{ id: "1", name: "loop", input: {} }] }]);
  const r = await runConversation({
    provider, system: "S", history: [{ role: "user", content: "go" }],
    tools: [{ name: "loop" }], maxSteps: 3, execute: async () => ({ ok: true }),
  });
  assert.equal(r.done, false);
  assert.equal(r.reason, "step-limit");
  assert.equal(provider.calls.length, 3);
});

test("the verifier can send the agent back to work, at most twice", async () => {
  const provider = fakeProvider([{ text: "fini" }, { text: "fini" }, { text: "fini" }, { text: "fini" }]);
  let asked = 0;
  const r = await runConversation({
    provider, system: "S", history: [{ role: "user", content: "task" }], tools: [],
    verify: async () => { asked++; return { pass: false, reason: "the form is still empty" }; },
  });
  assert.equal(asked, 2, "two objections, then it stops arguing");
  assert.equal(provider.calls.length, 3, "the initial step plus one per objection");
  assert.match(provider.calls[1].history.at(-1).content, /the form is still empty/,
    "the objection reaches the model as a real message");
  assert.equal(r.done, true);
});

test("a passing verifier does not add a step", async () => {
  const provider = fakeProvider([{ text: "fini" }]);
  await runConversation({
    provider, system: "S", history: [{ role: "user", content: "t" }], tools: [],
    verify: async () => ({ pass: true }),
  });
  assert.equal(provider.calls.length, 1);
});

test("a verifier that throws is ignored rather than failing the turn", async () => {
  const provider = fakeProvider([{ text: "fini" }]);
  const r = await runConversation({
    provider, system: "S", history: [{ role: "user", content: "t" }], tools: [],
    verify: async () => { throw new Error("verifier offline"); },
  });
  assert.equal(r.done, true);
  assert.equal(r.text, "fini");
});

test("the returned event log is a complete record of the turn", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "1", name: "read_page", input: {} }] },
    { text: "ok" },
  ]);
  const r = await runConversation({
    provider, system: "S", history: [{ role: "user", content: "go" }],
    tools: [{ name: "read_page" }], execute: async () => ({ ok: true }),
  });
  assert.deepEqual(r.events.map((e) => e.type), [
    "system/prompt", "user/message", "turn/start",
    "step/start", "assistant/message", "tool/call", "tool/result", "step/end",
    "step/start", "assistant/message", "step/end",
    "turn/end",
  ]);
});

// ── The prompt builder, which is pure and was equally untested ─────────────────────────────

test("activeTools only exposes tools in agent mode", () => {
  assert.deepEqual(activeTools({ agentMode: false }), []);
  assert.ok(activeTools({ agentMode: true }).length > 0);
});

test("the system prompt always states the untrusted-content rule", () => {
  for (const mode of ["chat", "translate", "improve", "security"]) {
    const p = buildSystemPrompt({ mode, agentMode: false });
    assert.match(p, /untrusted/i, `mode "${mode}" must keep the prompt-injection warning`);
  }
});

test("a forced response language is stated, and Auto is not", () => {
  assert.match(buildSystemPrompt({ responseLang: "français", mode: "chat" }), /in français/);
  assert.match(buildSystemPrompt({ responseLang: "Auto", mode: "chat" }), /SAME language/);
});

test("turning artifacts off tells the model so explicitly", () => {
  assert.match(buildSystemPrompt({ mode: "chat", artifacts: false }), /ARTIFACTS ARE OFF/);
  assert.match(buildSystemPrompt({ mode: "chat", artifacts: true }), /RUNTIME CORRECTNESS/);
});

test("security mode stays defensive", () => {
  const p = buildSystemPrompt({ mode: "security" });
  assert.match(p, /DEFENSIVE/);
  assert.match(p, /never.{0,40}exploits|NEVER\s+produce working exploits/i);
});
