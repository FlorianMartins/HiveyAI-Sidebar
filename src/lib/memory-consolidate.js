// 🧠 Consolidation — Tier 2 → Tier 1 → Tier 0.
//
// What gets recalled later must be the SCHEMA, not the transcript. That is the difference between
// a memory that reconstructs and an archive that accumulates: twenty episodes saying the user
// keeps choosing Postgres should become one line saying they prefer Postgres, and the twenty
// should then fade. Without this the search space grows forever, every recall reads more
// candidates for the same answer, and the profile fills with repetition.
//
// Decay is the other half and the uncomfortable one: consolidation only pays if the sources are
// then allowed to go. So salience decays, and below a floor an episode leaves the retrieval set
// before it is purged — reversible for a while, in case the abstraction was wrong.
//
// Reinforcement runs the opposite way: an episode whose recall proved useful gets salience back.
// Between the two, what survives is what is used, not what is recent.

import { cosineToQuantised, dequantise, computeSalience, fitTier0 } from "./memory.js";

export const CLUSTER_THRESHOLD = 0.82;   // cosine, on the same embedding model as the store
export const DECAY_PER_ROUND = 0.12;
export const RETRIEVAL_FLOOR = 0.15;     // below this an episode stops being searched
export const PURGE_FLOOR = 0.05;         // below this it is deleted

/**
 * Group semantically close episodes.
 *
 * Greedy single-pass clustering seeded by the most salient episode. Not the best clustering there
 * is, but it is deterministic, it needs no parameters nobody will tune, and at a few thousand
 * episodes it takes milliseconds. A better algorithm would buy accuracy nobody can perceive on a
 * decision that is revisited every six hours anyway.
 */
export function clusterEpisodes(episodes, threshold = CLUSTER_THRESHOLD) {
  const pool = episodes.slice().sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
  const used = new Set();
  const clusters = [];
  for (const seed of pool) {
    if (used.has(seed.id)) continue;
    used.add(seed.id);
    const members = [seed];
    const seedVec = dequantise(seed.vec);
    for (const other of pool) {
      if (used.has(other.id)) continue;
      if (cosineToQuantised(seedVec, other.vec) >= threshold) { used.add(other.id); members.push(other); }
    }
    clusters.push(members);
  }
  return clusters;
}

export const CONSOLIDATE_SYSTEM =
  "You are given several memories that say related things about one user. Write ONE sentence that " +
  "captures what they have in common, in the third person, at most 160 characters.\n" +
  "Rules:\n" +
  "- State only what the memories support. Never generalise beyond them.\n" +
  "- Prefer the durable form: \"prefers X\" rather than \"chose X on Tuesday\".\n" +
  "- If they do not actually share a claim, reply exactly: NO SCHEMA.\n" +
  "- Reply with the sentence alone, nothing else.";

/**
 * A schema for a cluster, without a model where one is not needed.
 *
 * A cluster of one is already its own schema — asking a model to summarise a single sentence is
 * paying for a paraphrase. Only genuine groups are worth a call.
 */
export function trivialSchema(cluster) {
  if (cluster.length === 1) return { text: cluster[0].text, kind: cluster[0].kind };
  return null;
}

/**
 * Fold a cluster into a Tier 1 schema.
 *
 * `derivedFrom` records the sources so a schema can be audited, and so a defective extractor
 * cohort can be reconsolidated rather than the whole store purged.
 */
export async function consolidateCluster(cluster, { callModel, now = () => Date.now() } = {}) {
  const trivial = trivialSchema(cluster);
  if (trivial) {
    return { ok: true, schema: { ...trivial, derivedFrom: [cluster[0].id], ts: now(), members: 1 }, calls: 0 };
  }
  if (!callModel) return { ok: false, reason: "no model available", calls: 0 };

  let res;
  try {
    res = await callModel({
      system: CONSOLIDATE_SYSTEM,
      user: cluster.map((e, i) => `${i + 1}. ${e.text}`).join("\n"),
    });
  } catch (e) { return { ok: false, reason: String(e && e.message || e), calls: 1 }; }
  if (res?.error) return { ok: false, reason: res.error, calls: 1 };

  const text = String(res.text || "").trim();
  if (!text || /^NO SCHEMA/i.test(text)) return { ok: false, reason: "no shared claim", calls: 1 };

  // The most specific kind in the cluster wins: a preference that keeps recurring is a preference,
  // not a series of events.
  const rank = { preference: 4, decision: 3, fact: 2, affect: 1, event: 0 };
  const kind = cluster.slice().sort((a, b) => (rank[b.kind] ?? 0) - (rank[a.kind] ?? 0))[0].kind;
  return {
    ok: true,
    calls: 1,
    schema: {
      text: text.slice(0, 200),
      kind,
      derivedFrom: cluster.map((e) => e.id),
      ts: now(),
      members: cluster.length,
      // A claim supported by five episodes is more established than one supported by two.
      salience: computeSalience({ kind, repeats: cluster.length, entities: [] }),
    },
  };
}

/**
 * Decay every episode, and report what has fallen out of reach.
 *
 * Two floors, not one. Leaving the retrieval set is reversible — the episode is still there, still
 * auditable, still restorable if the abstraction that replaced it turns out to be wrong. Deletion
 * is not. Collapsing them into a single threshold would make every consolidation mistake
 * permanent.
 */
export function decay(episodes, { rate = DECAY_PER_ROUND, floor = RETRIEVAL_FLOOR, purge = PURGE_FLOOR } = {}) {
  const updated = [];
  const dormant = [];
  const purgeable = [];
  for (const e of episodes) {
    // An episode that has been recalled decays more slowly: usage is the evidence that it matters.
    const protection = Math.min(0.8, (e.recallCount || 0) * 0.2);
    const next = Math.max(0, Number((e.salience - rate * (1 - protection)).toFixed(3)));
    const out = { ...e, salience: next };
    updated.push(out);
    if (next < purge) purgeable.push(out);
    else if (next < floor) dormant.push(out);
  }
  return { updated, dormant, purgeable };
}

/**
 * Promote the strongest Tier 1 schemas into the Tier 0 profile.
 *
 * Tier 0 is what gets injected at the head of every session, so the bar is high and the budget is
 * hard. `fitTier0` drops WHOLE lines and reports them; nothing is silently cut.
 */
export function promoteToProfile(schemas, { cap } = {}) {
  const lines = schemas
    .filter((s) => (s.salience ?? 0) >= 0.5 || (s.members ?? 1) >= 3)
    .map((s) => ({ text: s.text, salience: s.salience ?? 0.5, ts: s.ts || 0 }));
  return fitTier0(lines, cap);
}

/**
 * One full consolidation round.
 *
 * Scheduled by `alarms` — never `setInterval`, which a Chromium service worker kills after about
 * thirty seconds. The budget is hard for the same reason as everywhere else here: a background
 * job that spends without a ceiling is how a free feature becomes an expensive one.
 */
export async function consolidate({ episodes, callModel, budgetCalls = 4, now = () => Date.now() }) {
  const eligible = episodes.filter((e) => (e.salience ?? 0) >= RETRIEVAL_FLOOR);
  const clusters = clusterEpisodes(eligible).filter((c) => c.length >= 2);
  const schemas = [];
  let calls = 0;
  for (const cluster of clusters) {
    if (calls >= budgetCalls) break;
    const r = await consolidateCluster(cluster, { callModel, now });
    calls += r.calls;
    if (r.ok) schemas.push(r.schema);
  }
  const { updated, dormant, purgeable } = decay(episodes);
  return { schemas, calls, clusters: clusters.length, decayed: updated, dormant, purgeable };
}
