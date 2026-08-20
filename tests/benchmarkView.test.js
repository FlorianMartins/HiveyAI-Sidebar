// Tests for the Benchmark workspace's table logic.
//
// The rendering needs a DOM; these functions do not, and they are the ones that decide what a
// user believes. Two properties matter most: a model with no score must never sort as if it
// scored zero, and a stale source must be visibly stale — a number whose age is hidden invites a
// decision it cannot support.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, sortRows, filterRows, freshnessOf } from "../src/lib/benchmarkView.js";
import { BENCHMARK_WEB, BENCHMARK_UNCOVERED } from "../src/lib/benchmark-web.js";

const cat = (id, over = {}) => ({
  id, name: id, created: 1_700_000_000, context_length: 128_000,
  pricing: { prompt: "0.000001", completion: "0.000003" }, ...over,
});

const webId = Object.keys(BENCHMARK_WEB)[0];
const gapId = BENCHMARK_UNCOVERED[0];

test("the table covers published models, measured models, and the gap between them", () => {
  const catalogue = [cat(webId), cat(gapId), cat("vendor/measured-only")];
  const rows = buildRows({ catalogue, measured: { "vendor/measured-only": { score: 0.8, answered: 20, total: 20 } } });
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(webId), "a model with a published score");
  assert.ok(ids.includes(gapId), "a model no leaderboard covers — the reason this tab exists");
  assert.ok(ids.includes("vendor/measured-only"), "a model only we measured");
});

test("a model that has left the catalogue is dropped, however much data it has", () => {
  // Its scores are still true; you just cannot select it any more, so listing it is an invitation
  // to a choice that will fail.
  const rows = buildRows({
    catalogue: [cat("vendor/still-here")],
    measured: {
      "vendor/still-here": { score: 0.7, answered: 20, total: 20 },
      "vendor/retired": { score: 1, answered: 20, total: 20 },
    },
  });
  assert.deepEqual(rows.map((r) => r.id), ["vendor/still-here"]);
});

test("the table lists models with DATA, not the whole 400-model catalogue", () => {
  // A catalogue model nobody has published or measured has nothing to show but its price, and
  // four hundred rows of that is not a benchmark, it is a directory. The picker is for browsing;
  // this tab is for comparing.
  const rows = buildRows({ catalogue: [cat("vendor/nothing-known")], measured: {} });
  assert.deepEqual(rows.map((r) => r.id), []);
});

test("with no catalogue at all the table still renders what it knows", () => {
  // Offline, or the public endpoint is down: fewer columns, not an empty screen.
  const rows = buildRows({ catalogue: [], measured: { "vendor/x": { score: 0.5, answered: 20, total: 20 } } });
  assert.ok(rows.length > 0);
  assert.equal(rows.find((r) => r.id === "vendor/x").price, null);
});

test("a partial run is marked as partial, not presented as a verdict", () => {
  const rows = buildRows({
    catalogue: [cat("vendor/a"), cat("vendor/b")],
    measured: {
      "vendor/a": { score: 0.9, answered: 20, total: 20 },
      "vendor/b": { score: 1.0, answered: 4, total: 20 },   // rate-limited into a thin sample
    },
  });
  assert.equal(rows.find((r) => r.id === "vendor/a").measuredThin, false);
  assert.equal(rows.find((r) => r.id === "vendor/b").measuredThin, true);
});

test("the published name is carried so a fuzzy join can be audited by eye", () => {
  const entry = BENCHMARK_WEB[webId];
  const rows = buildRows({ catalogue: [cat(webId)], measured: {} });
  const r = rows[0];
  if (entry.aider) assert.equal(r.aiderAs, entry.aider.as);
  if (entry.vectara) assert.equal(r.hallucAs, entry.vectara.as);
});

// ── Sorting ────────────────────────────────────────────────────────────────────────────────

const rows = () => [
  { id: "a/unmeasured", measured: null, aider: 50, halluc: 5, price: 3, ctx: 100, created: 300, covered: true },
  { id: "b/good", measured: 0.9, aider: 80, halluc: 2, price: 10, ctx: 200, created: 200, covered: true },
  { id: "c/poor", measured: 0.4, aider: 20, halluc: 9, price: 1, ctx: 50, created: 100, covered: true },
];

test("an unmeasured model sorts last, never as a zero", () => {
  // Sorting a blank as 0 would rank a model nobody has tested below one measured as bad, which is
  // a claim the data does not support.
  assert.deepEqual(sortRows(rows(), "measured").map((r) => r.id), ["b/good", "c/poor", "a/unmeasured"]);
});

test("among unmeasured models the newest comes first", () => {
  const only = [
    { id: "old", measured: null, created: 100 },
    { id: "new", measured: null, created: 900 },
  ];
  assert.deepEqual(sortRows(only, "measured").map((r) => r.id), ["new", "old"]);
});

test("cheaper and less hallucinatory are better, so they sort first", () => {
  assert.equal(sortRows(rows(), "price")[0].id, "c/poor", "cheapest first");
  assert.equal(sortRows(rows(), "halluc")[0].id, "b/good", "least hallucination first");
});

test("clicking the same column again reverses it", () => {
  const desc = sortRows(rows(), "aider").map((r) => r.id);
  const asc = sortRows(rows(), "aider", "asc").map((r) => r.id);
  assert.deepEqual(asc, desc.slice().reverse());
});

test("sorting by name is stable and alphabetical", () => {
  assert.deepEqual(sortRows(rows(), "name").map((r) => r.id), ["a/unmeasured", "b/good", "c/poor"]);
});

// ── Filtering ──────────────────────────────────────────────────────────────────────────────

test("search matches the id and is case-insensitive", () => {
  assert.deepEqual(filterRows(rows(), { query: "GOOD" }).map((r) => r.id), ["b/good"]);
  assert.equal(filterRows(rows(), { query: "  " }).length, 3, "whitespace is not a filter");
});

test("the gap filter keeps only what no leaderboard covers", () => {
  const mixed = [...rows(), { id: "d/new", measured: null, covered: false, created: 999 }];
  assert.deepEqual(filterRows(mixed, { onlyGap: true }).map((r) => r.id), ["d/new"]);
});

// ── Freshness ──────────────────────────────────────────────────────────────────────────────

test("a source's age is measured in months from the newest model it covers", () => {
  const today = new Date("2026-08-20T00:00:00Z");
  assert.equal(freshnessOf({ newestModelCovered: "2026-08-01" }, today).months, 1);
  assert.equal(freshnessOf({ newestModelCovered: "2025-12-01" }, today).months, 9);
});

test("a source that covers nothing recent is flagged stale", () => {
  const today = new Date("2026-08-20T00:00:00Z");
  assert.equal(freshnessOf({ newestModelCovered: "2026-07-01" }, today).stale, false);
  assert.equal(freshnessOf({ newestModelCovered: "2025-12-01" }, today).stale, true);
});

test("a source with no coverage date says so instead of guessing", () => {
  assert.deepEqual(freshnessOf({}), { months: null, stale: false });
  assert.deepEqual(freshnessOf(null), { months: null, stale: false });
});
