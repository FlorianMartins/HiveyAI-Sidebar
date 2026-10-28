// 🐝 Hivey model assignments — the OpenRouter model behind each tier/role.
//
// Hivey has three presets, each mapping every capability role to an OpenRouter model:
//   • Free  ("hivey/free")   — strong FREE models; the sidebar auto-rotates to another free model
//                              when one hits a rate-limit / runs out of free credits;
//   • Smart ("hivey/hybrid") — the most precise for the least money;
//   • Pro   ("hivey/smart")  — the most powerful (both described below, brief of 2026-10-25).
//
// AUTO-CURATED by scripts/update-models.mjs (daily): each role is bumped to a newer model (free
// stays free, paid stays paid) of the same family when one ships. Every id is validated against the live catalogue.
//
// MEASURED, 2026-08-19/20 (`node scripts/bench-hivey.mjs --candidates=… --repeat=4`, the answers
// EXTRACTED and EXECUTED against assertions rather than eyeballed). A single run ranked noise:
// the same model scored 3/3 then 1/2 on consecutive passes. Over four repeats the picture held:
//
//     8/8  nvidia/nemotron-3-super-120b-a12b:free    ok:8
//     8/8  nvidia/nemotron-3.5-lightning:free        ok:8
//     6/8  poolside/laguna-s-2.1:free                ok:6  logic:2
//
// The code-SPECIALISED free models all lost, and laguna's two failures were LOGIC, not syntax —
// wrong answers, not a misread instruction. So hivey/free code+test run on nemotron-3-super, and
// agent on nemotron-3.5-lightning (same score, plus a 1M window the agent role genuinely uses).
// A "-code" suffix is a claim; the bench is a result. Re-run it before changing these back.
// (z-ai/glm-5.2:free scored 0 in the first sweep purely by exhausting its rate-limit retries —
// it answers 200 fine. That was the bench's impatience, not the model.)
// Pro (hivey/smart) and Smart (hivey/hybrid), user's brief, 2026-10-25:
//   Pro — the most precise answers, a little cheaper where it costs nothing: Fable 5.1 for hard
//   reasoning and maths, Opus 5.5 for chat, code, the agent and writing, Sonnet 5.5 for vision,
//   search, verification, simple chat and extraction; Haiku only routes.
//   Smart — the middle one, most precision for the least cost: Sonnet 5.5 everywhere, Opus 5.5 for
//   hard reasoning and maths; Haiku routes and extracts.
// <hivey:start>
export const HIVEY_MODELS = {
  "hivey/smart": {
    "router": "anthropic/claude-haiku-5.5",
    "utility": "anthropic/claude-haiku-5.5",
    "light": "anthropic/claude-sonnet-5.5",
    "chat": "anthropic/claude-opus-5.5",
    "code": "anthropic/claude-opus-5.5",
    "test": "qwen/qwen3-coder",
    "reasoning": "anthropic/claude-fable-5.1",
    "math": "anthropic/claude-fable-5.1",
    "creative": "anthropic/claude-opus-5.5",
    "extract": "anthropic/claude-sonnet-5.5",
    "vision": "anthropic/claude-sonnet-5.5",
    "verify": "anthropic/claude-sonnet-5.5",
    "agent": "anthropic/claude-opus-5.5",
    "search": "anthropic/claude-sonnet-5.5",
    "image": "google/gemini-3-pro-image"
  },
  "hivey/hybrid": {
    "router": "anthropic/claude-haiku-5.5",
    "utility": "anthropic/claude-haiku-5.5",
    "light": "anthropic/claude-sonnet-5.5",
    "chat": "anthropic/claude-sonnet-5.5",
    "code": "anthropic/claude-sonnet-5.5",
    "test": "qwen/qwen3-coder",
    "reasoning": "anthropic/claude-opus-5.5",
    "math": "anthropic/claude-opus-5.5",
    "creative": "anthropic/claude-sonnet-5.5",
    "extract": "anthropic/claude-haiku-5.5",
    "vision": "anthropic/claude-sonnet-5.5",
    "verify": "anthropic/claude-sonnet-5.5",
    "agent": "anthropic/claude-sonnet-5.5",
    "search": "anthropic/claude-sonnet-5.5",
    "image": "google/gemini-3.1-flash-image"
  },
  "hivey/free": {
    "router": "nvidia/nemotron-3.5-lightning:free",
    "utility": "nvidia/nemotron-3.5-lightning:free",
    "light": "nvidia/nemotron-3.5-lightning:free",
    "chat": "nvidia/nemotron-3.5-lightning:free",
    "code": "poolside/laguna-s-2.1:free",
    "test": "poolside/laguna-s-2.1:free",
    "reasoning": "thinkingmachines/inkling:free",
    "math": "thinkingmachines/inkling:free",
    "creative": "nvidia/nemotron-3.5-lightning:free",
    "extract": "nvidia/nemotron-3.5-lightning:free",
    "vision": "thinkingmachines/inkling-small:free",
    "verify": "nvidia/nemotron-3.5-lightning:free",
    "agent": "nvidia/nemotron-3.5-lightning:free",
    "search": "nvidia/nemotron-3.5-lightning:free",
    "image": "google/gemini-3.1-flash-image"
  }
};
// <hivey:end>
