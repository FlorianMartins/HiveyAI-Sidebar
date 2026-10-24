// What the bench's checks are made of: small, exact, and blind to how the answer is phrased.

import { runInNewContext } from "node:vm";

const STOP = {
  fr: ["le", "la", "les", "des", "est", "et", "une", "pour", "dans", "que", "qui", "pas", "sur", "avec", "vous", "sont", "du", "au"],
  en: ["the", "and", "is", "are", "of", "to", "in", "for", "with", "that", "this", "you", "it", "on", "be", "not"],
  es: ["el", "los", "las", "es", "y", "una", "para", "con", "que", "por", "del", "se", "su", "como", "está"],
  de: ["der", "die", "das", "und", "ist", "nicht", "mit", "für", "ein", "eine", "auf", "den", "sie", "zu", "von"],
};

/** The language most of the answer's prose is in — code blocks and URLs aside. */
export function languageOf(text) {
  const prose = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ").toLowerCase();
  const words = prose.split(/[^\p{L}]+/u).filter(Boolean);
  let best = "?";
  let bestN = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const n = words.filter((w) => set.has(w)).length;
    if (n > bestN) { best = lang; bestN = n; }
  }
  return best;
}

/** Every number written in the text, with spaces, thin spaces and commas as thousands marks read as one number. */
export function numbersIn(text) {
  return (String(text || "").replace(/(\d)[\s  .,](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(",", ".")));
}

export const has = (text, ...needles) => needles.every((n) => (n instanceof RegExp ? n.test(text) : String(text).toLowerCase().includes(String(n).toLowerCase())));

/** The first fenced code block in a language from `langs`, else the first fenced block. */
export function codeBlock(text, langs = ["js", "javascript"]) {
  const blocks = [...String(text || "").matchAll(/```([\w-]*)\n([\s\S]*?)```/g)];
  const hit = blocks.find((b) => langs.includes(b[1].toLowerCase())) || blocks[0];
  return hit ? hit[2] : "";
}

/**
 * Run model-written code with nothing in scope — no require, process or fetch — and a timeout, then
 * call `name` on each case. Returns how many cases passed and the first failure.
 */
export function runFunction(code, name, cases) {
  const src = code.replace(/^\s*export\s+(default\s+)?/gm, "").replace(/module\.exports\s*=.*$/gm, "");
  let fn;
  try {
    const sandbox = {};
    runInNewContext(`${src}\n;globalThis.__fn = typeof ${name} === "function" ? ${name} : undefined;`, sandbox, { timeout: 2000 });
    fn = sandbox.__fn;
  } catch (e) {
    return { passed: 0, total: cases.length, failure: `does not run: ${e.message}` };
  }
  if (typeof fn !== "function") return { passed: 0, total: cases.length, failure: `no function named ${name}` };
  let passed = 0;
  let failure = "";
  for (const [args, want] of cases) {
    let got;
    try { got = fn(...args); } catch (e) { got = `throws ${e.message}`; }
    if (JSON.stringify(got) === JSON.stringify(want)) passed++;
    else if (!failure) failure = `${name}(${args.map((a) => JSON.stringify(a)).join(", ")}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
  }
  return { passed, total: cases.length, failure };
}

export const pass = (ok, why = "") => ({ pass: Boolean(ok), why: ok ? "" : why });
