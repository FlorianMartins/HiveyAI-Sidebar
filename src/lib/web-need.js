// Does this request need the web? With « Web » on, every request used to search — a paid search for
// « write a haiku » as for « bitcoin price today ». Now: a free rule decides the clear cases, and only
// the doubtful ones ask a cheap model one yes/no question; the search runs only when it helps.

// Word boundaries that know accented letters (JavaScript's \b does not: « actualité » never ended).
const B = "(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_])|(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_]))";
const W = (re) => new RegExp(re.source.replace(/\\b/g, B), re.flags + "u");

// Clear YES: a link, an explicit ask to search, something that changes with time.
const YES = [
  /https?:\/\/\S+|\bwww\.\S+/i,
  /\b(cherche|recherche|search|google|look\s*up|busca|suche|cerca|pesquis)\w*\b.{0,40}\b(web|internet|en ligne|online|net)\b/i,
  /\b(sur|on|en|im|nel|na)\s+(le\s+)?(web|internet)\b/i,
  /\b(aujourd'hui|aujourd’hui|ce matin|ce soir|hier|demain|cette semaine|ce mois|en ce moment|actuellement|actuel(le)?s?|derni[eè]re?s? (nouvelles|news|infos?|version|sortie|résultats?)|récemment|today|tonight|yesterday|tomorrow|this (week|month|year)|right now|currently|latest|recent(ly)?|breaking|hoy|ayer|heute|gestern|oggi|hoje)\b/i,
  /\b(actualités?|news|météo|weather|prévisions?|forecast|cours (de|du)|stock price|bourse|cotation|taux de change|exchange rate|score|résultats? (du|des) match|classement|élections?|sondage|horaires?|ouvert le|opening hours|trafic|bitcoin|crypto)\b/i,
  /\b(prix|price|tarif|coût|cost|combien coûte|how much (is|does)|precio|preis|prezzo|preço)\b.{0,60}\b(actuel|now|today|aujourd|202\d|en ce moment|current)\b/i,
  /\b20(2[4-9]|3\d)\b/,
].map(W);
// Clear NO: work on what is given — write, translate, code, compute, rephrase, summarise a text.
const NO = [
  /^\s*(salut|bonjour|bonsoir|hello|hi|hey|merci|thanks|thank you|ok|d'accord|super|parfait)\b[\s!.?]*$/i,
  /\b(écris|rédige|write|draft|compose|invente|imagine|poème|poem|haïku|haiku|histoire|story|blague|joke|slogan)\b/i,
  /\b(tradui[st]|translate|traduce|übersetz|traduci|traduz)\w*\b/i,
  /\b(reformule|corrige|améliore|rephrase|rewrite|proofread|fix (the )?(grammar|spelling))\b/i,
  /\b(code|fonction|function|script|regex|sql|bug|debug|refactor|classe|class|algorithme|algorithm|compile)\b/i,
  /\b(calcule|calculate|compute|combien font|résous|solve|équation|equation|dérivée|integral|intégrale)\b/i,
  /\b(résume|summari[sz]e|explique|explain)\b.{0,30}\b(ce|cette|ces|this|these|le texte|the text|la page|the page|ci-dessous|below|above|ci-dessus)\b/i,
].map(W);

/** "yes" / "no" from the rule alone, "maybe" when it can't tell. */
export function webNeedRule(text) {
  const t = String(text || "").slice(0, 2000);
  if (!t.trim()) return "no";
  if (YES.some((r) => r.test(t))) return "yes";
  if (NO.some((r) => r.test(t))) return "no";
  return "maybe";
}

/** The one yes/no question for a doubtful request: short, cheap, no thinking. */
export function webNeedMessages(text) {
  return {
    system: "You decide whether answering a request well REQUIRES searching the web. Answer YES when it needs " +
      "up-to-date or very specific facts you may not know reliably: news, prices, schedules, recent events, " +
      "current versions or products, details about a specific company, place, person or event. Answer NO when " +
      "general knowledge, reasoning, writing, coding, maths or the text provided is enough. Reply with one word: YES or NO.",
    history: [{ role: "user", content: String(text || "").slice(0, 1500) }],
  };
}
export function parseWebNeed(reply) {
  return /\byes\b|\boui\b/i.test(String(reply || "").slice(0, 40));
}
