// One model, many spellings: `anthropic/claude-opus-4.5` in the catalogue, `claude-opus-4-5` on
// Anthropic's own API, `models/gemini-2.5-pro` on Google's. The catalogue key a native id stands
// for, so a window or a price is found whichever door the model was reached through.

const VENDOR = { anthropic: "anthropic", openai: "openai", google: "google", mistral: "mistralai", deepseek: "deepseek", xai: "x-ai", perplexity: "perplexity", cohere: "cohere" };

/** The key of `table` this provider's model id corresponds to, or "" when none does. */
/** Provider aliases whose catalogue entry has another name. */
const LATEST_ALIASES = { "mistral/mistral-small-latest": "mistralai/mistral-small-2603" };

export function catalogWindowId(providerId, modelId, table) {
  const id = String(modelId || "");
  if (!id) return "";
  if (table[id]) return id;
  const vendor = VENDOR[providerId];
  const dotted = id.replace(/^models\//, "").replace(/-(\d+)-(\d+)(?=$|-)/, "-$1.$2").replace(/-\d{8}$/, "");
  // « mistral-large-latest » is the catalogue's « mistralai/mistral-large »; a few aliases name
  // the current release under another name.
  const latest = dotted.replace(/-latest$/, "");
  const alias = LATEST_ALIASES[`${providerId}/${id}`];
  for (const c of vendor ? [`${vendor}/${id}`, `${vendor}/${dotted}`, `${vendor}/${latest}`, alias] : [dotted, latest]) if (c && table[c]) return c;
  return "";
}
