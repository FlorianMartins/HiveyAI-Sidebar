// 🏁 Live benchmark — measure a model here, now, with your own key.
//
// WHY A LOCAL MEASUREMENT AT ALL
// ------------------------------
// Published leaderboards are broader and more rigorous than anything a sidebar can run, and they
// lag: at the time of writing, the best public coding leaderboard covers no model released in
// 2026, which is to say it cannot help you choose between the models you can actually pick. This
// fills exactly that gap — a handful of tasks, on the models you care about, today.
//
// It does NOT replace them, and the workspace says so. Four families of probe, all gradeable by a
// program, so a score means the same thing twice:
//
//   reason       exact answers, extracted from whatever prose surrounds them
//   instruction  the model was told a format; did it obey it
//   json         output that has to parse and carry the right fields
//   tools        pick the right tool, fill its arguments, and — the failure that makes an agent
//                spin forever on "hello" — do NOT call one when none is needed
//
// WHY NO CODE EXECUTION HERE
// --------------------------
// The most informative probe would be "write this function and let us run it". The add-on's CSP
// is `script-src 'self'` with no 'unsafe-eval', so generated code cannot be executed in an
// extension page — deliberately, and it is not a restriction worth weakening for a benchmark.
// Routing the code to the remote artifact runner would work, but it would send model output to a
// third party to earn a number. So code execution stays in `scripts/bench-hivey.mjs`, where it
// runs locally in a `vm` context with no filesystem or network, and the workspace links to it
// rather than pretending the browser did it.

export const PROBES = {
  reason: [
    { id: "coins", prompt: "In five flips of a fair coin, what is the probability of exactly three heads? Reply with the reduced fraction only, e.g. 3/8.", accept: (t) => /(^|\D)5\s*\/\s*16(\D|$)/.test(t) },
    { id: "quadratic", prompt: "Solve 3x² - 12x + 9 = 0. Reply with the two roots only, smallest first, like: 1, 3", accept: (t) => /(^|\D)1\D+3(\D|$)/.test(t.replace(/[^0-9,.\s-]/g, " ")) },
    { id: "arrival", prompt: "A train leaves at 14:35 and the journey takes 2 h 50 min. At what time does it arrive? Reply with the time only, 24h format.", accept: (t) => /17\s*[:h]\s*25/.test(t) },
    { id: "sequence", prompt: "What is the next number: 2, 6, 12, 20, 30, ? Reply with the number only.", accept: (t) => /(^|\D)42(\D|$)/.test(t) },
    // Harder tier. Without these the set did not discriminate at all at the top: Haiku 4.5 tied
    // Opus 5 at 100%, and a benchmark where a small model ties the flagship ranks nothing.
    { id: "digit-count", prompt: "How many times does the digit 7 appear in the numbers from 1 to 100 inclusive? Reply with the number only.", accept: (t) => /(^|\D)20(\D|$)/.test(lastLine(t)) },
    { id: "bat-and-ball", prompt: "A bat and a ball cost 1.10 € in total. The bat costs 1.00 € more than the ball. How much does the ball cost, in cents? Reply with the number only.", accept: (t) => /(^|\D)5(\D|$)/.test(lastLine(t)) && !/(^|\D)10(\D|$)/.test(lastLine(t)) },
  ],
  instruction: [
    { id: "one-word", prompt: "Reply with exactly one word, nothing else: the capital city of Portugal.", accept: (t) => /^\W*lisbo(n|a|nne)\W*$/i.test(t.trim()) },
    { id: "french-only", prompt: "Répondez UNIQUEMENT en français, en une seule phrase : qu'est-ce qu'un navigateur web ?", accept: (t) => /\b(le|la|un|une|est|qui|pour|des)\b/i.test(t) && !/\b(the|is|that|which|browser is)\b/i.test(t) },
    { id: "no-preamble", prompt: "Output the three words: alpha beta gamma. No preamble, no punctuation, no explanation.", accept: (t) => /^\W*alpha\s+beta\s+gamma\W*$/i.test(t.trim()) },
    { id: "refusal-format", prompt: "Answer with the single character ? and nothing else if you do not know: what is my cat's name?", accept: (t) => /^\W*\?\W*$/.test(t.trim()) },
    {
      id: "five-s-words",
      prompt: "Reply with exactly five words, each beginning with the letter s, and nothing else.",
      accept: (t) => {
        const w = t.trim().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
        return w.length === 5 && w.every((x) => /^s/i.test(x));
      },
    },
    {
      id: "no-letter-e",
      // A constraint the model must hold across a whole sentence, not just at the start. Models
      // that "understand" the instruction and then drift are exactly what this catches.
      prompt: "Write one sentence of at least six words about the ocean that does NOT contain the letter e, anywhere. Reply with the sentence only.",
      accept: (t) => {
        const s2 = t.trim();
        return !/e/i.test(s2) && s2.split(/\s+/).filter(Boolean).length >= 6;
      },
    },
  ],
  json: [
    {
      id: "extract",
      prompt: 'Extract the fields and reply with ONLY a JSON object, no code fence, no prose: "Marie Dupont, 34 ans, habite à Nantes." Keys exactly: name, age, city. age must be a number.',
      accept: (t) => {
        const o = parseLoose(t);
        return !!o && typeof o.age === "number" && /nantes/i.test(String(o.city || "")) && /dupont/i.test(String(o.name || ""));
      },
    },
    { id: "verdict", prompt: 'Reply with ONLY {"pass": true} or {"pass": false}. Nothing else. Is 17 a prime number?', accept: (t) => parseLoose(t)?.pass === true },
    { id: "array", prompt: 'Reply with ONLY a JSON array of the three largest planets of the Solar System by radius, largest first, as lowercase English strings.', accept: (t) => { const a = parseLoose(t); return Array.isArray(a) && a.length === 3 && /jupiter/i.test(a[0]) && /saturn/i.test(a[1]); } },
    {
      id: "computed-schema",
      // Shape AND arithmetic AND ordering, together. Each is easy alone; holding all three is
      // where models that merely pattern-match a schema come apart.
      prompt: 'Order: 3 mugs at 4.50 each, 2 books at 12.00 each, 5 pens at 1.20 each. Reply with ONLY JSON: '
        + '{"total": <grand total>, "items": [{"name": <name>, "subtotal": <qty*price>}]} with items sorted by subtotal, largest first.',
      accept: (t) => {
        const o = parseLoose(t);
        if (!o || !Array.isArray(o.items) || o.items.length !== 3) return false;
        if (Math.abs(Number(o.total) - 43.5) > 0.01) return false;
        const subs = o.items.map((i) => Number(i.subtotal));
        return Math.abs(subs[0] - 24) < 0.01 && Math.abs(subs[1] - 13.5) < 0.01 && Math.abs(subs[2] - 6) < 0.01;
      },
    },
  ],
};

// A model that wraps its JSON in a fence, or explains itself first, has still produced the JSON.
// Grading it as a failure would measure prose habits, not capability — the strict-format cases
// above are where obedience is being measured, on purpose and separately.
export function parseLoose(text) {
  const s = String(text || "");
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const m = /[[{][\s\S]*[\]}]/.exec(body);
  try { return JSON.parse(m ? m[0] : body); } catch { return null; }
}

export const BENCH_TOOLS = [
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

// Two shapes reach these graders: the OpenAI wire form ({function:{name,arguments}}) when a raw
// API response is graded, and the normalised form ({name,input}) the sidebar's provider layer
// hands back. Accepting both keeps the same probes usable from the CLI and from the extension —
// one definition of "did it pick the right tool", not two that can drift apart.
export const toolName = (c) => c?.function?.name || c?.name || "";
export const toolArgs = (c) => {
  if (c?.input && typeof c.input === "object") return c.input;
  try { return JSON.parse(c?.function?.arguments || "{}"); } catch { return {}; }
};
const argsOf = toolArgs;

export const TOOL_PROBES = [
  {
    id: "pick-tool",
    prompt: "What is the weather in Lyon right now?",
    accept: (_t, calls) => { const c = calls?.[0]; return toolName(c) === "get_weather" && /lyon/i.test(argsOf(c).city || ""); },
  },
  {
    id: "fill-args",
    prompt: "How much is 250 euros in Japanese yen?",
    accept: (_t, calls) => {
      const c = calls?.[0], a = argsOf(c);
      return toolName(c) === "convert_currency" && Number(a.amount) === 250 && /eur/i.test(a.from || "") && /jpy|yen/i.test(a.to || "");
    },
  },
  {
    id: "restraint",
    prompt: "Say the word ready and nothing else.",
    accept: (t, calls) => !(calls || []).length && /ready/i.test(t || ""),
  },
  {
    id: "no-tool-needed",
    // The information is already in the question. Reaching for the weather tool here is the same
    // reflex that makes an agent burn a step looking up what it was just told.
    prompt: "It is 25°C in Lyon and 68°F in Boston. Which city is warmer right now? Answer with the city name only.",
    accept: (t, calls) => !(calls || []).length && /lyon/i.test(t || "") && !/boston/i.test(t || ""),
  },
];

// Models that reason out loud put the answer at the END. Grading the whole transcript lets a
// number mentioned while thinking ("could it be 19?") count as the answer.
function lastLine(t) {
  const lines = String(t || "").trim().split(/\n+/).filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1] : "";
}

export const FAMILIES = ["reason", "instruction", "json", "tools"];

export function probesFor(family) {
  return family === "tools" ? TOOL_PROBES : PROBES[family] || [];
}

export function totalProbes(families = FAMILIES) {
  return families.reduce((n, f) => n + probesFor(f).length, 0);
}

/**
 * Run the whole set against one model.
 *
 * `call({ model, messages, tools })` is injected rather than imported: the sidebar passes the real
 * provider, and a test passes a scripted one. Without that seam this could only ever be exercised
 * by spending money against a live API, which is the same as not being exercised.
 */
export async function runLiveBench({ model, call, families = FAMILIES, repeats = 1, onProgress, signal }) {
  const byFamily = {};
  const failures = [];
  let pass = 0, total = 0, ms = 0, cost = 0, errors = 0;

  for (let run = 0; run < repeats; run++) {
    for (const family of families) {
      byFamily[family] ||= { pass: 0, total: 0 };
      for (const probe of probesFor(family)) {
        if (signal?.aborted) return finish();
        const t0 = Date.now();
        let res;
        try {
          res = await call({
            model,
            messages: [{ role: "user", content: probe.prompt }],
            tools: family === "tools" ? BENCH_TOOLS : undefined,
          });
        } catch (e) {
          res = { error: e && e.message ? e.message : String(e) };
        }
        ms += Date.now() - t0;
        cost += res?.cost || 0;
        total++; byFamily[family].total++;

        // An API error is not a wrong answer, and scoring it as one would slander a model for a
        // rate limit or a dropped connection. It is counted separately and shown as such.
        if (res?.error) { errors++; failures.push({ family, probe: probe.id, why: res.error.slice(0, 90) }); }
        else if (probe.accept(res?.text || "", res?.toolCalls || [])) { pass++; byFamily[family].pass++; }
        else failures.push({ family, probe: probe.id, why: "wrong answer" });

        onProgress?.({ done: total, of: totalProbes(families) * repeats, family, probe: probe.id });
      }
    }
  }
  return finish();

  function finish() {
    const answered = total - errors;
    return {
      model,
      // Scored over what the model actually ANSWERED: a run half-eaten by rate limits should read
      // as a thin measurement, not as a bad model. `answered` is reported so thinness is visible.
      score: answered > 0 ? pass / answered : null,
      pass, total, answered, errors, ms, cost,
      byFamily, failures,
    };
  }
}

/** Rank measured results, then published ones, then the rest. Nulls sort last, never as zero. */
export function compareRows(a, b, key) {
  const va = a[key], vb = b[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  return vb - va;
}
