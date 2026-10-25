// Image sizes for the models that take a format and a resolution (Gemini image models through
// OpenRouter: `image_config: { aspect_ratio, image_size }`). Measured on OpenRouter, 2026-10-25:
// gemini-3.1-flash-image 1K 1:1 → 1024×1024, 2K 16:9 → 2752×1536, 4K 16:9 → 5504×3072 (real 4K,
// ~0.15 $, ~2 min); gemini-3-pro-image 2K 1:1 → 2048×2048, but 4K refused for that id.

/** The formats offered, as `aspect_ratio` values. */
export const IMAGE_SHAPES = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];

/** Models OpenRouter lets generate in 4K (its own list, from the refusal message). */
const FOUR_K = [/gemini-3\.1-flash-image/, /gemini-3-pro-image-preview/, /gemini-nano-banana-2\.1/];
/** Models with a resolution setting at all (2K and up): the Gemini 3.x image family. */
const SIZED = [/gemini-3(\.\d)?-(pro|flash)-image/, /gemini-nano-banana/];

/**
 * The resolutions a model offers with formats, or [] when it takes pixel sizes (or none).
 * Every Gemini image model takes the format; 2K and 4K only where measured. (OpenAI's image models
 * through OpenRouter ignore both — measured: 16:9 and 9:16 both came back 1024×1024.)
 */
export function imageResolutions(modelId) {
  const id = String(modelId || "");
  if (FOUR_K.some((r) => r.test(id))) return ["1K", "2K", "4K"];
  if (SIZED.some((r) => r.test(id))) return ["1K", "2K"];
  if (/^google\/gemini.*image/.test(id)) return ["1K"]; // 2.5 Flash Image, 3.1 Flash Lite Image: format only
  return [];
}

/**
 * The pixel sizes a model really takes, for the models with a size parameter. OpenAI's own API
 * accepts only these (the list used to offer every size to every model).
 */
export function pixelSizes(providerId, modelId) {
  const id = String(modelId || "");
  if (providerId === "openai") {
    if (/dall-e-2/.test(id)) return ["256x256", "512x512", "1024x1024"];
    if (/dall-e-3/.test(id)) return ["1024x1024", "1792x1024", "1024x1792"];
    return ["1024x1024", "1536x1024", "1024x1536"]; // gpt-image-*
  }
  if (providerId === "openrouter") return []; // no size control outside the Gemini models above
  return ["512x512", "1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"]; // FLUX, Grok…: free sizes
}

/**
 * "16:9@4K" → { aspect_ratio: "16:9", image_size: "4K" }; the format or the quality alone ("16:9",
 * "@2K") → that one only, the model choosing the other; a pixel size "1792x1024" → its ratio;
 * null otherwise.
 */
export function imageConfigOf(size) {
  const s = String(size || "");
  const m = /^(\d+:\d+)?(?:@(1K|2K|4K))?$/.exec(s);
  if (s && m) return { ...(m[1] ? { aspect_ratio: m[1] } : {}), ...(m[2] ? { image_size: m[2] } : {}) };
  const px = /^(\d+)x(\d+)$/.exec(s);
  if (px) {
    const w = +px[1], h = +px[2], r = w / h;
    const near = IMAGE_SHAPES.map((a) => { const [x, y] = a.split(":").map(Number); return [a, Math.abs(x / y - r)]; }).sort((p, q) => p[1] - q[1])[0];
    return { aspect_ratio: near[0] };
  }
  return null;
}
