// What each thinking level puts in the request, per provider and per model — the assertions of
// hivey-vscode's tests/reasoningMap.test.ts, on the sidebar's providers. The request is captured at
// fetch, so what is checked is the body that would leave the browser.

import test from "node:test";
import assert from "node:assert/strict";
import { anthropicFamily, anthropicThinking, effortFor, profileFor, reasoningMenu, selfHostedThinkingBudget, reasoningSupport, levelsFromRefusal, choicesFor } from "../src/lib/reasoning.js";
import { makeProvider, adaptRequest, maxOutputFromRefusal } from "../src/lib/providers.js";
import { REASONING_EFFORTS } from "../src/lib/model-catalog.generated.js";

const LEVELS = ["none", "low", "medium", "high"];
const TOOLS = [{ name: "read_page", description: "read", input_schema: { type: "object" } }];

/** A streamed reply in the provider's own shape: `parts` are the SSE payloads, without [DONE] when cut. */
function sse(parts) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
const OPENAI_OK = [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, "[DONE]"];
const ANTHROPIC_OK = [
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
];

/** Run one turn against a fake fetch; returns every body it received and the turn's result. */
async function exchange(providerId, model, { level, tools, chore, history = [{ role: "user", content: "hi" }], replies } = {}) {
  const bodies = [];
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    const r = replies ? replies[n++] : undefined;
    if (typeof r === "function") return r();
    return sse(r || (providerId === "anthropic" ? ANTHROPIC_OK : OPENAI_OK));
  };
  try {
    const settings = { provider: providerId, models: { [providerId]: model }, keys: { [providerId]: "k" }, baseUrls: { [providerId]: "http://127.0.0.1:9/v1" } };
    const provider = makeProvider(settings, { thinkLevel: level });
    const result = await provider.runTurn({ system: "", history, tools, chore });
    return { bodies, result };
  } finally {
    globalThis.fetch = real;
  }
}
const bodyOf = async (p, m, o) => (await exchange(p, m, o)).bodies[0];

async function wireBody(provider, model, level, extra = {}) {
  const b = await bodyOf(provider, model, { level, ...extra });
  const pick = {};
  for (const k of ["reasoning", "reasoning_effort", "thinking", "enable_thinking", "thinking_budget"]) if (k in b) pick[k] = b[k];
  return pick;
}
async function anthropicBody(model, level) {
  const b = await bodyOf("anthropic", model, { level });
  return { thinking: b.thinking, effort: b.output_config && b.output_config.effort, max_tokens: b.max_tokens };
}

// ── Anthropic ─────────────────────────────────────────────────────────────────────────────────

test("Anthropic: model ids are read into families, whatever the spelling", () => {
  const f = (id) => { const x = anthropicFamily(id); return `${x.tier} ${x.version.join(".")} ${x.style}`; };
  assert.equal(f("claude-opus-5-5"), "opus 5.5 adaptive");
  assert.equal(f("claude-fable-5-1"), "fable 5.1 adaptive");
  assert.equal(f("anthropic.claude-opus-4-8"), "opus 4.8 adaptive", "Bedrock");
  assert.equal(f("claude-opus-4-5@20251101"), "opus 4.5 budget", "Vertex");
  assert.equal(f("anthropic/claude-sonnet-4.6"), "sonnet 4.6 adaptive", "OpenRouter spelling");
  assert.equal(f("claude-sonnet-4-5-20250929"), "sonnet 4.5 budget", "a date is not a minor version");
  assert.equal(f("claude-3-7-sonnet-latest"), "sonnet 3.7 budget");
  assert.equal(f("claude-3-5-haiku-latest"), "haiku 3.5 none", "no extended thinking before 3.7");
  assert.equal(f("claude-opus-6"), "opus 6.0 adaptive", "a newer model gets the newest rules");
});

test("Anthropic: the matrix — each family, each level, exactly the documented fields", async () => {
  const A = { type: "adaptive", display: "summarized" };
  const A46 = { type: "adaptive" };
  const matrix = {
    "claude-fable-5-1": [[A, "low"], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-opus-5-5": [[A, "low"], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-opus-5": [[{ type: "disabled" }, undefined], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-opus-4-8": [[{ type: "disabled" }, undefined], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-sonnet-5-5": [[{ type: "between_tools" }, undefined], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-haiku-5-5": [[{ type: "disabled" }, undefined], [A, "low"], [A, "medium"], [A, "high"]],
    "claude-opus-4-6": [[{ type: "disabled" }, undefined], [A46, "low"], [A46, "medium"], [A46, "high"]],
  };
  for (const [model, rows] of Object.entries(matrix)) {
    for (const [i, level] of LEVELS.entries()) {
      const got = await anthropicBody(model, level);
      assert.deepEqual(got.thinking, rows[i][0], `${model} ${level}: thinking`);
      assert.equal(got.effort, rows[i][1], `${model} ${level}: effort`);
    }
  }
});

test("Anthropic: older models keep a token budget, always below max_tokens; no level chosen sends none", async () => {
  for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"]) {
    assert.equal((await anthropicBody(model, "none")).thinking, undefined);
    const budgets = [];
    for (const level of ["low", "medium", "high"]) {
      const b = await anthropicBody(model, level);
      assert.equal(b.thinking.type, "enabled");
      assert.ok(b.max_tokens > b.thinking.budget_tokens, "budget < max_tokens");
      budgets.push(b.thinking.budget_tokens);
    }
    assert.ok(budgets[0] < budgets[1] && budgets[1] < budgets[2], `${model}: each level thinks more`);
  }
  for (const model of ["claude-opus-5-5", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
    const b = await bodyOf("anthropic", model, {});
    assert.equal(b.thinking, undefined, `${model}: unpicked = the model's default`);
    assert.equal(b.output_config, undefined);
    assert.equal(b.max_tokens, 64000, "no fixed cap: a generous request, the model's own limit applies");
  }
  assert.equal((await anthropicBody("claude-3-5-haiku-latest", "high")).thinking, undefined, "a model without extended thinking is never sent it");
});

test("Anthropic: the menu offers Direct only where thinking can really be turned off", () => {
  const ids = (model) => reasoningMenu("anthropic", model).map((c) => c.id).join(",");
  assert.equal(ids("claude-opus-5-5"), "low,medium,high,xhigh,max");
  for (const m of ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-haiku-5-5"]) assert.equal(ids(m), "none,low,medium,high,xhigh,max", m);
  assert.equal(ids("claude-opus-4-6"), "none,low,medium,high,max", "4.6 has max, not xhigh");
  assert.equal(ids("claude-haiku-4-5"), "none,low,medium,high");
  assert.equal(reasoningMenu("anthropic", "claude-opus-5-5").find((c) => c.isDefault).id, "medium");
  assert.equal(reasoningMenu("anthropic", "claude-3-5-haiku-latest"), undefined);
  assert.equal(anthropicThinking("claude-opus-4-6", "xhigh").effort, "high", "4.6 has no xhigh");
});

test("Anthropic: the output limit is learned from the refusal and asked for exactly", async () => {
  assert.equal(maxOutputFromRefusal("max_tokens: 64000 > 32000, which is the maximum allowed number of output tokens for claude-x"), 32000);
  const refused = () => new Response('{"type":"error","error":{"message":"max_tokens: 64000 > 32000, which is the maximum allowed"}}', { status: 400 });
  const { bodies } = await exchange("anthropic", "claude-learn-test", { replies: [refused, undefined] });
  assert.deepEqual(bodies.map((b) => b.max_tokens), [64000, 32000]);
  const again = await bodyOf("anthropic", "claude-learn-test", {});
  assert.equal(again.max_tokens, 32000, "remembered for the next request");
});

test("Anthropic: a long conversation is cached — the system prompt and the last message carry a breakpoint", async () => {
  const long = "x".repeat(12000);
  const settings = { provider: "anthropic", models: { anthropic: "claude-opus-5-5" }, keys: { anthropic: "k" } };
  let body;
  const real = globalThis.fetch;
  globalThis.fetch = async (_u, o) => { body = JSON.parse(o.body); return sse(ANTHROPIC_OK); };
  try {
    const history = [{ role: "user", content: long }];
    await makeProvider(settings, {}).runTurn({ system: "s".repeat(6000), history });
    assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
    assert.equal(typeof history[0].content, "string", "the stored history never carries a breakpoint");
  } finally { globalThis.fetch = real; }
});

// ── The OpenAI wire format ────────────────────────────────────────────────────────────────────

test("unpicked, on the clouds: no reasoning field and no output cap — the model's own default and limit", async () => {
  for (const [provider, model] of [["openai", "gpt-5.5"], ["openai", "gpt-4o"], ["openrouter", "openai/gpt-5.5"], ["openrouter", "anthropic/claude-opus-5.5"], ["google", "gemini-2.5-pro"], ["deepseek", "deepseek-flash"], ["mistral", "mistral-medium-latest"], ["xai", "grok-4.7"]]) {
    const b = await bodyOf(provider, model, {});
    for (const k of ["reasoning", "reasoning_effort", "thinking", "max_tokens", "max_completion_tokens"]) assert.equal(k in b, false, `${provider} ${model}: ${k}`);
    assert.deepEqual(b.stream_options, { include_usage: true });
  }
});

test("OpenRouter: Direct DISABLES thinking (effort none), each level is its own effort, a mandatory model never gets none", async () => {
  const rows = [];
  for (const level of LEVELS) rows.push(await wireBody("openrouter", "openai/gpt-5.5", level));
  assert.deepEqual(rows, [{ reasoning: { effort: "none" } }, { reasoning: { effort: "low" } }, { reasoning: { effort: "medium" } }, { reasoning: { effort: "high" } }]);
  assert.deepEqual(await wireBody("openrouter", "anthropic/claude-opus-5.5", "none"), { reasoning: { effort: "low" } });
  assert.equal(reasoningMenu("openrouter", "anthropic/claude-opus-5.5").some((c) => c.id === "none"), false);
});

test("OpenAI, Gemini, DeepSeek, Mistral, xAI, Groq, Perplexity: only the efforts each model takes", async () => {
  assert.deepEqual(await wireBody("openai", "gpt-4.1", "high"), {}, "gpt-4.1 rejects reasoning_effort");
  assert.deepEqual(reasoningMenu("openai", "gpt-4o"), [], "no thinking control on a model without thinking");
  const g5 = [];
  for (const level of LEVELS) g5.push((await wireBody("openai", "gpt-5", level)).reasoning_effort);
  assert.deepEqual(g5, ["minimal", "low", "medium", "high"]);
  assert.deepEqual(await wireBody("openai", "gpt-5.5", "high", { tools: TOOLS }), { reasoning_effort: "none" }, "from GPT-5.4, tools take effort none only");
  assert.equal((await wireBody("google", "gemini-2.5-flash", "none")).reasoning_effort, "none");
  assert.equal((await wireBody("google", "gemini-2.5-pro", "none")).reasoning_effort, "low");
  assert.deepEqual(await wireBody("deepseek", "deepseek-v4-pro", "none"), { thinking: { type: "disabled" } });
  assert.deepEqual(await wireBody("deepseek", "deepseek-flash", "high"), { thinking: { type: "enabled" }, reasoning_effort: "high" });
  assert.equal((await wireBody("mistral", "mistral-medium-latest", "low")).reasoning_effort, "high", "Mistral has high or none");
  assert.equal((await wireBody("xai", "grok-4.7", "none")).reasoning_effort, "low");
  assert.equal((await wireBody("groq", "qwen/qwen3.8-27b", "none")).reasoning_effort, "none");
  assert.deepEqual(await wireBody("perplexity", "sonar-pro", "high"), {});
});

test("self-hosted and gateway: Standard when nothing is picked, Bref as \"medium\" with its budget, none for a chore", async () => {
  for (const provider of ["custom", "lmstudio"]) {
    const sent = [];
    for (const level of LEVELS) sent.push((await wireBody(provider, "qwen3.8", level)).reasoning_effort);
    assert.deepEqual(sent, ["none", "medium", "medium", "high"], provider);
    const unpicked = await bodyOf(provider, "qwen3.8", {});
    assert.equal(unpicked.reasoning_effort, "medium", "Qwen's template default is its maximum: Standard instead");
    assert.equal(unpicked.reasoning_budget_tokens, 8192);
    assert.equal((await bodyOf(provider, "qwen3.8", { level: "low" })).reasoning_budget_tokens, 1024);
    const chore = await bodyOf(provider, "qwen3.8", { level: "high", chore: true });
    assert.equal(chore.reasoning_effort, "none");
    assert.equal("reasoning_budget_tokens" in chore, false);
  }
  assert.equal("reasoning_budget_tokens" in (await bodyOf("ollama", "qwen3", { level: "low" })), false, "Ollama has no such field");
  assert.deepEqual(selfHostedThinkingBudget("xhigh"), {});
});

test("no level is ever sent as a value its profile lacks, on any catalogued model", () => {
  for (const id of Object.keys(REASONING_EFFORTS)) {
    const p = profileFor("openrouter", id);
    for (const level of LEVELS) {
      const e = effortFor(p, level);
      assert.ok(p.efforts.includes(e), `${id} ${level} → ${e}`);
      if (REASONING_EFFORTS[id].m) assert.notEqual(e, "none", `${id}: mandatory, never none`);
    }
    const sent = reasoningMenu("openrouter", id).map((c) => effortFor(p, c.id));
    assert.equal(new Set(sent).size, sent.length, `${id}: two menu levels send the same effort`);
  }
});

test("which models reason: the catalogue, a family fallback, and unknown for a model nobody lists", () => {
  assert.equal(reasoningSupport("anthropic/claude-opus-5.5"), "yes");
  assert.equal(reasoningSupport("qwen3-coder-local"), "yes", "a vendor family, not a version");
  assert.equal(reasoningSupport("my-private-model"), "unknown");
  const r = levelsFromRefusal('Unexpected reasoning effort hivey-probe. Supported types are xhigh (default), medium, and low.');
  assert.deepEqual(r, { levels: ["xhigh", "medium", "low"], defaultLevel: "xhigh" });
  assert.deepEqual(choicesFor(r).map((c) => c.id), ["none", "low", "medium", "high"]);
});

// ── What the server refuses, and what it sends back ───────────────────────────────────────────

test("a refused field is dropped and the request sent again — never anything added", async () => {
  assert.deepEqual(adaptRequest({ model: "m", reasoning_effort: "low", messages: [] }, '"llama3" does not support thinking'), { model: "m", messages: [] });
  assert.deepEqual(adaptRequest({ model: "m", reasoning: { effort: "none" } }, "Reasoning is mandatory for this endpoint and cannot be disabled"), { model: "m" });
  assert.deepEqual(adaptRequest({ model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "high" }, "The reasoning_content in the thinking mode must be passed back"), { model: "deepseek-flash", thinking: { type: "disabled" } });
  assert.deepEqual(adaptRequest({ model: "m", max_tokens: 4096 }, "can only afford 1991"), { model: "m", max_tokens: 1991 });
  assert.equal(adaptRequest({ model: "m" }, "model not found"), undefined, "not about a parameter: the error stands");
  const refused = () => new Response('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}', { status: 400 });
  const { bodies } = await exchange("lmstudio", "local-model", { replies: [refused, undefined] });
  assert.equal("stream_options" in bodies[0], true);
  assert.equal("stream_options" in bodies[1], false);
});

test("the thinking of a step goes back to the model that had it — and only where the API takes it", async () => {
  const step = await exchange("custom", "qwen3.8", { replies: [[{ choices: [{ delta: { reasoning_content: "I should read the page." } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_page", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }, "[DONE]"]] });
  assert.equal(step.result.message._reasoning, "I should read the page.");
  const history = [{ role: "user", content: "hi" }, step.result.message, { role: "tool", tool_call_id: "c1", content: "{}" }];
  const self = await bodyOf("custom", "qwen3.8", { history });
  assert.equal(self.messages[1].reasoning_content, "I should read the page.");
  assert.equal("_reasoning" in self.messages[1], false, "private keys never leave");
  const cloud = await bodyOf("openai", "gpt-5.5", { history });
  assert.equal("reasoning_content" in cloud.messages[1], false, "OpenAI is not sent a field it does not take");
  const or = await exchange("openrouter", "deepseek/deepseek-v4.1", { replies: [[{ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", index: 0, text: "a" }] } }] }, { choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", index: 0, text: "b" }] }, finish_reason: "stop" }] }, "[DONE]"]] });
  assert.deepEqual(or.result.message._reasoningDetails, [{ type: "reasoning.text", index: 0, text: "ab" }]);
  const back = await bodyOf("openrouter", "deepseek/deepseek-v4.1", { history: [{ role: "user", content: "hi" }, or.result.message, { role: "user", content: "and?" }] });
  assert.deepEqual(back.messages[1].reasoning_details, [{ type: "reasoning.text", index: 0, text: "ab" }]);
});

test("a stream that stops without finishing is an interrupted reply, and half a tool call is dropped", async () => {
  const cut = await exchange("custom", "qwen3.8", { replies: [[{ choices: [{ delta: { content: "Voici le début" } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_page", arguments: '{"x":' } }] } }] }]] });
  assert.equal(cut.result.interrupted, true);
  assert.equal(cut.result.text, "Voici le début");
  assert.deepEqual(cut.result.toolCalls, []);
  const whole = await exchange("custom", "qwen3.8", {});
  assert.equal(whole.result.interrupted, undefined);
});

test("a connection reset before any answer is sent again, once", async () => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNRESET" }; throw e; }
    return sse(OPENAI_OK);
  };
  try {
    const r = await makeProvider({ provider: "custom", models: { custom: "m" }, baseUrls: { custom: "http://127.0.0.1:9/v1" } }, {}).runTurn({ system: "", history: [{ role: "user", content: "hi" }] });
    assert.equal(r.text, "ok");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = real; }
});
