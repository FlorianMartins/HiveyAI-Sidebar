// The report tab: the last run's results, written by the Benchmark workspace into storage, rendered
// by lib/bench-report.js into a self-contained document. It is shown in a sandboxed frame with no
// script allowed, and the very same document is what « Save » writes to disk.

import { buildBenchReport } from "../lib/bench-report.js";
import { t, setLang } from "../lib/i18n.js";

const api = globalThis.browser || globalThis.chrome;

async function main() {
  const { benchmarkReport: data, uiLang } = await api.storage.local.get(["benchmarkReport", "uiLang"]);
  setLang((data && data.lang) || uiLang || "en");
  const html = buildBenchReport((data && data.entries) || [], { t, lang: (data && data.lang) || "en", generatedAt: new Date((data && data.at) || Date.now()) });
  document.title = t("bench.r.title");
  const frame = document.getElementById("report");
  frame.srcdoc = html;
  const save = document.getElementById("save");
  save.textContent = t("bench.r.save");
  save.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `hivey-benchmark-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  const print = document.getElementById("print");
  print.textContent = t("bench.r.print");
  print.addEventListener("click", () => frame.contentWindow.print());
}

main();
