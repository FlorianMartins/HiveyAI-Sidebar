// 🐝 Hivey model assignments — the OpenRouter model behind each tier/role.
//
// Hivey now has a SINGLE variant: "hivey/free". It maps each capability role to a strong
// FREE OpenRouter model, and the sidebar auto-rotates to another free model when one hits a
// rate-limit / runs out of free credits. The paid composite variants (low-cost/balanced/pro)
// were removed: routing one request across several paid APIs cost more for a worse result,
// and all the good "technologies" (artifacts, Thinking, web, verify) now work on ANY model.
//
// AUTO-CURATED by scripts/update-models.mjs (daily): each role is bumped to a newer free
// model of the same family when one ships. Every id is validated against the live catalogue.
//
// <hivey:start>
export const HIVEY_MODELS = {
  "hivey/smart": {
    "router": "anthropic/claude-haiku-4.5",
    "utility": "anthropic/claude-haiku-4.5",
    "light": "anthropic/claude-haiku-4.5",
    "chat": "anthropic/claude-opus-5",
    "code": "anthropic/claude-opus-5",
    "test": "qwen/qwen3-coder",
    "reasoning": "anthropic/claude-opus-5",
    "math": "anthropic/claude-opus-5",
    "creative": "anthropic/claude-opus-5",
    "extract": "anthropic/claude-haiku-4.5",
    "vision": "anthropic/claude-sonnet-5",
    "verify": "anthropic/claude-sonnet-5",
    "agent": "anthropic/claude-opus-5",
    "search": "anthropic/claude-sonnet-5",
    "image": "google/gemini-3-pro-image"
  },
  "hivey/hybrid": {
    "router": "anthropic/claude-haiku-4.5",
    "utility": "anthropic/claude-haiku-4.5",
    "light": "anthropic/claude-haiku-4.5",
    "chat": "anthropic/claude-haiku-4.5",
    "code": "anthropic/claude-sonnet-5",
    "test": "qwen/qwen3-coder",
    "reasoning": "anthropic/claude-sonnet-5",
    "math": "anthropic/claude-sonnet-5",
    "creative": "anthropic/claude-haiku-4.5",
    "extract": "anthropic/claude-haiku-4.5",
    "vision": "anthropic/claude-haiku-4.5",
    "verify": "anthropic/claude-haiku-4.5",
    "agent": "anthropic/claude-sonnet-5",
    "search": "anthropic/claude-haiku-4.5",
    "image": "google/gemini-3.1-flash-image"
  },
  "hivey/free": {
    "router": "nvidia/nemotron-3-nano-30b-a3b:free",
    "utility": "nvidia/nemotron-3-nano-30b-a3b:free",
    "light": "nvidia/nemotron-3-nano-30b-a3b:free",
    "chat": "nvidia/nemotron-3.5-lightning:free",
    "code": "poolside/laguna-s-2.1:free",
    "test": "poolside/laguna-s-2.1:free",
    "reasoning": "nvidia/nemotron-3-super-120b-a12b:free",
    "math": "nvidia/nemotron-3-super-120b-a12b:free",
    "creative": "nvidia/nemotron-3.5-lightning:free",
    "extract": "nvidia/nemotron-3-nano-30b-a3b:free",
    "vision": "nvidia/nemotron-nano-12b-v2-vl:free",
    "verify": "nvidia/nemotron-3-nano-30b-a3b:free",
    "agent": "poolside/laguna-s-2.1:free",
    "search": "nvidia/nemotron-3.5-lightning:free",
    "image": "google/gemini-3.1-flash-image"
  }
};
// <hivey:end>
