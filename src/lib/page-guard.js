// What a page says to the AI rather than to its reader never reaches the model.
//
// A sentence in a prompt asking a small model to ignore such text does not hold: it reads it as an
// order like any other. The refusal is code, for the same reason the payment guard is. It is not a
// complete defence (no filter of words can be), and the other guards stay: this removes the plain
// cases, those a page writes for every agent that comes by.

const ORDER = "(open|visit|navigate|go to|click|send|tell|report|enter|ignore|ouvre|va sur|clique|envoie|dis)";
const ADDRESSED_TO_AI = new RegExp(
  [
    "\\b(ignore|disregard) (all |any )?(your |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)",
    "\\b(ignore|oublie|ignorez?) (toutes? )?(tes|vos) (instructions|consignes)",
    "\\b(note|notice|instructions?)\\b[^.\\n]{0,20}\\b(for|to)\\b[^.\\n]{0,8}\\b(ai|llm|assistants|agents|language models?)\\b",
    `\\b(ai|llm|browsing)\\s+(agents?|assistants?|models?)\\b[^.\\n]{0,40}\\b(must|shall|are required to|need to)\\b[^\\n]{0,60}\\b${ORDER}\\b`,
    "\\bsystem\\s+(notice|override)\\b",
    "^\\W*\\[\\s*system\\s*:",
    "<!--\\s*(assistant|ai|system)\\b",
    "^\\W*(assistant|ai agent)\\s*:",
    `\\b(assistants?|agents?) (ia|d'ia)\\b[^.\\n]{0,40}\\b(doivent|doit|devez)\\b[^\\n]{0,60}\\b${ORDER}\\b`,
  ].join("|"),
  "i",
);
export const REMOVED_NOTE = "[Removed by the browser: text addressed to AI assistants rather than to the page's reader.]";

/** The page's text without what it addresses to AI assistants, and how many lines went. */
export function cleanPageText(text) {
  if (typeof text !== "string" || !text) return { text, removed: 0 };
  let removed = 0;
  const lines = text.split("\n").map((line) => {
    if (!ADDRESSED_TO_AI.test(line)) return line;
    removed++;
    return REMOVED_NOTE;
  });
  return { text: removed ? lines.join("\n") : text, removed };
}

/** A tool's page, cleaned where it holds one; it says so, for the model to tell the user. */
export function guardPage(page) {
  if (!page || typeof page.text !== "string") return page;
  const { text, removed } = cleanPageText(page.text);
  return removed ? { ...page, text, removedForAi: removed } : page;
}
