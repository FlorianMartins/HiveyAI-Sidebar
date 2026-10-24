// What an answer cost, and what the conversation has cost so far — for the cloud models.
//
// « Il n'y a nulle part le contexte rempli ni le coût de la conversation et des réponses » (as in
// hivey-vscode). OpenRouter says what each request cost (`usage.cost`, asked for with
// `usage: {include: true}`): that figure is exact and is used as it is. Elsewhere the tokens the
// provider counted are priced from the daily catalogue (OpenRouter's list prices, the same models
// under their vendor's name), and the result is marked as an estimate. The user's own machine and
// gateway cost nothing through this extension.

import { PRICES } from "./model-catalog.generated.js";
import { catalogWindowId } from "./model-ids.js";
import { privacyClass } from "./privacy.js";

/** The catalogue's [in, out, cacheRead?] USD per million tokens for a model, any spelling; null when unknown. */
export function priceOf(providerId, modelId) {
  const id = catalogWindowId(providerId, modelId, PRICES);
  return id ? PRICES[id] : null;
}

/**
 * The cost of one turn's usage: `{ usd, exact }`, `{ usd: 0, free: true }` on the user's own
 * infrastructure, or null when the price is unknown.
 */
export function costOf(providerId, modelId, usage, settings) {
  if (!usage) return null;
  if (privacyClass(providerId, settings) !== "cloud") return { usd: 0, free: true };
  if (typeof usage.costUsd === "number") return { usd: usage.costUsd, exact: true };
  if (/:free$/.test(String(modelId || ""))) return { usd: 0, exact: true };
  const p = priceOf(providerId, modelId);
  if (!p) return null;
  const cached = Math.min(usage.cachedTokens || 0, usage.promptTokens || 0);
  const fresh = (usage.promptTokens || 0) - cached;
  const usd = (fresh * p[0] + cached * (p[2] ?? p[0]) + (usage.completionTokens || 0) * p[1]) / 1e6;
  return { usd, exact: false };
}

/** "0,0042 $", "< 0,0001 $", "≈ 0,12 $" — in the interface's language. */
export function formatUsd(usd, { exact = true, lang = "fr" } = {}) {
  if (!Number.isFinite(usd)) return "";
  if (usd > 0 && usd < 0.0001) return `< ${new Intl.NumberFormat(lang, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 4 }).format(0.0001)}`;
  const digits = usd < 0.01 ? 4 : usd < 1 ? 3 : 2;
  const s = new Intl.NumberFormat(lang, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits }).format(usd);
  return exact ? s : `≈ ${s}`;
}

/** "8,2 k" — a token count short enough for a status line. */
export function formatTokens(n, lang = "fr") {
  if (!Number.isFinite(n)) return "";
  if (n < 1000) return String(Math.round(n));
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: n < 10000 ? 1 : 0 }).format(n / 1000)} k`;
}
