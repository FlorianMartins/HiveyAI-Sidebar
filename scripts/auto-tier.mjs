#!/usr/bin/env node
// 🐝 Auto-tiering — keep every Hivey role on the best model that still fits the variant.
//
// WHY THIS EXISTS
// ---------------
// `update-models.mjs` keeps the CATALOGUE fresh: new models appear, retired ones leave. It does
// not decide which model should ANSWER — it only ever promotes a role to a newer sibling of the
// same family, which cannot notice that a different family has overtaken it.
//
// The obvious alternative is to trust the curated index in src/lib/benchmarks.js. It is a table
// of hand-tuned numbers, and it rots exactly where it matters — on the models that are new:
//
//     curated index        executed against assertions (4 repeats)
//     laguna-s-2.1   60    6/8   ← the "code-specialised" one
//     nemotron-3.5   62    8/8
//     nemotron-super 74    8/8
//
// It rates the best free coder at 62 and a worse one at 60. That is a reputation guessed from
// the vendor's name, not a measurement, and no amount of editing keeps it honest as models ship.
//
// So the two are given the jobs they can actually do:
//
//     the curated index SHORTLISTS  (cheap, instant, ranks 400 models roughly)
//     the executable bench DECIDES  (slow, costs a little, but it is a fact)
//
// A role is promoted only when a challenger BEATS the incumbent, re-measured in the same run so
// both face the same conditions, by a margin wide enough that noise cannot cause it — because
// these models are not deterministic even at temperature 0, and a single pass ranks noise.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-… node scripts/auto-tier.mjs                 # dry run, free variant
//   OPENROUTER_API_KEY=sk-or-… node scripts/auto-tier.mjs --apply
//   … --variants=free,hybrid,smart --roles=code,agent --repeat=3 --max-spend=0.50 --shortlist=3

import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { modelScore } from "../src/lib/benchmarks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HIVEY_FILE = join(__dirname, "..", "src", "lib", "hivey-models.js");
const API = "https://openrouter.ai/api/v1";

// ── What each role has to be able to do ──────────────────────────────────────────────────────
// Hard gates first: a model that cannot call a tool cannot be the agent, however well it writes.
// `category` is the column to read in the curated index; `probes` is what actually gets measured.
export const ROLES = {
  router:    { category: "global",       probes: "classify", ctx: 8_000 },
  utility:   { category: "writing",      probes: "instruction", ctx: 16_000 },
  light:     { category: "global",       probes: "instruction", ctx: 8_000 },
  chat:      { category: "global",       probes: "instruction", ctx: 32_000 },
  code:      { category: "code",         probes: "code", ctx: 32_000 },
  test:      { category: "code",         probes: "code", ctx: 32_000 },
  reasoning: { category: "reasoning",    probes: "reason", ctx: 32_000 },
  math:      { category: "reasoning",    probes: "reason", ctx: 16_000 },
  creative:  { category: "writing",      probes: "instruction", ctx: 16_000 },
  extract:   { category: "global",       probes: "json", ctx: 32_000 },
  verify:    { category: "reasoning",    probes: "json", ctx: 32_000 },
  agent:     { category: "agent",        probes: "tools", ctx: 64_000, needsTools: true },
  search:    { category: "global",       probes: "instruction", ctx: 32_000 },
  // Not automatable from a headless script without fixtures, so they are never touched here and
  // the report says so — a role silently left behind looks the same as a role deliberately kept.
  vision:    { category: "global",       probes: null, needsImageIn: true },
  image:     { category: "image",        probes: null, needsImageOut: true },
};

const NOT_ELIGIBLE = /preview|-exp\b|experimental|:batch\b|multi-agent|deep-research|search-preview|:online|-20\d{6}\b/i;

// ── Probes ───────────────────────────────────────────────────────────────────────────────────
// Every probe is graded by a program, never by taste. That is the whole point: "which model is
// better" has to survive being asked twice.

const CODE_PROBES = [
  {
    name: "chunk",
    prompt: "Write a JavaScript function `chunk(arr, size)` that splits an array into consecutive chunks of `size`. " +
      "If size is not a positive integer, return []. The last chunk may be shorter. " +
      "Reply with ONLY the function inside a ```js code block, no explanation, no exports, no TypeScript types.",
    checks: `assert(JSON.stringify(chunk([1,2,3,4,5],2))==="[[1,2],[3,4],[5]]","basic");
             assert(JSON.stringify(chunk([],3))==="[]","empty");
             assert(JSON.stringify(chunk([1,2],0))==="[]","size 0");
             assert(JSON.stringify(chunk([1,2],-1))==="[]","negative");
             assert(JSON.stringify(chunk([1,2],1.5))==="[]","fractional");
             assert(JSON.stringify(chunk([1,2,3],10))==="[[1,2,3]]","oversize");`,
  },
  {
    name: "parseDuration",
    prompt: "Write a JavaScript function `parseDuration(s)` turning \"1h30m\", \"45s\", \"2h\", \"90m\" into SECONDS. " +
      "Units h, m, s in any combination, left to right. Return null for anything unparseable (\"\", \"abc\", \"5x\", null). " +
      "Reply with ONLY the function inside a ```js code block, no explanation, no exports, no TypeScript types.",
    checks: `assert(parseDuration("1h30m")===5400,"1h30m"); assert(parseDuration("45s")===45,"45s");
             assert(parseDuration("2h")===7200,"2h"); assert(parseDuration("90m")===5400,"90m");
             assert(parseDuration("1h2m3s")===3723,"combined"); assert(parseDuration("abc")===null,"garbage");
             assert(parseDuration("")===null,"empty"); assert(parseDuration("5x")===null,"bad unit");
             assert(parseDuration(null)===null,"null");`,
  },
  {
    name: "groupBy",
    prompt: "Write a JavaScript function `groupBy(arr, keyFn)` returning an object grouping items by the string key " +
      "keyFn(item) returns, preserving insertion order within each group. If arr is not an array, return {}. " +
      "Reply with ONLY the function inside a ```js code block, no explanation, no exports, no TypeScript types.",
    checks: `const r=groupBy([1,2,3,4],n=>n%2?"odd":"even");
             assert(JSON.stringify(r.odd)==="[1,3]","odd"); assert(JSON.stringify(r.even)==="[2,4]","even");
             assert(JSON.stringify(groupBy(null,x=>x))==="{}","not an array");`,
  },
];

// Short, unambiguous answers. Graded on the extracted final value, so a model that reasons at
// length is not penalised for it — only for being wrong.
const REASON_PROBES = [
  { name: "coins", prompt: "In five flips of a fair coin, what is the probability of exactly three heads? Reply with the reduced fraction only, e.g. 3/8.", accept: (t) => /(^|\D)5\s*\/\s*16(\D|$)/.test(t) },
  { name: "quadratic", prompt: "Solve 3x² - 12x + 9 = 0. Reply with the two roots only, smallest first, like: 1, 3", accept: (t) => /1\D+3/.test(t.replace(/[^0-9,.\s-]/g, " ")) },
  { name: "trains", prompt: "A train leaves at 14:35 and the journey takes 2 h 50 min. At what time does it arrive? Reply with the time only, 24h format.", accept: (t) => /17\s*[:h]\s*25/.test(t) },
];

// Instruction-following, which is what the chat/light/creative roles actually live or die by.
const INSTRUCTION_PROBES = [
  { name: "one-word", prompt: "Reply with exactly one word, nothing else: the capital city of Portugal.", accept: (t) => /^\W*lisbo(n|a|nne)\W*$/i.test(t.trim()) },
  { name: "language", prompt: "Répondez UNIQUEMENT en français, en une seule phrase : qu'est-ce qu'un navigateur web ?", accept: (t) => /\b(le|la|un|une|est|qui|pour|des)\b/i.test(t) && !/\b(the|is|that|which)\b/i.test(t) },
  { name: "no-preamble", prompt: "Output the three words: alpha beta gamma. No preamble, no punctuation, no explanation.", accept: (t) => /^\W*alpha\s+beta\s+gamma\W*$/i.test(t.trim()) },
];

const JSON_PROBES = [
  {
    name: "strict-json",
    prompt: 'Extract the fields from this sentence and reply with ONLY a JSON object, no code fence, no prose: ' +
      '"Marie Dupont, 34 ans, habite à Nantes." Keys exactly: name, age, city. age must be a number.',
    accept: (t) => {
      try {
        const m = /\{[\s\S]*\}/.exec(t);
        const o = JSON.parse(m ? m[0] : t);
        return typeof o.age === "number" && /nantes/i.test(String(o.city)) && /dupont/i.test(String(o.name));
      } catch { return false; }
    },
  },
  {
    name: "verdict-json",
    prompt: 'Reply with ONLY {"pass": true} or {"pass": false}. Nothing else. Question: is 17 a prime number?',
    accept: (t) => { try { const m = /\{[\s\S]*\}/.exec(t); return JSON.parse(m ? m[0] : t).pass === true; } catch { return false; } },
  },
];

// The router is scored against the SHIPPING dispatcher prompt; testing a paraphrase would measure
// a prompt that does not exist. Kept short here — the full 24-case set lives in bench-hivey.mjs.
const CLASSIFY_PROBES = [
  ["Bonjour, ça va ?", "light"], ["Explique-moi la différence entre HTTP et HTTPS", "normal"],
  ["Écris une fonction Python qui inverse une liste chaînée", "code"],
  ["Ajoute des tests Jest pour ce reducer Redux", "test"],
  ["Résous l'équation 3x² - 12x + 9 = 0", "math"],
  ["Quel est le prix actuel du Bitcoin ?", "search"],
  ["Écris un poème sur l'automne en Bretagne", "creative"],
  ["Analyse en profondeur les risques d'un modèle d'authentification par magic link", "hard"],
];

// Two tools, not one. With a single tool on offer, every model scored 2/2 and the probe ranked
// nothing — a test everyone passes measures nothing. Picking the RIGHT tool from a set, and
// filling its arguments, is the skill the agent role actually needs.
const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_currency",
      description: "Convert an amount from one currency to another.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
        required: ["amount", "from", "to"],
      },
    },
  },
];

// ── Pure decision logic (tested in tests/autoTier.test.js — no network involved) ──────────────

/** A promotion must not quietly change what the variant IS. The variant's identity is its price
 *  envelope: Free is free, Smart is cheap, Pro is allowed to be dear. Expressed relative to the
 *  incumbent, that is one rule instead of three tables that would drift apart. */
export function withinBudget(incumbentPrice, candidatePrice, headroom = 1.5) {
  if (incumbentPrice === 0) return candidatePrice === 0;   // free stays free, exactly
  return candidatePrice <= incumbentPrice * headroom;
}

/** Hard capability gates. These are facts from the catalogue, not judgement. */
export function passesGates(model, role) {
  const spec = ROLES[role];
  if (!spec) return false;
  if (/^~/.test(model.id)) return false;                    // moving alias: not a stable id to commit
  if (NOT_ELIGIBLE.test(model.id)) return false;
  const out = model.architecture?.output_modalities || ["text"];
  const inp = model.architecture?.input_modalities || ["text"];
  if (spec.needsTools && !(model.supported_parameters || []).includes("tools")) return false;
  if (spec.needsImageOut && !out.includes("image")) return false;
  if (spec.needsImageIn && !inp.includes("image")) return false;
  if (!spec.needsImageOut && !out.includes("text")) return false;
  if (spec.ctx && (model.context_length || 0) < spec.ctx) return false;
  return true;
}

/** The cheap prior: rank by the curated index, but never let it be the only voice. A model the
 *  table has never heard of gets the vendor default, which is what buried nemotron-3.5 at 62 —
 *  so recency lifts newcomers into the shortlist, where the bench can speak for them. */
export function shortlist(models, role, incumbentId, { size = 3, newest = 0, incumbentPrice = null } = {}) {
  const spec = ROLES[role];
  // The price envelope is a GATE, not a tie-breaker. Applying it only at the decision stage
  // meant the free variant shortlisted Opus and GLM, paid real money to measure them, and then
  // discarded both for being paid — money spent to learn something the catalogue already knew.
  const affordable = (m) =>
    incumbentPrice == null || withinBudget(incumbentPrice, m?.pricing?.completion ? +m.pricing.completion * 1e6 : 0);
  const scored = models
    .filter((m) => passesGates(m, role) && affordable(m))
    .map((m) => {
      const prior = modelScore(m.id, spec.category) ?? 60;
      const freshness = newest ? ((m.created || 0) / newest) : 0;
      return { model: m, rank: prior + 8 * freshness };
    })
    .sort((a, b) => b.rank - a.rank);

  const out = [];
  const seen = new Set();
  for (const { model } of scored) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
    if (out.length >= size) break;
  }

  // One slot is always reserved for the NEWEST eligible model, whatever the prior thinks of it.
  // Recency as a bonus is not enough: a family the table has never heard of gets the vendor
  // default, and a mere +8 can never out-rank an entry the table already admires — so the exact
  // models most likely to have overtaken the incumbent would be the ones never measured. This is
  // the cheapest possible insurance against a stale table: measure one newcomer, every run.
  const newcomer = scored.map((x) => x.model)
    .filter((m) => !seen.has(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0))[0];
  if (newcomer) { seen.add(newcomer.id); out.push(newcomer); }
  // The incumbent is always measured too, in the same run and the same conditions. Comparing a
  // fresh challenger against a score recorded last week compares the weather, not the models.
  if (incumbentId && !seen.has(incumbentId)) {
    const inc = models.find((m) => m.id === incumbentId);
    if (inc) out.push(inc);   // measured whatever its price: it is the thing being compared against
  }
  return out;
}

/** Hysteresis. These models are not deterministic, so a hair's-breadth win is noise, and churning
 *  the assignment every night would make the product feel different for no reason the user can
 *  see. A challenger has to be clearly better, and ties go to whoever already holds the job. */
export function decidePromotion(incumbent, challengers, { margin = 0.12 } = {}) {
  const field = challengers.filter((c) => c.score != null).sort((a, b) =>
    b.score - a.score || a.ms - b.ms || a.price - b.price);
  const best = field[0];
  if (!best || !incumbent || best.id === incumbent.id) return { promote: false, reason: "incumbent still best" };
  if (best.score < incumbent.score + margin) {
    return { promote: false, reason: `margin not met (${best.score.toFixed(2)} vs ${incumbent.score.toFixed(2)}, need +${margin})` };
  }
  if (!withinBudget(incumbent.price, best.price)) {
    return { promote: false, reason: `over budget (${best.price.toFixed(2)}/M vs incumbent ${incumbent.price.toFixed(2)}/M)` };
  }
  return { promote: true, to: best, reason: `${best.score.toFixed(2)} vs ${incumbent.score.toFixed(2)}` };
}

// ── Measuring ────────────────────────────────────────────────────────────────────────────────

const KEY = process.env.OPENROUTER_API_KEY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let spent = 0;

async function chat(model, messages, { tools, maxTokens = 6000, attempt = 0 } = {}) {
  const t0 = Date.now();
  const r = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, max_tokens: maxTokens, temperature: 0, usage: { include: true } }),
  });
  const j = await r.json().catch(() => ({}));
  const err = j.error?.message || "";
  // A 429 is the bench's own impatience, not the model's answer. Waiting is the honest response.
  if ((r.status === 429 || /rate limit/i.test(err)) && attempt < 4) {
    await sleep(12_000 * (attempt + 1));
    return chat(model, messages, { tools, maxTokens, attempt: attempt + 1 });
  }
  spent += j.usage?.cost || 0;
  if (!r.ok) return { ok: false, ms: Date.now() - t0, error: err || `HTTP ${r.status}` };
  const msg = j.choices?.[0]?.message || {};
  return { ok: true, ms: Date.now() - t0, text: (msg.content || "").trim(), toolCalls: msg.tool_calls || [] };
}

const extractCode = (t) => {
  const f = /```(?:js|javascript)?\s*\n([\s\S]*?)```/i.exec(t || "");
  return (f ? f[1] : t || "").trim();
};

function runCode(code, checks) {
  const failures = [];
  // No require, no process, no fetch, no timers in scope: the generated function cannot reach the
  // disk or the network. This measures pure functions, and nothing else should be run here.
  try {
    runInNewContext(`${code}\n;(function(){${checks}})();`, { assert: (c, l) => { if (!c) failures.push(l); } }, { timeout: 2000 });
  } catch { return false; }
  return failures.length === 0;
}

async function scoreModel(model, role, routerSystem, repeats) {
  const kind = ROLES[role].probes;
  if (!kind) return null;
  let pass = 0, total = 0, ms = 0;

  for (let run = 0; run < repeats; run++) {
    if (kind === "code") {
      for (const p of CODE_PROBES) {
        const r = await chat(model, [{ role: "user", content: p.prompt }]);
        total++; ms += r.ms;
        if (r.ok && runCode(extractCode(r.text), p.checks)) pass++;
      }
    } else if (kind === "reason" || kind === "instruction" || kind === "json") {
      const set = kind === "reason" ? REASON_PROBES : kind === "json" ? JSON_PROBES : INSTRUCTION_PROBES;
      for (const p of set) {
        const r = await chat(model, [{ role: "user", content: p.prompt }]);
        total++; ms += r.ms;
        if (r.ok && p.accept(r.text || "")) pass++;
      }
    } else if (kind === "classify") {
      for (const [prompt, expected] of CLASSIFY_PROBES) {
        const r = await chat(model, [{ role: "system", content: routerSystem }, { role: "user", content: prompt }], { maxTokens: 800 });
        total++; ms += r.ms;
        if (r.ok && (r.text || "").toLowerCase().replace(/[^a-z]/g, "") === expected) pass++;
      }
    } else if (kind === "tools") {
      const call = async (content) => chat(model, [{ role: "user", content }], { tools: AGENT_TOOLS, maxTokens: 2000 });
      const argsOf = (c) => { try { return JSON.parse(c?.function?.arguments || "{}"); } catch { return {}; } };

      // 1. Pick the right tool and fill it.
      const r1 = await call("What is the weather in Lyon right now?");
      total++; ms += r1.ms;
      const c1 = r1.toolCalls?.[0];
      if (c1?.function?.name === "get_weather" && /lyon/i.test(argsOf(c1).city || "")) pass++;

      // 2. Pick the OTHER tool, with three arguments to get right — this is where models that
      //    merely recognise "a tool exists" start to fall over.
      const r2 = await call("How much is 250 euros in Japanese yen?");
      total++; ms += r2.ms;
      const c2 = r2.toolCalls?.[0], a2 = argsOf(c2);
      if (c2?.function?.name === "convert_currency" && Number(a2.amount) === 250
          && /eur/i.test(a2.from || "") && /jpy|yen/i.test(a2.to || "")) pass++;

      // 3. Do NOT call a tool when none is needed. This is the failure that makes an agent spin
      //    forever on "hello", and no amount of tool-calling skill compensates for it.
      const r3 = await call("Say the word ready and nothing else.");
      total++; ms += r3.ms;
      if (r3.ok && !(r3.toolCalls || []).length && /ready/i.test(r3.text || "")) pass++;
    }
  }
  return { score: total ? pass / total : 0, pass, total, ms: total ? Math.round(ms / total) : 0 };
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : fallback;
}

function loadAssignments() {
  const src = readFileSync(HIVEY_FILE, "utf8");
  const start = src.indexOf("{", src.indexOf("HIVEY_MODELS"));
  return { src, models: new Function(`return (${src.slice(start, src.lastIndexOf("}") + 1)});`)() };
}

function loadRouterSystem() {
  const src = readFileSync(join(__dirname, "..", "src", "lib", "models.js"), "utf8");
  const m = /export const HIVEY_ROUTER_SYSTEM =([\s\S]*?);\n/.exec(src);
  return m ? new Function(`return (${m[1]});`)() : "";
}

const priceOf = (m) => (m?.pricing?.completion ? +m.pricing.completion * 1e6 : 0);

async function main() {
  if (!KEY) { console.error("OPENROUTER_API_KEY is required."); process.exit(2); }
  const APPLY = process.argv.includes("--apply");
  const repeats = Number(arg("repeat", 3));
  const size = Number(arg("shortlist", 3));
  const maxSpend = Number(arg("max-spend", 0.5));
  const wantVariants = arg("variants", "free").split(",").map((v) => `hivey/${v.trim()}`);
  const wantRoles = arg("roles", "").split(",").map((r) => r.trim()).filter(Boolean);

  const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  const all = ((await res.json()).data || []).filter((m) => m?.id);
  const byId = new Map(all.map((m) => [m.id, m]));
  const newest = Math.max(...all.map((m) => m.created || 0), 1);

  const { src, models: current } = loadAssignments();
  const routerSystem = loadRouterSystem();
  const merged = JSON.parse(JSON.stringify(current));
  const changes = [];
  const skipped = [];

  console.log(`Auto-tiering — ${repeats} repeat(s), shortlist ${size}, budget $${maxSpend}. ${APPLY ? "APPLY" : "dry run"}\n`);

  for (const variant of wantVariants) {
    if (!current[variant]) { console.log(`skip ${variant}: not in hivey-models.js`); continue; }
    for (const role of Object.keys(current[variant])) {
      if (wantRoles.length && !wantRoles.includes(role)) continue;
      if (!ROLES[role]?.probes) { skipped.push(`${variant}.${role} (no automatable probe)`); continue; }
      if (spent >= maxSpend) { skipped.push(`${variant}.${role} (budget reached)`); continue; }

      const incumbentId = current[variant][role];
      const pool = shortlist(all, role, incumbentId, { size, newest, incumbentPrice: priceOf(byId.get(incumbentId)) });
      if (!pool.length) { skipped.push(`${variant}.${role} (nothing passes the gates)`); continue; }

      console.log(`── ${variant}.${role}  (incumbent: ${incumbentId})`);
      const results = [];
      for (const m of pool) {
        const s = await scoreModel(m.id, role, routerSystem, repeats);
        if (!s) continue;
        results.push({ id: m.id, price: priceOf(m), ...s });
        console.log(`   ${(s.score * 100).toFixed(0).padStart(3)}%  ${String(s.pass).padStart(2)}/${s.total}  ${String(s.ms).padStart(5)}ms  ${m.id}${m.id === incumbentId ? "  (incumbent)" : ""}`);
      }
      const incumbent = results.find((r) => r.id === incumbentId)
        || { id: incumbentId, score: 0, price: priceOf(byId.get(incumbentId)), ms: 0 };
      const verdict = decidePromotion(incumbent, results);
      if (verdict.promote) {
        merged[variant][role] = verdict.to.id;
        changes.push(`${variant}.${role}: ${incumbentId} → ${verdict.to.id}  (${verdict.reason})`);
        console.log(`   ⇧ PROMOTE → ${verdict.to.id}  (${verdict.reason})`);
      } else {
        console.log(`   = keep ${incumbentId}  (${verdict.reason})`);
      }
    }
  }

  console.log(`\nSpent $${spent.toFixed(4)} of $${maxSpend}.`);
  if (skipped.length) console.log(`Not evaluated: ${skipped.join(", ")}`);
  if (!changes.length) { console.log("No change: every measured role is already on its best available model."); return 0; }

  console.log("\nChanges:");
  changes.forEach((c) => console.log("  " + c));
  if (!APPLY) { console.log("\nDry run — re-run with --apply to write them."); return 0; }

  const header = src.split("// <hivey:start>")[0];
  const stamp = `// Last auto-tiered: ${new Date().toISOString().slice(0, 10)} — ${changes.length} change(s), measured over ${repeats} repeat(s).\n`;
  writeFileSync(HIVEY_FILE, `${header}${stamp}// <hivey:start>\nexport const HIVEY_MODELS = ${JSON.stringify(merged, null, 2)};\n// <hivey:end>\n`);
  console.log("\n✓ hivey-models.js updated.");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("auto-tier.mjs")) {
  main().then((c) => process.exit(c || 0)).catch((e) => { console.error("auto-tier failed:", e.message); process.exit(1); });
}
