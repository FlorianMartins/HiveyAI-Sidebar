// Image formats and resolutions (lib/image-sizes.js): 4K only where OpenRouter really generates it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageResolutions, imageConfigOf } from "../src/lib/image-sizes.js";

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
