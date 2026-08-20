// 🏁 The Benchmark workspace.
//
// Two columns of truth, deliberately never blended:
//
//   PUBLISHED   what a public leaderboard measured, with the date of the newest model it covers.
//               Broad and rigorous, and often months behind — one of the two sources shipped here
//               covers nothing released this year, which the header says out loud.
//   MEASURED    what this browser measured, on your key, on the models you actually have. Narrow
//               and current: exactly the models the leaderboards have not reached yet.
//
// Averaging them into a single "score" would be the easy thing and the wrong one: they measure
// different tasks on different dates, and a blended number hides which half is stale.
//
// The whole view is built with createElement/textContent. Model names and leaderboard labels are
// third-party strings, and this file is the one place where they meet the DOM.

import { BENCHMARK_WEB, BENCHMARK_SOURCES, BENCHMARK_UNCOVERED, BENCHMARK_FETCHED_AT } from "./benchmark-web.js";
import { runLiveBench, totalProbes, FAMILIES, compareRows } from "./livebench.js";

const STORE_KEY = "benchmarkResults";
const pct = (v) => (v == null ? "" : `${Math.round(v * 100)}%`);
const one = (v) => (v == null ? "" : v.toFixed(1));

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

export function initBenchmarkView({ els, t, callModel, load, save, fetchCatalogue }) {
  let catalogue = [];
  let measured = {};
  let sortKey = "measured";
  let sortDir = "desc";
  let abort = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

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
      card.append(el("span", "bv-src-about", s.about));
      card.append(el("span", "bv-src-fresh",
        months == null ? "" : t("bench.covers", { date: s.newestModelCovered, months: String(months) })));
      card.append(el("span", "bv-src-match", t("bench.matched", { n: String(s.matched), total: String(s.total) })));
      host.append(card);
    }
    host.append(el("span", "bv-fetched", t("bench.fetched", { date: BENCHMARK_FETCHED_AT })));
  }

  function render() {
    const body = els.bvBody;
    if (!body) return;
    const rows = sortRows(
      filterRows(buildRows({ catalogue, measured }), {
        query: els.bvSearch?.value || "",
        onlyGap: !!els.bvOnlyGap?.checked,
      }),
      sortKey, sortDir,
    );
    body.replaceChildren();
    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", "bv-empty", t("bench.none"));
      td.colSpan = 6;
      tr.append(td);
      body.append(tr);
      return;
    }
    for (const r of rows) {
      const tr = el("tr");
      tr.dataset.id = r.id;

      const name = el("td", "bv-model");
      name.append(el("span", "bv-id", r.id));
      if (!r.covered) name.append(el("span", "bv-gap", t("bench.gapTag")));
      tr.append(name);

      const meas = el("td", "num bv-meas");
      if (r.measured == null) meas.append(el("span", "bv-dash", "—"));
      else {
        meas.append(el("span", "bv-score", pct(r.measured)));
        // A run cut short by rate limits is a thin measurement, not a verdict. Saying so beside
        // the number is the difference between data and a claim.
        if (r.measuredThin) meas.append(el("span", "bv-thin", t("bench.thin")));
      }
      tr.append(meas);

      const aider = el("td", "num", r.aider == null ? "—" : one(r.aider));
      if (r.aiderAs && r.aiderAs !== r.id) aider.title = t("bench.publishedAs", { as: r.aiderAs });
      tr.append(aider);

      const hal = el("td", "num", r.halluc == null ? "—" : one(r.halluc));
      if (r.hallucAs && r.hallucAs !== r.id) hal.title = t("bench.publishedAs", { as: r.hallucAs });
      tr.append(hal);

      tr.append(el("td", "num", r.price == null ? "—" : r.price.toFixed(2)));
      tr.append(el("td", "num", r.ctx ? `${Math.round(r.ctx / 1000)}k` : "—"));
      body.append(tr);
    }
  }

  function setProgress(text) {
    if (!els.bvProgress) return;
    els.bvProgress.textContent = text || "";
    els.bvProgress.classList.toggle("hidden", !text);
  }

  /** Measure the models currently on screen, newest first, stopping at the cap. Running the whole
   *  catalogue would be both slow and rude to a rate-limited free tier. */
  async function runLive() {
    if (abort) return;
    abort = { aborted: false };
    els.bvRun?.classList.add("hidden");
    els.bvStop?.classList.remove("hidden");

    const visible = sortRows(
      filterRows(buildRows({ catalogue, measured }), {
        query: els.bvSearch?.value || "",
        onlyGap: !!els.bvOnlyGap?.checked,
      }),
      "measured", "desc",
    );
    // Prefer what nobody has measured: the models the leaderboards have not reached.
    const targets = visible
      .filter((r) => r.measured == null)
      .sort((a, b) => (a.covered === b.covered ? b.created - a.created : a.covered ? 1 : -1))
      .slice(0, 8);

    if (!targets.length) { setProgress(t("bench.allMeasured")); abort = null; restoreButtons(); return; }

    let spent = 0;
    for (let i = 0; i < targets.length; i++) {
      if (abort.aborted) break;
      const target = targets[i];
      const res = await runLiveBench({
        model: target.id,
        call: callModel,
        signal: abort,
        onProgress: ({ done, of }) =>
          setProgress(t("bench.progress", { model: target.id, done: String(done), of: String(of), i: String(i + 1), n: String(targets.length) })),
      });
      spent += res.cost || 0;
      measured[target.id] = {
        score: res.score, pass: res.pass, total: res.total, answered: res.answered,
        errors: res.errors, byFamily: res.byFamily, at: new Date().toISOString().slice(0, 10),
      };
      await save(STORE_KEY, measured);
      render();
    }
    setProgress(t("bench.done", { n: String(targets.length), cost: spent.toFixed(4) }));
    abort = null;
    restoreButtons();
  }

  function restoreButtons() {
    els.bvRun?.classList.remove("hidden");
    els.bvStop?.classList.add("hidden");
  }

  function wire() {
    els.bvSearch?.addEventListener("input", render);
    els.bvOnlyGap?.addEventListener("change", render);
    els.bvRun?.addEventListener("click", runLive);
    els.bvStop?.addEventListener("click", () => { if (abort) abort.aborted = true; setProgress(t("bench.stopping")); });
    document.querySelectorAll(".bv-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (key === sortKey) sortDir = sortDir === "desc" ? "asc" : "desc";
        else { sortKey = key; sortDir = "desc"; }
        render();
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
        measured = (await load(STORE_KEY)) || {};
        renderSources();
        render();
        // The catalogue gives prices and context sizes. It is public, so this works before the
        // user has entered any key, and the table simply shows fewer columns if it fails.
        try { catalogue = await fetchCatalogue(); } catch { catalogue = []; }
        render();
      } else {
        render();
      }
    },
    // Exposed for tests and for the settings "clear" action.
    async clear() { measured = {}; await save(STORE_KEY, measured); render(); },
    get measured() { return measured; },
  };
}

export { totalProbes, FAMILIES };
