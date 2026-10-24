// Reasoning: what each thinking level puts in the request, per provider and per model — the same
// table as hivey-vscode (src/core/providers/reasoningMap.ts, router/reasoning.ts,
// router/reasoningLevels.ts), carried over with its rules and the reasons for them.
//
// ⚠️ The sidebar had three levels for every model — off, "high", "max" — and translated them by
// guesswork: Anthropic always got `thinking: {type: "enabled", budget_tokens}` (refused by every
// Claude since Opus 4.7, where adaptive thinking replaced it), OpenRouter got `reasoning.effort:
// "high"` or a token budget, every other provider got NOTHING — so a model that thinks by default
// (Qwen3.8 on the user's own server: its maximum effort) thought at its default whatever the menu
// said, and a model that cannot think was offered levels that changed nothing but the prompt. Now
// the menu offers the levels the selected model really has, under their own names, and each level
// is the request its vendor documents.
//
// The facts about models come from the generated catalogue (OpenRouter's own API, refreshed daily
// by scripts/update-models.mjs); nothing here names a model version.

import { REASONING_EFFORTS, REASONING_MODELS } from "./model-catalog.generated.js";
import { PROVIDERS } from "./models.js";

/** The user's own machine or gateway: Ollama, LM Studio, any OpenAI-compatible URL. */
export function isSelfHostedProvider(id) {
  const meta = PROVIDERS[id];
  return Boolean(meta && (meta.local || meta.custom || meta.gateway));
}

/** Tokens the thinking may take, per level — a budget where the API takes one, headroom elsewhere. */
export const THINKING_BUDGET = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
  xhigh: 32768,
  max: 65536,
};

/** The reasoning models of the catalogue, with bare ids aliased (`gpt-5` for `openai/gpt-5`). */
const REASONING_SET = (() => {
  const set = new Set(REASONING_MODELS);
  for (const id of REASONING_MODELS) {
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : undefined;
    if (bare) set.add(bare);
  }
  return set;
})();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Which models reason at all (router/reasoning.ts)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Which models accept a thinking budget.
//
// ⚠️ This was a regular expression in `extension/models.ts` naming versions:
//
//     /o[134]|gpt-5|claude|sonnet|opus|haiku|fable|deepseek|qwen3|reason|think|magistral|grok-[34]|gemini-[23]/i
//
// and it rotted the way a version written in source always rots. It matched `gpt-5`; the market moved
// to `gpt-6`. So `openai/gpt-6.1-sol-pro` — the model **both paid presets route their deep work to**
// — was reported as unable to reason, and the control that turns thinking on was **hidden on the
// strongest model in the product**. The invariant the project states for prices and versions applies
// here word for word: nothing names a version in source.
//
// The catalogue answers now, from OpenRouter's own `supported_parameters`, regenerated daily — 327
// of 454 models on the day this was written.
//
// The fallback stays, because the catalogue cannot answer for a model it has never heard of: a local
// runtime serving `qwen3-coder` appears in no gateway's list, and a pure-catalogue answer would turn
// thinking off for every local model at once. But the fallback **names no version** — only vendor
// families, which are stable for years, and the two words that describe the capability itself. A
// fallback that named versions would be this same defect, one layer down.
/**
 * Signals that are not versions.
 *
 * Vendor families and capability words only. `deepseek` is a house; `gpt-5` was a release. The first
 * is true next year and the second was false within months — which is the whole lesson here.
 */
export const REASONING_FALLBACK = /claude|sonnet|opus|haiku|fable|deepseek|qwen|magistral|reason|think/i;
export function reasoningSupport(id) {
  if (!id)
    return "unknown";
  if (REASONING_SET.has(id))
    return "yes";
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  if (REASONING_SET.has(bare))
    return "yes";
  if (REASONING_FALLBACK.test(id))
    return "yes";
  // A vendor prefix the catalogue carries means the catalogue HAS an opinion about this vendor's
  // models, and this one is not among the reasoning ones. No prefix, or one it has never seen, means
  // the model does not come from a catalogue at all — a gateway, a local runtime, a private
  // deployment — and there is nothing here to know it by.
  return KNOWN_VENDORS.has(id.slice(0, Math.max(0, id.indexOf("/")))) ? "no" : "unknown";
}
/** Vendors the generated catalogue actually lists, so "absent" can mean something for them. */
const KNOWN_VENDORS = new Set([...REASONING_SET].flatMap((id) => (id.includes("/") ? [id.slice(0, id.indexOf("/"))] : [])));
/** Does this model accept a thinking budget? Unknown counts as yes — see `reasoningSupport`. */
export function canReason(id) {
  return reasoningSupport(id) !== "no";
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// A self-hosted template's own levels, read from its refusal (router/reasoningLevels.ts)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The thinking levels a self-hosted model really has.
//
// ⚠️ « le mode de réflexion doit correspondre aux modes de raisonnement des modèles utilisés ». The
// panel offered the same four efforts for every model, and on Qwen3.8 they did not line up: its
// chat template knows "low", "medium" and "xhigh" — its DEFAULT, and the one an empty request got —
// and turns "high" into "xhigh". Nothing told the user which was which.
//
// The template says so itself. Asked for an effort it does not know, it refuses before generating
// anything — in milliseconds — with the list: "Unexpected reasoning effort x. Supported types are
// xhigh (default), medium, and low." That refusal is read here. A template that says nothing (it
// ignores the field, or the model does not think) leaves the panel's usual menu in place.
/** The effort sent to make a template list its levels: one no template knows. */
export const PROBE_EFFORT = "hivey-probe";
export function levelsFromRefusal(message) {
  // The list ends at the sentence's full stop — or at the quote closing the JSON string it sits in.
  const m = /supported (?:types|values|levels|efforts?|options)\s*(?:are|:)\s*([^.\n"\\]+)/i.exec(message);
  if (!m)
    return undefined;
  const list = m[1].replace(/['`]/g, "");
  const levels = [];
  let defaultLevel;
  for (const raw of list.split(/,|\band\b|\bor\b/)) {
    const item = raw.trim();
    const name = /^[a-z][a-z0-9_-]*/i.exec(item)?.[0]?.toLowerCase();
    if (!name || levels.includes(name))
      continue;
    levels.push(name);
    if (/\(default\)/i.test(item))
      defaultLevel = name;
  }
  if (!levels.length)
    return undefined;
  return { levels, ...(defaultLevel ? { defaultLevel } : {}) };
}
/** Which of the panel's four efforts a model level is. */
function effortOf(level) {
  if (/^(minimal|min|low|lite|brief)$/.test(level))
    return "low";
  if (/^(medium|med|default|normal|standard)$/.test(level))
    return "medium";
  if (/^(high|xhigh|max|maximum|deep)$/.test(level))
    return "high";
  return undefined;
}
/**
 * The menu for this model: thinking off, then each of its levels, weakest first — and only those.
 * Two levels that are the same effort to the panel (Qwen's "high" is its "xhigh") keep the stronger
 * name, which is the one the template actually runs.
 */
export function choicesFor(r) {
  const byEffort = new Map();
  for (const level of r.levels) {
    const id = effortOf(level);
    if (!id)
      continue;
    const prev = byEffort.get(id);
    if (prev && !(id === "high" && level.length > prev.native.length))
      continue;
    byEffort.set(id, { id, native: level, ...(level === r.defaultLevel ? { isDefault: true } : {}) });
  }
  const order = ["low", "medium", "high"];
  return [{ id: "none", native: "none" }, ...order.flatMap((id) => (byEffort.has(id) ? [byEffort.get(id)] : []))];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The table (providers/reasoningMap.ts)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// What each thinking level of the panel puts in the request, per provider and per model family.
//
// ⚠️ « je veux vraiment que quand on bascule le mode de réflexion qu'il change vraiment le niveau
// de réflexion sur tous les modèles cloud et locaux ou gateway ». The panel has four levels —
// Direct, Bref, Standard, Approfondi (`ReasoningEffort` "none" | "low" | "medium" | "high") — and
// before this file each provider translated them on its own, by guesswork:
//
//   • Anthropic got `thinking: {type: "enabled", budget_tokens}` on every model — a 400 on every
//     current Claude since Opus 4.7, where adaptive thinking and `output_config.effort` replaced it.
//   • OpenRouter got `reasoning: {exclude: true}` for Direct — which only HIDES the reasoning: the
//     model went on thinking, and billing for it.
//   • Clouds got nothing at all for Direct, so a model that thinks by default thought at its default.
//
// So the levels are translated HERE, in one place, with the vendor's documentation cited beside
// each rule. The providers ask this file what to send; the panel asks it which levels a model really
// has, so the menu never offers a level that would be the same request as another one, or a 400.
//
// The refused-field safety net in `openai.ts` (`adaptRequest`) stays — a gateway can always be
// stricter than its upstream — but nothing here relies on it: every mapping below is one the
// vendor documents as accepted for that model family.
/** Anthropic version ordering, so "newer than" is a comparison rather than a list of names. */
function atLeast(v, major, minor) {
  return v[0] > major || (v[0] === major && v[1] >= minor);
}
/**
 * The family a Claude model id belongs to — any spelling: `claude-opus-4-8`, `claude-sonnet-4-5-20250929`,
 * `anthropic.claude-opus-5-5` (Bedrock), `us.anthropic.claude-haiku-4-5-20251001-v1:0`,
 * `claude-opus-4-5@20251101` (Vertex), `anthropic/claude-opus-4.8` (OpenRouter), `claude-3-7-sonnet-latest`.
 */
export function anthropicFamily(model) {
  const id = model.toLowerCase().replace(/@.*$/, "");
  // New naming: tier then version — `opus-4-8`, `opus-4.8`, `fable-5`, `opus-4` (4.0). A date suffix
  // (`-20250929`) is not a minor version: only one or two digits count.
  const modern = /(opus|sonnet|haiku|fable|mythos)[-.]?(\d+)(?:[-.](\d{1,2}))?(?!\d)/.exec(id);
  // Old naming: version then tier — `claude-3-7-sonnet`, `claude-3-opus`, `claude-3-5-haiku`.
  const legacy = /claude-(\d+)(?:[-.](\d{1,2}))?-(opus|sonnet|haiku)/.exec(id);
  let tier = "unknown";
  let version = [99, 0];
  if (legacy) {
    tier = legacy[3];
    version = [Number(legacy[1]), Number(legacy[2] ?? 0)];
  }
  else if (modern) {
    tier = modern[1] === "mythos" ? "fable" : modern[1];
    version = [Number(modern[2]), Number(modern[3] ?? 0)];
  }
  return familyRules(tier, version);
}
function familyRules(tier, v) {
  const base = { tier, version: v };
  // Claude 3.5 and older have no extended thinking at all; 3.7 introduced the budget.
  if (tier !== "unknown" && tier !== "fable" && !atLeast(v, 3, 7)) {
    return { ...base, style: "none", off: "omit", xhigh: false, sampling: "allowed", displayOmitted: false };
  }
  const budget = { ...base, style: "budget", off: "omit", xhigh: false, sampling: "allowed", displayOmitted: false };
  switch (tier) {
    case "fable":
      return { ...base, style: "adaptive", off: "never", xhigh: true, max: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
    case "opus":
      if (atLeast(v, 5, 5))
        return { ...base, style: "adaptive", off: "never", xhigh: true, max: true, sampling: "rejected", displayOmitted: true, defaultEffort: "medium" };
      if (atLeast(v, 5, 0))
        return { ...base, style: "adaptive", off: "disabled", xhigh: true, max: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 7))
        return { ...base, style: "adaptive", off: "disabled", xhigh: true, max: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 6))
        return { ...base, style: "adaptive", off: "disabled", xhigh: false, max: true, sampling: "allowed", displayOmitted: false, defaultEffort: "high" };
      return budget;
    case "sonnet":
      if (atLeast(v, 5, 5))
        return { ...base, style: "adaptive", off: "between_tools", xhigh: true, max: true, sampling: "nondefault", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 5, 0))
        return { ...base, style: "adaptive", off: "disabled", xhigh: true, max: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 6))
        return { ...base, style: "adaptive", off: "disabled", xhigh: false, max: true, sampling: "allowed", displayOmitted: false, defaultEffort: "high" };
      return budget;
    case "haiku":
      if (atLeast(v, 5, 0))
        return { ...base, style: "adaptive", off: "disabled", xhigh: true, max: true, sampling: "nondefault", displayOmitted: true, defaultEffort: "medium" };
      return budget;
    default:
      // A Claude id nothing here can read — an alias, a private deployment name. The newest rules are
      // the safe ones: adaptive is accepted by every current model, and thinking is never "turned off"
      // by a field a model might refuse — Direct becomes the lowest effort instead.
      return { ...base, style: "adaptive", off: "never", xhigh: false, sampling: "rejected", displayOmitted: true };
  }
}
/**
 * The effort a panel level is on this family: the effort of the same name, or — for a level picked on
 * another model that this one lacks — the nearest it has below it.
 */
function anthropicEffort(f, level) {
  if (level === "max")
    return f.max ? "max" : f.xhigh ? "xhigh" : "high";
  if (level === "xhigh")
    return f.xhigh ? "xhigh" : "high";
  return level;
}
/**
 * The thinking part of an Anthropic request for this model and level. `undefined` level = nothing
 * was chosen: the model's own default, untouched (only the sampling rule still applies).
 */
export function anthropicThinking(model, level) {
  const f = anthropicFamily(model);
  const sampling = f.sampling === "allowed";
  if (!level || f.style === "none")
    return { headroom: 0, temperature: sampling };
  if (f.style === "budget") {
    if (level === "none")
      return { headroom: 0, temperature: sampling };
    const budget = THINKING_BUDGET[level];
    return { thinking: { type: "enabled", budget_tokens: budget }, headroom: budget, temperature: false };
  }
  const adaptive = () => (f.displayOmitted ? { type: "adaptive", display: "summarized" } : { type: "adaptive" });
  if (level === "none") {
    switch (f.off) {
      // No effort with it: Direct turns the THINKING off, not the care of the answer — and on Opus 5
      // and Haiku 5.5 `disabled` is refused above `high`, which no default exceeds.
      case "disabled":
        return { thinking: { type: "disabled" }, headroom: 0, temperature: sampling };
      // Sonnet 5.5: `disabled` is a 400; `between_tools` takes no other field and is accepted at
      // `high` or below — the default.
      case "between_tools":
        return { thinking: { type: "between_tools" }, headroom: 0, temperature: false };
      case "omit":
        return { headroom: 0, temperature: sampling };
      // Opus 5.5, Fable: thinking cannot be off. The least it does is adaptive at `low` — and the
      // panel does not offer Direct on these models (see `reasoningMenu`), so this is only reached by
      // a chore or a level carried over from another model.
      case "never":
        return { thinking: adaptive(), effort: "low", headroom: THINKING_BUDGET.low, temperature: false };
    }
  }
  return { thinking: adaptive(), effort: anthropicEffort(f, level), headroom: THINKING_BUDGET[level], temperature: false };
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The level menu, per model
// ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The levels the panel offers for a model, when this file knows that model's rules; `undefined`
 * keeps the usual four. Only levels that are a DIFFERENT request from one another, and none that
 * would be a 400 — so "Direct" is absent where thinking cannot be turned off.
 */
export function reasoningMenu(provider, model) {
  const all = [
    { id: "none", native: "none" },
    { id: "low", native: "low" },
    { id: "medium", native: "medium" },
    { id: "high", native: "high" },
  ];
  if (provider === "anthropic") {
    const f = anthropicFamily(model);
    if (f.style === "none")
      return undefined;
    if (f.style === "budget")
      return all.map((c) => (c.id === "none" ? c : { ...c, native: `${THINKING_BUDGET[c.id]} tokens` }));
    // The family's own efforts, all of them — see the header of this section.
    const own = [...all, ...(f.xhigh ? [{ id: "xhigh", native: "xhigh" }] : []), ...(f.max ? [{ id: "max", native: "max" }] : [])];
    const menu = own
      .filter((c) => c.id !== "none" || f.off !== "never")
      .map((c) => {
      const t = anthropicThinking(model, c.id);
      const native = c.id === "none" ? (f.off === "between_tools" ? "between_tools" : "none") : (t.effort ?? c.id);
      return { ...c, native, ...(f.defaultEffort && t.effort === f.defaultEffort ? { isDefault: true } : {}) };
    });
    return menu;
  }
  if (isSelfHosted(provider))
    return undefined; // the server's own template says — see reasoningLevels.ts
  const profile = profileFor(provider, model);
  if (!profile)
    return [];
  const a = assign(profile);
  // OpenAI's Chat Completions refuses tool calls with any effort but "none" from GPT-5.4 on, and an
  // agent turn always carries tools: on those models through this API, only Direct is real.
  if (provider === "openai" && toolsForbidThinking(model) && a.none)
    return [{ id: "none", native: "none" }];
  return LEVEL_ORDER.flatMap((id) => {
    const native = a[id];
    if (!native)
      return [];
    return [{ id, native, ...(profile.defaultEffort && native === profile.defaultEffort ? { isDefault: true } : {}) }];
  });
}
const RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const rank = (e) => RANK.indexOf(e);
const LEVEL_ORDER = ["none", "low", "medium", "high", "xhigh", "max"];
function isSelfHosted(provider) {
  return isSelfHostedProvider(provider);
}
function profile(efforts, defaultEffort) {
  const sorted = [...new Set(efforts)].filter((e) => rank(e) >= 0).sort((a, b) => rank(a) - rank(b));
  return { efforts: sorted, ...(defaultEffort && rank(defaultEffort) >= 0 ? { defaultEffort: defaultEffort } : {}) };
}
/** OpenRouter's catalogue entry for this id, as a profile. */
function fromCatalogue(id) {
  const row = REASONING_EFFORTS[id] ?? REASONING_EFFORTS[id.replace(/:[a-z]+$/, "")];
  if (!row)
    return undefined;
  const listed = (row.e ?? ["low", "medium", "high"]);
  // Not mandatory means it can be off, whether or not "none" is in the list (OpenRouter's own
  // documented switch); mandatory means "none" is refused, even when listed.
  const efforts = row.m ? listed.filter((e) => e !== "none") : [...listed, "none"];
  return profile(efforts, row.d);
}
const VENDOR_PREFIX = {
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  mistral: "mistralai",
  xai: "x-ai",
  qwen: "qwen",
  perplexity: "perplexity",
};
/** `gpt-5.4` → [5, 4]; undefined for anything that is not a numbered GPT. */
function gptVersion(model) {
  const m = /(?:^|\/)gpt-(\d+)(?:\.(\d+))?/.exec(model.toLowerCase());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined;
}
/** From GPT-5.4, Chat Completions takes tool calls only with `reasoning_effort: "none"`. */
export function toolsForbidThinking(model) {
  const v = gptVersion(model);
  return Boolean(v && (v[0] > 5 || (v[0] === 5 && v[1] >= 4)));
}
/** The efforts this model accepts through this provider; undefined when it cannot be steered at all. */
export function profileFor(provider, model) {
  const id = model.replace(/^models\//, "");
  const lower = id.toLowerCase();
  const ALL = ["none", "low", "medium", "high"];
  const ALWAYS = ["low", "medium", "high"];
  switch (provider) {
    case "openrouter": {
      const known = fromCatalogue(id);
      if (known)
        return known;
      if (lower.startsWith("anthropic/")) {
        const f = anthropicFamily(lower);
        if (f.style === "none")
          return undefined;
        const on = ["low", "medium", "high", ...(f.xhigh ? ["xhigh"] : []), ...(f.max ? ["max"] : [])];
        return profile(f.off === "never" ? on : ["none", ...on], f.defaultEffort);
      }
      return reasoningSupport(id) === "no" ? undefined : profile(ALL);
    }
    case "anthropic":
      return undefined; // its own native mapping, above
    case "deepseek":
      // The deprecated aliases are fixed: deepseek-chat never thinks, deepseek-reasoner always does.
      if (/deepseek-(chat|reasoner)$/.test(lower))
        return undefined;
      return profile(["none", "low", "high", "max"], "high");
    case "mistral":
      return fromCatalogue(`mistralai/${id}`) ?? (/mistral-(small|medium|large)/.test(lower) ? profile(["none", "high"], "high") : undefined);
    case "groq":
      if (/qwen3/.test(lower))
        return profile(ALL);
      if (/gpt-oss/.test(lower))
        return profile(ALWAYS);
      return undefined;
    case "perplexity":
      return /sonar-deep-research/.test(lower) ? profile(ALWAYS, "medium") : undefined;
    case "qwen": {
      const known = fromCatalogue(`qwen/${id}`);
      if (known)
        return profile(known.efforts.includes("none") ? ALL : ALWAYS);
      return /qwen3|qwq|deepseek|glm|kimi|minimax/.test(lower) ? profile(ALL) : undefined;
    }
    case "openai": {
      const known = fromCatalogue(`openai/${id}`);
      if (known)
        return known;
      if (/^o\d/.test(lower))
        return profile(ALWAYS, "medium");
      if (/gpt-oss/.test(lower))
        return profile(ALWAYS, "medium");
      const v = gptVersion(lower);
      if (!v || v[0] < 5 || /chat/.test(lower))
        return undefined;
      return v[0] === 5 && v[1] === 0 ? profile(["minimal", "low", "medium", "high"], "medium") : profile(ALL, "medium");
    }
    case "google": {
      const known = fromCatalogue(`google/${id}`);
      if (known)
        return known;
      if (/gemini-2\.5-flash/.test(lower))
        return profile(ALL);
      if (/gemini-(2\.5|[3-9]|\d{2})/.test(lower))
        return profile(ALWAYS);
      return undefined;
    }
    case "xai":
      return fromCatalogue(`x-ai/${id}`);
    default: {
      const prefix = VENDOR_PREFIX[provider];
      return prefix ? fromCatalogue(`${prefix}/${id}`) : undefined;
    }
  }
}
/**
 * The panel levels laid onto a profile — see the table above. Approfondi is the model's "high" (its
 * strongest effort when it has no "high"); "xhigh" and "max", when the model has them, are levels of
 * their own: « afficher les modes de réflexion des modèles de base ».
 */
export function assign(p) {
  const on = p.efforts.filter((e) => e !== "none");
  const out = {};
  if (p.efforts.includes("none"))
    out.none = "none";
  if (!on.length)
    return out;
  const top = on.filter((e) => e !== "xhigh" && e !== "max");
  const deep = on.includes("high") ? "high" : (top[top.length - 1] ?? on[0]);
  out.high = deep;
  if (on.includes("xhigh") && deep !== "xhigh")
    out.xhigh = "xhigh";
  if (on.includes("max") && deep !== "max")
    out.max = "max";
  const below = on.filter((e) => rank(e) < rank(deep));
  const brief = below.includes("low") ? "low" : below[0];
  if (brief) {
    out.low = brief;
    const standard = below.includes("medium") && brief !== "medium" ? "medium" : below.find((e) => rank(e) > rank(brief));
    if (standard)
      out.medium = standard;
  }
  return out;
}
/** The effort a level is SENT as on this profile — including a level the menu does not offer. */
export function effortFor(p, level) {
  const a = assign(p);
  if (a[level])
    return a[level];
  const on = p.efforts.filter((e) => e !== "none");
  if (!on.length)
    return a.none;
  // Direct where thinking cannot be off: the least the model does.
  if (level === "none")
    return on[0];
  // Otherwise the nearest level the profile has, the cheaper one on a tie.
  const wanted = LEVEL_ORDER.indexOf(level);
  const near = LEVEL_ORDER.filter((l) => l !== "none" && a[l]).sort((x, y) => Math.abs(LEVEL_ORDER.indexOf(x) - wanted) - Math.abs(LEVEL_ORDER.indexOf(y) - wanted) || LEVEL_ORDER.indexOf(x) - LEVEL_ORDER.indexOf(y));
  return near.length ? a[near[0]] : on[0];
}
/**
 * ⚙️ THE SELF-HOSTED MAPPING HOOK — the word sent to the user's own server (llama.cpp, vLLM,
 * Ollama, a llama-swap gateway) for each panel level.
 *
 * Today it is the panel's own word: "low", "medium", "high" (which Qwen3.8's template runs as its
 * "xhigh"), and "none" for thinking off. ⚠️ Measured on Qwen3.8: its "low" thinks LONGER than its
 * "medium" (3.7–7.4k against 1.3–3.9k characters on the same step), so on that template Bref is not
 * the lighter of the two. Which word each label should send there is for the owner's benchmark to
 * decide; change it here, and only here.
 */
export function selfHostedEffort(level) {
  // Bref sends "medium": on Qwen3.8 "low" thinks LONGER (above). What makes Bref brief is its budget —
  // see `selfHostedThinkingBudget`. A cloud's "xhigh" or "max" carried over is the server's deepest.
  if (level === "xhigh" || level === "max")
    return "high";
  return level === "low" ? "medium" : level;
}
/**
 * The thinking budget of each level on the user's own server, in tokens — llama.cpp closes the
 * thought itself when it is spent (`reasoning_budget_tokens`, with `reasoning_budget_message` said
 * as the thought's last words). None for Direct (no thinking) or Deep (as long as it takes).
 *
 * ⚠️ « Il n'y a absolument aucune différence entre les modes de réflexion (il met 1 h en mode bref
 * et réfléchit trop) … il se contredit souvent en mode "Wait… hum" en continu ». A level was only
 * a word in the template — Qwen3.8 turns "low" into one sentence, "Keep your thinking brief", which
 * it stops following the moment a problem is hard; "medium" adds nothing at all. Measured over 12 229
 * recorded steps: half think under ~50 tokens, 95 % under ~1 000, 99 % under ~3 600 — and the rest
 * run to 23 000, with up to 138 "Wait / Hmm / Actually" in one step. Bref stops at the 95th
 * percentile — measured: as precise as before (20/24 against 20/24 on the tasks that moved), 29 %
 * faster. Standard is only there to stop a runaway: at 4096 it cut a 15 000-character thought a hard
 * task needed (ts-cursor-pagination, 1/3 against 3/3), so it stops at 8192 — above every step of
 * the bench, far below the 23 000 of a loop.
 */
export function selfHostedThinkingBudget(level) {
  const tokens = level === "low" ? 1024 : level === "medium" ? 8192 : undefined;
  if (!tokens)
    return {};
  return {
    reasoning_budget_tokens: tokens,
    reasoning_budget_message: "\n\nI have thought this through enough. Now I act on what I have: the next tool call, or my answer.\n",
  };
}
/**
 * The reasoning fields of an OpenAI-shaped request for this provider, model and level.
 * `level` undefined: nothing chosen, the model's own default — nothing is sent.
 */
export function wireReasoning(provider, model, level, opts = {}) {
  const none = { fields: {}, dropTemperature: false };
  if (isSelfHosted(provider)) {
    // A side task on the user's own server: thinking OFF, whatever the panel says — a commit
    // message does not need the template's default effort.
    if (opts.chore)
      return { fields: { reasoning_effort: "none" }, dropTemperature: false };
    return level ? { fields: { reasoning_effort: selfHostedEffort(level) }, dropTemperature: false } : none;
  }
  // A chore on a cloud (a commit message, a suggestion, a translation) is not a level anybody picked:
  // it is sent exactly as before levels were translated per model — the vendor's own thinking, and on
  // OpenRouter the reasoning text left out of the reply (`exclude`, which hides it without changing it).
  if (opts.chore)
    return provider === "openrouter" ? { fields: { reasoning: { exclude: true } }, dropTemperature: false } : none;
  if (!level || provider === "anthropic")
    return none;
  const p = profileFor(provider, model);
  if (!p)
    return none;
  let effort = effortFor(p, level);
  if (!effort)
    return none;
  switch (provider) {
    case "openrouter":
      return { fields: { reasoning: { effort } }, dropTemperature: false };
    case "openai":
      if (opts.tools && toolsForbidThinking(model) && p.efforts.includes("none"))
        effort = "none";
      return { fields: { reasoning_effort: effort }, dropTemperature: effort !== "none" };
    case "deepseek":
      return effort === "none"
        ? { fields: { thinking: { type: "disabled" } }, dropTemperature: false }
        : { fields: { thinking: { type: "enabled" }, reasoning_effort: effort }, dropTemperature: false };
    case "qwen": {
      if (effort === "none")
        return { fields: { enable_thinking: false }, dropTemperature: false };
      const tokens = effort === "low" || effort === "minimal" ? THINKING_BUDGET.low : effort === "medium" ? THINKING_BUDGET.medium : THINKING_BUDGET.high;
      return { fields: { enable_thinking: true, thinking_budget: tokens }, dropTemperature: false };
    }
    default:
      return { fields: { reasoning_effort: effort }, dropTemperature: false };
  }
}
