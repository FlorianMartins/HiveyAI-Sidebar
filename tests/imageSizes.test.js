// Image formats and resolutions (lib/image-sizes.js): 4K only where OpenRouter really generates it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageResolutions, imageConfigOf, pixelSizes } from "../src/lib/image-sizes.js";

test("4K is offered only for the models that really generate it; 2K for the Gemini 3 family; nothing for others", () => {
  assert.deepEqual(imageResolutions("google/gemini-3.1-flash-image"), ["1K", "2K", "4K"]);
  assert.deepEqual(imageResolutions("google/gemini-3-pro-image"), ["1K", "2K"], "OpenRouter refuses 4K for this id");
  assert.deepEqual(imageResolutions("google/gemini-3-pro-image-preview"), ["1K", "2K", "4K"]);
  assert.deepEqual(imageResolutions("openai/gpt-5-image"), []);
});

test("a size becomes the request's image_config", () => {
  assert.deepEqual(imageConfigOf("16:9@4K"), { aspect_ratio: "16:9", image_size: "4K" });
  assert.deepEqual(imageConfigOf("1792x1024"), { aspect_ratio: "16:9" });
  assert.equal(imageConfigOf(""), null);
});

test("every Gemini image model takes formats; OpenAI direct keeps only the sizes its API accepts", () => {
  assert.deepEqual(imageResolutions("google/gemini-2.5-flash-image"), ["1K"]);
  assert.deepEqual(imageResolutions("google/gemini-3.1-flash-lite-image"), ["1K"], "2K is refused (measured)");
  assert.deepEqual(imageResolutions("google/gemini-nano-banana-2.1"), ["1K", "2K", "4K"]);
  assert.deepEqual(pixelSizes("openai", "dall-e-3"), ["1024x1024", "1792x1024", "1024x1792"]);
  assert.deepEqual(pixelSizes("openai", "gpt-image-1"), ["1024x1024", "1536x1024", "1024x1536"]);
  assert.deepEqual(pixelSizes("openrouter", "openai/gpt-5-image"), [], "ignored through OpenRouter (measured)");
});
