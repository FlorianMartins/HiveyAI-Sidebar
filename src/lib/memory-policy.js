// 🧠 Memory capability policy — one place that answers "may this space read or write memory?".
//
// The rule under the table, which matters more than the table: a space may WRITE only if what it
// receives is the user talking about themselves. Any space whose job is to process CONTENT — a
// page, a PDF, a packet capture, someone else's code — reads at best and never writes. Content is
// not testimony: a summarised .pcap describes an infrastructure, and an email pasted into Improve
// was written by somebody else.
//
// Checked once, at the pre-step. Scattering the check across call sites is how a space quietly
// acquires a capability nobody granted it.

/** Every workspace the rail can show. A space absent from this list is unknown to the policy. */
export const SPACES = [
  "chat", "web", "agent", "translate", "improve",
  "image", "pdf", "security", "wisebase", "benchmark", "code",
];

/**
 * read-write  may read memory and write episodes
 * read        may read memory, never writes
 * read-user   may read ONLY episodes whose provenance is 'user'
 * none        no memory at all, in either direction
 */
export const SPACE_MEMORY = {
  chat: "read-write",
  improve: "read-write",   // writes restricted to kind:'preference' — see canWrite()
  code: "read",
  wisebase: "read",
  security: "read",        // never writes: a .pcap summary describes an infrastructure
  pdf: "read",
  agent: "read-user",      // an autonomous agent reads only what the user said themselves
  translate: "none",
  image: "none",
  benchmark: "none",       // measures models; has no conversation to remember
  // The Web chats space embeds a third party's own page. We do not control that prompt, so there
  // is nothing to inject memory into and nothing trustworthy to extract from it.
  web: "none",
};

/** Unknown space → 'none'. A space someone forgets to declare must not inherit write access by
 *  accident; the safe default is the one that grants nothing. */
export function memoryCapability(space) {
  return Object.prototype.hasOwnProperty.call(SPACE_MEMORY, space) ? SPACE_MEMORY[space] : "none";
}

export function canRead(space) {
  return memoryCapability(space) !== "none";
}

/** Which provenances this space may see. Defence in depth: the recall pipeline filters as well,
 *  but a capability that only exists in the pipeline is one refactor away from disappearing. */
export function readableProvenance(space) {
  const cap = memoryCapability(space);
  if (cap === "none") return [];
  if (cap === "read-user") return ["user"];
  return ["user", "agent", "imported"];
}

/**
 * Improve is the reason this takes a `kind`. It rewrites text the user PASTED, which is routinely
 * somebody else's — an email received, an article. A style preference stated about that rewrite is
 * the user speaking; a "fact" extracted from the pasted body is not about the user at all.
 * Enforced here, at the write gate, because a prompt asking an extractor to behave constrains
 * nothing.
 */
export function canWrite(space, kind) {
  const cap = memoryCapability(space);
  if (cap !== "read-write") return false;
  if (space === "improve") return kind === "preference";
  return true;
}

/** Only these two are ever eligible to become a stored episode. Everything read from a page, tab,
 *  PDF or capture is content, and content is never testimony about the user. */
export const WRITABLE_PROVENANCE = ["user", "agent"];

export function isWritableProvenance(provenance) {
  return WRITABLE_PROVENANCE.includes(provenance);
}

// ── Authenticated tabs ───────────────────────────────────────────────────────────────────────
// The Web chats space works by embedding sites the user is LOGGED INTO. An autonomous agent that
// could drive those tabs would combine the three ingredients of the classic problem: private
// data, untrusted content, and an outbound capability. The refusal is coded in the tool executor,
// not written in a prompt, because a prompt is not a control.

export const WEB_CHAT_HOSTS = [
  "chatgpt.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com",
  "chat.mistral.ai", "chat.deepseek.com", "chat.qwen.ai", "chat.z.ai",
  "www.kimi.com", "kimi.com", "huggingface.co",
];

/** True when a URL points at one of the embedded chat providers. Matches the host and its
 *  subdomains, and treats an unparseable URL as a match — refusing to act on something we cannot
 *  identify is the safe direction. */
export function isWebChatUrl(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(String(url)).hostname.toLowerCase();
  } catch {
    return true; // unparseable: refuse rather than guess
  }
  return WEB_CHAT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
