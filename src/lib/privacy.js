// Privacy first: what may leave the browser, and in what form.
//
// Three kinds of model, as in hivey-vscode, and the user picks:
//   • LOCAL   — Ollama, LM Studio, a server on this machine or the office network: nothing leaves.
//   • GATEWAY — the user's own OpenAI-compatible server (their gateway, their company's): theirs.
//   • CLOUD   — a vendor's API (Claude, OpenAI, OpenRouter, Gemini…): somebody else's machine.
//
// Local and gateway are sent as they are — the user asked, in hivey-vscode, that anonymization be
// removed there (« c'est des environnements sûrs »), and pseudonymizing text that never reaches a
// third party costs answer quality for nothing. A cloud request is pseudonymized first: every
// credential, e-mail, phone number, IBAN, card, company identifier or listed term becomes a marker
// like ⟨EMAIL_1⟩, consistent for the whole conversation so the model can still reason about it, and
// every marker the model writes back — in its answer, its reasoning, or the arguments of a tool it
// calls — is turned back into the real value here, before anything is shown or done.
//
// What is sensitive in a sidebar is not what is sensitive in an editor. What the user types, the
// files and PDFs they attach, their Wisebase and the logs they analyse are private: everything the
// level covers is replaced. A public web page is not: its prices are the point of comparing them,
// so the one rule left out there is the amount — a model cannot add up placeholders. Credentials and
// personal data are replaced on every page all the same (a webmail page is a web page too).
//
// Before a cloud request that carries a credential, or personal/company data that the user did NOT
// type themselves (a page, a file, a result), the sidebar asks — once per value and per conversation
// — with where each one is: « Envoyer (marqueurs en place) », « Toujours envoyer (cette conversation) »,
// « Annuler ». Nothing about the values is ever logged.

import { redact, Vault, isLocalEndpoint, restoreDeep, streamingRestorer } from "./redaction/index.js";
import { masked } from "./redaction/locate.js";
import { PROVIDERS, baseUrlFor } from "./models.js";

export { Vault };

/** "local" | "gateway" | "cloud" — what the provider IS, and where its address points. */
export function privacyClass(providerId, settings) {
  const meta = PROVIDERS[providerId];
  if (!meta) return "cloud";
  const url = baseUrlFor(providerId, settings || {}) || "";
  if (meta.local) return "local";
  if (meta.custom || meta.gateway) return url && isLocalEndpoint(url) ? "local" : "gateway";
  return "cloud";
}

/** Whether a request to this provider is pseudonymized: clouds, unless the user turned it off. */
export function redactsFor(providerId, settings) {
  const level = (settings && settings.privacyLevel) || "balanced";
  // « none »: the user chose to send everything as written — nothing masked, nothing asked.
  if (level === "none") return false;
  if (level === "off") return privacyClass(providerId, settings) === "cloud" ? "secrets" : false;
  if (privacyClass(providerId, settings) !== "cloud") return settings && settings.privacyTrustOwn === false ? level : false;
  return level;
}

/** Where a message came from: what the user typed, or a fenced block (page, tabs, file…). */
function sourceOf(m) {
  if (!m) return { from: "unknown" };
  if (m.role === "tool") return { from: "tool" };
  if (m.role === "assistant") return { from: "answer" };
  const text = typeof m.content === "string" ? m.content : "";
  const head = /^⟦UNTRUSTED ([^⟧]*?)(?: from ([^⟧]*?))? id=[^⟧]+⟧/.exec(text);
  if (head) return { from: head[1], source: head[2] || "" };
  if (Array.isArray(m.content) && m.content.some((p) => p && p.type === "tool_result")) return { from: "tool" };
  return { from: "typed" };
}
const isWeb = (src) => src.from === "web page" || src.from === "browser tabs" || src.from === "tool";

/** The attached file (and line) an offset falls in, from the `[Attached file: name]` headers. */
function fileAt(text, at) {
  const before = text.slice(0, at);
  const heads = [...before.matchAll(/\[Attached (?:file|PDF): ([^\]\n]+?)(?: \(\d+ pages\))?\]\n/g)];
  const h = heads[heads.length - 1];
  if (!h) return null;
  const line = before.slice(h.index + h[0].length).split("\n").length;
  return { file: h[1], line };
}

/**
 * Pseudonymize a request's messages (provider-native: strings, text parts, tool results) with one
 * vault. Returns the new messages and what was found — kind, rule, masked value and where it was.
 */
export function redactRequest(messages, vault, level, customTerms = []) {
  const findings = [];
  const policyFor = (src) => ({ level: level === "secrets" ? "off" : level, customTerms, blockOnSecret: false, web: isWeb(src) });
  const one = (text, src, msgIndex) => {
    if (typeof text !== "string" || !text) return text;
    const policy = policyFor(src);
    const r = redact(text, vault, policy);
    let out = r.text;
    for (const f of r.findings) {
      // A public page's prices are its content: put them back (see the header).
      if (policy.web && f.rule === "amount") { out = out.split(f.placeholder).join(f.value); continue; }
      const file = src.from === "attached document" ? fileAt(text, f.start) : null;
      findings.push({ kind: f.kind, rule: f.rule, value: f.value, placeholder: f.placeholder, message: msgIndex, from: src.from, source: src.source || "", ...(file ? file : {}) });
    }
    return out;
  };
  const out = messages.map((m, i) => {
    if (!m) return m;
    const src = sourceOf(m);
    if (typeof m.content === "string") return { ...m, content: one(m.content, src, i) };
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((p) => {
          if (!p) return p;
          if (p.type === "text") return { ...p, text: one(p.text, src, i) };
          if (p.type === "tool_result") {
            return { ...p, content: typeof p.content === "string" ? one(p.content, { from: "tool" }, i) : Array.isArray(p.content) ? p.content.map((q) => (q && q.type === "text" ? { ...q, text: one(q.text, { from: "tool" }, i) } : q)) : p.content };
          }
          return p;
        }),
      };
    }
    return m;
  });
  return { messages: out, findings };
}

/**
 * Which findings the user is asked about: credentials anywhere, personal/company data they did not
 * type — and never what the model only repeats from earlier in the conversation (`answer`): that
 * value already went, as a marker, with the message it came from.
 */
export function findingsToAsk(findings) {
  return findings.filter((f) => f.from !== "answer" && (f.kind === "secret" || ((f.kind === "identity" || f.kind === "business" || f.kind === "term") && f.from !== "typed")));
}

/** A finding as one line of the warning: where — what (masked). `t` is the interface's translator. */
export function describeFinding(f, t) {
  const where =
    f.file ? `${f.file}:${f.line}` :
    f.from === "typed" ? t("priv.where.typed") :
    f.from === "web page" ? (f.source || t("priv.where.page")) :
    f.from === "tool" ? t("priv.where.tool") :
    f.from === "answer" ? t("priv.where.answer") :
    f.source || f.from;
  const what = t("priv.kind." + f.rule) !== "priv.kind." + f.rule ? t("priv.kind." + f.rule) : t(f.kind === "secret" ? "priv.kind.secret" : "priv.kind.personal");
  return `${where} — ${what} (${masked(f.value)})`;
}

export const MARKER_RULE =
  "PRIVACY MARKERS: some values appear as markers like ⟨EMAIL_1⟩, ⟨PHONE_2⟩ or ⟨IBAN_1⟩. Each stands for a real value that was " +
  "removed for privacy before this request left the user's browser; it is put back on the user's side. Use the markers exactly " +
  "as they are wherever the value belongs — in your answer and in tool arguments — and never invent a plausible real value in their place.";

/** Per conversation: the values already accepted, and whether "Always send" was chosen. */
const accepted = new Map();
const always = new Set();
export function forgetConversation(id) { accepted.delete(id); always.delete(id); }

/**
 * Wrap a provider so that its requests are pseudonymized and its answers restored.
 *
 * `ask(lines, count)` → "once" | "always" | "no" is the sidebar's dialog, used with anonymisation off
 * (level "secrets") — anonymised, a value is replaced and nobody is asked; without one (a side task
 * nobody is watching), a request that would have to ask is not sent — "nobody could be asked" must
 * not mean "send it anyway". `onRedacted(findings)` reports what was replaced, counts only.
 */
export function privateProvider(inner, { level, customTerms = [], vault = new Vault(), conversation = "", ask = null, t = (k) => k, onRedacted = null }) {
  return {
    ...inner,
    vault,
    async runTurn(req) {
      const { messages, findings } = redactRequest(req.history || [], vault, level, customTerms);
      const sysR = redactRequest([{ role: "user", content: req.system || "" }], vault, level, customTerms);
      const toAsk = findingsToAsk([...findings, ...sysR.findings]);
      const seen = accepted.get(conversation) || new Set();
      // ⚠️ A value the user typed came back in the model's answer, and the next question asked about
      // it — « une réponse précédente — adresse e-mail ». What the user wrote is theirs: accepted for
      // the conversation the first time it is seen, wherever it shows up next.
      for (const f of findings) if (f.from === "typed" && f.kind !== "secret") seen.add(f.value);
      if (conversation) accepted.set(conversation, seen);
      const fresh = toAsk.filter((f) => !seen.has(f.value));
      // Anonymised (« balanced », « strict »): every value already leaves as a marker, so there is
      // nothing left to approve — the window opened on each agent step for nothing. It is asked only
      // with anonymisation OFF (level « secrets »), where the credentials are the one thing masked.
      const asks = level === "secrets";
      if (asks && fresh.length && !(conversation && always.has(conversation))) {
        if (!ask) throw Object.assign(new Error(t("priv.notSent")), { name: "PrivacyRefused" });
        const lines = fresh.slice(0, 12).map((f) => describeFinding(f, t));
        if (fresh.length > 12) lines.push(t("priv.more", { n: fresh.length - 12 }));
        const answer = await ask(lines, fresh.length);
        if (answer === "no") throw Object.assign(new Error(t("priv.cancelled")), { name: "AbortError" });
        if (answer === "always" && conversation) always.add(conversation);
        for (const f of fresh) seen.add(f.value);
        if (conversation) accepted.set(conversation, seen);
      }
      if (onRedacted && (findings.length || sysR.findings.length)) onRedacted([...findings, ...sysR.findings]);
      const restore = (s) => vault.restore(s);
      const textR = streamingRestorer(restore);
      const thinkR = streamingRestorer(restore);
      const onText = req.onText ? (d) => { const s = textR.push(d); if (s) req.onText(s); } : null;
      const onThink = req.onThink ? (d) => { const s = thinkR.push(d); if (s) req.onThink(s); } : null;
      // Said only when markers are actually there (hivey-vscode's SHARED_RULES): a model that does not
      // know what ⟨EMAIL_1⟩ is writes around it — "I'll address it generically" — and the user loses
      // the very value the marker stands for.
      const marked = findings.length || sysR.findings.length;
      const system = marked ? `${sysR.messages[0].content}\n\n${MARKER_RULE}` : sysR.messages[0].content;
      const r = await inner.runTurn({ ...req, system, history: messages, onText, onThink });
      const tailT = textR.flush(); if (tailT && req.onText) req.onText(tailT);
      const tailK = thinkR.flush(); if (tailK && req.onThink) req.onThink(tailK);
      // What is kept in the history and what the tools receive hold the real values: the next
      // request is pseudonymized again with the same vault, so the model sees the same markers.
      return {
        ...r,
        text: restore(r.text || ""),
        reasoning: r.reasoning ? restore(r.reasoning) : r.reasoning,
        message: restoreDeep(r.message, restore),
        toolCalls: (r.toolCalls || []).map((c) => ({ ...c, input: restoreDeep(c.input, restore) })),
      };
    },
  };
}
