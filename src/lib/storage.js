// Local settings storage (BYOK — "bring your own key").
//
// PRIVACY MODEL: nothing ever leaves the browser except a request to the AI
// endpoint the user explicitly chose. We use `browser.storage.local`, which is
// scoped to this device and is NEVER synced to any account or server. There is
// no analytics, no telemetry and no remote configuration: the extension talks
// only to the provider URLs listed in the manifest's host permissions.
//
// The project ships 100% blank: every key is empty by default. Users supply
// their own credentials (or point at a local model that needs none).

const DEFAULTS = {
  // ----- Provider / model selection ----------------------------------------
  provider: "openrouter", // active provider id — OpenRouter (free models + 1-click OAuth)
  keys: {}, // per-provider API keys      { anthropic:"", openai:"", ... }
  models: { openrouter: "hivey/free" }, // default model = 🐝 Hivey Free (not a random free model)
  baseUrls: {}, // per-provider base URL overrides (ollama / lmstudio / custom)

  // ----- Image generation ---------------------------------------------------
  imageProvider: "openai",
  imageModel: "gpt-image-1",
  imageSize: "", // "" = "—": no fixed size; the model uses the dimensions described in the prompt

  // ----- UI / behaviour ------------------------------------------------------
  mode: "chat", // active workspace tab: chat | agent | translate | improve | image | terminal | code
  thinkLevel: "off", // reasoning depth: "off" (no thinking — fast/cheap) | "high" | "max"
  webSearch: false, // web search OFF by default (opt-in per tab)
  deepSearch: false, // 🔎 DeepSearch: multi-step cited web research (opt-in per Chat tab)
  deepSearchDepth: "standard", // fast | standard | deep — scales sub-queries + sources read
  wisebaseEnabled: true, // 📚 Wisebase tab (local KB + RAG). Tab shown by default; can be hidden.
  wisebaseTopK: 6, // RAG retrieval: number of passages injected as context
  wisebaseScope: "", // last-used search scope: "" = all collections, else a collectionId
  webDefault: false, // open the embedded Web chats panel on startup (for API-free users)
  modeSel: {}, // per-workspace model selection ("provider|model") — each tab keeps its own
  artifacts: true, // Artifact mode: encourage the model to build runnable artifacts (interactive
                   // HTML/JS apps & games, React components, SVG, Mermaid diagrams) and render them
                   // live in a sandboxed frame. Off = code stays as plain copyable blocks.
  searchModel: "openrouter|hivey/free", // web-search model: 🐝 Hivey Free (cheap & competent)
  agentMode: false, // allow the model to act inside the browser
  // "" = the agent uses the SAME model the user selected for chat (so picking Claude Opus
  // 4.8 in chat also drives the agent). The chat default (Llama 3.3 70B) is tool-capable,
  // so this works out of the box. The user can still PIN a specific agent model in Settings
  // (e.g. a free tool-capable model) if their chosen chat model can't call tools.
  agentModel: "",
  // ── Memory ──────────────────────────────────────────────────────────────────────────────
  // OFF by default, and off means no search at all — not a search whose result is discarded.
  // Opt-in is the only defensible default for a feature that writes down what someone says about
  // themselves and then sends parts of it to a model.
  memoryEnabled: false,
  memoryModels: {},          // role → model id. Empty = the free route (see memory-models.js).
  memoryReviewEvery: 4,      // user turns between background reviews
  memoryRecallBudget: 300,   // max tokens of briefing injected per recall
  memoryQuotaMb: 50,         // episodic store ceiling before salience-based eviction
  memoryEncrypt: false,      // encrypt episode text at rest (asks for a passphrase)
  memoryAgentName: "",       // what the status lines call the assistant; empty = neutral wording
  memoryOffered: false,      // the one-time suggestion has been shown
  agentVerify: false, // independent verifier pass at the end of an agent task — OFF by default (opt-in in Settings).
  agentInteractive: false, // interaction mode: the agent proposes several options in chat (after page+web research) instead of acting on its own.
  agentPermission: "auto", // "auto" (default) = run actions automatically, BUT very sensitive ones
                           // (download / reserve / book / delete / transfer / sign-up / install…)
                           // still ask for confirmation; "manual" = confirm EVERY state-changing action.
                           // The anti-purchase guardrail (blockPayments) applies in BOTH modes.
  confirmActions: false, // ask before every state-changing action (kept in sync with agentPermission)
  includePageContext: false, // page reading OFF by default (Chat); user enables it via the Page chip
  autoReadPage: true, // re-read the page on every navigation (subdomains too)
  includeSelectedTabs: false, // also feed the user-selected extra tabs
  selectedTabs: [], // tab ids the user ticked for multi-tab context
  localEnabled: {}, // explicit opt-in for local servers { ollama:true, lmstudio:true }
  maxPageChars: 12000, // truncation budget for a single page's text
  targetLang: "French", // preferred target language for translations (canonical English name)
  responseLang: "Auto", // language the AI replies in. "Auto" = match the user's input language.
                        // (The UI language is separate — see uiLang.)
  orFreeOnly: false, // OpenRouter model picker: show ALL models with their price-tier colours
                     // (🎁🟢🟡🟠🔴) by default. Free-only is an opt-in toggle in Settings.
                     // Inaccessible models are auto-removed on error + a data-policy link is shown.
  improvePreset: "improve", // default writing preset for the "improve" mode
  promptLibrary: [], // user's reusable saved prompts: [{ id, title, text, category, at }]. Inserted via
                     // the 📚 library button or the "/" command palette. Local-only (BYOK privacy model).
  promptFavorites: [], // ⭐ favorited prompt ids (built-in or user) — shown in the library's Favorites tab.
  modelVotes: {}, // 🏆 per-model win tally from the compare "Best" vote { "provider|model": count }.
  shortcuts: {}, // configurable keyboard shortcuts { actionId: "Ctrl+Shift+N" } — merged over defaults.
  uiLang: "en", // sidebar interface language: "en" (default) | "fr". Changed from Settings.
  theme: "dark", // colour theme key (see src/lib/theme.js): dark (default) | hive | modern | neon | sunset | light
  themeColors: {}, // optional per-colour overrides applied ON TOP of the theme { accent, accent2, bg, panel, text }
  auraColor: "", // background aura colour ("" = follow the accent). Also synced to Hivey Code.
  auraOpacity: 0.12, // background aura intensity (0–0.3)
  auraSize: 720, // background aura radius in px
  railSide: "left", // workspace tab rail position INSIDE the sidebar: "left" (default) | "right".
                    // (The sidebar's own browser-side position is not controllable by extensions.)
  railHidden: true, // rail is a hover overlay, hidden (not pinned) by default; hover ☰ to peek, click to pin.
  railOrder: [], // user-defined order of the workspace tab icons (drag to reorder). [] = default order.
  railTabsHidden: [], // workspace modes whose rail icon is hidden (Settings → Appearance).
  metricScore: true, // model picker: show the accuracy (🎯 %) badge. Independent of price.
  metricPrice: false, // model picker: show the price (💰) badge. Both can be on at once.
  modelSort: "", // model list quick sort cycle: "" (normal) | "desc" (best first) | "asc" (worst first).
  soundOnDone: false, // play a short chime when an answer finishes (composer 🔔 toggle).
  tabDoneIndicator: true, // show a dot on a workspace icon when its answer finishes while you're on another tab.
  selectorOff: {}, // per selector-tab page-mode off state { translate:true, … } (eye toggle).
  msgBorderOn: false, // show the outline around reply bubbles (Settings → Appearance). Off by default.
  msgBorderColor: "", // custom reply-bubble border colour ("" = theme default); also drives the neon outline colour.
  railIconColor: "", // custom MENU (rail) icon colour ("" = theme default grey/idle, --text active).
  topIconColor: "", topIconColor2: "", topIconGradient: true, // top-bar icons colour 1 / 2 / gradient on (default brand gradient).
  railIconOpacity: 100, msgBorderOpacity: 100, contourOpacity: 100, // element-colour opacities (0–100).
  gradientOn: true, // use the accent→accent2 gradient on text/logo/buttons (off = flat accent).
  gradientSplit: -1, // gradient two-colour ratio % held by accent before transition (-1 = theme default).
  textOutlineOn: false, // neon-tube effect on the response-area title AND its icon. Off by default. Colour = msgBorderColor or accent.
  contourOn: true, // offset-shadow contour on the title + icon — ON by default (combinable with neon).
  contourColor: "#000000", // contour colour — black by default.
  uiFont: "", // chosen UI font key ("" = system). See UI_FONTS in theme.js; fonts bundled in vendor/fonts.
  smoothStream: true, // reveal streamed answers with a fluid rAF typewriter (adapts to model speed). Off = instant chunks.

  // ----- Model picker filter (price tiers + providers) -----------------------
  // Persisted state of the model-filter popover shared by every workspace's picker.
  // `tiers` = price tiers to SHOW; `providers` empty = all; `subproviders` empty = all
  // (used to filter OpenRouter models by their vendor: google / openai / anthropic…).
  modelFilter: { tiers: ["free", "green", "yellow", "orange", "red"], providers: [], subproviders: [] },

  // ----- Code workspace ------------------------------------------------------
  // The "Code" tab launches a self-hosted AI app builder ("Hivey Code",
  // a Bolt.diy instance) in a NEW BROWSER TAB. WebContainers there require
  // cross-origin isolation (COOP/COEP) and can't run inside an extension iframe,
  // so a new tab is the only robust integration. The builder is keyless server-
  // side: the sidebar hands it its OpenRouter key via the URL fragment (#sk=) so
  // both share one and the same key/budget — a single service. URL is user-
  // configurable; leave blank to hide the launcher.
  codeAppUrl: "https://app.hivey.be",

  // Width (px) of the left activity rail — user-resizable by dragging its edge (clamped 48–110).
  railWidth: 56,

  // ----- Judge0 (compile & run compiled languages in the sidebar) ------------
  // C/C++/Rust/Go/Python/Java… can't run in the browser, so code blocks in those
  // languages get a "Compile & run" button that sends them to a Judge0 instance.
  judge0Endpoint: "https://ce.judge0.com",
  judge0Key: "", // optional: RapidAPI key (rapidapi endpoints) or self-hosted X-Auth-Token

  // ----- Compare & history ---------------------------------------------------
  compareMode: false, // run the prompt on a second model side-by-side
  compareModel: "", // "providerId|modelId" of the second model
  saveHistory: true, // persist conversations locally (privacy: local only)

  // ----- Efficiency: speed + token-cost optimisation -------------------------
  // These trim what we send to the model so the user pays only for the tokens that
  // matter, which also lowers latency (a smaller prompt = a faster first token).
  cleanContext: true, // strip boilerplate/whitespace/duplicate lines from page & tab
                      // text before sending, AND send a page's content only ONCE per
                      // conversation (not re-attached on every follow-up message).
  autoScroll: true,      // follow the AI's answer by auto-scrolling to the bottom while it
                         // streams; off = the view stays put so you can read/scroll freely.
  verifyAnswers: false,  // OFF by default: Hivey double-checks & auto-fixes each answer only
                         // when the user turns the Verify chip on (it costs extra tokens).
  compressHistory: true, // when a conversation grows long, summarise its OLD turns with
                         // a cheap model so later turns send far fewer tokens. The UI
                         // still shows the full transcript — only the model payload shrinks.
  smartRouting: true, // route housekeeping work (summaries, compaction, auto-titles) to a
                      // cheap/free model; the premium model the user picked is reserved for
                      // the actual answers / complex reasoning.
  utilityModel: "", // "providerId|modelId" used for the cheap housekeeping tasks above.
                    // "" = auto-pick the cheapest free model among connected providers.

  // ----- Safety guardrails ---------------------------------------------------
  // The agent can browse autonomously but must never transact. When enabled it
  // refuses payment / checkout / purchase / order-confirmation actions and stops
  // at the cart, as requested. This is enforced both in the system prompt AND in
  // code (tools.js) so a jailbroken prompt cannot bypass it.
  blockPayments: true,
};

// Migrate from the older schema (anthropicKey / openrouterKey / *Model).
function migrate(s) {
  s.keys = s.keys || {};
  s.models = s.models || {};
  s.baseUrls = s.baseUrls || {};
  if (s.anthropicKey && !s.keys.anthropic) s.keys.anthropic = s.anthropicKey;
  if (s.openrouterKey && !s.keys.openrouter) s.keys.openrouter = s.openrouterKey;
  if (s.anthropicModel && !s.models.anthropic) s.models.anthropic = s.anthropicModel;
  if (s.openrouterModel && !s.models.openrouter) s.models.openrouter = s.openrouterModel;
  // The translate-target language is now stored as a canonical English name (the
  // <option> values). Map any legacy French label to it so the dropdown still matches.
  const LANG_FR2EN = {
    "Français": "French", "Anglais": "English", "Espagnol": "Spanish",
    "Allemand": "German", "Italien": "Italian", "Portugais": "Portuguese",
    "Néerlandais": "Dutch", "Arabe": "Arabic", "Chinois": "Chinese",
    "Japonais": "Japanese", "Russe": "Russian",
  };
  if (s.targetLang && LANG_FR2EN[s.targetLang]) s.targetLang = LANG_FR2EN[s.targetLang];
  // Hivey Code moved from the old Bolt instance (code.hivey.be) to the greenfield app (app.hivey.be).
  if (s.codeAppUrl === "https://code.hivey.be") s.codeAppUrl = "https://app.hivey.be";
  // Default OpenRouter model = 🐝 Hivey Free. Force it when unset or stuck on a raw free model
  // (gpt-oss…) so the picker opens on Hivey Free, not a random free endpoint.
  s.models = s.models || {};
  if (!s.models.openrouter || /gpt-oss/i.test(s.models.openrouter)) s.models.openrouter = "hivey/free";
  // Theme list was revamped: drop removed themes, map them to the closest survivor.
  if (s.theme === "violet" || s.theme === "pro") s.theme = "dark";
  if (s.theme === "gamer") s.theme = "neon";
  delete s.anthropicKey;
  delete s.openrouterKey;
  delete s.anthropicModel;
  delete s.openrouterModel;
  return s;
}

export async function getSettings() {
  const stored = await browser.storage.local.get(null);
  const s = migrate({ ...DEFAULTS, ...stored });
  // One-time migration (persisted): the old default forced English replies. Switch
  // it to "Auto" (match the input language) ONCE, so users who never changed it get
  // the expected behaviour, while anyone who later picks a language keeps it.
  if (s.responseLang === "English" && !s.respLangMigrated) {
    s.responseLang = "Auto";
    s.respLangMigrated = true;
    try { await browser.storage.local.set({ responseLang: "Auto", respLangMigrated: true }); } catch (_) {}
  }
  // One-time: the agent now defaults to "auto" (Allow), with very sensitive actions
  // still confirmed. Flip the old "manual" default to "auto" ONCE; an explicit later
  // choice of "manual" sticks (it re-sets the flag only on this first pass).
  if (s.agentPermission === "manual" && !s.agentPermMigrated) {
    s.agentPermission = "auto";
    s.confirmActions = false;
    s.agentPermMigrated = true;
    try { await browser.storage.local.set({ agentPermission: "auto", confirmActions: false, agentPermMigrated: true }); } catch (_) {}
  }
  // Web search is OFF by default now (opt-in per tab). One-time: flip any previously force-enabled
  // default back to off; keeps the cheap search-model routing for when the user does turn it on.
  if (!s.webOffDefaultMigrated) {
    s.webSearch = false;
    if (!s.searchModel) s.searchModel = "openrouter|hivey/free";
    s.webOffDefaultMigrated = true;
    try { await browser.storage.local.set({ webSearch: false, searchModel: s.searchModel, webOffDefaultMigrated: true }); } catch (_) {}
  }
  // One-time: the rail became a HOVER OVERLAY hidden by default. Flip an old pinned-open
  // (railHidden=false) to hidden ONCE; the user can still pin it open by clicking ☰.
  if (s.railHidden === false && !s.railOverlayMigrated) {
    s.railHidden = true;
    s.railOverlayMigrated = true;
    try { await browser.storage.local.set({ railHidden: true, railOverlayMigrated: true }); } catch (_) {}
  }
  // One-time: page reading is now OFF by default (Chat). Flip a stored ON to off ONCE; the user
  // can still turn it back on via the Page chip (flag prevents re-flip).
  if (s.includePageContext !== false && !s.pageCtxOffMigrated) {
    s.includePageContext = false;
    s.pageCtxOffMigrated = true;
    try { await browser.storage.local.set({ includePageContext: false, pageCtxOffMigrated: true }); } catch (_) {}
  }
  // One-time: the earlier build defaulted to free-only, which hid paid models and made
  // every shown model the same green. Flip it off once so the full coloured list returns.
  if (s.orFreeOnly === true && !s.orFreeOnlyMigrated) {
    s.orFreeOnly = false;
    s.orFreeOnlyMigrated = true;
    try { await browser.storage.local.set({ orFreeOnly: false, orFreeOnlyMigrated: true }); } catch (_) {}
  }
  // One-time: a previous build force-pinned the agent to Qwen3 Coder, which OVERRODE the
  // model the user selected for chat. Clear that ONCE so the agent follows the selected
  // model again (e.g. Claude Opus 4.8). A later explicit agent-model choice sticks.
  if (s.agentModel === "openrouter|qwen/qwen3-coder:free" && !s.agentModelResetMigrated) {
    s.agentModel = "";
    s.agentModelResetMigrated = true;
    try { await browser.storage.local.set({ agentModel: "", agentModelResetMigrated: true }); } catch (_) {}
  }
  // One-time: ensure Artifact mode is ON by default. Flip a stored false → true ONCE; the
  // user can still turn it off afterwards (the flag prevents re-flipping).
  if (s.artifacts === false && !s.artifactsOnMigrated) {
    s.artifacts = true;
    s.artifactsOnMigrated = true;
    try { await browser.storage.local.set({ artifacts: true, artifactsOnMigrated: true }); } catch (_) {}
  }
  return s;
}

export async function setSettings(patch) {
  await browser.storage.local.set(patch);
}

// Update a single entry of a nested object (keys / models / baseUrls) without
// clobbering its siblings.
export async function setNested(field, key, value) {
  const cur = (await browser.storage.local.get(field))[field] || {};
  cur[key] = value;
  await browser.storage.local.set({ [field]: cur });
}

export function onSettingsChanged(callback) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local") callback(changes);
  });
}

export { DEFAULTS };
