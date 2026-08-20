// Tests for the in-browser live benchmark.
//
// The probes are the measurement, so a sloppy `accept` is a sloppy benchmark: too strict and a
// correct answer is graded wrong, too loose and everything scores 100% and the tab ranks nothing.
// Each one is therefore tested against a right answer AND a wrong one, and the runner is tested
// on the cases that decide whether a number is trustworthy — API errors, aborts, and a model that
// answers nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROBES, TOOL_PROBES, FAMILIES, probesFor, totalProbes,
  parseLoose, runLiveBench, compareRows,
} from "../src/lib/livebench.js";

// ── The probes themselves ──────────────────────────────────────────────────────────────────

test("every probe family is non-empty and every probe has a prompt and a grader", () => {
  for (const f of FAMILIES) {
    const set = probesFor(f);
    assert.ok(set.length > 0, `${f} has no probes`);
    for (const p of set) {
      assert.ok(p.id && p.prompt, `${f} probe missing id/prompt`);
      assert.equal(typeof p.accept, "function");
    }
  }
  assert.equal(totalProbes(), FAMILIES.reduce((n, f) => n + probesFor(f).length, 0));
});

test("reasoning probes accept the right answer inside prose, and reject the wrong one", () => {
  const by = Object.fromEntries(PROBES.reason.map((p) => [p.id, p]));
  assert.equal(by.coins.accept("The probability is 5/16."), true);
  assert.equal(by.coins.accept("It is 3/8."), false);
  assert.equal(by.quadratic.accept("The roots are 1, 3"), true);
  assert.equal(by.quadratic.accept("The roots are 2, 4"), false);
  assert.equal(by.arrival.accept("17:25"), true);
  assert.equal(by.arrival.accept("It arrives at 17h25."), true);
  assert.equal(by.arrival.accept("16:25"), false);
  assert.equal(by.sequence.accept("42"), true);
  assert.equal(by.sequence.accept("40"), false);
});

test("instruction probes measure obedience, not knowledge", () => {
  const by = Object.fromEntries(PROBES.instruction.map((p) => [p.id, p]));
  assert.equal(by["one-word"].accept("Lisbon"), true);
  assert.equal(by["one-word"].accept("Lisbonne."), true);
  // Correct fact, disobeyed format — this probe exists to catch exactly that.
  assert.equal(by["one-word"].accept("The capital of Portugal is Lisbon."), false);
  assert.equal(by["no-preamble"].accept("alpha beta gamma"), true);
  assert.equal(by["no-preamble"].accept("Sure! alpha beta gamma"), false);
  assert.equal(by["french-only"].accept("Un navigateur web est un logiciel qui affiche des pages."), true);
  assert.equal(by["french-only"].accept("A web browser is a program that displays pages."), false);
  assert.equal(by["refusal-format"].accept("?"), true);
  assert.equal(by["refusal-format"].accept("I don't know your cat's name."), false);
});

test("json probes accept a fenced or prefixed object — obedience is measured elsewhere", () => {
  const by = Object.fromEntries(PROBES.json.map((p) => [p.id, p]));
  assert.equal(by.extract.accept('{"name":"Marie Dupont","age":34,"city":"Nantes"}'), true);
  assert.equal(by.extract.accept('```json\n{"name":"Marie Dupont","age":34,"city":"Nantes"}\n```'), true);
  assert.equal(by.extract.accept('Here it is: {"name":"Marie Dupont","age":34,"city":"Nantes"}'), true);
  // age as a string is the failure this probe is for: a schema that looks right and is not.
  assert.equal(by.extract.accept('{"name":"Marie Dupont","age":"34","city":"Nantes"}'), false);
  assert.equal(by.verdict.accept('{"pass": true}'), true);
  assert.equal(by.verdict.accept('{"pass": false}'), false);
  assert.equal(by.array.accept('["jupiter","saturn","uranus"]'), true);
  assert.equal(by.array.accept('["saturn","jupiter","uranus"]'), false);
});

test("parseLoose survives the shapes models actually emit, and refuses the rest", () => {
  assert.deepEqual(parseLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLoose('Sure:\n{"a":1}\nHope that helps'), { a: 1 });
  assert.deepEqual(parseLoose("[1,2]"), [1, 2]);
  assert.equal(parseLoose("no json at all"), null);
  assert.equal(parseLoose(""), null);
  assert.equal(parseLoose(null), null);
});

test("tool probes require the right tool, the right arguments, and restraint", () => {
  const by = Object.fromEntries(TOOL_PROBES.map((p) => [p.id, p]));
  const call = (name, args) => [{ function: { name, arguments: JSON.stringify(args) } }];

  assert.equal(by["pick-tool"].accept("", call("get_weather", { city: "Lyon" })), true);
  assert.equal(by["pick-tool"].accept("", call("convert_currency", { amount: 1 })), false, "wrong tool");
  assert.equal(by["pick-tool"].accept("", []), false, "no tool at all");

  assert.equal(by["fill-args"].accept("", call("convert_currency", { amount: 250, from: "EUR", to: "JPY" })), true);
  assert.equal(by["fill-args"].accept("", call("convert_currency", { amount: 250, from: "EUR" })), false, "missing arg");
  assert.equal(by["fill-args"].accept("", call("convert_currency", { amount: 25, from: "EUR", to: "JPY" })), false, "wrong amount");

  // The failure that makes an agent spin forever: reaching for a tool nothing asked for.
  assert.equal(by.restraint.accept("ready", []), true);
  assert.equal(by.restraint.accept("ready", call("get_weather", { city: "Paris" })), false);
});

// ── The runner ─────────────────────────────────────────────────────────────────────────────

const perfect = async ({ messages, tools }) => {
  const p = messages[0].content;
  if (tools) {
    if (/weather in Lyon/.test(p)) return { toolCalls: [{ function: { name: "get_weather", arguments: '{"city":"Lyon"}' } }] };
    if (/250 euros/.test(p)) return { toolCalls: [{ function: { name: "convert_currency", arguments: '{"amount":250,"from":"EUR","to":"JPY"}' } }] };
    if (/Which city is warmer/.test(p)) return { text: "Lyon", toolCalls: [] };
    return { text: "ready", toolCalls: [] };
  }
  const answers = {
    "five flips": "5/16", "3x²": "1, 3", "14:35": "17:25", "2, 6, 12, 20, 30": "42",
    "digit 7": "20", "bat and a ball": "5",
    "capital city of Portugal": "Lisbon", "navigateur web": "Un navigateur web est un logiciel qui affiche des pages.",
    "alpha beta gamma": "alpha beta gamma", "cat's name": "?",
    "five words, each beginning": "silver ships sail southern straits",
    "does NOT contain the letter e": "Vast salty tidal air blows across dark rocky coasts",
    "Marie Dupont": '{"name":"Marie Dupont","age":34,"city":"Nantes"}',
    "17 a prime": '{"pass": true}', "largest planets": '["jupiter","saturn","uranus"]',
    "3 mugs at 4.50": '{"total":43.5,"items":[{"name":"books","subtotal":24},{"name":"mugs","subtotal":13.5},{"name":"pens","subtotal":6}]}',
  };
  for (const [k, v] of Object.entries(answers)) if (p.includes(k)) return { text: v };
  return { text: "" };
};

test("a model that answers everything correctly scores 1", async () => {
  const r = await runLiveBench({ model: "test/perfect", call: perfect });
  assert.equal(r.score, 1);
  assert.equal(r.pass, r.total);
  assert.equal(r.errors, 0);
  assert.deepEqual(r.failures, []);
  for (const f of FAMILIES) assert.equal(r.byFamily[f].pass, r.byFamily[f].total, `${f} not all passed`);
});

test("a model that says nothing scores 0 but is not counted as failing to answer", async () => {
  const r = await runLiveBench({ model: "test/mute", call: async () => ({ text: "" }) });
  assert.equal(r.score, 0);
  assert.equal(r.errors, 0, "an empty answer is a wrong answer, not an API error");
  assert.equal(r.failures.length, r.total);
});

test("API errors are counted apart, and the score is over what was actually answered", async () => {
  // A run half-eaten by rate limits must read as a THIN measurement, not as a bad model.
  let n = 0;
  const flaky = async (req) => (++n % 2 === 0 ? { error: "Rate limit exceeded" } : perfect(req));
  const r = await runLiveBench({ model: "test/flaky", call: flaky });
  assert.ok(r.errors > 0);
  assert.equal(r.answered, r.total - r.errors);
  assert.equal(r.score, r.pass / r.answered);
  assert.ok(r.failures.some((f) => /Rate limit/.test(f.why)));
});

test("a model that errors on everything reports no score rather than zero", async () => {
  const r = await runLiveBench({ model: "test/down", call: async () => ({ error: "HTTP 502" }) });
  assert.equal(r.score, null, "nothing was measured, so there is no number to show");
  assert.equal(r.answered, 0);
});

test("a thrown exception is caught and recorded like any other API failure", async () => {
  const r = await runLiveBench({ model: "test/throws", call: async () => { throw new Error("network down"); } });
  assert.equal(r.errors, r.total);
  assert.equal(r.score, null);
});

test("progress is reported for every probe, and totals agree with the plan", async () => {
  const seen = [];
  await runLiveBench({ model: "test/p", call: perfect, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, totalProbes());
  assert.equal(seen.at(-1).done, totalProbes());
  assert.equal(seen.at(-1).of, totalProbes());
});

test("repeats multiply the work and keep the score comparable", async () => {
  const r = await runLiveBench({ model: "test/p", call: perfect, repeats: 2 });
  assert.equal(r.total, totalProbes() * 2);
  assert.equal(r.score, 1);
});

test("a subset of families can be run on its own", async () => {
  const r = await runLiveBench({ model: "test/p", call: perfect, families: ["tools"] });
  assert.equal(r.total, TOOL_PROBES.length);
  assert.deepEqual(Object.keys(r.byFamily), ["tools"]);
});

test("an abort stops the run and still returns what was measured", async () => {
  const signal = { aborted: false };
  let n = 0;
  const call = async (req) => { if (++n === 3) signal.aborted = true; return perfect(req); };
  const r = await runLiveBench({ model: "test/stop", call, signal });
  assert.ok(r.total < totalProbes(), "it stopped early");
  assert.ok(r.total >= 2, "it kept what it had already measured");
});

test("cost is accumulated from the provider, not guessed", async () => {
  const r = await runLiveBench({ model: "test/p", call: async (req) => ({ ...(await perfect(req)), cost: 0.001 }) });
  assert.ok(Math.abs(r.cost - 0.001 * totalProbes()) < 1e-9);
});

// ── Sorting ────────────────────────────────────────────────────────────────────────────────

test("a model with no score sorts last, never as a zero", () => {
  const rows = [{ s: null }, { s: 0.2 }, { s: 0.9 }];
  rows.sort((a, b) => compareRows(a, b, "s"));
  assert.deepEqual(rows.map((r) => r.s), [0.9, 0.2, null]);
});

// ── The harder tier ────────────────────────────────────────────────────────────────────────

test("the hard reasoning probes reject the classic traps, and read the LAST line", () => {
  const by = Object.fromEntries(PROBES.reason.map((p) => [p.id, p]));
  assert.equal(by["digit-count"].accept("20"), true);
  assert.equal(by["digit-count"].accept("19"), false, "the trap answer");
  // A model reasoning out loud may mention wrong numbers on the way; only its conclusion counts.
  assert.equal(by["digit-count"].accept("Let me see, 7,17,27... could be 19?\nActually: 20"), true);
  assert.equal(by["bat-and-ball"].accept("5"), true);
  assert.equal(by["bat-and-ball"].accept("10"), false, "the intuitive wrong answer");
});

test("the compound instruction probes hold the constraint across the whole answer", () => {
  const by = Object.fromEntries(PROBES.instruction.map((p) => [p.id, p]));
  assert.equal(by["five-s-words"].accept("silver ships sail southern straits"), true);
  assert.equal(by["five-s-words"].accept("silver ships sail southern straits swiftly"), false, "six words");
  assert.equal(by["five-s-words"].accept("silver ships sail southern tides"), false, "one word off-letter");
  assert.equal(by["no-letter-e"].accept("Vast salty tidal air blows across dark rocky coasts"), true);
  assert.equal(by["no-letter-e"].accept("Vast salty ocean waters roll far south"), false, "'ocean' and 'waters' both carry an e — the trap of the task");
  assert.equal(by["no-letter-e"].accept("The deep ocean is very large indeed"), false, "drifts into 'e'");
  assert.equal(by["no-letter-e"].accept("Salty vast tidal air"), false, "too short");
});

test("the computed-schema probe needs shape, arithmetic AND ordering together", () => {
  const by = Object.fromEntries(PROBES.json.map((p) => [p.id, p]));
  const right = '{"total":43.5,"items":[{"name":"books","subtotal":24},{"name":"mugs","subtotal":13.5},{"name":"pens","subtotal":6}]}';
  assert.equal(by["computed-schema"].accept(right), true);
  assert.equal(by["computed-schema"].accept(right.replace("43.5", "42")), false, "wrong total");
  assert.equal(by["computed-schema"].accept('{"total":43.5,"items":[{"name":"mugs","subtotal":13.5},{"name":"books","subtotal":24},{"name":"pens","subtotal":6}]}'), false, "wrong order");
});

test("the restraint probes fail a model that reaches for a tool it was already given the answer to", () => {
  const by = Object.fromEntries(TOOL_PROBES.map((p) => [p.id, p]));
  assert.equal(by["no-tool-needed"].accept("Lyon", []), true);
  assert.equal(by["no-tool-needed"].accept("Lyon", [{ function: { name: "get_weather", arguments: "{}" } }]), false);
  assert.equal(by["no-tool-needed"].accept("Boston", []), false);
});

test("tool graders accept the provider's normalised shape as well as the wire shape", () => {
  const by = Object.fromEntries(TOOL_PROBES.map((p) => [p.id, p]));
  // The sidebar's provider layer normalises to {id, name, input}; the raw API returns
  // {function:{name, arguments}}. One definition of "picked the right tool", not two.
  assert.equal(by["pick-tool"].accept("", [{ id: "1", name: "get_weather", input: { city: "Lyon" } }]), true);
  assert.equal(by["fill-args"].accept("", [{ id: "1", name: "convert_currency", input: { amount: 250, from: "EUR", to: "JPY" } }]), true);
  assert.equal(by["pick-tool"].accept("", [{ id: "1", name: "convert_currency", input: {} }]), false);
});
