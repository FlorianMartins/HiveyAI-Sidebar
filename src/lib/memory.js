// 🧠 Layered memory — Tier 0 profile, Tier 1 schemas, Tier 2 episodes.
//
// THE ECONOMICS, WHICH DRIVE EVERY DESIGN CHOICE BELOW
// ---------------------------------------------------
// This is not token compression. It is a shift of WHERE the spend happens.
//
//   naive     ~20 episodes × ~80 tokens injected every turn = ~1600 tokens paid, prefix cache
//             broken on every turn because the prefix changes
//   this      0 tokens by default. On a recall: ~30 tokens to ask + ~200 tokens of distilled
//             answer. The ~3000 tokens of raw candidates are eaten by a local or free model.
//
// Gzip and int8 buy DISK, never tokens. They are a separate axis and are treated as one: nothing
// in this file trades recall quality for bytes without saying so.
//
// WHAT GOES WHERE
// ---------------
//   Tier 0  a bounded profile (~800 tokens) of plain text in storage.local, injected once at the
//           head of a session and FROZEN for its duration. Writes persist immediately but only
//           appear next session — because a prefix that changes mid-session voids the provider's
//           cache, and then you do not pay 10% more, you pay full price for the whole context on
//           every turn. Hand-editable, because it is just text.
//   Tier 1  consolidated schemas: a few hundred abstractions, searchable (written in Phase 3).
//   Tier 2  raw episodes in IndexedDB: gzipped text, int8 vectors, brute-force search. At twenty
//           thousand episodes that is ~7.5 MB and a few milliseconds — HNSW would be overkill.
//
// Storage is INJECTED (`createMemory({ idb, kv, … })`) rather than imported. The browser supplies
// IndexedDB and storage.local; a test supplies maps. Without that seam none of this could be
// exercised outside a browser, which is how the old agent loop went untested for a year.

import { canWrite, isWritableProvenance, readableProvenance } from "./memory-policy.js";

export const TIER0_TOKEN_CAP = 800;
export const KINDS = ["preference", "fact", "decision", "event", "affect"];
export const SCHEMA_VERSION = 1;

/** Rough token count. Deliberately an estimate: the real tokenizer is provider-specific, and a
 *  budget that pretends to be exact would be wrong in a way that is harder to reason about than
 *  one that is openly approximate. ~4 characters per token, the usual ratio for prose. */
export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

// ── Vector quantisation ──────────────────────────────────────────────────────────────────────
// 384 float32 = 1536 bytes per episode. int8 with a per-vector scale and offset = 384 bytes plus
// two floats. Four times less disk; the question that matters is what it costs in RECALL, which
// is measured in the tests rather than assumed.

export function quantise(vec) {
  const v = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < v.length; i++) { if (v[i] < min) min = v[i]; if (v[i] > max) max = v[i]; }
  // A constant vector has no range; any scale would do, so pick one that round-trips exactly.
  const scale = max > min ? (max - min) / 255 : 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const n = Math.round((v[i] - min) / scale) - 128;
    q[i] = n < -128 ? -128 : n > 127 ? 127 : n;
  }
  return { q, scale, offset: min };
}

export function dequantise({ q, scale, offset }) {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = (q[i] + 128) * scale + offset;
  return out;
}

/** Cosine between a float query and a quantised stored vector.
 *
 *  The stored side is dequantised on the fly rather than compared in integer space. Integer dot
 *  products would be faster, but the per-vector OFFSET makes the cross terms awkward, and at
 *  twenty thousand vectors this is already a few milliseconds. Clarity is worth more than a
 *  speedup nobody will notice. */
export function cosineToQuantised(queryVec, stored) {
  const b = dequantise(stored);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < b.length; i++) { dot += queryVec[i] * b[i]; na += queryVec[i] * queryVec[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── Compression ──────────────────────────────────────────────────────────────────────────────
// CompressionStream is native in both targets, so gzip costs no dependency. Small strings get
// BIGGER when gzipped (the header alone is ~20 bytes), so the raw form is kept when it wins —
// storing a compressed blob that is larger than its source would be compression as ritual.

export async function gzip(text) {
  const raw = new TextEncoder().encode(String(text ?? ""));
  const cs = new CompressionStream("gzip");
  const stream = new Blob([raw]).stream().pipeThrough(cs);
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out.length < raw.length ? { z: out, gz: true } : { z: raw, gz: false };
}

export async function gunzip({ z, gz }) {
  if (!gz) return new TextDecoder().decode(z);
  const stream = new Blob([z]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// ── Identity and salience ────────────────────────────────────────────────────────────────────

export async function contentHash(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("contentHash: no SubtleCrypto available");
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * How much this deserves to survive.
 *
 * Explicitly NOT recency. Recency alone makes a memory that remembers the last thing you said and
 * forgets what you told it about yourself — which is the failure mode people describe as "it has
 * no memory" even when the log is full. What earns salience is a preference stated, a decision
 * taken, an entity that keeps coming back, an affective marker.
 */
export function computeSalience({ kind, entities = [], repeats = 0, affect = false, explicit = false } = {}) {
  let s = 0.25;
  if (kind === "preference" || kind === "decision") s += 0.3;
  if (kind === "fact") s += 0.15;
  if (explicit) s += 0.2;                                   // "remember that…"
  if (affect) s += 0.1;
  s += Math.min(0.2, entities.length * 0.05);
  s += Math.min(0.2, repeats * 0.07);
  return Math.max(0, Math.min(1, Number(s.toFixed(3))));
}

// ── Tier 0 arbitration ───────────────────────────────────────────────────────────────────────

/**
 * Fit profile lines into the token cap.
 *
 * The rule the spec insists on and that this enforces: NEVER a silent truncation. Lines are kept
 * whole, by salience, and what did not fit is RETURNED so the caller can say so — a profile
 * quietly cut mid-sentence is worse than a profile that admits it is full, because the user
 * cannot see what was lost or fix it.
 */
export function fitTier0(lines, cap = TIER0_TOKEN_CAP) {
  const ranked = lines.slice().sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0) || (b.ts ?? 0) - (a.ts ?? 0));
  const kept = [];
  const dropped = [];
  let tokens = 0;
  for (const line of ranked) {
    const cost = estimateTokens(line.text) + 1;              // +1 for the newline
    if (tokens + cost > cap) { dropped.push(line); continue; }
    kept.push(line);
    tokens += cost;
  }
  return { kept, dropped, tokens, full: dropped.length > 0 };
}

export function renderTier0(lines) {
  return lines.map((l) => `- ${String(l.text).replace(/\s+/g, " ").trim()}`).join("\n");
}

// ── The write gate ───────────────────────────────────────────────────────────────────────────

/**
 * May this become a stored episode?
 *
 * Returns a REASON when refusing rather than a bare false: a write that vanishes without
 * explanation is indistinguishable from a bug, and this gate refuses often by design.
 */
export function admitEpisode({ space, provenance, kind, text }) {
  if (!isWritableProvenance(provenance)) return { ok: false, reason: `provenance "${provenance}" is never storable` };
  if (!KINDS.includes(kind)) return { ok: false, reason: `unknown kind "${kind}"` };
  if (!canWrite(space, kind)) return { ok: false, reason: `space "${space}" may not write kind "${kind}"` };
  if (!String(text || "").trim()) return { ok: false, reason: "empty text" };
  if (String(text).length > 600) return { ok: false, reason: "text too long — episodes are summaries, not transcripts" };
  return { ok: true };
}

// ── The store ────────────────────────────────────────────────────────────────────────────────

const AUDIT_KEY = "memoryAudit";
const TIER0_KEY = "memoryProfile";

/**
 * @param idb     { get, put, delete, all }  — a tiny async record store (IndexedDB in the browser)
 * @param kv      { get, set }               — storage.local
 * @param embed   (text) => Promise<Float32Array>
 * @param cipher  { encrypt, decrypt } | null — when present, episode TEXT and ENTITIES are
 *                encrypted at rest. Tier 0 receives the same treatment, because encrypting the raw
 *                episodes while leaving the summary of them in plaintext would protect the less
 *                sensitive half and look like security.
 */
export function createMemory({ idb, kv, embed, cipher = null, subtle, now = () => Date.now(), extractorVersion = "heuristic-v1" }) {
  // The cipher contract is BYTES in, bytes out — which is what AES-GCM works on natively, and
  // what a gzipped body already is. Routing it through JSON.stringify (the first attempt) turned
  // the Uint8Array into {"0":31,"1":139,…} and the body could never be decompressed again.
  const encBytes = async (u8) => (cipher ? await cipher.encrypt(u8) : u8);
  const decBytes = async (u8) => (cipher ? await cipher.decrypt(u8) : u8);
  const encJson = async (value) => (cipher ? await cipher.encrypt(new TextEncoder().encode(JSON.stringify(value))) : value);
  const decJson = async (value) => (cipher ? JSON.parse(new TextDecoder().decode(await cipher.decrypt(value))) : value);

  async function audit(entry) {
    const log = (await kv.get(AUDIT_KEY)) || [];
    log.push({ t: now(), ...entry });
    // Bounded: the audit log is a safety feature, not an archive. Keeping the most recent 500 is
    // enough to answer "what did it just store?" without becoming a second memory of its own.
    await kv.set(AUDIT_KEY, log.slice(-500));
  }

  return {
    /** Everything written, and everything refused, in one readable place. */
    async auditLog() { return (await kv.get(AUDIT_KEY)) || []; },
    async clearAudit() { await kv.set(AUDIT_KEY, []); },

    // ── Tier 0 ──────────────────────────────────────────────────────────────────────────────
    async profileLines() {
      const stored = await kv.get(TIER0_KEY);
      if (!stored) return [];
      return cipher ? await decJson(stored) : stored;
    },

    /** The text injected at the head of a session. The caller freezes it for the session's
     *  duration; this only ever reports what is currently on disk. */
    async profileText() {
      const { kept } = fitTier0(await this.profileLines());
      return renderTier0(kept);
    },

    async setProfileLines(lines) {
      const { kept, dropped, tokens } = fitTier0(lines);
      await kv.set(TIER0_KEY, cipher ? await encJson(kept) : kept);
      await audit({ op: "tier0", kept: kept.length, dropped: dropped.length, tokens });
      return { kept, dropped, tokens };
    },

    // ── Tier 2 ──────────────────────────────────────────────────────────────────────────────
    /**
     * Write one episode. Refusals are logged with their reason: this gate says no often by
     * design, and a silent no is indistinguishable from a bug.
     */
    async remember({ space, provenance, kind, text, entities = [], repeats = 0, affect = false, explicit = false, derivedFrom = null }) {
      const verdict = admitEpisode({ space, provenance, kind, text });
      if (!verdict.ok) {
        await audit({ op: "refused", space, provenance, kind, reason: verdict.reason });
        return { ok: false, reason: verdict.reason };
      }
      if (cipher && !cipher.ready) {
        // Encryption was asked for and the key is not available. Storing in clear "just this once"
        // is how an at-rest guarantee quietly becomes untrue.
        await audit({ op: "refused", space, reason: "encryption enabled but locked" });
        return { ok: false, reason: "memory is locked" };
      }

      const hash = await contentHash(`${kind}:${text}`, subtle);
      const existing = (await idb.all()).find((e) => e.contentHash === hash);
      if (existing) {
        // The same thing said twice is not two memories; it is one memory that matters more.
        existing.salience = Math.min(1, existing.salience + 0.08);
        existing.recallCount = existing.recallCount || 0;
        await idb.put(existing);
        await audit({ op: "reinforced", id: existing.id, salience: existing.salience });
        return { ok: true, id: existing.id, reinforced: true };
      }

      const vec = await embed(text);
      const { q, scale, offset } = quantise(vec);
      const body = await gzip(text);
      const id = `ep_${now()}_${Math.random().toString(36).slice(2, 8)}`;
      const episode = {
        id,
        ts: now(),
        provenance,
        space,
        kind,
        // Encrypted at rest when a cipher is configured; the vector and salience stay in clear
        // because search needs them and a 384-dimension embedding is far less legible than the
        // sentence it came from.
        body: { z: await encBytes(body.z), gz: body.gz },
        entities: await encJson(entities),
        salience: computeSalience({ kind, entities, repeats, affect, explicit }),
        lastRecalled: null,
        recallCount: 0,
        derivedFrom,
        extractorVersion,
        schemaVersion: SCHEMA_VERSION,
        contentHash: hash,
        vec: { q, scale, offset },
      };
      await idb.put(episode);
      await audit({ op: "wrote", id, space, provenance, kind, salience: episode.salience });
      return { ok: true, id };
    },

    /** Read one episode back, decrypting and decompressing. */
    async read(id) {
      const e = await idb.get(id);
      if (!e) return null;
      return {
        ...e,
        text: await gunzip({ z: await decBytes(e.body.z), gz: e.body.gz }),
        entities: await decJson(e.entities),
      };
    },

    /**
     * Brute-force vector search, filtered by what this space is allowed to see.
     *
     * The provenance filter is applied HERE as well as in the recall pipeline. Defence in depth:
     * a capability that exists only in the pipeline is one refactor away from not existing.
     */
    async search(queryText, { space, limit = 8, minScore = 0.2 } = {}) {
      const allowed = readableProvenance(space);
      if (!allowed.length) return [];
      const qv = await embed(queryText);
      const rows = await idb.all();
      const scored = [];
      for (const e of rows) {
        const prov = String(e.provenance || "").split(":")[0];
        if (!allowed.includes(prov)) continue;
        const score = cosineToQuantised(qv, e.vec);
        if (score < minScore) continue;
        scored.push({ id: e.id, score, salience: e.salience, ts: e.ts, kind: e.kind, provenance: e.provenance });
      }
      // Similarity first, but salience breaks ties: between two equally relevant memories, the
      // one that has mattered before is the better answer.
      scored.sort((a, b) => b.score - a.score || b.salience - a.salience);
      return scored.slice(0, limit);
    },

    /** Called when a recall turned out to be useful. Reinforcement is what keeps consolidation
     *  from discarding the things that actually get used. */
    async reinforce(id) {
      const e = await idb.get(id);
      if (!e) return false;
      e.recallCount = (e.recallCount || 0) + 1;
      e.lastRecalled = now();
      e.salience = Math.min(1, e.salience + 0.05);
      await idb.put(e);
      return true;
    },

    async forget(id) {
      const e = await idb.get(id);
      if (!e) return false;
      await idb.delete(id);
      await audit({ op: "deleted", id, space: e.space, kind: e.kind });
      return true;
    },

    /**
     * Evict by salience when the quota is tight.
     *
     * Never by age. The oldest memory is frequently the one that defines the person — "I am
     * allergic to penicillin" does not become less true, and a policy that drops it because it is
     * old is a policy that forgets the important things first.
     */
    async evictIfNeeded({ maxBytes, estimate = () => null } = {}) {
      const usage = await estimate();
      if (!usage || !maxBytes || usage.usage < maxBytes) return { evicted: 0 };
      const rows = (await idb.all()).sort((a, b) => a.salience - b.salience || a.ts - b.ts);
      const target = Math.ceil(rows.length * 0.1);
      let evicted = 0;
      for (const e of rows.slice(0, target)) { await idb.delete(e.id); evicted++; }
      if (evicted) await audit({ op: "evicted", count: evicted, reason: "quota" });
      return { evicted };
    },
  };
}
