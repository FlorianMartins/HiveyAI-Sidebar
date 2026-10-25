// Wisebase — a 100% local knowledge base + RAG store.
//
// Everything lives in the browser: collections, sources, text chunks AND their embedding vectors are
// held in IndexedDB (large data), never uploaded anywhere. Uninstalling the extension makes the
// browser purge the whole database. Embeddings are computed locally by src/lib/embeddings.js.
//
// Schema (DB "hivey-wisebase", v1):
//   collections { id, name, createdAt, updatedAt }
//   sources     { id, collectionId, type, title, size, chunkCount, createdAt, meta }   idx: collectionId
//   chunks      { id, sourceId, collectionId, idx, text, vector(Float32Array), meta }  idx: sourceId, collectionId

// Embeddings (transformers.js, ~0.9 MB + model) are dynamic-imported ONLY when we actually ingest or
// query — browsing collections/sources and full-text search never load the ML engine.
async function embeddings() { return import("./embeddings.js"); }

// Cosine of two L2-normalized vectors = dot product (embedMany/embedOne normalize on output).
function cosineSim(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

const DB_NAME = "hivey-wisebase";
const DB_VERSION = 1;

// ~800-token chunks with ~120-token overlap, approximated in characters (≈4 chars/token).
const CHUNK_CHARS = 3200;
const OVERLAP_CHARS = 480;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("collections")) db.createObjectStore("collections", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sources")) {
        const s = db.createObjectStore("sources", { keyPath: "id" });
        s.createIndex("collectionId", "collectionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const c = db.createObjectStore("chunks", { keyPath: "id" });
        c.createIndex("sourceId", "sourceId", { unique: false });
        c.createIndex("collectionId", "collectionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function allByIndex(store, index, value) {
  return openDB().then((db) => new Promise((res, rej) => {
    const idx = db.transaction(store, "readonly").objectStore(store).index(index);
    const r = idx.getAll(value);
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  }));
}

function genId(prefix) { return (prefix || "w") + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

// ---- Chunking ---------------------------------------------------------------
// Split on sentence / newline boundaries, then pack into ~CHUNK_CHARS windows with OVERLAP_CHARS of
// carry-over so context isn't cut mid-idea. Falls back to hard slicing for boundary-less text.
export function chunkText(raw) {
  const text = (raw || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!text) return [];
  const pieces = text.match(/[^.!?\n]+[.!?]*\n*|\n+/g) || [text];
  const chunks = [];
  let cur = "";
  for (let piece of pieces) {
    // A single oversized piece (no punctuation) is hard-split.
    while (piece.length > CHUNK_CHARS) {
      if (cur) { chunks.push(cur.trim()); cur = cur.slice(-OVERLAP_CHARS); }
      chunks.push(piece.slice(0, CHUNK_CHARS).trim());
      piece = piece.slice(CHUNK_CHARS - OVERLAP_CHARS);
    }
    if (cur.length + piece.length > CHUNK_CHARS) {
      chunks.push(cur.trim());
      cur = cur.slice(-OVERLAP_CHARS) + piece;
    } else {
      cur += piece;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 0);
}

// ---- Collections ------------------------------------------------------------
export async function listCollections() {
  const store = await tx("collections", "readonly");
  const all = await reqP(store.getAll());
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function createCollection(name) {
  const col = { id: genId("c"), name: (name || "Collection").trim(), createdAt: Date.now(), updatedAt: Date.now() };
  const store = await tx("collections", "readwrite");
  await reqP(store.add(col));
  return col;
}
export async function renameCollection(id, name) {
  const store = await tx("collections", "readwrite");
  const col = await reqP(store.get(id));
  if (!col) return null;
  col.name = (name || col.name).trim();
  col.updatedAt = Date.now();
  await reqP(store.put(col));
  return col;
}
export async function deleteCollection(id) {
  const sources = await allByIndex("sources", "collectionId", id);
  for (const s of sources) await deleteSource(s.id);
  const store = await tx("collections", "readwrite");
  await reqP(store.delete(id));
}
async function touchCollection(id) {
  const store = await tx("collections", "readwrite");
  const col = await reqP(store.get(id));
  if (col) { col.updatedAt = Date.now(); await reqP(store.put(col)); }
}

// ---- Sources + ingestion ----------------------------------------------------
export async function listSources(collectionId) {
  const all = await allByIndex("sources", "collectionId", collectionId);
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Ingest a source: chunk → embed (local) → store chunks with vectors. `onProgress` gets
// { phase: "model"|"embed", ... } so the UI can show model-download then per-chunk progress.
export async function addSource(collectionId, { type, title, text, meta }, { onProgress } = {}) {
  const clean = (text || "").trim();
  if (!clean) throw new Error("empty source");
  // Idempotency guard: if an identical source (same title + size) is already in this collection,
  // return it instead of indexing a duplicate. Prevents accidental double-adds.
  const existing = await allByIndex("sources", "collectionId", collectionId);
  const dup = existing.find((s) => s.title === (title || "Untitled").slice(0, 200) && s.size === clean.length);
  if (dup) return dup;
  const chunks = chunkText(clean);
  if (!chunks.length) throw new Error("no chunks");

  const { embedMany } = await embeddings();
  const vectors = await embedMany(chunks, {
    onProgress: (p) => onProgress && onProgress({ phase: "model", ...p }),
    onItem: (done, total) => onProgress && onProgress({ phase: "embed", done, total }),
  });

  const sourceId = genId("s");
  const source = {
    id: sourceId, collectionId, type: type || "text",
    title: (title || "Untitled").slice(0, 200), size: clean.length,
    chunkCount: chunks.length, createdAt: Date.now(), meta: meta || {},
  };

  const db = await openDB();
  await new Promise((res, rej) => {
    const t = db.transaction(["sources", "chunks"], "readwrite");
    t.objectStore("sources").add(source);
    const cs = t.objectStore("chunks");
    for (let i = 0; i < chunks.length; i++) {
      cs.add({ id: `${sourceId}:${i}`, sourceId, collectionId, idx: i, text: chunks[i], vector: vectors[i], meta: {} });
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  await touchCollection(collectionId);
  return source;
}
export async function renameSource(id, title) {
  const store = await tx("sources", "readwrite");
  const s = await reqP(store.get(id));
  if (!s) return null;
  s.title = (title || s.title).slice(0, 200);
  await reqP(store.put(s));
  return s;
}
// Portable JSON export of a collection (metadata + source texts, WITHOUT the vectors — those are
// re-computable on import and would bloat the file). Good for backup / sharing / re-importing.
export async function exportCollection(id) {
  const store = await tx("collections", "readonly");
  const col = await reqP(store.get(id));
  if (!col) return null;
  const sources = await listSources(id);
  const out = { format: "hivey-wisebase", version: 1, name: col.name, exportedAt: Date.now(), sources: [] };
  for (const s of sources) {
    const chunks = (await allByIndex("chunks", "sourceId", s.id)).sort((a, b) => a.idx - b.idx);
    out.sources.push({ title: s.title, type: s.type, size: s.size, text: chunks.map((c) => c.text).join("\n") });
  }
  return out;
}
// Import a previously-exported collection (re-indexes every source into a NEW collection).
export async function importCollection(data, { onProgress } = {}) {
  if (!data || data.format !== "hivey-wisebase" || !Array.isArray(data.sources)) throw new Error("bad file");
  const col = await createCollection((data.name || "Imported") + " (import)");
  for (const s of data.sources) {
    if (s && s.text) await addSource(col.id, { type: s.type || "text", title: s.title || "Untitled", text: s.text }, { onProgress });
  }
  return col;
}
export async function deleteSource(id) {
  const chunks = await allByIndex("chunks", "sourceId", id);
  const db = await openDB();
  await new Promise((res, rej) => {
    const t = db.transaction(["sources", "chunks"], "readwrite");
    t.objectStore("sources").delete(id);
    const cs = t.objectStore("chunks");
    for (const c of chunks) cs.delete(c.id);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// ---- Stats ------------------------------------------------------------------
export async function collectionStats(id) {
  const sources = await allByIndex("sources", "collectionId", id);
  const chunkCount = sources.reduce((n, s) => n + (s.chunkCount || 0), 0);
  return { sources: sources.length, chunks: chunkCount };
}

// ---- Retrieval --------------------------------------------------------------
// Embed the query, cosine-score every chunk in the selected collections, return the top-k with their
// source titles. Loading all vectors into memory is fine for a personal KB (thousands of chunks).
export async function retrieve(query, collectionIds, { k = 6, onProgress } = {}) {
  const ids = (collectionIds && collectionIds.length ? collectionIds : null);
  const { embedOne } = await embeddings();
  const qvec = await embedOne(query, (p) => onProgress && onProgress({ phase: "model", ...p }));

  let candidates = [];
  if (ids) {
    for (const cid of ids) candidates.push(...(await allByIndex("chunks", "collectionId", cid)));
  } else {
    const store = await tx("chunks", "readonly");
    candidates = await reqP(store.getAll());
  }
  if (!candidates.length) return [];

  // Titles for citation labels.
  const srcStore = await tx("sources", "readonly");
  const titleCache = new Map();
  const titleFor = async (sid) => {
    if (titleCache.has(sid)) return titleCache.get(sid);
    const s = await reqP(srcStore.get(sid));
    const tt = s ? s.title : "source";
    titleCache.set(sid, tt);
    return tt;
  };

  const scored = candidates.map((c) => ({ chunk: c, score: cosineSim(qvec, c.vector) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  const out = [];
  for (const { chunk, score } of top) {
    out.push({ text: chunk.text, score, sourceId: chunk.sourceId, idx: chunk.idx, sourceTitle: await titleFor(chunk.sourceId) });
  }
  return out;
}

// Local full-text (substring) search across chunk text of the selected collections.
export async function searchText(query, collectionIds, { limit = 30 } = {}) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const ids = (collectionIds && collectionIds.length ? collectionIds : null);
  let candidates = [];
  if (ids) {
    for (const cid of ids) candidates.push(...(await allByIndex("chunks", "collectionId", cid)));
  } else {
    const store = await tx("chunks", "readonly");
    candidates = await reqP(store.getAll());
  }
  const hits = [];
  for (const c of candidates) {
    const pos = c.text.toLowerCase().indexOf(q);
    if (pos >= 0) hits.push({ sourceId: c.sourceId, idx: c.idx, text: c.text, pos });
    if (hits.length >= limit) break;
  }
  return hits;
}
