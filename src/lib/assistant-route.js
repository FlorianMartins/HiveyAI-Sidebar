// Hivey Browser's Assistant is a chat that can also act: should this turn go to the agent?
//
// The rule is deliberately conservative. Wrongly sending a question to the agent costs a browser tab
// and a run of tools; wrongly leaving an action in the chat costs one message and the switch in the
// composer is right there. So a turn is an action only when it opens on an imperative aimed at the
// browser — « lance-moi une musique », « open youtube », « peux-tu remplir ce formulaire ? » — and
// anything phrased as a question, or about writing or explaining, stays a chat turn. No model is asked:
// this runs before every send, on any machine, and costs nothing.

/** Lower case, no accents, single spaces; hyphens and apostrophes become spaces (« lance-moi »). */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’'`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// What can open a message without changing what it asks.
const GREETING = /^(?:(?:bonjour|bonsoir|salut|coucou|hello|hi|hey|ok|okay|alors|please|stp|svp|s il te plait|s il vous plait|hivey)\b[\s,:!.]*)+/;
// A request put as a question: « peux-tu ouvrir… ? » is still a request.
const ASKING = /^(?:est ce que )?(?:tu peux|peux tu|pourrais tu|tu pourrais|vous pouvez|pouvez vous|pourriez vous|can you|could you|would you|will you)(?: please| s il te plait| stp)? /;
// A wish is an action only for what is played: « je veux écouter du jazz », not « je veux acheter une maison ».
const WISH = /^(?:je veux|je voudrais|j aimerais|i want to|i would like to|i d like to|i wanna) /;
// Politely ending an order: « lance une musique s'il te plaît ».
const TRAILING_POLITE = /[\s,]*(?:s il te plait|s il vous plait|stp|svp|please)[\s.!?]*$/;

const OBJ = "(?:moi |nous |me |us )?";
const MEDIA_WORD = "(?:musique|musiques|chanson|chansons|son|sons|morceau|morceaux|titre|album|playlist|radio|video|videos|clip|clips|film|films|serie|bande annonce|podcast|concert|song|songs|music|track|tracks|movie|trailer)";

// A verb that means playing, and what it is played on. These are the only things a wish can ask for.
const MEDIA = [
  // lance / lancer: « lance-moi une musique », « lance Daft Punk ». Not « lance-toi ».
  new RegExp(`^lancer? (?!toi\\b)${OBJ}\\S`),
  new RegExp(`^(?:mets?|mettre) ${OBJ}(?:(?:une?|de la|du|des|la|le|les|ma|mon|mes|un peu de|cette|ce) )?(?:\\S+ )?${MEDIA_WORD}\\b`),
  new RegExp(`^(?:joue|jouer) ${OBJ}(?!a |au |aux |le role|un role|avec )\\S`),
  new RegExp(`^(?:passe|passer) ${OBJ}(?:(?:une?|de la|du|des|la|le|un peu de) )?(?:\\S+ )?${MEDIA_WORD}\\b`),
  new RegExp(`^(?:ecoute|ecouter|regarde|regarder) ${OBJ}(?:(?:une?|de la|du|des|la|le|les|ma|mon|un peu de) )(?:\\S+ )?${MEDIA_WORD}\\b`),
  // play: « play some music », « play Daft Punk ». Not a game, not a part.
  /^play (?!a game|games?\b|chess\b|cards\b|along\b|a role\b|the role\b|with\b|tic tac|devil|hide\b)\S/,
  new RegExp(`^(?:put on|listen to|watch) (?:(?:a|an|some|the|my) )?(?:\\S+ )?${MEDIA_WORD}\\b`),
];

// Everything else the agent is for. Each pattern names its object, to stay clear of figures of speech.
const ACTIONS = [
  // Open, go to.
  /^(?:ouvre|ouvrir) (?!ton\b|tes\b|votre\b|vos\b|source\b|les yeux)\S/,
  /^(?:va|vas|aller|rends toi|rendez vous|se rendre|navigue|naviguer) (?:sur|a|au|aux|vers|chez|dans|voir) \S/,
  /^open (?!source\b|ai\b|up about\b|your\b)\S/,
  /^(?:go|navigate|head) (?:to|on) \S/,
  /^(?:visit|take me to|bring me to|browse to) \S/,
  // Click, fill in.
  /^(?:clique|cliquer|clic|appuie|appuyer) (?:sur|ici|la) ?/,
  /^(?:click|tap|press) (?:on |the |this |that |here|\S+ button)/,
  /^(?:remplis|remplir|complete|completer) (?:moi )?(?:(?:le|la|les|ce|cette|mon|ma|mes) )(?:\S+ )?(?:formulaire|champ|champs|questionnaire)\b/,
  /^(?:renseigne|renseigner|saisis|saisir) (?:(?:le|la|les|ce|cette|mon|ma|mes) )\S/,
  /^fill (?:in |out )?(?:(?:the|this|that|my) )?(?:\S+ )?(?:form|field|fields|survey|questionnaire)\b/,
  /^(?:tape|taper|ecris|ecrire|saisis|saisir) .{1,80} (?:dans|sur) (?:le|la|ce|cette) (?:\S+ )?(?:champ|barre|formulaire|recherche)\b/,
  /^type .{1,80} (?:in|into) (?:the|this) \S/,
  // Buy, order, book — the anti-purchase guard stops at the cart, in code (tools.js).
  /^(?:achete|acheter|commande|commander|reserve|reserver) (?:moi |nous )?(?:une?|des|du|de la|mon|ma|mes|le|la|les|ce|cette|\d+) ?\S/,
  /^(?:ajoute|ajouter|mets|mettre) .{1,80} (?:au|dans le|dans mon) panier\b/,
  /^(?:buy|purchase|order|book) (?:me |us )?(?:a|an|some|the|my|this|that|\d+) \S/,
  /^add .{1,80} to (?:my|the) (?:cart|basket)\b/,
  // Send.
  /^(?:envoie|envoies|envoyer) (?:moi |lui |leur )?(?:(?:un|une|le|la|ce|cette|mon|ma) )?(?:mail|email|courriel|message|sms|dm|tweet|formulaire)\b/,
  /^send (?:him |her |them )?(?:(?:a|an|the|this|my) )?(?:mail|email|message|text|sms|dm|tweet|form)\b/,
  // The running tab, the running media.
  /^(?:ferme|fermer) (?:(?:l|cet|ce|cette|les|mes|tous les) )?(?:onglets?|fenetre)\b/,
  /^close (?:(?:this|the|that|all|my) )?(?:tabs?|window)\b/,
  /^(?:telecharge|telecharger) (?:moi )?(?:(?:le|la|les|ce|cette|un|une|des) )\S/,
  /^download (?:(?:the|this|that|a|an|my) )\S/,
  /^(?:connecte|connecter|deconnecte|deconnecter) (?:moi|toi) /,
  /^(?:log|sign) (?:me )?(?:in|out)\b/,
  new RegExp(`^(?:mets? (?:en |sur )?pause|mettre (?:en |sur )?pause|coupe le son|arrete (?:la|le|cette) (?:\\S+ )?${MEDIA_WORD}|pause (?:the|this)|mute (?:the|this)|stop (?:the|this) (?:music|song|video)|unmute\\b)`),
  /^(?:fais|faire) defiler\b|^scroll (?:down|up|to)\b/,
  // A search on a named site is an action there; a search « on the web » is the chat's own.
  /^(?:cherche|chercher|recherche|rechercher|trouve|trouver) .{1,80} sur (?:youtube|amazon|ebay|leboncoin|booking|airbnb|spotify|deezer|netflix|twitch|github|wikipedia|wikipedia\.\S+)\b/,
  /^(?:search|look up|find) .{0,80}\bon (?:youtube|amazon|ebay|booking|airbnb|spotify|netflix|twitch|github|wikipedia)\b/,
];

const STARTS_QUESTION = /^(?:comment|pourquoi|quel|quelle|quels|quelles|qui|que|quoi|ou|quand|combien|est ce|c est|lequel|laquelle|how|why|what|which|who|whom|where|when|is|are|am|do|does|did|should|shall|may|might|was|were|has|have)\b/;

/** One sentence: does it order something done in the browser? */
function sentenceActs(raw) {
  const asked = /\?\s*$/.test(raw);
  let s = normalize(raw).replace(/[.!?…:;,\s]+$/, "").replace(GREETING, "").replace(TRAILING_POLITE, "").trim();
  if (!s) return false;
  const asking = ASKING.exec(s);
  if (asking) s = s.slice(asking[0].length);
  const wish = !asking && WISH.exec(s);
  if (wish) {
    if (asked) return false;
    s = s.slice(wish[0].length);
    return MEDIA.some((re) => re.test(s));
  }
  // « Lance une musique ? » without « peux-tu » is a question about it, not an order.
  if (asked && !asking) return false;
  if (!asking && STARTS_QUESTION.test(s)) return false;
  return MEDIA.some((re) => re.test(s)) || ACTIONS.some((re) => re.test(s));
}

/**
 * "agent" when the message asks for an action on the browser, else "chat". Only its first two sentences
 * are read, and a long text is never an order: pasted content must not be able to start the agent.
 */
export function routeTurn(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 300 || /```/.test(t)) return "chat";
  const sentences = t.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
  return sentences.some(sentenceActs) ? "agent" : "chat";
}

/**
 * What to search for when the message plainly asks for music (« lance-moi une musique », « mets du jazz »),
 * else null. Such a turn needs no model: it would only slow the music down on a small machine, and
 * tends to search for the words of the order themselves (« lance musique »).
 */
export function mediaQuery(text) {
  const t = normalize(text).replace(TRAILING_POLITE, "").replace(/[.!?]+$/, "").trim();
  const m = t.match(/^(?:lance|lancer|mets|mettre|joue|jouer|passe|passer|ecoute|ecouter|play|put on)\s+(?:moi |nous |me |us )?(.+)$/);
  if (!m || t.length > 120) return null;
  const words = m[1].split(" ");
  const MUSIC = new Set(["musique", "musiques", "chanson", "chansons", "morceau", "morceaux", "music", "song", "songs"]);
  const STYLE = new Set(["jazz", "rock", "rap", "pop", "metal", "classique", "lofi", "techno", "electro", "reggae", "blues", "funk", "disco"]);
  if (!words.some((w) => MUSIC.has(w) || STYLE.has(w))) return null;
  const SKIP = new Set(["une", "un", "de", "la", "le", "les", "du", "des", "d", "l", "some", "a", "the", "any", "n", "importe", "quelle", "quel", "peu", "ma", "mon", "mes"]);
  const rest = words.filter((w) => !SKIP.has(w) && !MUSIC.has(w));
  return rest.length ? `${rest.join(" ")} music` : "popular music";
}

/** The composer's switch: "chat" and "agent" force the turn, anything else lets the rule decide. */
export function resolveRoute(choice, text) {
  if (choice === "chat" || choice === "agent") return choice;
  return routeTurn(text);
}

/** For what the rule above leaves to the chat: is it a question, or might it be an order? A question costs nothing more. */
export function worthAsking(text) {
  const t = normalize(text);
  if (!t || t.length > 300 || /\?\s*$/.test(String(text).trim())) return false;
  return !/^(?:qui|que|quoi|quel|quelle|quels|quelles|quand|ou|comment|pourquoi|combien|est ce|what|who|when|where|why|how|which|is|are|does|do|did|can|explique|resume|traduis|ecris|corrige|explain|summarize|summarise|translate|write)\b/.test(t);
}

export const ROUTE_SYSTEM =
  "You route a message sent to a web browser's assistant. Reply with one word. " +
  "ACT: the user wants the browser itself to do something on websites for them: open a site, click, fill in a form, log in, " +
  "book, buy, order, send, post, subscribe, download, play something. " +
  "ANSWER: the user wants information or text, even if it must be searched on the web, compared or looked up: facts, advice, lists, opinions, a summary, a statement or correction about what was said. " +
  "When in doubt, ANSWER.";

/** The model's word, or null if it said something else: then the rule's choice stands. */
export function parseRoute(reply) {
  const m = /^\W*(act|answer)\b/i.exec(String(reply || "").replace(/<think>[\s\S]*?<\/think>/g, ""));
  return m ? (m[1].toLowerCase() === "act" ? "agent" : "chat") : null;
}
