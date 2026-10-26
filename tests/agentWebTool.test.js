// The agent searches the web through a tool it calls when it needs it, not on every step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeTools } from "../src/lib/agent.js";
import { executeTool } from "../src/lib/tools.js";
import { PURE_READS } from "../src/lib/agent-guards.js";

test("web_search is offered to the agent only when « Web » is on", () => {
  const names = (o) => activeTools(o).map((t) => t.name);
  assert.ok(!names({ agentMode: true }).includes("web_search"));
  assert.ok(names({ agentMode: true, webSearch: true }).includes("web_search"));
  assert.deepEqual(activeTools({ agentMode: false, webSearch: true }), []);
  assert.ok(!names({ agentMode: true, webSearch: true }).includes("recall"), "memory tools still follow their own switch");
});

test("web_search runs the search it is given, refuses clearly without it, and is a pure read", async () => {
  assert.match((await executeTool("web_search", { query: "x" }, {})).error, /turned off/);
  const seen = [];
  const out = await executeTool("web_search", { query: "horaires musée d'Orsay" }, { webSearch: async (q) => { seen.push(q); return { results: "9h30–18h" }; } });
  assert.deepEqual(seen, ["horaires musée d'Orsay"]);
  assert.equal(out.results, "9h30–18h");
  assert.ok(PURE_READS.has("web_search"));
});
