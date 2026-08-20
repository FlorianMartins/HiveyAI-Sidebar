// 🧠 Memory roles — which model does the memory work, and who pays for it.
//
// WHY THIS IS NOT IN hivey-models.js
// ----------------------------------
// That file is REGENERATED between its markers by the daily curation; anything written outside the
// header would be silently erased on the next run. Roles that must survive a curation belong in
// their own file.
//
// WHY THESE ROLES ARE NOT A QUALITY TIER
// --------------------------------------
// They are transverse to Free / Smart / Pro on purpose. Memory is not a premium feature and must
// never be conditioned on a paid tier: a user on Free who cannot recall anything does not
// experience "a cheaper plan", they experience an assistant with amnesia. The three roles are
// picked for latency and cost, not for prestige.
//
// THE ROUTE, AND WHY IT IS NEVER SILENTLY EXPENSIVE
// ------------------------------------------------
// The whole economic argument of this feature is that the ~3000 tokens of raw candidates are read
// by something free. If that fell back to a flagship, a recall would cost MORE than the naive
// injection it replaces — the design would invert. So the fallback is explicit and bounded:
//
//     local (Ollama / LM Studio)  → free, private, needs the user to run one
//     hivey/free                  → free, no setup                          ← default
//     a model the user chose      → their decision, shown with its price
//     nothing available           → NO recall. Never a flagship.
//
// The user picks, including "use my cloud model" if that is what they want; what the code refuses
// to do is choose an expensive route on their behalf to rescue a feature they did not ask to pay
// for.

export const MEMORY_ROLES = {
  "memory-extract": {
    label: "Extraction",
    // Runs in the background after an answer, a few times an hour at most. Latency does not matter;
    // cost does, because it is the only role that runs unprompted.
    why: "reads a few recent turns and proposes durable facts",
    prefer: "cheap",
  },
  "memory-recall": {
    label: "Recall",
    // Sits between a question and its answer. This is the one the user FEELS.
    why: "reads the candidate memories and writes a short briefing",
    prefer: "fast",
  },
  "memory-consolidate": {
    label: "Consolidation",
    // Rare, batched, and its output lands in the profile injected at every session — so this is
    // the one place where quality is worth more than speed.
    why: "folds groups of related memories into one durable statement",
    prefer: "quality",
  },
};

/** Free by default, for every variant. A local server wins when the user runs one. */
export const MEMORY_DEFAULTS = {
  "memory-extract": "hivey/free",
  "memory-recall": "hivey/free",
  "memory-consolidate": "hivey/free",
};

/**
 * Resolve the model for a role.
 *
 * Returns `null` rather than a paid model when nothing free or chosen is available. `null` means
 * "no recall this turn", which is a degradation the user does not pay for — the alternative is
 * spending flagship tokens to save flagship tokens.
 */
export function resolveMemoryModel(role, { settings = {}, localAvailable = false, localModel = "", freeAvailable = true } = {}) {
  const chosen = settings.memoryModels?.[role];
  if (chosen) return { id: chosen, route: "chosen" };
  if (localAvailable && localModel) return { id: localModel, route: "local" };
  if (freeAvailable) return { id: MEMORY_DEFAULTS[role] || "hivey/free", route: "free" };
  return { id: null, route: "none" };
}

/**
 * Candidates to offer in Settings.
 *
 * Everything the user's key can actually reach, filtered on the capability the role needs, each
 * shown with its price per million tokens and its admission score. Suggestions, never a cage —
 * the spec is explicit that there are no frozen presets, and a picker that hides the expensive
 * options is making the decision instead of informing it.
 */
export function memoryModelChoices(role, { catalogue = [], local = [], admission = {} } = {}) {
  const out = [];
  for (const m of local) out.push({ id: m.id, label: m.label || m.id, price: 0, route: "local", score: admission[m.id] ?? null });
  out.push({ id: "hivey/free", label: "Hivey Free", price: 0, route: "free", score: admission["hivey/free"] ?? null });
  for (const m of catalogue) {
    if (/^~/.test(m.id)) continue;
    const price = m.pricing?.completion ? +m.pricing.completion * 1e6 : 0;
    out.push({ id: m.id, label: m.name || m.id, price, route: "cloud", score: admission[m.id] ?? null });
  }
  // Free first, then by admission score, then by price. A model with no score sorts after the
  // measured ones rather than being ranked as if it had scored zero.
  return out.sort((a, b) =>
    a.price - b.price
    || (b.score ?? -1) - (a.score ?? -1)
    || String(a.label).localeCompare(String(b.label)));
}
