#!/usr/bin/env node
// 🐝 Hivey quality bench — does the routing actually work, and is each role's model any good?
//
// The Hivey engine's whole claim is that picking the right model per task beats sending
// everything to the most expensive one. That claim is measurable, and until it is measured it
// is only a hope: a router that misclassifies sends "write me a quicksort" to the small-talk
// model, and the user experiences Hivey as "worse than just picking a model myself".
//
// Three things are measured, all of them decidable without a human judging taste:
//   1. ROUTER ACCURACY — labelled prompts (FR + EN) against the real dispatcher prompt. The
//      router must answer with exactly one category word, so scoring is exact-match, not vibes.
//   2. CODE CORRECTNESS — the code role is asked for a pure function with known edge cases; the
//      answer is extracted and RUN against assertions. Passing is a fact, not an impression.
//   3. COST AND LATENCY — from OpenRouter's own usage accounting, per role, per variant.
//
// Generated code runs inside `vm.runInNewContext` with an empty context and a timeout: with no
// `require`, `process` or `fetch` in scope it cannot touch the disk or the network. That is a
// deliberate limit of this bench — it measures pure functions, and nothing else should be run.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-… node scripts/bench-hivey.mjs [--variants=free,hybrid,smart]
//   OPENROUTER_API_KEY=sk-or-… node scripts/bench-hivey.mjs --candidates=modelA,modelB,…
//   OPENROUTER_API_KEY=sk-or-… node scripts/bench-hivey.mjs --memory=modelA,modelB,…
//
// The third form is the MEMORY ADMISSION bench: 30 cases, each a set of memories, a question, the
// information that must come back, and distractors that appear in no source. A model only joins
// the memory pool if it passes — auto-curation with a canary, not a pinned model.
//
// The second form is the BAKE-OFF: it runs only the code tasks, against an arbitrary list of
// models, and prints a pass rate per model. That is how the free code role was chosen — and the
// comment in hivey-models.js tells the next person to re-run it before changing that choice, so
// it has to live here rather than in someone's shell history.

import { runInNewContext } from "node:vm";
import { MEMORY_CASES, poolFor, scoreAnswer } from "./memory-cases.mjs";
import { RECALL_SYSTEM } from "../src/lib/recall.js";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.OPENROUTER_API_KEY || "";
if (!KEY) { console.error("OPENROUTER_API_KEY is required."); process.exit(2); }

const argVariants = (process.argv.find((a) => a.startsWith("--variants=")) || "").split("=")[1];
const WANTED = (argVariants || "free,hybrid,smart").split(",").map((s) => `hivey/${s.trim()}`);

// Read the committed assignments straight from the source of truth, so the bench always tests
// what actually ships rather than a copy that drifts.
function loadModels() {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "hivey-models.js"), "utf8");
  const start = src.indexOf("{", src.indexOf("HIVEY_MODELS"));
  return new Function(`return (${src.slice(start, src.lastIndexOf("}") + 1)});`)();
}

// The dispatcher prompt, verbatim from models.js — testing a paraphrase would measure nothing.
function loadRouterSystem() {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "models.js"), "utf8");
  const m = /export const HIVEY_ROUTER_SYSTEM =([\s\S]*?);\n/.exec(src);
  if (!m) throw new Error("HIVEY_ROUTER_SYSTEM not found in models.js");
  return new Function(`return (${m[1]});`)();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(model, messages, { maxTokens = 900, temperature = 0, attempt = 0 } = {}) {
  const t0 = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, usage: { include: true } }),
  });
  const j = await r.json().catch(() => ({}));
  const ms = Date.now() - t0;
  // Free models are rate-limited per MINUTE. Counting a 429 as a wrong answer would slander the
  // model for the bench's own impatience, so we wait it out instead of scoring it.
  const errMsg = (j.error && j.error.message) || "";
  if ((r.status === 429 || /rate limit/i.test(errMsg)) && attempt < 4) {
    await sleep(12000 * (attempt + 1));
    return chat(model, messages, { maxTokens, temperature, attempt: attempt + 1 });
  }
  if (!r.ok) return { ok: false, ms, error: errMsg || `HTTP ${r.status}`, cost: 0 };
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  return {
    ok: true,
    ms,
    text: (msg.content || "").trim(),
    cost: (j.usage && j.usage.cost) || 0,
    tokens: (j.usage && j.usage.completion_tokens) || 0,
  };
}

// ── 1. Router accuracy ───────────────────────────────────────────────────────────────────────
// French and English mixed on purpose: the sidebar ships in six languages and a router that only
// classifies English would silently degrade for most of its users.
const ROUTER_CASES = [
  ["Bonjour, ça va ?", "light"],
  ["hi", "light"],
  ["Quelle est la capitale du Portugal ?", "light"],
  ["Merci beaucoup !", "light"],
  ["Explique-moi la différence entre HTTP et HTTPS", "normal"],
  ["Summarise the pros and cons of remote work", "normal"],
  ["Quels sont les symptômes d'une carence en fer ?", "normal"],
  ["Écris une fonction Python qui inverse une liste chaînée", "code"],
  ["Fix this: TypeError: cannot read property 'map' of undefined in my React component", "code"],
  ["Refactor ce composant Vue pour utiliser la Composition API", "code"],
  ["Write a SQL query joining orders and customers by id", "code"],
  ["Write unit tests with pytest for a function that parses ISO dates", "test"],
  ["Ajoute des tests Jest pour ce reducer Redux", "test"],
  ["Résous l'équation 3x² - 12x + 9 = 0", "math"],
  ["What is the probability of getting three heads in five fair coin flips?", "math"],
  ["Démontre par récurrence que la somme des n premiers entiers vaut n(n+1)/2", "math"],
  ["Quel temps fait-il à Lyon aujourd'hui ?", "search"],
  ["What's the latest news about the EU AI Act?", "search"],
  ["Quel est le prix actuel du Bitcoin ?", "search"],
  ["Écris un poème sur l'automne en Bretagne", "creative"],
  ["Draft a punchy launch email for a new productivity app", "creative"],
  ["Trouve-moi 10 noms de marque pour une boutique de café", "creative"],
  ["Design a fault-tolerant architecture for a multi-region payment system and justify each trade-off", "hard"],
  ["Analyse en profondeur les risques de sécurité d'un modèle d'authentification par magic link", "hard"],
];

async function benchRouter(model, routerSystem) {
  let hit = 0, cost = 0, ms = 0, failures = [];
  for (const [prompt, expected] of ROUTER_CASES) {
    const r = await chat(model, [
      { role: "system", content: routerSystem },
      { role: "user", content: prompt },
    ], { maxTokens: 800 });
    cost += r.cost; ms += r.ms;
    const word = (r.text || "").toLowerCase().replace(/[^a-z]/g, "");
    if (word === expected) hit++;
    else failures.push(`${expected}→${word || (r.error ? "ERR:" + r.error : "∅")}  «${prompt.slice(0, 44)}»`);
  }
  return { total: ROUTER_CASES.length, hit, cost, ms, failures };
}

// ── 2. Code correctness ──────────────────────────────────────────────────────────────────────
// Small, unambiguous, edge-case-heavy tasks. A model that only handles the happy path fails.
const CODE_TASKS = [
  {
    name: "chunk",
    prompt:
      "Write a JavaScript function `chunk(arr, size)` that splits an array into consecutive chunks of `size`. " +
      "If size is not a positive integer, return []. The last chunk may be shorter. " +
      "Reply with ONLY the function inside a ```js code block, no explanation, no exports.",
    checks: `
      assert(JSON.stringify(chunk([1,2,3,4,5],2)) === "[[1,2],[3,4],[5]]", "basic split");
      assert(JSON.stringify(chunk([],3)) === "[]", "empty input");
      assert(JSON.stringify(chunk([1,2],0)) === "[]", "size 0");
      assert(JSON.stringify(chunk([1,2],-1)) === "[]", "negative size");
      assert(JSON.stringify(chunk([1,2],1.5)) === "[]", "non-integer size");
      assert(JSON.stringify(chunk([1,2,3],10)) === "[[1,2,3]]", "size larger than array");
    `,
  },
  {
    name: "parseDuration",
    prompt:
      "Write a JavaScript function `parseDuration(s)` that turns a duration string like \"1h30m\", \"45s\", " +
      "\"2h\", \"90m\" into a number of SECONDS. Supported units: h, m, s, in any combination and order of " +
      "appearance left to right. Return null for anything unparseable (empty string, \"abc\", \"5x\", null). " +
      "Reply with ONLY the function inside a ```js code block, no explanation, no exports.",
    checks: `
      assert(parseDuration("1h30m") === 5400, "1h30m");
      assert(parseDuration("45s") === 45, "45s");
      assert(parseDuration("2h") === 7200, "2h");
      assert(parseDuration("90m") === 5400, "90m");
      assert(parseDuration("1h2m3s") === 3723, "combined");
      assert(parseDuration("abc") === null, "garbage");
      assert(parseDuration("") === null, "empty");
      assert(parseDuration("5x") === null, "bad unit");
      assert(parseDuration(null) === null, "null input");
    `,
  },
];

function extractCode(text) {
  const fenced = /```(?:js|javascript)?\s*\n([\s\S]*?)```/i.exec(text || "");
  return (fenced ? fenced[1] : text || "").trim();
}

function runCode(code, checks) {
  const failures = [];
  const sandbox = {
    assert(cond, label) { if (!cond) failures.push(label); },
    // Deliberately nothing else: no require, no process, no fetch, no timers.
  };
  try {
    runInNewContext(`${code}\n;(function(){${checks}})();`, sandbox, { timeout: 2000 });
  } catch (e) {
    // Two different failures wear the same "0 points" here, and conflating them makes the
    // numbers unreadable: code that does not PARSE (typically TypeScript annotations when the
    // task asked for JavaScript — an instruction-following miss) versus code that parses and
    // computes the wrong answer. Only the second says anything about coding ability.
    const msg = String(e.message);
    const kind = /Unexpected token|Invalid or unexpected|missing \)|Unexpected identifier/.test(msg)
      ? (/:\s*(string|number|boolean|any|unknown|void|[A-Z]\w*)\b/.test(code) ? "syntax(TS not JS)" : "syntax")
      : "runtime";
    return { pass: false, kind, failures: [`${kind}: ${msg.slice(0, 70)}`] };
  }
  return { pass: failures.length === 0, kind: failures.length ? "logic" : "ok", failures };
}

async function benchCode(model, repeats = 1) {
  let pass = 0, cost = 0, ms = 0;
  const detail = [];
  const kinds = {};
  for (let run = 0; run < repeats; run++)
  for (const task of CODE_TASKS) {
    // 2000 was too tight: a free model that emits reasoning before its answer got TRUNCATED,
    // and a truncated function fails every assertion — the bench blamed the model for its own
    // budget. Measuring badly is worse than not measuring.
    const r = await chat(model, [{ role: "user", content: task.prompt }], { maxTokens: 6000 });
    cost += r.cost; ms += r.ms;
    if (!r.ok) { detail.push(`${task.name}: API ${r.error}`); continue; }
    const res = runCode(extractCode(r.text), task.checks);
    kinds[res.kind] = (kinds[res.kind] || 0) + 1;
    if (res.pass) { pass++; detail.push(`${task.name}: pass`); }
    else detail.push(`${task.name}: FAIL (${res.failures.join(", ")})`);
  }
  return { total: CODE_TASKS.length * repeats, pass, cost, ms, detail, kinds };
}

// ── Memory admission ─────────────────────────────────────────────────────────────────────────
// Thresholds. Fabrication is the strict one on purpose: a model that recalls little is
// disappointing, a model that invents is unusable — it sounds MORE helpful than the honest one and
// is wrong in a way the main model cannot detect.
const ADMIT_RECALL = 0.8;
const ADMIT_FABRICATION = 0.1;
// Latency was measured from the start but not GATED on, and the first real run showed why it must
// be: a model scored 100% recall at 22.7 SECONDS per lookup. The recall role sits between a
// question and its answer — perfect recall that arrives after the user has given up is not a
// better answer, it is a worse product. Six seconds leaves margin under the 8s hard timeout.
const ADMIT_MS = { recall: 6000, extract: 30000, consolidate: 60000 };

async function benchMemory(model) {
  let recalled = 0, fabricated = 0, errors = 0, ms = 0, cost = 0;
  const failures = [];
  for (const c of MEMORY_CASES) {
    const memories = poolFor(c.pool).map((m, i) => `[${i + 1}] (fact) ${m}`).join("\n");
    const r = await chat(model, [
      { role: "system", content: RECALL_SYSTEM },
      { role: "user", content: `QUESTION:\n${c.q}\n\nMEMORIES:\n${memories}` },
    ], { maxTokens: 1200 });
    ms += r.ms; cost += r.cost || 0;
    if (!r.ok) { errors++; continue; }
    const s = scoreAnswer(r.text, c);
    if (s.recalled) recalled++; else failures.push(`miss: ${c.q}`);
    if (s.fabricated) { fabricated++; failures.push(`INVENTED: ${c.q}`); }
  }
  const answered = MEMORY_CASES.length - errors;
  return {
    model, answered, errors,
    recall: answered ? recalled / answered : 0,
    fabrication: answered ? fabricated / answered : 1,
    ms: answered ? Math.round(ms / answered) : 0,
    cost, failures,
  };
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────
const memoryArg = (process.argv.find((a) => a.startsWith("--memory=")) || "").split("=")[1];
if (memoryArg) {
  const models = memoryArg.split(",").map((m) => m.trim()).filter(Boolean);
  console.log(`Memory admission: ${MEMORY_CASES.length} cases, ${models.length} model(s).`);
  console.log(`Admitted at recall >= ${ADMIT_RECALL} and fabrication <= ${ADMIT_FABRICATION}.\n`);
  const role = (process.argv.find((a) => a.startsWith("--role=")) || "").split("=")[1] || "recall";
  const msCap = ADMIT_MS[role] ?? ADMIT_MS.recall;
  console.log(`Role "${role}": latency ceiling ${msCap} ms.\n`);
  for (const model of models) {
    const r = await benchMemory(model);
    // Each reason is named. "REJECT" alone tells you nothing you can act on.
    const why = [];
    if (r.recall < ADMIT_RECALL) why.push(`recall ${(r.recall * 100).toFixed(0)}% < ${ADMIT_RECALL * 100}%`);
    if (r.fabrication > ADMIT_FABRICATION) why.push(`invents ${(r.fabrication * 100).toFixed(0)}% > ${ADMIT_FABRICATION * 100}%`);
    if (r.ms > msCap) why.push(`${r.ms}ms > ${msCap}ms`);
    console.log(`${why.length ? "REJECT" : "ADMIT "}  recall ${(r.recall * 100).toFixed(0).padStart(3)}%  invented ${(r.fabrication * 100).toFixed(0).padStart(3)}%  ${String(r.ms).padStart(6)}ms  $${r.cost.toFixed(4)}  ${model}${r.errors ? `  (${r.errors} errors)` : ""}`);
    if (why.length) console.log(`         rejected: ${why.join(", ")}`);
    r.failures.slice(0, 4).forEach((f) => console.log(`         ${f}`));
  }
  process.exit(0);
}

const candidateArg = (process.argv.find((a) => a.startsWith("--candidates=")) || "").split("=")[1];
if (candidateArg) {
  const models = candidateArg.split(",").map((m) => m.trim()).filter(Boolean);
  // These models are not deterministic even at temperature 0, and a single run of three tasks
  // ranks noise as often as it ranks models: the same model scored 3/3 and then 1/2 on
  // consecutive runs. Repeats are the difference between a measurement and an anecdote.
  const repeats = Number((process.argv.find((a) => a.startsWith("--repeat=")) || "").split("=")[1]) || 3;
  console.log(`Bake-off: ${CODE_TASKS.length} code tasks x ${repeats} run(s), ${models.length} model(s).\n`);
  const rows = [];
  for (const model of models) {
    const r = await benchCode(model, repeats);
    rows.push({ model, ...r });
    const kinds = Object.entries(r.kinds).map(([k, n]) => `${k}:${n}`).join(" ");
    console.log(`${String(r.pass).padStart(2)}/${r.total}  ${model.padEnd(46)} ${kinds}`);
  }
  rows.sort((a, b) => b.pass - a.pass || a.ms - b.ms);
  console.log(`\nBest: ${rows[0].model} (${rows[0].pass}/${rows[0].total})`);
  console.log("A model that scores 0 may simply have run out of free-tier retries — check it answers at all before concluding.");
  process.exit(0);
}

const MODELS = loadModels();
const routerSystem = loadRouterSystem();
const report = { at: new Date().toISOString(), variants: {} };

for (const variant of WANTED) {
  const roles = MODELS[variant];
  if (!roles) { console.log(`skip ${variant}: not in hivey-models.js`); continue; }
  console.log(`\n=== ${variant} ===`);
  console.log(`router: ${roles.router}`);
  const router = await benchRouter(roles.router, routerSystem);
  console.log(`  routing  ${router.hit}/${router.total} (${Math.round((100 * router.hit) / router.total)}%)  ${Math.round(router.ms / router.total)}ms/call  $${router.cost.toFixed(4)}`);
  router.failures.forEach((f) => console.log(`    ✗ ${f}`));

  console.log(`code:   ${roles.code}`);
  const code = await benchCode(roles.code);
  console.log(`  code     ${code.pass}/${code.total}  ${Math.round(code.ms / code.total)}ms/call  $${code.cost.toFixed(4)}`);
  code.detail.forEach((d) => console.log(`    · ${d}`));

  report.variants[variant] = { router: { model: roles.router, ...router }, code: { model: roles.code, ...code } };
}

const out = join(__dirname, "..", "bench-hivey.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nreport → ${out}`);
