// Privacy first (lib/privacy.js): what leaves for a cloud model is pseudonymized, what comes back is
// restored, the user's own machine and gateway get their data as it is. Checked on the body that
// would leave the browser, captured at fetch.

import test from "node:test";
import assert from "node:assert/strict";
import { makeProvider } from "../src/lib/providers.js";
import { privacyClass, redactRequest, findingsToAsk, Vault, forgetConversation } from "../src/lib/privacy.js";
import { buildTurn } from "../src/lib/untrusted.js";

const sse = (parts) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); c.close(); } }), { status: 200 });
};
const say = (...chunks) => [...chunks.map((c) => ({ choices: [{ delta: { content: c } }] })), { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"];

async function turn(providerId, { history, reply = say("ok"), privacy, settings: extra = {}, onText }) {
  const bodies = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body)); return sse(typeof reply === "function" ? reply() : reply); };
  try {
    const settings = { provider: providerId, models: { [providerId]: "m" }, keys: { [providerId]: "k" }, baseUrls: { custom: "https://ai.hivey.be/v1" }, privacyLevel: "balanced", ...extra };
    const r = await makeProvider(settings, { privacy }).runTurn({ system: "S", history, tools: [], onText });
    return { body: bodies[0], result: r };
  } finally { globalThis.fetch = real; }
}
const sent = (body) => JSON.stringify(body.messages);

test("local, gateway, cloud: what the provider is, and where its address points", () => {
  assert.equal(privacyClass("ollama", {}), "local");
  assert.equal(privacyClass("custom", { baseUrls: { custom: "http://localhost:8080/v1" } }), "local");
  assert.equal(privacyClass("custom", { baseUrls: { custom: "http://192.168.1.20:8080/v1" } }), "local");
  assert.equal(privacyClass("custom", { baseUrls: { custom: "https://ai.hivey.be/v1" } }), "gateway");
  for (const p of ["openrouter", "anthropic", "openai", "google", "deepseek"]) assert.equal(privacyClass(p, {}), "cloud");
});

test("a cloud request carries markers, never the value — and the answer comes back in clear", async () => {
  const { body, result } = await turn("openrouter", {
    history: [{ role: "user", content: "Écris un mot à jeanne.dupont@acme-corp.fr pour la facture." }],
    reply: say("Voici le message pour ⟨EM", "AIL_1⟩ : bonjour."),
    privacy: { conversation: "c1" },
  });
  assert.doesNotMatch(sent(body), /jeanne\.dupont/);
  assert.match(sent(body), /⟨EMAIL_1⟩/);
  assert.equal(result.text, "Voici le message pour jeanne.dupont@acme-corp.fr : bonjour.");
  assert.equal(result.message.content, "Voici le message pour jeanne.dupont@acme-corp.fr : bonjour.", "the history keeps the real value");
});

test("a marker split across two packets is restored on screen, not shown raw", async () => {
  const shown = [];
  await turn("openrouter", { history: [{ role: "user", content: "Contacte jeanne.dupont@acme-corp.fr" }], reply: say("À ⟨EMA", "IL_1⟩."), privacy: { conversation: "c2" }, onText: (d) => shown.push(d) });
  assert.equal(shown.join(""), "À jeanne.dupont@acme-corp.fr.");
  assert.doesNotMatch(shown.join(""), /⟨/);
});

test("the agent's actions get the real values back: a form is filled with the address, not its marker", async () => {
  const reply = [{ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "fill_input", arguments: JSON.stringify({ ref: "e2", value: "⟨EMAIL_1⟩" }) } }] }, finish_reason: "tool_calls" }] }, "[DONE]"];
  const { result } = await turn("openrouter", { history: [{ role: "user", content: "Remplis avec lea.martin@acme-corp.fr" }], reply, privacy: { conversation: "c3" } });
  assert.deepEqual(result.toolCalls[0].input, { ref: "e2", value: "lea.martin@acme-corp.fr" });
  assert.match(result.message.tool_calls[0].function.arguments, /lea\.martin@acme-corp\.fr/);
});

test("the same value keeps the same marker for the whole conversation", async () => {
  const vault = new Vault();
  const a = await turn("openrouter", { history: [{ role: "user", content: "jeanne.dupont@acme-corp.fr et paul.durand@acme-corp.fr" }], privacy: { vault, conversation: "c4" } });
  const b = await turn("openrouter", { history: [{ role: "user", content: "et encore paul.durand@acme-corp.fr" }], privacy: { vault, conversation: "c4" } });
  assert.match(sent(a.body), /⟨EMAIL_2⟩/);
  assert.match(sent(b.body), /⟨EMAIL_2⟩/);
});

test("the user's own gateway and local models get the request exactly as written", async () => {
  const history = [{ role: "user", content: "Écris à jeanne.dupont@acme-corp.fr, IBAN FR76 3000 6000 0112 3456 7890 189" }];
  const gw = await turn("custom", { history });
  assert.match(sent(gw.body), /jeanne\.dupont@acme-corp\.fr/);
  assert.match(sent(gw.body), /FR76 3000/);
  const strictOwn = await turn("custom", { history, settings: { privacyTrustOwn: false }, privacy: { conversation: "c5", ask: async () => "once" } });
  assert.doesNotMatch(sent(strictOwn.body), /jeanne\.dupont/, "trust switched off: the gateway is treated like a cloud");
});

test("a public page keeps its prices — a model cannot add up markers — but not its e-mail addresses", () => {
  const vault = new Vault();
  const page = buildTurn({ userText: "", untrusted: [{ kind: "web page", source: "https://shop.example", text: "MacBook 2 499 € — contact ventes@shop-pro.fr" }] }).messages[0];
  const typed = { role: "user", content: "Mon budget est de 2 500 €" };
  const { messages, findings } = redactRequest([page, typed], vault, "balanced");
  assert.match(messages[0].content, /2 499 €/);
  assert.doesNotMatch(messages[0].content, /ventes@shop-pro\.fr/);
  assert.doesNotMatch(messages[1].content, /2 500 €/, "what the user typed is private: its amount is replaced");
  assert.deepEqual(findingsToAsk(findings).map((f) => f.from), ["web page"], "asked about the page's address, not about what the user typed");
});

test("anonymised: values leave as markers and nobody is asked — not on every agent step", async () => {
  forgetConversation("c6");
  const history = [buildTurn({ userText: "", untrusted: [{ kind: "attached document", source: "a file you attached", text: "[Attached file: clients.csv]\nnom;email\nDurand;paul.durand@acme-corp.fr\n" }] }).messages[0], { role: "user", content: "Résume, ma clé sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }];
  let asked = 0;
  for (const level of ["balanced", "strict"]) {
    const { body } = await turn("openrouter", { history, settings: { privacyLevel: level }, privacy: { conversation: "c6", ask: async () => { asked++; return "once"; } } });
    assert.doesNotMatch(sent(body), /paul\.durand@acme-corp\.fr|sk-ant-api03/, `${level}: replaced`);
  }
  assert.equal(asked, 0, "« anonymisé » means automatic: no window");
  // A side task nobody watches is sent too: nothing would have been asked.
  await turn("openrouter", { history: [{ role: "user", content: "voici ma clé sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }] });
});

test("not anonymised: the window asks about a key, once per value, with where it is; Cancel sends nothing; Always covers the conversation", async () => {
  const off = { privacyLevel: "off" };
  forgetConversation("c7");
  const history = [buildTurn({ userText: "", untrusted: [{ kind: "attached document", source: "a file you attached", text: "[Attached file: config.env]\nTOKEN=x\nKEY=sk-ant-api03-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC\n" }] }).messages[0], { role: "user", content: "Résume" }];
  const asked = [];
  const ask = async (lines) => { asked.push(lines); return "once"; };
  const first = await turn("openrouter", { history, settings: off, privacy: { conversation: "c7", ask } });
  assert.equal(asked.length, 1);
  assert.match(asked[0][0], /^config\.env:2 — /, "the file and the line, so it can be corrected");
  assert.doesNotMatch(asked[0][0], /CCCCCCCCCCCCCCCC/, "the value is shown masked");
  assert.doesNotMatch(sent(first.body), /sk-ant-api03-C/, "the key itself never leaves");
  await turn("openrouter", { history, settings: off, privacy: { conversation: "c7", ask } });
  assert.equal(asked.length, 1, "an accepted value is not asked about again in the same conversation");

  forgetConversation("c8");
  await assert.rejects(turn("openrouter", { history, settings: off, privacy: { conversation: "c8", ask: async () => "no" } }), (e) => e.name === "AbortError");

  forgetConversation("c9");
  let n = 0;
  const always = async () => { n++; return "always"; };
  await turn("openrouter", { history, settings: off, privacy: { conversation: "c9", ask: always } });
  await turn("openrouter", { history: [{ role: "user", content: "et sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ?" }], settings: off, privacy: { conversation: "c9", ask: always } });
  assert.equal(n, 1, "« Toujours envoyer » covers the rest of the conversation");
});

test("not anonymised, a side task nobody watches is not sent when it would have to ask", async () => {
  await assert.rejects(
    turn("openrouter", { history: [{ role: "user", content: "voici ma clé sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }], settings: { privacyLevel: "off" } }),
    (e) => e.name === "PrivacyRefused",
  );
});

test("the model is told what the markers are — only when a request carries some", async () => {
  const marked = await turn("openrouter", { history: [{ role: "user", content: "Écris à jeanne.dupont@acme-corp.fr" }], privacy: { conversation: "c9" } });
  assert.match(marked.body.messages[0].content, /PRIVACY MARKERS/);
  const plain = await turn("openrouter", { history: [{ role: "user", content: "Quelle heure est-il à Tokyo ?" }], privacy: { conversation: "c9" } });
  assert.doesNotMatch(plain.body.messages[0].content, /PRIVACY MARKERS/);
});

test("a value the user typed does not open the window when it comes back in the model's answer", async () => {
  forgetConversation("c10");
  let asked = 0;
  const ask = async () => { asked++; return "once"; };
  const vault = new Vault();
  await turn("openrouter", { history: [{ role: "user", content: "Réponds à paul.durand@acme-corp.fr" }], privacy: { conversation: "c10", ask, vault } });
  const history = [{ role: "user", content: "Réponds à paul.durand@acme-corp.fr" }, { role: "assistant", content: "À : paul.durand@acme-corp.fr — c'est noté." }, { role: "user", content: "Autre chose." }];
  await turn("openrouter", { history, privacy: { conversation: "c10", ask, vault } });
  assert.equal(asked, 0);
});
