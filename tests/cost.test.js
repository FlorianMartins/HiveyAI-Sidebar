// What an answer cost (lib/cost.js), and whose mark the model chip wears (lib/vendor-icon.js).

import test from "node:test";
import assert from "node:assert/strict";
import { costOf, priceOf, formatUsd, formatTokens } from "../src/lib/cost.js";
import { vendorSlug } from "../src/lib/vendor-icon.js";
import { PRICES } from "../src/lib/model-catalog.generated.js";

const usage = { promptTokens: 10000, completionTokens: 500, cachedTokens: 8000 };

test("OpenRouter's own figure is the cost, exactly", () => {
  assert.deepEqual(costOf("openrouter", "anthropic/claude-sonnet-4.6", { ...usage, costUsd: 0.0123 }, {}), { usd: 0.0123, exact: true });
});

test("elsewhere the provider's tokens are priced from the catalogue — cache reads at their own price — and marked as an estimate", () => {
  const p = PRICES["anthropic/claude-sonnet-4.6"];
  const c = costOf("anthropic", "claude-sonnet-4-6", usage, { keys: { anthropic: "k" } });
  assert.equal(c.exact, false);
  assert.ok(Math.abs(c.usd - (2000 * p[0] + 8000 * (p[2] ?? p[0]) + 500 * p[1]) / 1e6) < 1e-9);
  assert.deepEqual(priceOf("anthropic", "claude-sonnet-4-6"), p, "a native id finds the catalogue's spelling");
  assert.equal(costOf("openai", "a-model-nobody-lists", usage, {}), null, "unknown price: no figure rather than a wrong one");
});

test("the user's own machine and gateway cost nothing through the extension; free models neither", () => {
  assert.deepEqual(costOf("custom", "qwen-27b", usage, { baseUrls: { custom: "https://ai.example.org/v1" } }), { usd: 0, free: true });
  assert.deepEqual(costOf("ollama", "qwen3", usage, {}), { usd: 0, free: true });
  assert.deepEqual(costOf("openrouter", "meta-llama/llama-3.3-70b-instruct:free", usage, {}), { usd: 0, exact: true });
});

test("costs and token counts read the way a status line needs", () => {
  assert.match(formatUsd(0.0042, { lang: "fr" }), /^0,0042\s\$$/u, "a no-break space before the symbol, as French writes it");
  assert.match(formatUsd(0.00001, { lang: "fr" }), /^< 0,0001/);
  assert.match(formatUsd(0.123, { exact: false, lang: "fr" }), /^≈ 0,123/);
  assert.equal(formatTokens(8234, "fr"), "8,2 k");
  assert.equal(formatTokens(950000, "fr"), "950 k");
  assert.equal(formatTokens(512, "fr"), "512");
});

test("the model chip wears its maker's mark: by vendor prefix, by provider, or by the model's family on a gateway", () => {
  assert.equal(vendorSlug("openrouter", "anthropic/claude-sonnet-4.6"), "anthropic");
  assert.equal(vendorSlug("openrouter", "~openai/gpt-luna-latest"), "openai");
  assert.equal(vendorSlug("anthropic", "claude-opus-5-5"), "anthropic");
  assert.equal(vendorSlug("custom", "qwen-27b"), "qwen");
  assert.equal(vendorSlug("ollama", "some-local-model"), "ollama");
  assert.equal(vendorSlug("custom", "my-private-model"), undefined);
});
