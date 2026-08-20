#!/usr/bin/env node
// 🏁 Published-benchmark harvester.
//
// The Benchmark workspace shows two things side by side: what the web PUBLISHES about a model,
// and what this machine MEASURED. Both are needed, because neither is sufficient:
//
//   * Published leaderboards are rigorous and broad, and they LAG. Aider's polyglot leaderboard —
//     the best public coding benchmark — contains zero models released in 2026. Opus 5, GPT-5.6,
//     Gemini 3.7, Grok 4.6 and DeepSeek V4 are simply absent, which is to say it cannot help you
//     choose between the models you can actually pick today.
//   * A local measurement covers exactly the models you care about and nothing else, on a handful
//     of tasks. It is current and narrow where a leaderboard is thorough and stale.
//
// So the tab reports both, WITH each source's own freshness, and never silently blends them. A
// number whose age is hidden is worse than no number: it invites a decision it cannot support.
//
// The data is fetched here, at build/refresh time, and committed as a plain JS module rather than
// fetched by the extension at runtime. Two reasons: the add-on then needs no extra host
// permission for a third-party domain (a real review question), and the workspace still works
// offline.
//
// Usage:  node scripts/update-benchmarks.mjs [--check]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "src", "lib", "benchmark-web.js");
const CHECK_ONLY = process.argv.includes("--check");

const SOURCES = {
  aider: {
    label: "Aider Polyglot",
    url: "https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml",
    home: "https://aider.chat/docs/leaderboards/",
    metric: "pass",
    about: "225 coding exercises in C++, Go, Java, JavaScript, Python and Rust. The model must edit real files, so it measures editing as much as writing.",
  },
  vectara: {
    label: "Vectara Hallucination",
    url: "https://raw.githubusercontent.com/vectara/hallucination-leaderboard/main/README.md",
    home: "https://github.com/vectara/hallucination-leaderboard",
    metric: "factual",
    about: "How often a model invents facts when summarising a document it was given. Lower hallucination is better.",
  },
};

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────
// Both files are simple enough to read without a YAML or Markdown dependency, and an add-on that
// ships no npm dependency should not grow one for two shapes this regular.

function parseAider(text) {
  const rows = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (/^- dirname:/.test(line)) {
      if (cur?.model) rows.push(cur);
      cur = { date: (/(\d{4}-\d{2}-\d{2})/.exec(line) || [])[1] || null };
      continue;
    }
    if (!cur) continue;
    const m = /^\s{2}(\w+):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    const v = raw.replace(/^["']|["']$/g, "");
    if (k === "model") cur.model = v;
    else if (k === "pass_rate_2") cur.pass = parseFloat(v);
    else if (k === "percent_cases_well_formed") cur.wellFormed = parseFloat(v);
  }
  if (cur?.model) rows.push(cur);
  // A model can appear several times (different edit formats or effort levels). Keep its best
  // result: the leaderboard's own headline number for that model is its best configuration.
  const best = new Map();
  for (const r of rows) {
    if (typeof r.pass !== "number") continue;
    const prev = best.get(r.model);
    if (!prev || r.pass > prev.pass) best.set(r.model, r);
  }
  return [...best.values()];
}

function parseVectara(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || /^-+:?$/.test(cells[1]) || /hallucination/i.test(cells[1])) continue;
    const num = (s) => { const n = parseFloat(String(s).replace("%", "").trim()); return Number.isFinite(n) ? n : null; };
    const hallucination = num(cells[1]);
    if (hallucination == null) continue;
    rows.push({ model: cells[0], hallucination, factual: num(cells[2]), answerRate: num(cells[3]) });
  }
  return rows;
}

// ── Matching a leaderboard name to an OpenRouter id ──────────────────────────────────────────
// Leaderboards name models the way a human writes them ("o3 (high)", "DeepSeek-V3.2-Exp (Chat)"),
// and OpenRouter names them the way an API does. The join is inevitably fuzzy, so it is done
// conservatively and what fails to match is REPORTED rather than forced: a wrong join would
// attach one model's score to another, which is worse than a blank cell.

export function normalise(name) {
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")          // "(high)", "(Chat)" — a configuration, not a model
    .replace(/:free$|:beta$|:extended$/g, " ")
    .replace(/\b(instruct|chat|preview|latest|exp|turbo|it)\b/g, " ")
    .replace(/[^a-z0-9.]+/g, "");
}

/** The numbers in a model name ARE its identity: "grok-4" and "grok-4.6" are different models,
 *  and so are "gpt-5" and "gpt-5.6". Plain containment happily joins them — it did, attaching
 *  Aider's grok-4 score to grok-4.6, which is precisely the silent mis-attribution this join is
 *  supposed to avoid. Two names may only match if their numeric signature is identical. */
export function versions(s) {
  return (String(s).match(/\d+(?:\.\d+)*/g) || []).join(",");
}

export function matchModel(name, catalogueIds) {
  const n = normalise(name);
  if (n.length < 3) return null;
  const nv = versions(n);
  let best = null;
  for (const id of catalogueIds) {
    const tail = normalise(id.split("/").slice(1).join("/"));
    if (!tail) continue;
    // Containment in either direction, with a length guard: "gpt-5" must not swallow "gpt-5.6",
    // so the shorter string has to be a substantial part of the longer one.
    if (versions(tail) !== nv) continue;   // same family, different version = a different model
    const [long, short] = tail.length >= n.length ? [tail, n] : [n, tail];
    if (!long.includes(short)) continue;
    if (short.length / long.length < 0.62) continue;
    const score = short.length / long.length;
    if (!best || score > best.score || (score === best.score && id.length < best.id.length)) best = { id, score };
  }
  return best ? best.id : null;
}

// ── Run ──────────────────────────────────────────────────────────────────────────────────────

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": "hivey-ai-sidebar-benchmarks" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const cat = await get("https://openrouter.ai/api/v1/models");
  const catalogue = (JSON.parse(cat).data || []).filter((m) => m?.id && !/^~/.test(m.id));
  const ids = catalogue.map((m) => m.id);
  console.log(`OpenRouter catalogue: ${ids.length} models.`);

  const merged = {};
  const meta = {};
  const unmatched = [];

  const aider = parseAider(await get(SOURCES.aider.url));
  const vectara = parseVectara(await get(SOURCES.vectara.url));

  for (const [key, rows, take] of [
    ["aider", aider, (r) => ({ pass: r.pass, wellFormed: r.wellFormed })],
    ["vectara", vectara, (r) => ({ hallucination: r.hallucination, factual: r.factual, answerRate: r.answerRate })],
  ]) {
    let hit = 0;
    for (const r of rows) {
      const id = matchModel(r.model, ids);
      if (!id) { unmatched.push({ source: key, model: r.model }); continue; }
      hit++;
      (merged[id] ||= {})[key] = { ...take(r), as: r.model };
    }
    meta[key] = { ...SOURCES[key], matched: hit, total: rows.length };
    console.log(`${SOURCES[key].label}: ${rows.length} rows, ${hit} matched to a live OpenRouter id.`);
  }

  // Each source's freshness, measured the only way that means anything: how recent are the models
  // it covers? A leaderboard updated yesterday with models from a year ago is a stale leaderboard.
  const created = new Map(catalogue.map((m) => [m.id, m.created || 0]));
  for (const key of Object.keys(meta)) {
    const covered = Object.entries(merged).filter(([, v]) => v[key]).map(([id]) => created.get(id) || 0);
    const newest = covered.length ? Math.max(...covered) : 0;
    meta[key].newestModelCovered = newest ? new Date(newest * 1000).toISOString().slice(0, 10) : null;
  }
  // Models the catalogue has that NO source covers: the gap a local measurement exists to fill.
  const uncovered = catalogue
    .filter((m) => !merged[m.id] && (m.created || 0) > 0)
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, 40)
    .map((m) => m.id);

  const body =
    `// GENERATED by scripts/update-benchmarks.mjs — do not edit by hand.\n` +
    `//\n` +
    `// Published benchmark results, harvested from the sources below and joined to the OpenRouter\n` +
    `// ids this add-on can actually select. Each source carries its OWN freshness, because that is\n` +
    `// the number people forget to ask for: a leaderboard can be maintained daily and still cover\n` +
    `// nothing released this year.\n` +
    `export const BENCHMARK_FETCHED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};\n` +
    `export const BENCHMARK_SOURCES = ${JSON.stringify(meta, null, 2)};\n` +
    `export const BENCHMARK_WEB = ${JSON.stringify(merged, null, 2)};\n` +
    `// Leaderboard rows whose model could not be joined to a live OpenRouter id — reported rather\n` +
    `// than force-matched, because attaching one model's score to another is worse than a gap.\n` +
    `export const BENCHMARK_UNMATCHED = ${JSON.stringify(unmatched.slice(0, 80), null, 2)};\n` +
    `// The newest catalogue models NO published source covers. This is the gap the live test fills.\n` +
    `export const BENCHMARK_UNCOVERED = ${JSON.stringify(uncovered, null, 2)};\n`;

  let prev = "";
  try { prev = readFileSync(OUT_FILE, "utf8"); } catch {}
  const strip = (s) => s.replace(/export const BENCHMARK_FETCHED_AT = "[^"]*";\n/, "");
  if (strip(prev) === strip(body)) { console.log("✓ benchmark-web.js already up to date."); return 0; }
  if (CHECK_ONLY) { console.log("benchmark-web.js is out of date (run without --check)."); return 1; }
  writeFileSync(OUT_FILE, body);
  console.log(`✓ benchmark-web.js updated — ${Object.keys(merged).length} models with at least one published score.`);
  return 0;
}

if (process.argv[1]?.endsWith("update-benchmarks.mjs")) {
  main().then((c) => process.exit(c)).catch((e) => { console.error("update-benchmarks failed:", e.message); process.exit(1); });
}
