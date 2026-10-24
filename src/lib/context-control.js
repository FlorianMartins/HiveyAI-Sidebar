// What the model is given of a conversation — decided by the user, exchange by exchange.
//
// hivey-vscode lets the person take an exchange out of the context (it stays on screen, it stops
// being sent), pin one (it survives every summary word for word), and delete one. « elle est
// vraiment utile pour garder de la précision et un contexte maîtrisé et propre » — a wrong turn, a
// pasted log that has done its job, an answer that went off on a tangent: each of them is read
// again by the model at every later question, and pulls the answers toward it.
//
// The sidebar keeps a conversation as provider-native messages (agent.js, providers.js). An
// EXCHANGE is the user's question, what was sent with it (page, files) and everything the model
// did to answer it (tool calls, results, the answer): they are tagged with one `_turn` id when the
// question is asked, and acted on together — a question taken out without its answer, or a tool
// call without its result, would be a history no API accepts. Keys starting with `_` never leave
// the browser (providers.js strips them).

/** A new exchange id. */
export function newTurnId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Tag every message from `from` on that has no exchange yet. */
export function tagTurn(history, from, turnId) {
  for (let i = Math.max(0, from); i < history.length; i++) {
    const m = history[i];
    if (m && typeof m === "object" && !m._turn) m._turn = turnId;
  }
}

const ofTurn = (history, turnId) => (history || []).filter((m) => m && m._turn === turnId);

/** Out of the context (`muted`) or back in; pinned or not. Returns how many messages changed. */
export function setTurnState(history, turnId, { muted, pinned } = {}) {
  const ms = ofTurn(history, turnId);
  for (const m of ms) {
    if (muted !== undefined) { if (muted) m._muted = true; else delete m._muted; }
    if (pinned !== undefined) { if (pinned) m._pinned = true; else delete m._pinned; }
  }
  return ms.length;
}

/** Forget an exchange entirely. Returns how many messages went. */
export function removeTurn(history, turnId) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i]._turn === turnId) { history.splice(i, 1); n++; }
  }
  return n;
}

/** What is sent: everything not taken out of the context. */
export function activeMessages(history) {
  return (history || []).filter((m) => !(m && m._muted));
}

/** A message as it leaves the browser: no `_` key (exchange ids, flags, kept reasoning). */
export function stripPrivate(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return m;
  let copy = null;
  for (const k of Object.keys(m)) {
    if (k.startsWith("_")) { copy = copy || { ...m }; delete copy[k]; }
  }
  return copy || m;
}
