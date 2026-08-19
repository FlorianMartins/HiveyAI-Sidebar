// Tests for the reasoning kernel (src/lib/harness.js).
//
// The kernel exists to make agent behaviour testable without a network, a browser or a model,
// so these tests mount a scripted `llm` seam and assert on the SESSION LOG — the same artefact
// the model's view is derived from. If a behaviour cannot be seen in the log, the model cannot
// see it either, which is exactly the property we want to hold.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness, runTurn, inject, DURABLE } from "../src/lib/harness.js";

// A scripted model: each entry is one reply, consumed in order.
function scriptedLlm(replies) {
  let i = 0;
  const seen = [];
  return {
    seen,
    project: (e) => {
      if (e.type === "user/message") return { role: "user", content: e.text };
      if (e.type === "assistant/message") return { role: "assistant", content: e.text };
      if (e.type === "tool/result") return { role: "tool", content: JSON.stringify(e.result) };
      return null;
    },
    async runTurn(req) {
      seen.push(req.messages.map((m) => `${m.role}:${m.content}`).join("|"));
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return { text: r.text || "", message: { role: "assistant" }, toolCalls: r.toolCalls || [] };
    },
  };
}

const echoTools = {
  list: () => [{ name: "echo" }],
  execute: async (name, input) => ({ ok: true, name, input }),
};

const typesOf = (ctx) => ctx.events().map((e) => e.type);

// ── Seams ──────────────────────────────────────────────────────────────────────────────────

test("a seam can be provided, read, and restored on dispose", () => {
  const ctx = createHarness();
  assert.equal(ctx.has("llm"), false);
  const undoA = ctx.provide("llm", { id: "a" });
  assert.equal(ctx.get("llm").id, "a");
  const undoB = ctx.provide("llm", { id: "b" });
  assert.equal(ctx.get("llm").id, "b");
  undoB();
  assert.equal(ctx.get("llm").id, "a", "disposing the override restores the previous provider");
  undoA();
  assert.equal(ctx.has("llm"), false);
});

test("reading a missing seam fails loudly rather than returning undefined", () => {
  const ctx = createHarness();
  assert.throws(() => ctx.get("nope"), /no provider for "nope"/);
});

// ── Events ─────────────────────────────────────────────────────────────────────────────────

test("listeners run in declared order, not registration order", async () => {
  const ctx = createHarness();
  const order = [];
  ctx.on("x", () => order.push("late"), 200);
  ctx.on("x", () => order.push("early"), 10);
  ctx.on("x", () => order.push("mid"), 100);
  await ctx.emit("x", {});
  assert.deepEqual(order, ["early", "mid", "late"]);
});

test("a throwing listener cannot take down the emit", async () => {
  const ctx = createHarness();
  const errors = [];
  ctx.onError = (name, e) => errors.push([name, e.message]);
  let reached = false;
  ctx.on("x", () => { throw new Error("boom"); }, 10);
  ctx.on("x", () => { reached = true; }, 20);
  await ctx.emit("x", {});
  assert.equal(reached, true, "the second listener still runs");
  assert.deepEqual(errors, [["x", "boom"]]);
});

test("a waterfall delegates through next() and reaches the terminal", async () => {
  const ctx = createHarness();
  ctx.on("w", (v, next) => next({ n: v.n + 1 }), 10);
  ctx.on("w", (v, next) => next({ n: v.n * 10 }), 20);
  const out = await ctx.waterfall("w", { n: 1 }, (v) => ({ n: v.n + 100 }));
  assert.deepEqual(out, { n: 120 }, "(1+1)*10 + 100");
});

test("a waterfall listener that does not call next() takes the decision", async () => {
  const ctx = createHarness();
  let terminalRan = false;
  ctx.on("w", () => ({ decided: true }), 10);
  ctx.on("w", (v, next) => next(v), 20);
  const out = await ctx.waterfall("w", {}, () => { terminalRan = true; return { decided: false }; });
  assert.deepEqual(out, { decided: true });
  assert.equal(terminalRan, false, "short-circuiting must skip the terminal, not merely reorder it");
});

// ── Plugins ────────────────────────────────────────────────────────────────────────────────

test("disposing a plugin unwinds every registration it made", async () => {
  const ctx = createHarness();
  const hits = [];
  const plugin = {
    name: "demo",
    apply(c) {
      c.provide("thing", { v: 1 });
      c.on("e", () => hits.push("plugin"));
      return "applied";
    },
  };
  const handle = ctx.plug(plugin);
  assert.equal(handle.value, "applied");
  assert.equal(ctx.get("thing").v, 1);
  await ctx.emit("e", {});
  assert.deepEqual(hits, ["plugin"]);

  handle.dispose();
  assert.equal(ctx.has("thing"), false, "the service is gone");
  await ctx.emit("e", {});
  assert.deepEqual(hits, ["plugin"], "the listener no longer fires");
});

test("a nested plugin is unwound with its parent", () => {
  const ctx = createHarness();
  const child = { name: "child", apply: (c) => c.provide("child", {}) };
  const parent = { name: "parent", apply: (c) => { c.plug(child); c.provide("parent", {}); } };
  const h = ctx.plug(parent);
  assert.equal(ctx.has("child") && ctx.has("parent"), true);
  h.dispose();
  assert.equal(ctx.has("child"), false, "the nested plugin was unwound too");
  assert.equal(ctx.has("parent"), false);
});

// ── The log ────────────────────────────────────────────────────────────────────────────────

test("the log is ordered, stamped, and broadcast after the append", async () => {
  let clock = 0;
  const ctx = createHarness({ now: () => ++clock });
  const seenDuringBroadcast = [];
  ctx.on("session/event", (e) => seenDuringBroadcast.push([e.type, ctx.events().length]));
  ctx.append("user/message", { text: "a" });
  ctx.append("assistant/message", { text: "b" });
  const ev = ctx.events();
  assert.deepEqual(ev.map((e) => e.seq), [0, 1]);
  assert.deepEqual(ev.map((e) => e.t), [1, 2]);
  // The listener must already be able to see the event it is being told about.
  assert.deepEqual(seenDuringBroadcast, [["user/message", 1], ["assistant/message", 2]]);
});

test("events() returns a copy — a caller cannot corrupt the log", () => {
  const ctx = createHarness();
  ctx.append("user/message", { text: "a" });
  ctx.events().push({ type: "forged" });
  assert.equal(ctx.events().length, 1);
});

test("deriveMessages projects only durable events, in order", () => {
  const ctx = createHarness();
  ctx.append("turn/start");
  ctx.append("user/message", { text: "hi" });
  ctx.append("step/start", { step: 1 });
  ctx.append("assistant/message", { text: "yo" });
  ctx.emit("agent/pre-step", {}); // live, never logged
  const msgs = ctx.deriveMessages((e) =>
    e.type === "user/message" ? { role: "user", content: e.text }
      : e.type === "assistant/message" ? { role: "assistant", content: e.text }
        : null);
  assert.deepEqual(msgs, [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }]);
});

test("every event type the loop appends is declared durable", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([{ text: "done" }]));
  inject(ctx, "go");
  await runTurn(ctx);
  for (const t of typesOf(ctx)) {
    assert.equal(DURABLE.has(t), true, `"${t}" is written to the log but not declared durable`);
  }
});

// ── The reasoning loop ─────────────────────────────────────────────────────────────────────

test("a turn with no tool calls runs exactly one step", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([{ text: "hello" }]));
  inject(ctx, "hi");
  const r = await runTurn(ctx);
  assert.equal(r.done, true);
  assert.equal(r.steps, 1);
  assert.equal(r.text, "hello");
  assert.deepEqual(typesOf(ctx), [
    "user/message", "turn/start", "step/start", "assistant/message", "step/end", "turn/end",
  ]);
});

test("a tool call owes another step, and both call and result are logged", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([
    { text: "", toolCalls: [{ id: "1", name: "echo", input: { a: 1 } }] },
    { text: "finished" },
  ]));
  ctx.provide("tools", echoTools);
  inject(ctx, "use the tool");
  const r = await runTurn(ctx);
  assert.equal(r.steps, 2, "one step for the tool call, one for the answer");
  assert.deepEqual(typesOf(ctx), [
    "user/message", "turn/start",
    "step/start", "assistant/message", "tool/call", "tool/result", "step/end",
    "step/start", "assistant/message", "step/end",
    "turn/end",
  ]);
  const res = ctx.events().find((e) => e.type === "tool/result");
  assert.deepEqual(res.result, { ok: true, name: "echo", input: { a: 1 } });
  assert.equal(res.isError, false);
});

test("the model's view is rebuilt from the log on every step", async () => {
  const llm = scriptedLlm([
    { text: "", toolCalls: [{ id: "1", name: "echo", input: {} }] },
    { text: "done" },
  ]);
  const ctx = createHarness();
  ctx.provide("llm", llm);
  ctx.provide("tools", echoTools);
  inject(ctx, "start");
  await runTurn(ctx);
  assert.equal(llm.seen[0], "user:start");
  // Second step sees the whole history, including the tool result — because it was logged.
  assert.match(llm.seen[1], /^user:start\|assistant:\|tool:/);
});

test("a rejected pre-step closes the turn without spending a step", async () => {
  const ctx = createHarness();
  const llm = scriptedLlm([{ text: "should never run" }]);
  ctx.provide("llm", llm);
  ctx.on("agent/pre-step", () => ({ reject: "over budget" }));
  inject(ctx, "expensive");
  const r = await runTurn(ctx);
  assert.equal(r.done, false);
  assert.equal(r.reason, "rejected");
  assert.equal(r.detail, "over budget");
  assert.equal(llm.seen.length, 0, "the model was never called — that is the whole point");
  const end = ctx.events().find((e) => e.type === "turn/end");
  assert.equal(end.detail, "over budget", "the refusal is recorded, not silent");
});

test("pre-step can rewrite what the model sees", async () => {
  const llm = scriptedLlm([{ text: "ok" }]);
  const ctx = createHarness();
  ctx.provide("llm", llm);
  ctx.on("agent/pre-step", (v, next) =>
    next({ ...v, messages: [...v.messages, { role: "user", content: "[guard] be brief" }] }));
  inject(ctx, "question");
  await runTurn(ctx);
  assert.equal(llm.seen[0], "user:question|user:[guard] be brief");
});

test("a denied tool still produces a logged result, so call/result stay paired", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([
    { text: "", toolCalls: [{ id: "1", name: "echo", input: {} }] },
    { text: "understood" },
  ]));
  let executed = false;
  ctx.provide("tools", { list: () => [], execute: async () => { executed = true; return {}; } });
  ctx.on("tools/pre-execute", (d) => ({ error: "denied by policy" }));
  inject(ctx, "do it");
  await runTurn(ctx);
  assert.equal(executed, false, "the tool never ran");
  const res = ctx.events().find((e) => e.type === "tool/result");
  assert.deepEqual(res.result, { error: "denied by policy" });
  assert.equal(res.isError, true);
});

test("post-execute can transform a result before the model sees it", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([
    { text: "", toolCalls: [{ id: "1", name: "echo", input: {} }] },
    { text: "done" },
  ]));
  ctx.provide("tools", echoTools);
  ctx.on("tools/post-execute", (v, next) => next({ ...v, result: { redacted: true } }));
  inject(ctx, "go");
  await runTurn(ctx);
  assert.deepEqual(ctx.events().find((e) => e.type === "tool/result").result, { redacted: true });
});

test("turn-stopping can demand another step, and its reason enters the log", async () => {
  const llm = scriptedLlm([{ text: "first" }, { text: "second" }]);
  const ctx = createHarness();
  ctx.provide("llm", llm);
  let asked = 0;
  ctx.on("agent/turn-stopping", (c) => {
    if (asked++ === 0) { c.continue = true; c.reason = "[verifier] not done"; }
  });
  inject(ctx, "task");
  const r = await runTurn(ctx);
  assert.equal(r.steps, 2);
  assert.equal(r.text, "second");
  assert.match(llm.seen[1], /\[verifier\] not done/, "the model actually saw the objection");
});

test("the step limit stops the loop and says so", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([{ text: "", toolCalls: [{ id: "1", name: "echo", input: {} }] }]));
  ctx.provide("tools", echoTools);
  inject(ctx, "loop forever");
  const r = await runTurn(ctx, { maxSteps: 3 });
  assert.equal(r.done, false);
  assert.equal(r.reason, "step-limit");
  assert.equal(r.steps, 3);
  assert.equal(ctx.events().filter((e) => e.type === "step/start").length, 3);
});

test("an already-aborted signal spends no step", async () => {
  const ctx = createHarness();
  const llm = scriptedLlm([{ text: "no" }]);
  ctx.provide("llm", llm);
  inject(ctx, "x");
  const r = await runTurn(ctx, { signal: { aborted: true } });
  assert.equal(r.reason, "aborted");
  assert.equal(llm.seen.length, 0);
});

test("a turn runs without a tools seam at all", async () => {
  const ctx = createHarness();
  ctx.provide("llm", scriptedLlm([{ text: "chat only" }]));
  inject(ctx, "hi");
  const r = await runTurn(ctx);
  assert.equal(r.done, true);
});
