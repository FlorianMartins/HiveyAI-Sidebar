// Local conversation history (privacy-first).
//
// Everything is stored in browser.storage.local — on this device only, never
// synced, never sent anywhere. The user can disable saving (settings.saveHistory)
// or clear everything. Each conversation keeps a display transcript (for the UI)
// plus the provider-native message array (to allow continuing the chat).

const KEY = "conversations";
const MAX_CONVERSATIONS = 60;
// In Hivey Browser the storage is unlimited (manifest.chrome.json), so what bounds the list is that it is
// rewritten whole at every save, and a conversation deleted without asking is a surprise. A cap stays,
// five times higher; the history view says what the conversations take up.
export const HIVEY_BROWSER_MAX_CONVERSATIONS = 300;

const isQuotaError = (e) => /quota/i.test(String((e && (e.message || e.name)) || e));

export async function listConversations() {
  const { [KEY]: list } = await browser.storage.local.get(KEY);
  return Array.isArray(list) ? list : [];
}

export async function getConversation(id) {
  const list = await listConversations();
  return list.find((c) => c.id === id) || null;
}

// Sort: PINNED first (kept together), then most-recent-first.
export function sortConversations(list) {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

// Insert or update a conversation, keeping the list capped (pinned are NEVER dropped by the cap).
//
// A full storage used to lose the answer without a word. Now the oldest unpinned conversations make room
// for the one being saved (`conv.evicted` says how many), and only when even that does not fit does it
// throw, with `code: "storage_quota"`, for the caller to say so. The conversation is never lost on screen.
export async function saveConversation(conv, { cap = MAX_CONVERSATIONS } = {}) {
  const list = await listConversations();
  const idx = list.findIndex((c) => c.id === conv.id);
  conv.updatedAt = Date.now();
  if (idx >= 0) conv.pinned = conv.pinned ?? list[idx].pinned; // preserve pin state on update
  if (idx >= 0) list[idx] = conv;
  else list.unshift(conv);
  const sorted = sortConversations(list);
  // Keep every pinned conversation + the most recent unpinned up to the cap.
  const pinned = sorted.filter((c) => c.pinned);
  const rest = sorted.filter((c) => !c.pinned).slice(0, Math.max(0, cap - pinned.length));
  let evicted = 0;
  for (;;) {
    try {
      await browser.storage.local.set({ [KEY]: sortConversations([...pinned, ...rest]) });
      break;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      // The oldest one that is neither pinned nor this conversation makes room.
      let i = rest.length - 1;
      while (i >= 0 && rest[i].id === conv.id) i--;
      if (i < 0) {
        const full = new Error("The browser's storage is full.");
        full.code = "storage_quota";
        throw full;
      }
      rest.splice(i, 1);
      evicted++;
    }
  }
  return evicted ? { ...conv, evicted } : conv;
}

/**
 * What the saved conversations take up, in bytes: the browser's own count, or their JSON's size where it
 * has none (Firefox's storage.local long had no getBytesInUse).
 */
export async function conversationBytes() {
  const area = browser.storage.local;
  try {
    if (typeof area.getBytesInUse === "function") return await area.getBytesInUse(KEY);
  } catch (_) { /* counted below */ }
  const list = await listConversations();
  return list.length ? new TextEncoder().encode(JSON.stringify(list)).length : 0;
}

export async function togglePinned(id) {
  const list = await listConversations();
  const c = list.find((x) => x.id === id);
  if (!c) return false;
  c.pinned = !c.pinned;
  await browser.storage.local.set({ [KEY]: sortConversations(list) });
  return c.pinned;
}

// Full-text match: search the title AND every message's text.
export function conversationMatches(conv, query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return true;
  if ((conv.title || "").toLowerCase().includes(q)) return true;
  return (conv.transcript || []).some((m) => (m.text || "").toLowerCase().includes(q));
}

export async function deleteConversation(id) {
  const list = await listConversations();
  await browser.storage.local.set({ [KEY]: list.filter((c) => c.id !== id) });
}

export async function clearConversations() {
  await browser.storage.local.remove(KEY);
}

export function newConversationId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Derive a short title from the first user message.
export function titleFrom(transcript) {
  const firstUser = (transcript || []).find((m) => m.role === "user");
  const t = (firstUser && firstUser.text) || "Nouvelle conversation";
  return t.replace(/\s+/g, " ").trim().slice(0, 48);
}
