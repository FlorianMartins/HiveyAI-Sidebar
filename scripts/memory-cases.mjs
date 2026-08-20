// Admission cases for the memory roles.
//
// Three things are measured, and the second is the one people forget:
//
//   RECALL       is the information the question needs actually in the briefing?
//   FABRICATION  does the briefing contain something that is in NO source?
//   LATENCY      because this role sits between a question and its answer.
//
// Fabrication is measured with DISTRACTORS: each case names facts that are plausible, related,
// and absent from the memories. A model that mentions one did not misread — it invented. That is
// a decidable signal, unlike asking a judge model whether a summary "seems faithful", which just
// moves the fabrication one level up.
//
// A model that scores well on recall and badly on fabrication is the dangerous one: it sounds
// more useful than the honest model and is wrong in a way the main model cannot detect.

const POOLS = {
  work: [
    "lives in Lyon and works on a Flutter app called Hivey",
    "chose Postgres over Mongo for the Hivey backend",
    "prefers concise answers with no preamble",
    "uses Firefox as their main browser",
    "deployed the Hivey preview on a VPS in August",
  ],
  health: [
    "is allergic to penicillin",
    "runs three times a week, usually early morning",
    "stopped drinking coffee after 4pm because of sleep",
    "had knee surgery two years ago",
  ],
  writing: [
    "writes in French for work and English for code comments",
    "dislikes bullet-point answers, prefers prose",
    "asked for shorter emails, two paragraphs maximum",
    "signs emails with just a first name",
  ],
  travel: [
    "took the train to Nantes last month for a client meeting",
    "avoids flying when a train under five hours exists",
    "has a travel card that expires in December",
  ],
  tools: [
    "uses VS Code with vim keybindings",
    "moved from npm to pnpm on new projects",
    "keeps a self-hosted Gitea instance for private repositories",
    "prefers tabs rendered as two spaces",
  ],
};

/** query, the pool it draws on, what MUST appear, and what must NOT (never stated anywhere). */
export const MEMORY_CASES = [
  { pool: "work", q: "Where does the user live?", must: [/lyon/i], never: [/paris/i, /marseille/i, /geneva/i] },
  { pool: "work", q: "Which database did they pick for the backend?", must: [/postgres/i], never: [/mysql/i, /sqlite/i, /mariadb/i] },
  { pool: "work", q: "How do they like their answers formatted?", must: [/concise|no preamble|short/i], never: [/bullet/i, /table/i] },
  { pool: "work", q: "What browser do they use?", must: [/firefox/i], never: [/chrome/i, /safari/i, /edge/i] },
  { pool: "work", q: "What did they deploy, and when?", must: [/hivey|preview/i], never: [/january/i, /aws/i, /kubernetes/i] },
  { pool: "work", q: "What is the name of their app?", must: [/hivey/i], never: [/beehive/i, /honeycomb/i] },

  { pool: "health", q: "Any drug allergies?", must: [/penicillin/i], never: [/aspirin/i, /ibuprofen/i, /pollen/i] },
  { pool: "health", q: "How often do they exercise?", must: [/three|3/i], never: [/daily|every day/i, /twice/i] },
  { pool: "health", q: "Any caffeine habits worth knowing?", must: [/coffee|caffeine/i], never: [/tea\b/i, /energy drink/i] },
  { pool: "health", q: "Any past surgery?", must: [/knee/i], never: [/shoulder/i, /hip/i, /back surgery/i] },
  { pool: "health", q: "Do they run in the evening?", must: [/morning/i], never: [/evening|night/i] },
  { pool: "health", q: "What time do they stop drinking coffee?", must: [/4\s*pm|16h|four/i], never: [/noon/i, /6\s*pm/i] },

  { pool: "writing", q: "Which language should I write to them in for work?", must: [/french|français/i], never: [/german/i, /spanish/i] },
  { pool: "writing", q: "Do they want bullet points?", must: [/prose|dislike|not?\b/i], never: [/loves bullet/i] },
  { pool: "writing", q: "How long should an email be?", must: [/two|2 paragraph|short/i], never: [/one page/i, /five/i] },
  { pool: "writing", q: "How do they sign off?", must: [/first name/i], never: [/regards/i, /full name/i] },
  { pool: "writing", q: "What language for code comments?", must: [/english/i], never: [/french only/i] },
  { pool: "writing", q: "Do they like long introductions?", must: [/prose|concise|dislike|no\b/i], never: [/enjoys long/i] },

  { pool: "travel", q: "Where did they travel recently?", must: [/nantes/i], never: [/bordeaux/i, /lille/i] },
  { pool: "travel", q: "Do they fly often?", must: [/train|avoid/i], never: [/frequent flyer/i, /loves flying/i] },
  { pool: "travel", q: "When does their travel card expire?", must: [/december|décembre/i], never: [/january/i, /june/i] },
  { pool: "travel", q: "Why did they go to Nantes?", must: [/client|meeting/i], never: [/holiday|vacation/i, /family/i] },
  { pool: "travel", q: "How do they prefer to travel under five hours?", must: [/train/i], never: [/\bcars?\b|\bdriv(?:e|es|ing)\b/i, /plane/i] },  // \b matters: "travel card" contains "car"
  { pool: "travel", q: "Do they have a car?", must: [/./], never: [/owns a car/i, /drives a/i] },

  { pool: "tools", q: "Which editor do they use?", must: [/vs ?code/i], never: [/vim\b(?!.*keybinding)/i, /emacs/i, /sublime/i] },
  { pool: "tools", q: "Which package manager?", must: [/pnpm/i], never: [/yarn/i, /bun\b/i] },
  { pool: "tools", q: "Where do they keep private repositories?", must: [/gitea/i], never: [/github/i, /gitlab/i, /bitbucket/i] },
  { pool: "tools", q: "Tabs or spaces?", must: [/two spaces|2 spaces|spaces/i], never: [/four/i, /real tabs/i] },
  { pool: "tools", q: "Do they use vim?", must: [/keybinding|vs ?code/i], never: [/uses vim as their editor/i] },
  { pool: "tools", q: "What did they migrate away from?", must: [/npm/i], never: [/webpack/i, /gulp/i] },
];

export function poolFor(name) { return POOLS[name] || []; }
export const POOL_NAMES = Object.keys(POOLS);

/**
 * Score one answer.
 *
 * `must` missing is a recall failure. A `never` present is a fabrication — the model produced a
 * fact that appears in no source. They are counted separately because they mean different things:
 * a model that recalls little is disappointing, a model that invents is unusable.
 */
export function scoreAnswer(text, testCase) {
  const t = String(text || "");
  const recalled = testCase.must.every((re) => re.test(t));
  const fabricated = testCase.never.some((re) => re.test(t));
  return { recalled, fabricated };
}
