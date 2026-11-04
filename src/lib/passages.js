// Which parts of the pages answer the question?
//
// ⚠️ « Le meilleur healer d'Overwatch » came back as Moira although the sources said otherwise: what the
// model was given was the START of each page — its menu, its cookie text, its intro — and the tier list
// was thousands of characters further down. Reading more of the page does not fit a small window;
// reading the right part does. So each page is cut into overlapping chunks, every chunk is scored against
// the question with BM25, what looks like navigation is pushed down, and only the best passages go to
// the model, within the budget the caller gives. No DOM, no network: tested with plain strings.

const STOP = new Set(("a au aux avec ce ces cette cet ceci cela ca dans de des du donc elle elles en es est et etre eu il ils je j la le les leur leurs lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que quel quelle quels quelles qui quoi sa se ses si son sur ta te tes toi ton tu un une vos votre vous y d l m n s t c " +
  "comment pourquoi quand combien lequel laquelle lesquels lesquelles dit peux peut veux voudrais faire fais parle dis donne moi stp svp merci bonjour salut " +
  "an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its me my no not of on or our she should so than that the their them then there these they this those to too us was we were what when where which who whom why will with would you your about tell give please thanks hello").split(" "));

/** Words of a text: lower case, no accents, no stop words, plural endings off. Numbers are kept. */
export function terms(text, { keepStop = false } = {}) {
  const out = [];
  const words = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u);
  for (const w of words) {
    if (!w || (!keepStop && STOP.has(w))) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(w.length > 3 && /[sx]$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  }
  return out;
}

/**
 * Overlapping chunks of a text, cut at line and sentence ends when there are any: `{ start, end, text }`.
 * The overlap keeps a fact that straddles two chunks whole in at least one of them.
 */
export function chunkText(text, { size = 900, overlap = 220 } = {}) {
  const s = String(text || "");
  const chunks = [];
  let start = 0;
  while (start < s.length) {
    let end = Math.min(s.length, start + size);
    if (end < s.length) {
      const window = s.slice(start + Math.floor(size * 0.6), end);
      const line = window.lastIndexOf("\n");
      const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
      const cut = line >= 0 ? line : stop >= 0 ? stop + 1 : window.lastIndexOf(" ");
      if (cut >= 0) end = start + Math.floor(size * 0.6) + cut;
    }
    const piece = s.slice(start, end).trim();
    if (piece) chunks.push({ start, end, text: piece });
    if (end >= s.length) break;
    let next = end - overlap;
    // The next chunk opens on a whole word.
    const space = s.indexOf(" ", next);
    if (space >= 0 && space < end) next = space + 1;
    start = next > start ? next : end;
  }
  return chunks;
}

/** The lines of a text, each once: a menu repeated twenty times is one menu, and says a word once. */
const distinctLines = (text) => [...new Set(String(text || "").split("\n").map((l) => l.trim()).filter(Boolean))];

const CHROME = /\b(cookies?|privacy policy|politique de confidentialit[eé]|conditions (?:d['’]utilisation|g[eé]n[eé]rales)|terms of (?:use|service)|all rights reserved|tous droits r[eé]serv[eé]s|newsletter|subscribe|abonnez-vous|sign in|log in|se connecter|connexion|inscription|sign up|follow us|suivez-nous|advertisement|publicit[eé]|sponsored|sponsoris[eé]|accept all|tout accepter|skip to (?:main )?content|aller au contenu|menu|back to top|share this|partager)\b/gi;

/**
 * How much a chunk reads like navigation rather than prose, 0 (prose) to 1: mostly very short lines (a
 * menu, a list of links), or words a page's frame is made of. A tier list has short lines too, but they
 * carry a verdict, so short lines alone cost less than short lines with the frame's words.
 */
export function chromeScore(text) {
  const lines = distinctLines(text);
  if (!lines.length) return 1;
  const flat = lines.join("\n");
  // By characters: one real sentence weighs more than the few words of a menu around it.
  const short = lines.filter((l) => l.split(/\s+/).length <= 3).reduce((n, l) => n + l.length, 0) / flat.length;
  const words = flat.split(/\s+/).length || 1;
  const hits = (flat.match(CHROME) || []).length;
  const sentences = (flat.match(/[.!?…:](\s|$)/g) || []).length;
  let score = 0;
  if (lines.length >= 4 && short > 0.6) score += 0.55;
  if (sentences === 0 && words > 12) score += 0.2;
  score += Math.min(0.5, (hits / words) * 8);
  return Math.min(1, score);
}

const K1 = 1.5;
const B = 0.75;

/**
 * Score chunks against a query with BM25, over the whole set: a word found everywhere (the game's name,
 * on every page) counts little, a word found in few chunks (« tier », « support ») decides. The result is
 * weighted by how many of the query's words the chunk holds, and pushed down when it reads as chrome.
 */
export function scoreChunks(chunks, query) {
  const q = [...new Set(terms(query))];
  if (!q.length || !chunks.length) return chunks.map(() => 0);
  const docs = chunks.map((c) => {
    const tf = new Map();
    const ws = terms(distinctLines(c.text).join("\n"));
    for (const w of ws) tf.set(w, (tf.get(w) || 0) + 1);
    return { tf, len: ws.length };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const idf = new Map(q.map((w) => {
    const df = docs.filter((d) => d.tf.has(w)).length;
    return [w, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))];
  }));
  return docs.map((d, i) => {
    let score = 0, matched = 0;
    for (const w of q) {
      const f = d.tf.get(w) || 0;
      if (!f) continue;
      matched++;
      score += (idf.get(w) * f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avg)));
    }
    if (!matched) return 0;
    const coverage = 0.4 + 0.6 * (matched / q.length);
    return score * coverage * (1 - 0.85 * chromeScore(chunks[i].text));
  });
}

/** The `budget` characters of a chunk around its line richest in the query's words: `{ start, end }`. */
function focusWithin(text, chunk, query, budget) {
  const wanted = new Set(terms(query));
  let best = chunk.start, bestScore = -1, at = chunk.start;
  for (const line of String(text).slice(chunk.start, chunk.end).split("\n")) {
    const score = new Set(terms(line).filter((w) => wanted.has(w))).size + Math.min(0.5, line.length / 1000);
    if (score > bestScore) { bestScore = score; best = at; }
    at += line.length + 1;
  }
  const start = Math.max(chunk.start, Math.min(best - Math.floor(budget * 0.25), chunk.end - budget));
  return { start, end: Math.min(chunk.end, start + budget) };
}

/**
 * The passages to give the model: the best chunks across all pages, within `budgetChars`, contiguous
 * chunks of a page merged back without their overlap, no page taking everything.
 *
 * `pages` is `[{ url, title, text }]`. Returns one entry per page that has something to say, best page
 * first: `[{ url, title, passages: [string], score }]`. A page with no matching word gives nothing: the
 * caller then says the sources do not answer, rather than handing over the start of a page.
 */
export function selectPassages(pages, query, { budgetChars = 6000, maxPerPage = 3, size = 900, overlap = 220 } = {}) {
  const usable = (pages || []).filter((p) => p && String(p.text || "").trim());
  const titled = usable.map((p, page) => chunkText(p.text, { size, overlap }).map((c) => ({ ...c, page, title: p.title || "" })));
  const chunks = titled.flat();
  if (!chunks.length) return [];
  const scores = scoreChunks(chunks.map((c) => ({ text: c.text })), query);
  const ranked = chunks.map((c, i) => ({ ...c, score: scores[i] })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  // Below a fraction of the best, a chunk only matched in passing: it would pay for nothing.
  const floor = ranked[0].score * 0.25;
  const taken = [];
  const perPage = new Map();
  let used = 0;
  for (const c of ranked) {
    if (c.score < floor) break;
    if (used >= budgetChars) break;
    if ((perPage.get(c.page) || 0) >= maxPerPage) continue;
    // The overlap with a chunk already taken is not paid twice.
    const shared = taken.filter((t) => t.page === c.page && t.start < c.end && c.start < t.end).reduce((n, t) => n + (Math.min(t.end, c.end) - Math.max(t.start, c.start)), 0);
    const cost = c.end - c.start - shared;
    if (used + cost > budgetChars) {
      if (taken.length) continue;
      // The very best chunk does not fit: its part around the line that says the most.
      taken.push({ ...c, ...focusWithin(usable[c.page].text, c, query, budgetChars) });
      used = budgetChars;
      break;
    }
    taken.push(c);
    used += cost;
    perPage.set(c.page, (perPage.get(c.page) || 0) + 1);
  }
  const best = new Map();
  for (const c of taken) best.set(c.page, Math.max(best.get(c.page) || 0, c.score));
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([page, score]) => {
    const merged = [];
    for (const c of taken.filter((t) => t.page === page).sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
      else merged.push({ start: c.start, end: c.end });
    }
    const p = usable[page];
    return { url: p.url, title: p.title || "", score, passages: merged.map((m) => String(p.text).slice(m.start, m.end).trim()) };
  });
}
