// 🐝 Harness — the reasoning kernel.
//
// WHY THIS EXISTS
// ---------------
// The old agent loop was a flat `for` loop that mutated a `history` array in place, called a
// handful of fixed callbacks, and had one special-case verifier wedged into the middle of it.
// Every new behaviour — a budget cap, a confirmation prompt, an injection guard, a second
// opinion before answering "done" — had to be added by editing that loop, so the loop grew a
// branch per feature and no behaviour could be tested without running the whole thing.
//
// This kernel adopts the reasoning model popularised by DeepSeek Harness (and the Cordis
// paradigm behind it): the loop keeps ONLY the mechanics of reasoning — turns, steps, tool
// calls — and everything that decides *what may happen* is registered from outside as a
// listener. Three ideas do the work:
//
//   1. THE LOG IS THE TRUTH. Every fact the model may see is appended to an ordered session
//      log, and the messages sent to the model are DERIVED from that log on every step. Not
//      kept in parallel — derived. So "what did the model actually see?" always has an exact
//      answer, replay is free, and it is structurally impossible to slip context past the
//      transcript. (The harness slogan is "model-visible means logged"; here it is enforced by
//      construction rather than by an assertion, because a projection cannot drift from its
//      source.)
//
//   2. ADMISSION BEFORE EVERY STEP. Before each model request, `agent/pre-step` runs as a
//      waterfall: each listener receives the messages about to be sent and either rewrites
//      them, passes them on, or rejects the step outright. Guards, injected context, budget
//      limits and the independent verifier all live here instead of inside the loop.
//
//   3. REVERSIBLE REGISTRATION. Mounting a plugin returns a handle; disposing it unwinds every
//      listener and service that plugin registered. That is what makes a feature removable —
//      and what makes it testable in isolation.
//
// This file deliberately depends on NOTHING: no browser API, no network, no DeepSeek service.
// It is the reasoning architecture, running on whichever provider the user already pays for.

// ── Session events ───────────────────────────────────────────────────────────────────────────
// Durable facts. Anything the model can see must be one of these, because the model's view is a
// projection of this list. `live` events (pre-step, tool guards…) are NOT logged: they are
// decisions about the log, not part of it.
export const DURABLE = new Set([
  "system/prompt",
  "turn/start",
  "step/start",
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
  "step/end",
  "turn/end",
]);

// ── The kernel ───────────────────────────────────────────────────────────────────────────────

export function createHarness({ now = () => Date.now() } = {}) {
  const services = new Map();
  const listeners = new Map(); // event → [{fn, order}]
  const log = [];
  let seq = 0;

  function addListener(name, fn, order) {
    const arr = listeners.get(name) || [];
    const entry = { fn, order };
    arr.push(entry);
    // Stable sort by declared order: a guard that must run before another guard says so once,
    // instead of depending on which plugin happened to be mounted first.
    arr.sort((a, b) => a.order - b.order);
    listeners.set(name, arr);
    return () => {
      const cur = listeners.get(name) || [];
      const i = cur.indexOf(entry);
      if (i >= 0) cur.splice(i, 1);
    };
  }

  const ctx = {
    // ── Seams ────────────────────────────────────────────────────────────────────────────────
    // A seam is a capability named once and implemented anywhere: `llm`, `tools`, `clock`.
    // Swapping the implementation swaps it for every consumer, which is what makes the loop
    // testable — the tests mount a fake `llm` and the real reasoning runs against it.
    provide(key, impl) {
      const prev = services.get(key);
      services.set(key, impl);
      return () => {
        if (services.get(key) === impl) {
          if (prev === undefined) services.delete(key);
          else services.set(key, prev);
        }
      };
    },
    get(key) {
      const s = services.get(key);
      if (s === undefined) throw new Error(`harness: no provider for "${key}"`);
      return s;
    },
    has(key) { return services.has(key); },

    // ── Events ───────────────────────────────────────────────────────────────────────────────
    on(name, fn, order = 100) { return addListener(name, fn, order); },

    // Serial notification: every listener sees it, none can change it. Errors are contained —
    // a broken telemetry listener must never take down a reasoning turn.
    async emit(name, payload) {
      for (const { fn } of listeners.get(name) || []) {
        try { await fn(payload); } catch (e) { ctx.onError && ctx.onError(name, e); }
      }
      return payload;
    },

    // Waterfall: listeners form a chain and each decides whether to delegate. A listener that
    // returns WITHOUT calling next() has taken the decision — that is how a rejection works.
    async waterfall(name, payload, terminal) {
      const chain = (listeners.get(name) || []).map((l) => l.fn);
      let i = -1;
      const next = async (value) => {
        i++;
        if (i < chain.length) return chain[i](value, next);
        return terminal ? terminal(value) : value;
      };
      return next(payload);
    },

    // ── Plugins ──────────────────────────────────────────────────────────────────────────────
    // Everything registered through the scoped ctx is remembered so it can be undone. A plugin
    // that cannot be removed is a patch to the core by another name.
    plug(plugin, config) {
      const undo = [];
      const scoped = Object.create(ctx);
      scoped.provide = (k, impl) => { const d = ctx.provide(k, impl); undo.push(d); return d; };
      scoped.on = (n, fn, order) => { const d = ctx.on(n, fn, order); undo.push(d); return d; };
      scoped.plug = (p, c) => { const h = ctx.plug(p, c); undo.push(h.dispose); return h; };
      const applied = plugin.apply ? plugin.apply(scoped, config) : plugin(scoped, config);
      return {
        name: plugin.name || "anonymous",
        value: applied,
        dispose() { while (undo.length) undo.pop()(); },
      };
    },

    // ── The session log ──────────────────────────────────────────────────────────────────────
    append(type, data = {}) {
      const event = { seq: seq++, t: now(), type, ...data };
      log.push(event);
      // Broadcast after appending, so any listener that reads the log sees the event already in
      // it. The reverse order produced a UI that rendered a turn before the turn existed.
      ctx.emit("session/event", event);
      return event;
    },
    events() { return log.slice(); },
    // The model's view, derived — never stored. `project` maps a durable event to zero or more
    // provider-shaped messages; the provider owns that shape, the kernel owns the order.
    // `project` receives its position in the log as well as the event, because some providers
    // batch: Anthropic expects the results of one step's parallel tool calls inside a SINGLE
    // user message. A projector that only ever saw one event at a time could not express that,
    // and would have forced the batching back into the loop.
    deriveMessages(project) {
      const durable = log.filter((e) => DURABLE.has(e.type));
      const out = [];
      for (let i = 0; i < durable.length; i++) {
        const m = project(durable[i], i, durable);
        if (m) out.push(...[].concat(m));
      }
      return out;
    },
    onError: null,
  };

  return ctx;
}

// ── The reasoning loop ───────────────────────────────────────────────────────────────────────
//
// A STEP is one model request plus the tools it calls. A TURN is zero or more steps: it opens
// when there is input to claim and closes once nothing is owed — no pending tool results, no
// listener asking for another pass. Compare with the old loop, which conflated the two and so
// could not express "this turn ran no step at all" (a rejected input) or "keep going, a guard
// asked for one more pass".
//
// Everything interesting is an extension point:
//   agent/pre-step      waterfall  rewrite or REJECT the messages about to be sent
//   agent/request       waterfall  wrap the provider call (retries, telemetry, model choice)
//   tools/pre-execute   waterfall  approve, deny or rewrite a tool call
//   tools/post-execute  waterfall  transform a tool result before the model sees it
//   agent/turn-stopping serial     last word before the turn closes — may demand another step
export async function runTurn(ctx, { maxSteps = 24, signal } = {}) {
  const llm = ctx.get("llm");
  const tools = ctx.has("tools") ? ctx.get("tools") : null;

  ctx.append("turn/start");
  let steps = 0;
  let lastText = "";
  let stopped = false;

  while (!stopped) {
    if (signal && signal.aborted) { ctx.append("turn/end", { reason: "aborted" }); return { text: lastText, steps, done: false, reason: "aborted" }; }
    if (steps >= maxSteps) { ctx.append("turn/end", { reason: "step-limit" }); return { text: lastText, steps, done: false, reason: "step-limit" }; }

    // The model's view is rebuilt from the log on EVERY step. Injected context therefore has to
    // be appended (see `inject`) — there is no back door that reaches the model without a trace.
    const derived = ctx.deriveMessages(llm.project);

    // ADMISSION. A listener may hand back `{ reject: reason }`; the step then never happens and
    // the turn closes having spent nothing. That is the cheap way to stop bad work: before it.
    const admitted = await ctx.waterfall("agent/pre-step", { messages: derived, step: steps }, (v) => v);
    if (!admitted || admitted.reject) {
      ctx.append("turn/end", { reason: "rejected", detail: admitted && admitted.reject });
      return { text: lastText, steps, done: false, reason: "rejected", detail: admitted && admitted.reject };
    }

    steps++;
    ctx.append("step/start", { step: steps });

    const request = { messages: admitted.messages, tools: tools ? tools.list() : [], signal };
    const turn = await ctx.waterfall("agent/request", request, (req) => llm.runTurn(req));

    lastText = turn.text || "";
    ctx.append("assistant/message", { text: lastText, raw: turn.message, calls: (turn.toolCalls || []).length });

    const calls = turn.toolCalls || [];
    if (calls.length && tools) {
      for (const call of calls) {
        ctx.append("tool/call", { step: steps, id: call.id, name: call.name, input: call.input });

        // A denied call still produces a RESULT, and the result still enters the log. Silently
        // dropping it desynchronises the provider's call/result pairing, and the model then
        // answers as if the tool had succeeded.
        const decision = await ctx.waterfall(
          "tools/pre-execute",
          { call, deny: null },
          async (d) => (d.deny ? { error: d.deny } : tools.execute(call.name, call.input)),
        );

        const result = await ctx.waterfall("tools/post-execute", { call, result: decision }, (v) => v.result);
        ctx.append("tool/result", { step: steps, id: call.id, name: call.name, result, isError: !!(result && result.error) });
      }
      ctx.append("step/end", { step: steps, owed: true });
      continue; // tools owe the model another request
    }

    ctx.append("step/end", { step: steps, owed: false });

    // LAST WORD. A listener may set `continue` to demand another step — this is where an
    // independent verifier belongs, not inside the loop.
    const closing = { text: lastText, steps, continue: false, reason: "" };
    await ctx.emit("agent/turn-stopping", closing);
    if (closing.continue) {
      // Whatever made it continue must be visible to the model, so it goes through the log.
      if (closing.reason) ctx.append("user/message", { text: closing.reason, injected: true });
      continue;
    }
    stopped = true;
  }

  ctx.append("turn/end", { reason: "done" });
  return { text: lastText, steps, done: true, reason: "done" };
}

// Inject context the model should see on its next step. Deliberately the ONLY way in, and it
// goes straight into the log: an injection that bypassed the log would break the one invariant
// the whole design rests on.
export function inject(ctx, text, meta = {}) {
  return ctx.append("user/message", { text, injected: true, ...meta });
}
