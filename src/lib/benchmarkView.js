// 🏁 The Benchmark workspace — « quel modèle choisir ? », answered on the user's own models.
//
// Two kinds of truth, deliberately never blended:
//
//   MEASURED    what this browser measured, now, on the models the user picked — any connected
//               provider, the local machine and the gateway included. Narrow and current.
//   PUBLISHED   what a public leaderboard measured, with the date of the newest model it covers.
//               Broad and rigorous, and often months behind, which the section says out loud.
//
// Averaging them into a single "score" would be the easy thing and the wrong one: they measure
// different tasks on different dates, and a blended number hides which half is stale.
//
// The whole view is built with createElement/textContent. Model names and leaderboard labels are
// third-party strings, and this file is the one place where they meet the DOM.

import { BENCHMARK_WEB, BENCHMARK_SOURCES, BENCHMARK_UNCOVERED, BENCHMARK_FETCHED_AT } from "./benchmark-web.js";
import { runLiveBench, totalProbes, FAMILIES, compareRows } from "./livebench.js";

const STORE_KEY = "benchmarkResults";
const PICK_KEY = "benchmarkPicked";

/** Build the table's rows: everything with a published score, everything measured locally, and
 *  the newest models no leaderboard has reached — which is the whole reason the tab exists. */
export function buildRows({ catalogue = [], measured = {} }) {
  const byId = new Map(catalogue.map((m) => [m.id, m]));
  const ids = new Set([...Object.keys(BENCHMARK_WEB), ...Object.keys(measured), ...BENCHMARK_UNCOVERED]);
  const rows = [];
  for (const id of ids) {
    const cat = byId.get(id);
    // A model that has left the catalogue can still have a published score and a stored
    // measurement. It is dropped rather than shown, because you can no longer select it.
    if (catalogue.length && !cat) continue;
    const web = BENCHMARK_WEB[id] || {};
    const mine = measured[id];
    rows.push({
      id,
      name: cat?.name || id,
      measured: mine?.score ?? null,
      measuredAt: mine?.at || null,
      measuredThin: mine ? mine.answered < mine.total : false,
      aider: web.aider?.pass ?? null,
      aiderAs: web.aider?.as || null,
      halluc: web.vectara?.hallucination ?? null,
      hallucAs: web.vectara?.as || null,
      price: cat?.pricing?.completion ? +cat.pricing.completion * 1e6 : null,
      ctx: cat?.context_length ?? null,
      covered: !!(web.aider || web.vectara),
      created: cat?.created || 0,
    });
  }
  return rows;
}

export function sortRows(rows, key, dir = "desc") {
  const out = rows.slice();
  if (key === "name") out.sort((a, b) => a.id.localeCompare(b.id));
  else if (key === "price") out.sort((a, b) => compareRows({ v: a.price == null ? null : -a.price }, { v: b.price == null ? null : -b.price }, "v"));
  else if (key === "halluc") out.sort((a, b) => compareRows({ v: a.halluc == null ? null : -a.halluc }, { v: b.halluc == null ? null : -b.halluc }, "v"));
  else out.sort((a, b) => compareRows(a, b, key));
  // Default view: newest first among the unranked, so an unmeasured model is not buried.
  if (key === "measured") out.sort((a, b) => compareRows(a, b, "measured") || b.created - a.created);
  return dir === "asc" ? out.reverse() : out;
}

export function filterRows(rows, { query = "", onlyGap = false } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!onlyGap || !r.covered) && (!q || r.id.toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q)));
}

/** How stale a source is, in plain words. The number people forget to ask for. */
export function freshnessOf(source, today = new Date()) {
  if (!source?.newestModelCovered) return { months: null, stale: false };
  const d = new Date(source.newestModelCovered + "T00:00:00Z");
  const months = Math.max(0, Math.round((today - d) / (1000 * 60 * 60 * 24 * 30.4)));
  return { months, stale: months >= 4 };
}

// ── The view ─────────────────────────────────────────────────────────────────────────────────
//
// Three blocks, read top to bottom: (1) the models to test — the current one is already there —
// and one button; (2) the results, one card per model with a bar per family, best first, and the
// report; (3) the public leaderboards, folded, for whoever wants them. The live test speaks to
// any connected provider through the sidebar's own provider layer, so a local model or a gateway
// is measured exactly like a cloud one, and a free one says so.

/** Older measurements were keyed by an OpenRouter id alone. */
export function normalizeMeasured(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) if (v) out[k.includes("|") ? k : `openrouter|${k}`] = v;
  return out;
}

export function initBenchmarkView({ els, t, lang = () => "fr", callModel, load, save, fetchCatalogue, describe, currentModel, openReport }) {
  let catalogue = [];
  let measured = {};
  let picked = [];
  let sortKey = "aider";
  let sortDir = "desc";
  let abort = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const pctOf = (v) => (v == null ? "—" : `${Math.round(v * 100)} %`);
  const tone = (s) => (s == null ? "none" : s >= 0.8 ? "good" : s >= 0.5 ? "mid" : "bad");
  const nf = (n, d) => new Intl.NumberFormat(lang(), { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  const money = (e) => (e.free ? t("bench.free") : e.cost ? `${e.costExact ? "" : "≈ "}${nf(e.cost, e.cost < 0.01 ? 4 : 3)} $` : "");

  // ── 1. The models to test ──────────────────────────────────────────────────────────────────
  function renderPicked() {
    const host = els.bvPicked;
    if (!host) return;
    host.replaceChildren();
    for (const key of picked) {
      const d = describe(key);
      const chip = el("span", "bv-chip");
      if (d.icon) { const ic = el("span", "bv-chip-ic"); ic.append(d.icon); chip.append(ic); }
      chip.append(el("span", "bv-chip-name", d.label));
      const x = el("button", "bv-chip-x", "×");
      x.type = "button";
      x.title = t("bench.unpick");
      x.disabled = !!abort;
      x.addEventListener("click", () => { picked = picked.filter((k) => k !== key); save(PICK_KEY, picked); renderPicked(); });
      chip.append(x);
      host.append(chip);
    }
    if (els.bvWhat) {
      const fams = FAMILIES.map((f) => `${t(`bench.fam.${f}`)} (${probesCount(f)})`).join(" · ");
      els.bvWhat.textContent = t("bench.what", { n: String(totalProbes()), families: fams });
    }
    if (els.bvRun) els.bvRun.disabled = !picked.length;
  }
  const probesCount = (f) => totalProbes([f]);

  // ── 2. The results ─────────────────────────────────────────────────────────────────────────
  function entries() {
    return Object.entries(measured)
      .map(([key, m]) => ({ key, ...m, label: describe(key).label, provider: describe(key).provider }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }
  function renderResults() {
    const host = els.bvResults;
    if (!host) return;
    host.replaceChildren();
    const list = entries();
    els.bvReport?.classList.toggle("hidden", !list.length);
    if (!list.length) { host.append(el("p", "bv-empty", t("bench.noResults"))); return; }
    list.forEach((e, i) => {
      const card = el("div", "bv-res" + (i === 0 && list.length > 1 && e.score != null ? " best" : ""));
      const head = el("div", "bv-res-head");
      const d = describe(e.key);
      if (d.icon) { const ic = el("span", "bv-res-ic"); ic.append(d.icon); head.append(ic); }
      const name = el("div", "bv-res-name");
      name.append(el("span", "bv-res-label", e.label));
      const meta = [d.provider, e.at, e.ms ? `${nf(e.ms / 1000, e.ms < 10000 ? 1 : 0)} s` : "", money(e)].filter(Boolean).join(" · ");
      name.append(el("span", "bv-res-meta", meta));
      head.append(name);
      const score = el("span", `bv-res-score ${tone(e.score)}`, pctOf(e.score));
      head.append(score);
      const x = el("button", "bv-res-x", "×");
      x.type = "button";
      x.title = t("bench.forget");
      x.addEventListener("click", async () => { delete measured[e.key]; await save(STORE_KEY, measured); renderResults(); });
      head.append(x);
      card.append(head);
      if (i === 0 && list.length > 1 && e.score != null) card.append(el("span", "bv-best", t("bench.bestTag")));
      const fams = el("div", "bv-fams");
      for (const f of FAMILIES) {
        const b = e.byFamily && e.byFamily[f];
        const s = b && b.total ? b.pass / b.total : null;
        const row = el("div", "bv-fam");
        row.title = t(`bench.famAbout.${f}`);
        row.append(el("span", "bv-fam-name", t(`bench.fam.${f}`)));
        const bar = el("span", "bv-fam-bar");
        const fill = el("span", `bv-fam-fill ${tone(s)}`);
        fill.style.width = `${Math.round((s || 0) * 100)}%`;
        bar.append(fill);
        row.append(bar);
        row.append(el("span", "bv-fam-val", b && b.total ? `${b.pass}/${b.total}` : "—"));
        fams.append(row);
      }
      card.append(fams);
      if (e.errors) card.append(el("div", "bv-res-warn", t("bench.errorsNote", { n: String(e.errors) })));
      host.append(card);
    });
  }

  function setProgress(text, frac) {
    if (!els.bvProgress) return;
    els.bvProgress.classList.toggle("hidden", text == null);
    if (els.bvProgressText) els.bvProgressText.textContent = text || "";
    if (els.bvProgressFill) els.bvProgressFill.style.width = `${Math.round((frac || 0) * 100)}%`;
  }

  async function runLive() {
    if (abort || !picked.length) return;
    abort = { aborted: false };
    els.bvRun?.classList.add("hidden");
    els.bvStop?.classList.remove("hidden");
    renderPicked();
    const targets = picked.slice();
    const per = totalProbes();
    let spent = 0, done = 0;
    for (let i = 0; i < targets.length; i++) {
      if (abort.aborted) break;
      const key = targets[i];
      const label = describe(key).label;
      setProgress(t("bench.progress", { model: label, done: "0", of: String(per), i: String(i + 1), n: String(targets.length) }), done / (per * targets.length));
      let costExact = true, free = false;
      const res = await runLiveBench({
        model: key,
        call: async (req) => {
          const r = await callModel(req);
          if (r && r.free) free = true;
          if (r && r.costExact === false) costExact = false;
          return r;
        },
        signal: abort,
        onProgress: ({ done: d }) => setProgress(t("bench.progress", { model: label, done: String(d), of: String(per), i: String(i + 1), n: String(targets.length) }), (done + d) / (per * targets.length)),
      });
      done += per;
      spent += res.cost || 0;
      if (!res.total) continue;
      measured[key] = {
        score: res.score, pass: res.pass, total: res.total, answered: res.answered, errors: res.errors,
        byFamily: res.byFamily, failures: res.failures, ms: res.ms, cost: res.cost, costExact, free,
        at: new Date().toISOString().slice(0, 10),
      };
      await save(STORE_KEY, measured);
      renderResults();
    }
    const stopped = abort.aborted;
    abort = null;
    els.bvRun?.classList.remove("hidden");
    els.bvStop?.classList.add("hidden");
    renderPicked();
    setProgress(stopped ? t("bench.stopped") : t("bench.done", { n: String(targets.length), cost: spent ? nf(spent, 4) : "0" }), 1);
    // The report opens by itself: it is what the run was for.
    if (!stopped && Object.keys(measured).length) openReport(report());
  }

  function report() {
    return { entries: entries(), lang: lang() };
  }

  // ── 3. The public leaderboards ─────────────────────────────────────────────────────────────
  function renderSources() {
    const host = els.bvSources;
    if (!host) return;
    host.replaceChildren();
    for (const [key, s] of Object.entries(BENCHMARK_SOURCES)) {
      const { months, stale } = freshnessOf(s);
      const card = el("div", "bv-source" + (stale ? " bv-source-stale" : ""));
      const a = el("a", "bv-src-name", s.label);
      a.href = s.home; a.target = "_blank"; a.rel = "noopener noreferrer";
      card.append(a);
      const about = t(`bench.src.${key}`);
      card.append(el("span", "bv-src-about", about.startsWith("bench.src.") ? s.about : about));
      if (months != null) card.append(el("span", "bv-src-fresh", t("bench.covers", { date: s.newestModelCovered, months: String(months) })));
      host.append(card);
    }
    host.append(el("span", "bv-fetched", t("bench.fetched", { date: BENCHMARK_FETCHED_AT })));
  }

  function renderTable() {
    const body = els.bvBody;
    if (!body) return;
    const rows = sortRows(
      filterRows(buildRows({ catalogue, measured: {} }), { query: els.bvSearch?.value || "" }).filter((r) => r.covered),
      sortKey, sortDir,
    );
    body.replaceChildren();
    document.querySelectorAll(".bv-table th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === sortKey);
      th.dataset.dir = th.dataset.sort === sortKey ? sortDir : "";
    });
    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", "bv-empty", t("bench.none"));
      td.colSpan = 5;
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const r of rows) {
      const tr = el("tr");
      tr.dataset.id = r.id;
      const name = el("td", "bv-model");
      name.append(el("span", "bv-id", r.name));
      tr.append(name);
      const aider = el("td", "num", r.aider == null ? "—" : `${nf(r.aider, 0)} %`);
      if (r.aiderAs && r.aiderAs !== r.id) aider.title = t("bench.publishedAs", { as: r.aiderAs });
      tr.append(aider);
      const hal = el("td", "num", r.halluc == null ? "—" : `${nf(r.halluc, 1)} %`);
      if (r.hallucAs && r.hallucAs !== r.id) hal.title = t("bench.publishedAs", { as: r.hallucAs });
      tr.append(hal);
      tr.append(el("td", "num", r.price == null ? "—" : nf(r.price, 2)));
      tr.append(el("td", "num", r.ctx ? `${Math.round(r.ctx / 1000)} k` : "—"));
      body.append(tr);
    }
  }

  function wire() {
    els.bvSearch?.addEventListener("input", renderTable);
    els.bvRun?.addEventListener("click", runLive);
    els.bvStop?.addEventListener("click", () => { if (abort) abort.aborted = true; setProgress(t("bench.stopping"), 0); });
    els.bvReport?.addEventListener("click", () => openReport(report()));
    document.querySelectorAll(".bv-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (key === sortKey) sortDir = sortDir === "desc" ? "asc" : "desc";
        else { sortKey = key; sortDir = "desc"; }
        renderTable();
      });
    });
  }

  let started = false;
  return {
    /** Called every time the workspace is opened; the first call does the setup. */
    async open() {
      if (!started) {
        started = true;
        wire();
        measured = normalizeMeasured(await load(STORE_KEY));
        picked = (await load(PICK_KEY)) || [];
        if (!picked.length && currentModel()) picked = [currentModel()];
        renderSources();
        renderTable();
        // The catalogue gives prices and context sizes. It is public, so this works before the
        // user has entered any key, and the table simply shows fewer columns if it fails.
        try { catalogue = await fetchCatalogue(); } catch { catalogue = []; }
        renderTable();
      }
      renderPicked();
      renderResults();
    },
    /** A model picked in the « add a model » list. */
    add(key) {
      if (!key || picked.includes(key)) return;
      picked.push(key);
      save(PICK_KEY, picked);
      renderPicked();
    },
    // Exposed for tests and for the settings "clear" action.
    async clear() { measured = {}; await save(STORE_KEY, measured); renderResults(); },
    get measured() { return measured; },
  };
}

export { totalProbes, FAMILIES };
