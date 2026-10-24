// 📊 The benchmark report — the page that opens by itself when a live test ends.
//
// « Il faudrait retravailler l'onglet benchmark car on ne comprend rien actuellement… avec un
// artifact auto en sortie pour afficher les résultats. » The workspace shows the scores; this page
// explains them: who won, by how much, in which family each model fails, the exact questions it
// missed and why, what it cost and how long it took. One self-contained HTML document — inline
// CSS and SVG, no script — so the very same string is shown in the report tab and saved as a file
// the user can keep or send.
//
// Model names and error messages come from third parties: every one of them goes through esc().

import { PROBES, TOOL_PROBES, FAMILIES } from "./livebench.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The question a probe asked, for the « questions missed » list. */
export function probePrompt(family, id) {
  const list = family === "tools" ? TOOL_PROBES : PROBES[family] || [];
  const p = list.find((x) => x.id === id);
  return p ? p.prompt : id;
}

/** green ≥ 80 %, amber ≥ 50 %, red below — the same thresholds as the workspace. */
export function scoreTone(score) {
  if (score == null) return "none";
  return score >= 0.8 ? "good" : score >= 0.5 ? "mid" : "bad";
}

/** The entries in the order the report shows them: best score first, unmeasured last. */
export function rankEntries(entries) {
  return entries.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.ms || 0) - (b.ms || 0));
}

/**
 * The report for a set of measured models.
 *
 * `entries`: [{ key, label, provider, score, pass, total, answered, errors, byFamily, failures,
 * ms, cost, costExact, free, at }]. `t(key, vars)` translates, `lang` formats numbers and dates.
 */
export function buildBenchReport(entries, { t, lang = "fr", generatedAt = new Date() } = {}) {
  const rows = rankEntries(entries.filter((e) => e && e.score != null));
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)} %`);
  const nf = (n, d = 0) => new Intl.NumberFormat(lang, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  const money = (e) => (e.free ? t("bench.free") : e.cost ? `${e.costExact ? "" : "≈ "}${nf(e.cost, e.cost < 0.01 ? 4 : 3)} $` : "—");
  const secs = (ms) => (ms ? `${nf(ms / 1000, ms < 10000 ? 1 : 0)} s` : "—");
  const fam = (f) => t(`bench.fam.${f}`);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeStyle: "short" }).format(generatedAt);

  // ── The headline: who to pick, in one sentence. ────────────────────────────────────────────
  let headline = t("bench.r.empty");
  if (rows.length) {
    const best = rows[0];
    headline = t("bench.r.best", { model: best.label, score: pct(best.score) });
    if (rows.length > 1) {
      const cheapest = rows.filter((r) => r.score >= best.score - 0.1).sort((a, b) => (a.free ? 0 : a.cost || 0) - (b.free ? 0 : b.cost || 0))[0];
      if (cheapest && cheapest !== best) headline += " " + t("bench.r.cheaper", { model: cheapest.label, score: pct(cheapest.score) });
    }
  }

  // ── The bar chart: one bar per model, inline SVG. ──────────────────────────────────────────
  const barH = 30, labelW = 210, chartW = 640, plotW = chartW - labelW - 60;
  const chart = rows.length ? `<svg class="chart" viewBox="0 0 ${chartW} ${rows.length * barH + 24}" role="img" aria-label="${esc(t("bench.r.chart"))}">
${[0, 0.5, 1].map((x) => `<line x1="${labelW + x * plotW}" x2="${labelW + x * plotW}" y1="0" y2="${rows.length * barH}" class="grid"/><text x="${labelW + x * plotW}" y="${rows.length * barH + 16}" class="axis">${x * 100} %</text>`).join("\n")}
${rows.map((r, i) => {
    const y = i * barH;
    const w = Math.max(2, r.score * plotW);
    return `<text x="${labelW - 10}" y="${y + barH / 2 + 4}" class="lbl">${esc(r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label)}</text>
<rect x="${labelW}" y="${y + 6}" width="${w}" height="${barH - 12}" rx="4" class="bar ${scoreTone(r.score)}"/>
<text x="${labelW + w + 6}" y="${y + barH / 2 + 4}" class="val">${pct(r.score)}</text>`;
  }).join("\n")}
</svg>` : "";

  // ── The table: overall, each family, time, cost. ───────────────────────────────────────────
  const famCell = (r, f) => {
    const b = r.byFamily && r.byFamily[f];
    if (!b || !b.total) return `<td class="num">—</td>`;
    const s = b.pass / b.total;
    return `<td class="num cell ${scoreTone(s)}">${b.pass}/${b.total}</td>`;
  };
  const table = rows.length ? `<table>
<thead><tr><th>${esc(t("bench.colModel"))}</th><th class="num">${esc(t("bench.r.score"))}</th>${FAMILIES.map((f) => `<th class="num">${esc(fam(f))}</th>`).join("")}<th class="num">${esc(t("bench.r.time"))}</th><th class="num">${esc(t("bench.r.cost"))}</th></tr></thead>
<tbody>${rows.map((r, i) => `<tr><td><span class="rank">${i + 1}</span> ${esc(r.label)}<div class="prov">${esc(r.provider || "")}${r.errors ? ` · <span class="warn">${esc(t("bench.r.errors", { n: String(r.errors) }))}</span>` : ""}</div></td><td class="num strong ${scoreTone(r.score)}">${pct(r.score)}</td>${FAMILIES.map((f) => famCell(r, f)).join("")}<td class="num">${secs(r.ms)}</td><td class="num">${esc(money(r))}</td></tr>`).join("\n")}</tbody>
</table>` : "";

  // ── What each model got wrong, question by question. ──────────────────────────────────────
  const misses = rows.map((r) => {
    const f = (r.failures || []);
    const body = f.length
      ? `<ul>${f.map((x) => `<li><span class="tag">${esc(fam(x.family))}</span> ${esc(probePrompt(x.family, x.probe))}<div class="why">${esc(x.why === "wrong answer" ? t("bench.r.wrong") : t("bench.r.apiError", { msg: x.why }))}</div></li>`).join("")}</ul>`
      : `<p class="ok">${esc(t("bench.r.allRight"))}</p>`;
    return `<details><summary>${esc(r.label)} — ${esc(t("bench.r.missed", { n: String(f.length) }))}</summary>${body}</details>`;
  }).join("\n");

  return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("bench.r.title"))}</title>
<style>
:root { --bg:#fbfaf8; --fg:#1d1b20; --muted:#6b6670; --line:#e6e1e8; --card:#fff; --accent:#7c5cff; --good:#1f9d6a; --mid:#d48a08; --bad:#d6455d; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d0c10; --fg:#ecebef; --muted:#9a95a3; --line:#2a2731; --card:#16141b; --good:#3cc28d; --mid:#f0a92d; --bad:#f06a80; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 32px 16px 56px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; }
h2 { font-size: 17px; margin: 32px 0 10px; }
.meta { color: var(--muted); font-size: 13px; }
.headline { margin: 18px 0 0; padding: 14px 16px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 10%, var(--card)); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line)); font-size: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; overflow-x: auto; }
.chart { width: 100%; height: auto; display: block; }
.chart .grid { stroke: var(--line); }
.chart .axis { fill: var(--muted); font-size: 11px; text-anchor: middle; }
.chart .lbl { fill: var(--fg); font-size: 13px; text-anchor: end; }
.chart .val { fill: var(--fg); font-size: 13px; font-weight: 600; }
.bar.good { fill: var(--good); } .bar.mid { fill: var(--mid); } .bar.bad { fill: var(--bad); }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { padding: 8px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.strong { font-weight: 700; }
td.good { color: var(--good); } td.mid { color: var(--mid); } td.bad { color: var(--bad); }
.cell.good { background: color-mix(in srgb, var(--good) 10%, transparent); }
.cell.mid { background: color-mix(in srgb, var(--mid) 12%, transparent); }
.cell.bad { background: color-mix(in srgb, var(--bad) 12%, transparent); }
.rank { display: inline-block; min-width: 20px; color: var(--muted); }
.prov { color: var(--muted); font-size: 12px; margin-left: 24px; }
.warn { color: var(--mid); }
details { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin: 8px 0; }
summary { cursor: pointer; font-weight: 600; }
ul { margin: 10px 0 2px; padding-left: 18px; }
li { margin: 6px 0; }
.tag { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 99px; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); margin-right: 4px; }
.why { color: var(--muted); font-size: 12.5px; }
.ok { color: var(--good); margin: 8px 0 0; }
.legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.legend div { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13px; }
.legend b { display: block; margin-bottom: 2px; }
footer { margin-top: 32px; color: var(--muted); font-size: 12.5px; }
</style></head>
<body><main>
<h1>${esc(t("bench.r.title"))}</h1>
<div class="meta">${esc(t("bench.r.meta", { date, n: String(rows.length) }))}</div>
<p class="headline">${esc(headline)}</p>
${rows.length ? `<h2>${esc(t("bench.r.chart"))}</h2><div class="card">${chart}</div>
<h2>${esc(t("bench.r.details"))}</h2><div class="card">${table}</div>
<h2>${esc(t("bench.r.missedTitle"))}</h2>${misses}` : ""}
<h2>${esc(t("bench.r.how"))}</h2>
<div class="legend">${FAMILIES.map((f) => `<div><b>${esc(fam(f))}</b>${esc(t(`bench.famAbout.${f}`))}</div>`).join("")}</div>
<footer>${esc(t("bench.r.footer"))}</footer>
</main></body></html>`;
}
