// Which house made a model, as a mark the composer can draw (hivey-vscode, core/router/vendorIcon.ts).
//
// The keys are the vendor prefixes OpenRouter uses; the sidebar's own provider ids map to the same
// marks, and a local server is marked by the server serving it — the honest answer to "whose model
// is this?" when the answer is "yours".

import { VENDOR_PATHS } from "./vendor-icons.generated.js";

const BY_VENDOR = {
  openai: "openai", anthropic: "anthropic", google: "google", qwen: "qwen", alibaba: "qwen",
  mistralai: "mistral", mistral: "mistral", deepseek: "deepseek", meta: "meta", "meta-llama": "meta",
  "x-ai": "xai", xai: "xai", cohere: "cohere", amazon: "aws", aws: "aws", nvidia: "nvidia",
  "z-ai": "zhipu", zhipu: "zhipu", zhipuai: "zhipu", minimax: "minimax", moonshotai: "moonshot",
  moonshot: "moonshot", perplexity: "perplexity", ollama: "ollama", lmstudio: "lmstudio",
};

/** The mark of a model: from its vendor prefix, else from the provider serving it; undefined when unknown. */
export function vendorSlug(providerId, modelId) {
  const id = String(modelId || "");
  const prefix = id.includes("/") ? id.slice(0, id.indexOf("/")).toLowerCase().replace(/^~/, "") : "";
  if (prefix && BY_VENDOR[prefix]) return BY_VENDOR[prefix];
  if (BY_VENDOR[providerId]) return BY_VENDOR[providerId];
  // A model served by a gateway is still its maker's: `qwen-27b`, `llama-3.3`, `gemma-4`.
  const low = id.toLowerCase();
  for (const [re, slug] of [[/qwen|qwq/, "qwen"], [/llama/, "meta"], [/gemma|gemini/, "google"], [/mistral|mixtral|codestral/, "mistral"], [/deepseek/, "deepseek"], [/claude/, "anthropic"], [/gpt|o\d-/, "openai"], [/grok/, "xai"], [/glm/, "zhipu"], [/kimi/, "moonshot"], [/minimax/, "minimax"], [/nemotron/, "nvidia"]]) {
    if (re.test(low)) return slug;
  }
  return undefined;
}

/** An <svg> of the mark, or null. Filled with currentColor; even-odd, as the marks are authored. */
export function vendorIcon(slug, size = 14) {
  const paths = slug && VENDOR_PATHS[slug];
  if (!paths || !paths.length) return null;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);
  }
  return svg;
}
