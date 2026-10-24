// Carried over from hivey-vscode (src/core/redaction/index.ts) — the same rules, the same reasons.
// The pipeline every byte crosses before it may reach a remote provider.
//
//   scan → resolve overlaps → filter by policy → replace → (block on secret) → send
//
// Local providers skip it entirely: redacting text that never leaves the machine costs quality
// for nothing. That decision is the caller's (`shouldRedact`), and it is the only place where the
// question "is this endpoint ours?" is answered.
import { scanShapes, scanEntropy, scanTerms, resolveOverlaps } from "./detectors.js";
import { DEFAULT_POLICY, kindsFor } from "./types.js";
export * from "./types.js";
export { Vault } from "./pseudonymizer.js";
export { entropy } from "./detectors.js";
/** Text the user typed can legitimately contain `⟨…⟩`; neutralise it so restore cannot be tricked. */
function escapePlaceholderShapes(text) {
  return text.replace(/⟨([A-Z0-9]+_\d+)⟩/g, "<$1>");
}
export function redact(input, vault, policy = DEFAULT_POLICY) {
  const text = escapePlaceholderShapes(input);
  const allowed = kindsFor(policy.level);
  const spans = [
    ...scanShapes(text),
    ...scanEntropy(text),
    ...(policy.customTerms.length ? scanTerms(text, policy.customTerms) : []),
  ].filter((s) => allowed.has(s.kind));
  const kept = resolveOverlaps(spans);
  if (!kept.length)
    return { text, findings: [], hasSecret: false, changed: text !== input };
  const findings = [];
  let out = "";
  let cursor = 0;
  for (const s of kept) {
    const placeholder = vault.placeholderFor(s.value, s.kind, s.rule);
    out += text.slice(cursor, s.start) + placeholder;
    cursor = s.end;
    findings.push({ kind: s.kind, rule: s.rule, start: s.start, end: s.end, value: s.value, placeholder });
  }
  out += text.slice(cursor);
  return {
    text: out,
    findings,
    hasSecret: findings.some((f) => f.kind === "secret"),
    changed: true,
  };
}
/** Convenience for message arrays: redacts every string field in place, sharing one vault. */
export function redactMessages(messages, vault, policy = DEFAULT_POLICY) {
  const findings = [];
  let hasSecret = false;
  const out = messages.map((m, i) => {
    const r = redact(m.content, vault, policy);
    findings.push(...r.findings.map((f) => ({ ...f, message: i })));
    hasSecret ||= r.hasSecret;
    return { ...m, content: r.text };
  });
  return { messages: out, findings, hasSecret };
}
/**
 * Strictly this machine: loopback only.
 *
 * `isLocalEndpoint` answers a question about TRUST — may this text leave without being
 * pseudonymized — and a server on the office network qualifies. This answers a different question,
 * about PLACE: is the model running on the laptop in front of you, or on a machine down the
 * corridor. Both are private; only one works on a train, and only one is somebody else's to
 * switch off. The interface names them separately because a user choosing a model cares which.
 */
export function isLoopbackEndpoint(baseUrl) {
  try {
    const h = new URL(baseUrl).hostname;
    return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "[::1]" || /^127\./.test(h);
  }
  catch {
    return false;
  }
}
/**
 * The providers that are the user's own infrastructure rather than somebody's cloud: the local
 * endpoint and the user's own OpenAI-compatible gateway — by what they ARE, not by their address.
 * Whether that earns them an exemption from pseudonymization is the caller's decision (a setting,
 * and an organisation policy above it).
 */
export function isSelfHostedProvider(provider) {
  return provider === "local" || provider === "openai-compatible";
}
/** A local endpoint is one that cannot leave the machine or the operator's own network. */
export function isLocalEndpoint(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const h = u.hostname;
    if (h === "localhost" || h.endsWith(".localhost") || h === "::1")
      return true;
    if (/^127\./.test(h))
      return true;
    // RFC1918 + link-local + CGNAT: an address that no router will forward to the internet.
    if (/^10\./.test(h))
      return true;
    if (/^192\.168\./.test(h))
      return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h))
      return true;
    if (/^169\.254\./.test(h))
      return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h))
      return true;
    if (/\.(?:internal|intranet|corp|local|lan|home)$/i.test(h))
      return true;
    return false;
  }
  catch {
    return false;
  }
}
/**
 * Put the real values back into every string of a tool call's arguments.
 *
 * The vault reached what the user READS — the answer and the reasoning — and not what the tools DO.
 * Against a remote endpoint in agent mode that is the difference between an edit that lands and one
 * that cannot: `write_file` writes `⟨HOST_1⟩` to disk, and `edit_file` searches a file for an
 * excerpt containing a placeholder the file has never held.
 *
 * Recursive, because an argument is not always a string: a list of paths, an object of options, a
 * nested edit. Everything that is not a string is passed through untouched — a number is not text
 * and a boolean cannot hold a secret — and the shape is rebuilt rather than mutated, so the caller's
 * parsed object is still what the model actually sent.
 */
export function restoreDeep(value, restore) {
  if (typeof value === "string")
    return restore(value);
  if (Array.isArray(value))
    return value.map((item) => restoreDeep(item, restore));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // The KEY is restored too: a tool whose arguments are keyed by path would otherwise carry a
      // placeholder as the name of the thing to act on.
      out[restore(key)] = restoreDeep(item, restore);
    }
    return out;
  }
  return value;
}
/**
 * The longest a placeholder can be.
 *
 * `⟨` + a label + `_` + a counter + `⟩`. The labels are a closed set, the longest being `SECRET`,
 * and the counter is however many values one conversation hid. Thirty-two characters is far more
 * than any of that and is the amount of text that may be held back waiting for a closing bracket —
 * which is the only thing this bound is for. Too small and a marker is released in halves; too
 * large and prose containing `⟨` stalls on screen for longer than it should.
 */
const MAX_PLACEHOLDER = 32;
/**
 * Restore markers in text that arrives in pieces.
 *
 * `vault.restore()` was applied chunk by chunk, and a model does not send words — it sends whatever
 * fits in a packet. A marker therefore arrives split, `⟨EMA` then `IL_1⟩`, and neither half matches
 * the pattern. The reader watched a placeholder appear raw and then watched it STAY raw, because
 * text already on screen is never revisited.
 *
 * So the end of a chunk is examined: an opening bracket with no closing one after it, close enough
 * to the end to still be a marker, is held back and joined to the next chunk. Everything before it
 * is released immediately, because a live answer that waits is worse than one that waits a packet.
 *
 * Two things it deliberately does not do. It does not hold for ever: prose can contain `⟨`, and
 * past `MAX_PLACEHOLDER` characters the text is released as it is. And it does not lose what it
 * held: `flush` gives it back when the stream ends, which is also what happens when the user stops
 * the turn mid-marker.
 */
export function streamingRestorer(restore) {
  let held = "";
  return {
    push(chunk) {
      const buffer = held + chunk;
      const open = buffer.lastIndexOf("⟨");
      // Held only when the opening bracket has no closing one after it AND is recent enough that
      // what follows could still become a marker.
      const partial = open >= 0 && !buffer.includes("⟩", open) && buffer.length - open <= MAX_PLACEHOLDER;
      const cut = partial ? open : buffer.length;
      held = buffer.slice(cut);
      return restore(buffer.slice(0, cut));
    },
    flush() {
      const rest = held;
      held = "";
      // Restored anyway: what is left is not a complete marker, so this changes nothing — and if
      // the bound above ever lets a whole one through, it is put back rather than shown raw.
      return restore(rest);
    },
  };
}
