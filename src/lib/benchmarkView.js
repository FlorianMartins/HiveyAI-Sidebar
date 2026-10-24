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
import { runLiveBench, totalProbes, estimateSeconds, mergeMeasurement, FAMILIES, compareRows } from "./livebench.js";
import { pickModel, verdictReason, rankEntries, costValue } from "./bench-report.js";

const STORE_KEY = "benchmarkResults";
const PICK_KEY = "benchmarkPicked";
const FAM_KEY = "benchmarkFamilies";

/** The families to run: what the user kept, in the canonical order; all of them by default, and
 *  never none — an empty choice from storage reads as « all ». */
export function chosenFamilies(saved) {
  const keep = Array.isArray(saved) ? FAMILIES.filter((f) => saved.includes(f)) : [];
  return keep.length ? keep : FAMILIES.slice();
}

/** « About N min » before a run: the probes' rough durations, per model, rounded up. */
export function estimateMinutes(families, models) {
  return Math.max(1, Math.ceil((estimateSeconds(families) * Math.max(1, models)) / 60));
}

/** The families a measurement covers, in order. */
export function familiesOf(m) {
  return FAMILIES.filter((f) => m && m.byFamily && m.byFamily[f] && m.byFamily[f].total);
}

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
// Read top to bottom, it answers the one question a newcomer has — « which model should I use? »:
//
//   the verdict   once anything is measured: the model to pick and why, in one sentence (as good,
//                 N× cheaper, N× faster), with the full report one click away;
//   the test      the models to compare, ONE button, and a line saying what will happen, how
//                 long it takes and what it costs — before anything is spent;
//   the ranking   one row per model: score, time and cost side by side, tagged « recommended »,
//                 « fastest », « cheapest », and what it got wrong in plain words;
//   the public    leaderboards, folded: a compact list, not a five-column table in 440 px.
//
// The live test speaks to any connected provider through the sidebar's own provider layer, so a
// local model or a gateway is measured exactly like a cloud one, and a free one says so.

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
  let families = FAMILIES.slice();
  let sortKey = "aider";
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
  const secs = (ms) => (ms < 60000 ? `${nf(ms / 1000, ms < 10000 ? 1 : 0)} s` : `${Math.floor(ms / 60000)} min ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")} s`);
  const dateFmt = (iso, opts) => { try { return new Intl.DateTimeFormat(lang(), { timeZone: "UTC", ...opts }).format(new Date(iso + "T00:00:00Z")); } catch { return iso; } };
  const monthOf = (iso) => dateFmt(iso, { month: "long", year: "numeric" });
  const dayOf = (iso) => dateFmt(iso, { dateStyle: "long" });
  const icon = (key, cls) => {
    const d = describe(key);
    if (!d.icon) return null;
    const ic = el("span", cls);
    ic.append(d.icon);
    return ic;
  };

  // ── The test: models to compare, one button, what it will take ────────────────────────────
  function renderPicked() {
    const host = els.bvPicked;
    if (!host) return;
    host.replaceChildren();
    for (const key of picked) {
      const d = describe(key);
      const chip = el("span", "bv-chip");
      const ic = icon(key, "bv-chip-ic");
      if (ic) chip.append(ic);
      chip.append(el("span", "bv-chip-name", d.label));
      const x = el("button", "bv-chip-x", "×");
      x.type = "button";
      x.title = t("bench.unpick");
      x.setAttribute("aria-label", `${t("bench.unpick")} — ${d.label}`);
      x.disabled = !!abort;
      x.addEventListener("click", () => { picked = picked.filter((k) => k !== key); save(PICK_KEY, picked); renderPicked(); });
      chip.append(x);
      host.append(chip);
    }
    if (els.bvWhat && !abort) {
      els.bvWhat.textContent = picked.length
        ? t("bench.what", { n: String(totalProbes(families)), m: String(picked.length), min: String(estimateMinutes(families, picked.length)) })
        : t("bench.pickFirst");
    }
    if (els.bvRun) els.bvRun.disabled = !picked.length;
    renderFamPick();
  }

  // Which kinds of questions to run. All on by default; the last one cannot be switched off, so
  // the button never runs an empty test.
  function renderFamPick() {
    const host = els.bvFamPick;
    if (!host) return;
    host.setAttribute("aria-label", t("bench.famPick"));
    host.replaceChildren();
    for (const f of FAMILIES) {
      const on = families.includes(f);
      const b = el("button", "bv-fam-tg");
      b.type = "button";
      b.dataset.fam = f;
      b.setAttribute("aria-pressed", String(on));
      b.title = t(`bench.famAbout.${f}`);
      b.append(el("span", null, t(`bench.fam.${f}`)), el("span", "bv-fam-n", String(totalProbes([f]))));
      b.disabled = !!abort || (on && families.length === 1);
      b.addEventListener("click", () => {
        families = on ? families.filter((x) => x !== f) : FAMILIES.filter((x) => x === f || families.includes(x));
        save(FAM_KEY, families);
        renderPicked();
      });
      host.append(b);
    }
  }

  function renderFamilies() {
    const host = els.bvFamList;
    if (!host) return;
    host.replaceChildren();
    for (const f of FAMILIES) {
      host.append(el("dt", null, `${t(`bench.fam.${f}`)} · ${totalProbes([f])}`));
      host.append(el("dd", null, t(`bench.famAbout.${f}`)));
    }
    host.append(el("p", "bv-famnote", t("bench.scoreNote")));
  }

  // ── The verdict and the ranking ────────────────────────────────────────────────────────────
  function entries() {
    return rankEntries(Object.entries(measured).map(([key, m]) => ({ key, ...m, label: describe(key).label, provider: describe(key).provider })));
  }

  function renderVerdict(v) {
    const host = els.bvVerdict;
    if (!host) return;
    host.replaceChildren();
    host.classList.toggle("hidden", !v);
    if (!v) return;
    const top = el("div", "bv-v-top");
    top.append(el("span", "bv-v-eyebrow", t(v.vs ? "bench.v.title" : "bench.v.titleOne")));
    if (v.vs) {
      const why = el("span", "bv-help", "?");
      why.title = t("bench.v.rule");
      why.tabIndex = 0;
      why.setAttribute("role", "img");
      why.setAttribute("aria-label", t("bench.v.rule"));
      top.append(why);
    }
    host.append(top);
    const name = el("div", "bv-v-name");
    const ic = icon(v.pick.key, "bv-v-ic");
    if (ic) name.append(ic);
    name.append(el("span", null, v.pick.label));
    host.append(name);
    host.append(el("p", "bv-v-why", verdictReason(v, { t, lang: lang(), running: !!abort })));
    // Scores over different questions do not compare: say so rather than let the verdict pretend.
    if (v.vs && new Set(v.rows.map((r) => familiesOf(r).join(","))).size > 1) host.append(el("p", "bv-v-mixed", t("bench.v.mixed")));
    const btn = el("button", "bv-report", t("bench.report"));
    btn.type = "button";
    btn.title = t("bench.reportTitle");
    btn.addEventListener("click", () => openReport(report()));
    host.append(btn);
  }

  function renderResults() {
    const host = els.bvResults;
    if (!host) return;
    host.replaceChildren();
    const list = entries();
    const v = pickModel(list);
    renderVerdict(v);
    els.bvRankCard?.classList.toggle("hidden", !list.length);
    if (!list.length) return;
    // The tags only mean something when there is something to compare.
    const many = list.filter((e) => e.score != null).length > 1;
    const priced = list.filter((e) => costValue(e) != null);
    const cheapest = many && priced.length > 1 ? priced.reduce((a, b) => (costValue(b) < costValue(a) ? b : a)) : null;
    const timed = list.filter((e) => e.ms);
    const fastest = many && timed.length > 1 ? timed.reduce((a, b) => (b.ms < a.ms ? b : a)) : null;
    list.forEach((e, i) => {
      const isPick = many && v && v.pick === e;
      const row = el("div", "bv-res" + (isPick ? " pick" : ""));
      row.append(el("span", "bv-rank", String(i + 1)));
      const main = el("div", "bv-res-main");
      const head = el("div", "bv-res-head");
      const ic = icon(e.key, "bv-res-ic");
      if (ic) head.append(ic);
      head.append(el("span", "bv-res-label", e.label));
      const scoreTitle = t("bench.scoreTitle", { pass: String(e.pass ?? "—"), total: String(e.total ?? "—") });
      const score = el("span", `bv-res-score ${tone(e.score)}`, pctOf(e.score));
      score.title = scoreTitle;
      head.append(score);
      const x = el("button", "bv-res-x", "×");
      x.type = "button";
      x.title = t("bench.forget");
      x.setAttribute("aria-label", `${t("bench.forget")} — ${e.label}`);
      x.addEventListener("click", async () => { delete measured[e.key]; await save(STORE_KEY, measured); renderResults(); });
      head.append(x);
      main.append(head);

      // Time and cost next to the score: the three things a choice is made on.
      const stats = el("div", "bv-stats");
      const stat = (text, title, cls = "") => { const s = el("span", ("bv-stat " + cls).trim(), text); s.title = title; stats.append(s); };
      // The best time and the best price say so in the same pill, in words, not only in colour.
      const lower = (x) => x.charAt(0).toLocaleLowerCase(lang()) + x.slice(1);
      if (isPick) stat(t("bench.tag.pick"), t("bench.v.rule"), "tag pick");
      if (e.ms) stat(`⏱ ${secs(e.ms)}${fastest === e ? ` · ${lower(t("bench.tag.fast"))}` : ""}`, t("bench.timeTitle"), fastest === e ? "tag" : "");
      const m = money(e);
      if (m) stat(`${m}${cheapest === e ? ` · ${lower(t("bench.tag.cheap"))}` : ""}`, t("bench.costTitle"), cheapest === e ? "tag" : "");
      main.append(stats);

      // What it got wrong, in words; the bars per kind of question behind a click.
      const weak = FAMILIES.filter((f) => { const b = e.byFamily && e.byFamily[f]; return b && b.total && b.pass < b.total; });
      const det = el("details", "bv-detail");
      det.append(el("summary", weak.length ? "bv-weak" : "bv-ok",
        weak.length ? t("bench.weak", { list: weak.map((f) => t(`bench.fam.${f}`)).join(", ") }) : t("bench.allRight")));
      const fams = el("div", "bv-fams");
      for (const f of FAMILIES) {
        const b = e.byFamily && e.byFamily[f];
        const s = b && b.total ? b.pass / b.total : null;
        const fr = el("div", "bv-fam");
        fr.title = t(`bench.famAbout.${f}`);
        fr.append(el("span", "bv-fam-name", t(`bench.fam.${f}`)));
        const bar = el("span", "bv-fam-bar");
        const fill = el("span", `bv-fam-fill ${tone(s)}`);
        fill.style.width = `${Math.round((s || 0) * 100)}%`;
        bar.append(fill);
        fr.append(bar);
        fr.append(el("span", "bv-fam-val", b && b.total ? `${b.pass}/${b.total}` : "—"));
        fams.append(fr);
      }
      fams.append(el("span", "bv-res-prov", [e.provider, e.at].filter(Boolean).join(" · ")));
      det.append(fams);
      main.append(det);
      const covered = familiesOf(e).length;
      if (covered && covered < FAMILIES.length) main.append(el("div", "bv-res-part", t("bench.partial", { n: String(covered), of: String(FAMILIES.length) })));
      if (e.errors) main.append(el("div", "bv-res-warn", t("bench.errorsNote", { n: String(e.errors) })));
      row.append(main);
      host.append(row);
    });
  }

  /** `frac` null hides the bar: a full bar after the run says nothing a sentence does not. */
  function setProgress(text, frac) {
    if (!els.bvProgress) return;
    els.bvProgress.classList.toggle("hidden", text == null);
    if (els.bvProgressText) els.bvProgressText.textContent = text || "";
    els.bvPbar?.classList.toggle("hidden", frac == null);
    if (els.bvProgressFill) els.bvProgressFill.style.width = `${Math.round((frac || 0) * 100)}%`;
  }

  async function runLive() {
    if (abort || !picked.length) return;
    abort = { aborted: false };
    els.bvRun?.classList.add("hidden");
    els.bvStop?.classList.remove("hidden");
    if (els.bvWhat) els.bvWhat.textContent = t("bench.runningHint");
    renderPicked();
    const targets = picked.slice();
    const run = families.slice();
    const per = totalProbes(run);
    const started = Date.now();
    let spent = 0, done = 0;
    for (let i = 0; i < targets.length; i++) {
      if (abort.aborted) break;
      const key = targets[i];
      const label = describe(key).label;
      const say = (d) => setProgress(t("bench.progress", { model: label, done: String(d), of: String(per), i: String(i + 1), n: String(targets.length) }), (done + d) / (per * targets.length));
      say(0);
      let costExact = true, free = false;
      const res = await runLiveBench({
        model: key,
        call: async (req) => {
          const r = await callModel(req);
          if (r && r.free) free = true;
          if (r && r.costExact === false) costExact = false;
          return r;
        },
        families: run,
        signal: abort,
        onProgress: ({ done: d }) => say(d),
      });
      done += per;
      spent += res.cost || 0;
      if (!res.total) continue;
      // A family left out of this run keeps its last measurement (see mergeMeasurement): running
      // « Code » alone does not erase what the model scored on everything else.
      measured[key] = mergeMeasurement(measured[key], {
        score: res.score, pass: res.pass, total: res.total, answered: res.answered, errors: res.errors,
        byFamily: res.byFamily, failures: res.failures, ms: res.ms, cost: res.cost, costExact, free,
        at: new Date().toISOString().slice(0, 10),
      });
      await save(STORE_KEY, measured);
      renderResults();
    }
    const stopped = abort.aborted;
    abort = null;
    els.bvRun?.classList.remove("hidden");
    els.bvStop?.classList.add("hidden");
    renderPicked();
    setProgress(stopped ? t("bench.stopped") : t("bench.done", { n: String(targets.length), time: secs(Date.now() - started), cost: spent ? nf(spent, 4) : "0" }), null);
    // The report opens by itself: it is what the run was for.
    if (!stopped && Object.keys(measured).length) openReport(report());
  }

  function report() {
    return { entries: entries(), lang: lang() };
  }

  // ── The public leaderboards ────────────────────────────────────────────────────────────────
  function renderSources() {
    const host = els.bvSources;
    if (!host) return;
    host.replaceChildren();
    for (const [key, s] of Object.entries(BENCHMARK_SOURCES)) {
      const { months, stale } = freshnessOf(s);
      const card = el("div", "bv-source" + (stale ? " bv-source-stale" : ""));
      const about = t(`bench.src.${key}`);
      card.append(el("span", "bv-src-about", about.startsWith("bench.src.") ? s.about : about));
      const line = el("span", "bv-src-fresh");
      const a = el("a", "bv-src-name", s.label);
      a.href = s.home; a.target = "_blank"; a.rel = "noopener noreferrer";
      line.append(a);
      if (months != null) line.append(document.createTextNode(` · ${t("bench.covers", { date: monthOf(s.newestModelCovered), months: String(months) })}`));
      card.append(line);
      host.append(card);
    }
    const legend = el("div", "bv-source");
    legend.append(el("span", "bv-src-about", t("bench.pubLegend")));
    legend.append(el("span", "bv-fetched", t("bench.fetched", { date: dayOf(BENCHMARK_FETCHED_AT) })));
    host.append(legend);
  }

  function renderTable() {
    const body = els.bvBody;
    if (!body) return;
    const rows = sortRows(
      filterRows(buildRows({ catalogue, measured: {} }), { query: els.bvSearch?.value || "" }).filter((r) => r.covered),
      sortKey,
    );
    body.replaceChildren();
    if (!rows.length) { body.append(el("li", "bv-empty", t("bench.none"))); return; }
    for (const r of rows) {
      const li = el("li", "bv-pub");
      li.dataset.id = r.id;
      li.append(el("span", "bv-pub-name", r.name));
      const vals = el("span", "bv-pub-vals");
      const val = (key, label, text, title) => {
        if (text == null) return;
        const s = el("span", "bv-pv" + (sortKey === key ? " sorted" : ""));
        s.append(el("span", "bv-pv-k", label));
        s.append(el("b", null, text));
        s.title = title;
        vals.append(s);
      };
      val("aider", t("bench.pub.code"), r.aider == null ? null : `${nf(r.aider, 0)} %`,
        t("bench.pub.codeTitle") + (r.aiderAs && r.aiderAs !== r.id ? ` — ${t("bench.publishedAs", { as: r.aiderAs })}` : ""));
      val("halluc", t("bench.pub.halluc"), r.halluc == null ? null : `${nf(r.halluc, 1)} %`,
        t("bench.pub.hallucTitle") + (r.hallucAs && r.hallucAs !== r.id ? ` — ${t("bench.publishedAs", { as: r.hallucAs })}` : ""));
      val("price", t("bench.pub.price"), r.price == null ? null : `${nf(r.price, 2)} $`, t("bench.pub.priceTitle"));
      val("ctx", t("bench.pub.ctx"), r.ctx ? `${Math.round(r.ctx / 1000)} k` : null, t("bench.pub.ctxTitle"));
      li.append(vals);
      body.append(li);
    }
  }

  function wire() {
    els.bvSearch?.addEventListener("input", renderTable);
    els.bvSort?.addEventListener("change", () => { sortKey = els.bvSort.value; renderTable(); });
    els.bvRun?.addEventListener("click", runLive);
    els.bvStop?.addEventListener("click", () => { if (abort) abort.aborted = true; setProgress(t("bench.stopping"), null); });
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
        families = chosenFamilies(await load(FAM_KEY));
        if (!picked.length && currentModel()) picked = [currentModel()];
        renderFamilies();
        renderSources();
        renderTable();
        // The catalogue gives prices and context sizes. It is public, so this works before the
        // user has entered any key, and the list simply shows fewer values if it fails.
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
