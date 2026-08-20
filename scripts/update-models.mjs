#!/usr/bin/env node
// Daily model auto-updater.
//
// Goal: keep the curated OpenRouter model list in `src/lib/models.js` fresh —
// automatically ADD newly released models and DROP ones a provider has removed —
// without any human editing. The sidebar already fetches each account's LIVE list
// at runtime; this script maintains the committed FALLBACK / out-of-the-box default
// so a brand-new install (and the build) reflects what currently exists.
//
// How: fetch OpenRouter's public /models catalogue (no key needed), rank a bounded,
// readable subset (free models first, then notable paid flagships, plus image
// models), then splice it between the <models:openrouter:*> markers in models.js.
// Prints an ADDED/REMOVED diff. Run by .github/workflows/update-models.yml daily;
// the workflow commits the diff if anything changed.
//
// Usage:
//   node scripts/update-models.mjs            # update models.js in place
//   node scripts/update-models.mjs --check    # exit 1 if it WOULD change (CI dry-run)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_FILE = join(__dirname, "..", "src", "lib", "models.js");
const HIVEY_FILE = join(__dirname, "..", "src", "lib", "hivey-models.js");
const API = "https://openrouter.ai/api/v1/models";

const CHECK_ONLY = process.argv.includes("--check");

// Ranked preference for FREE models (most capable / dependable first). Anything
// free not listed here is still included afterwards (alphabetically), up to the cap.
const FREE_PREF = [
  // Llama 3.3 70B first = the chat default (well-rounded, strong FR). gpt-oss kept
  // returning HTTP 400 so it's demoted; Gemma 4 stays high (Program Generator default).
  "llama-3.3-70b",
  "gemma-4-31b", "gemma-4",
  "gpt-oss-120b", "gpt-oss-20b",
  "deepseek-chat-v3", "deepseek-v3", "deepseek-r1",
  "llama-4-maverick", "llama-4-scout",
  "qwen3", "qwen-2.5", "qwen2.5",
  "nemotron", "gemini-2.0-flash", "gemma-3", "gemma-2",
  "mistral", "phi-4",
];
// PAID flagships: which VENDORS to surface, in display order — NEVER which versions.
// Pinning versions (the old "openai/gpt-4o", "google/gemini-2.5-pro"…) meant a brand-new
// release could never enter the list on its own: GPT-5.6, Claude Sonnet 5 and Grok 4.5 all
// shipped while the fallback still advertised GPT-4o. We now take each vendor's NEWEST
// flagships straight from the catalogue, so new releases are picked up with zero edits.
const PAID_VENDORS = ["anthropic", "openai", "google", "x-ai", "deepseek", "qwen", "mistralai", "z-ai", "moonshotai"];
const PER_VENDOR = 3; // newest flagships kept per vendor
const FREE_CAP = 18;
const PAID_CAP = 27;
// No cap on image models: there are ~9 real ones in the whole catalogue, the picker is
// searchable, and truncating a list that short only ever hides a model somebody wanted. The chat
// lists stay capped because those run to hundreds of entries.
const IMAGE_CAP = Infinity;

// Small/cheap variants — kept, but never allowed to displace a vendor's flagship.
// The token must start at a separator: without that, "mini" matches inside "ge-MINI-2.5-pro"
// and every Gemini flagship gets demoted as a "small" model (it did — Gemma outranked Gemini).
const SMALL = /(?:^|[-_/])(mini|nano|lite|small|tiny|haiku|8b|4b|3b|1b)\b/i;
// Builds we never advertise as a default: experimental, pinned date snapshots ("…-20260420",
// superseded by the moving id), agent-only / research-only SKUs.
// "-fast" is a routing SKU of a model already listed — keep the canonical one in the fallback.
// ":batch" is the asynchronous batch-API SKU of a model already listed: it is cheaper because
// the answer arrives later, which is the one thing an interactive sidebar cannot use.
const NOT_DEFAULT = /preview|-exp\b|experimental|multi-agent|deep-research|search-preview|:online|:batch\b|-20\d{6}\b|-fast$/i;
// Open-weights families: they belong in the FREE section (that's how people use them), not
// among a vendor's paid flagships — otherwise Gemma outranks Gemini in Google's own slot.
const OPEN_WEIGHTS = /gemma|gpt-oss|llama|qwen[23]-|mistral-7b/i;

function prettify(id) {
  const tail = id.split("/")[1] || id;
  return tail
    .replace(/:free$/, "")
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
function isFree(m) {
  const p = parseFloat((m.pricing && m.pricing.prompt) || "0");
  const c = parseFloat((m.pricing && m.pricing.completion) || "0");
  return !p && !c;
}
function outMods(m) {
  const out = (m.architecture && m.architecture.output_modalities) || [];
  return Array.isArray(out) ? out : [];
}
function canImage(m) { return outMods(m).includes("image"); }
// A "chat" model produces text. Excludes image-only / audio (music) / safety models
// that share the catalogue so they don't pollute the chat dropdown.
function isChat(m) {
  const out = outMods(m);
  if (out.length && !out.includes("text")) return false;       // image/audio-only
  if (/lyria|whisper|tts|embedding|content-safety|moderation|image/i.test(m.id)) return false;
  return true;
}
// Prefer OpenRouter's own display name ("Vendor: Model") → keep the model part.
function niceName(m) {
  let n = m.name ? (m.name.includes(": ") ? m.name.split(": ").slice(1).join(": ") : m.name) : prettify(m.id);
  return n.replace(/\s*\(free\)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}
function isReasoning(id) {
  return /(^|[-/])(o3|o1|r1|reasoning|thinking|deepseek-r1)/i.test(id);
}
function rankBy(prefList, id) {
  const lid = id.toLowerCase();
  for (let i = 0; i < prefList.length; i++) if (lid.includes(prefList[i])) return i;
  return prefList.length + 1;
}
function esc(s) { return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function renderPairs(pairs, indent) {
  return pairs.map(([id, label]) => `${indent}["${esc(id)}", "${esc(label)}"],`).join("\n");
}

// Newest-first, flagships before their small siblings (a vendor's "mini" must never hide
// the model people actually came for).
function byNewestFlagship(a, b) {
  const fa = SMALL.test(a.id) ? 1 : 0, fb = SMALL.test(b.id) ? 1 : 0;
  // On a tie (a vendor shipping "x" and "x-fast" the same day), the plain model is the default.
  const xa = /-fast$/.test(a.id) ? 1 : 0, xb = /-fast$/.test(b.id) ? 1 : 0;
  return fa - fb || (b.created || 0) - (a.created || 0) || xa - xb;
}

// The PAID fallback list: each vendor's newest flagships, vendors in PAID_VENDORS order.
// Version-agnostic by construction — a GPT-5.7 or Claude Opus 5 lands here the day it ships.
function pickFlagships(paid) {
  const out = [];
  for (const v of PAID_VENDORS) {
    const mine = paid
      .filter((m) => m.id.startsWith(v + "/") && !NOT_DEFAULT.test(m.id) && !OPEN_WEIGHTS.test(m.id))
      .sort(byNewestFlagship)
      .slice(0, PER_VENDOR);
    out.push(...mine);
  }
  return out.slice(0, PAID_CAP);
}

// ---- NATIVE provider catalogues (OpenAI / Anthropic / Google / xAI direct APIs) --------
// These lists used to be hand-written and rotted badly (OpenAI still offered "GPT-4o" long
// after GPT-5.6 shipped). We now DERIVE them from the same OpenRouter catalogue — it carries
// every vendor's releases with dates — and map the id back to the vendor's own naming.
// The sidebar still queries each provider's live /models with the user's key at runtime and
// PREFERS that; this is the out-of-the-box default (and the fallback when /models is blocked).
const NATIVE = {
  anthropic: {
    vendor: "anthropic",
    // OpenRouter "anthropic/claude-opus-4.8" → Anthropic API "claude-opus-4-8" (dots→dashes).
    toNative: (id) => id.split("/")[1].replace(/\./g, "-"),
    // "-fast" is an OpenRouter routing SKU, not an Anthropic model id.
    skip: /-fast$/i,
    cap: 5,
  },
  openai: {
    vendor: "openai",
    toNative: (id) => id.split("/")[1],
    // gpt-oss = open-weights (not served by the OpenAI API); the rest aren't chat models.
    skip: /gpt-oss|image|audio|realtime|tts|whisper|embed|moderation|codex/i,
    cap: 6,
  },
  google: {
    vendor: "google",
    toNative: (id) => id.split("/")[1],
    // Gemma is open-weights, not a Gemini-API model id.
    skip: /gemma|lyria|image|embed|veo/i,
    cap: 5,
  },
  xai: {
    vendor: "x-ai",
    toNative: (id) => id.split("/")[1],
    skip: /image|build/i,
    cap: 4,
  },
};

// A vendor's newest models for its NATIVE dropdown, plus one cheap/fast option so the list
// isn't all-flagship (people want a "mini" for throwaway work).
function nativePairs(all, cfg) {
  const pool = all.filter(
    (m) => m.id.startsWith(cfg.vendor + "/") && isChat(m) && !isFree(m)
      && !NOT_DEFAULT.test(m.id) && !cfg.skip.test(m.id),
  );
  const picked = pool.filter((m) => !SMALL.test(m.id)).sort(byNewestFlagship).slice(0, cfg.cap);
  const cheap = pool.filter((m) => SMALL.test(m.id)).sort((a, b) => (b.created || 0) - (a.created || 0))[0];
  if (cheap && !picked.includes(cheap)) picked.push(cheap);
  return picked.map((m) => [cfg.toNative(m.id), niceName(m) + (isReasoning(m.id) ? " (reasoning)" : "")]);
}

// Replace the lines BETWEEN two single-line markers (the marker lines stay intact).
// Both markers must each sit on their own line, directly bracketing the array.
function spliceMarkers(src, startMark, endMark, body) {
  const s = src.indexOf(startMark);
  const e = src.indexOf(endMark);
  if (s < 0 || e < 0 || e < s) throw new Error(`Markers not found: ${startMark} .. ${endMark}`);
  const afterStartLine = src.indexOf("\n", s) + 1;   // first char after the start-marker line
  const endLineStart = src.lastIndexOf("\n", e) + 1; // first char of the end-marker line
  return src.slice(0, afterStartLine) + body + "\n" + src.slice(endLineStart);
}
// Pull the existing ids inside a marker block, for the diff.
function idsInBlock(src, startMark, endMark) {
  const s = src.indexOf(startMark), e = src.indexOf(endMark);
  if (s < 0 || e < 0) return [];
  const block = src.slice(s, e);
  return [...block.matchAll(/\["([^"]+)",/g)].map((m) => m[1]);
}
// Existing id → label inside a block. Used to PRESERVE the 🐝 Hivey rows' labels: they are
// product naming (Pro / Smart / Free), not catalogue data, so a regeneration must not rename
// what the user sees in the picker.
function labelsInBlock(src, startMark, endMark) {
  const s = src.indexOf(startMark), e = src.indexOf(endMark);
  const map = new Map();
  if (s < 0 || e < 0) return map;
  for (const m of src.slice(s, e).matchAll(/\["([^"]+)",\s*"([^"]*)"\]/g)) map.set(m[1], m[2]);
  return map;
}

// 🐝 Hivey auto-curation — KEY-FREE & automatic. For each role, bump the assigned model to
// the NEWEST release of the SAME model family available in the catalogue (e.g. Gemini 2.5
// Flash → 3.5 Flash, Claude Opus 4.8 → 4.9). It only follows the SAME line (conservative,
// never a risky cross-family jump), so Hivey gets more powerful on its own when providers
// ship new versions — no API key, no benchmark feed needed. Writes src/lib/hivey-models.js.

// The "family stem" of a model id: drop pure version / size / date tokens, keep the
// descriptive name. "google/gemini-2.5-flash"→"google/gemini-flash",
// "anthropic/claude-opus-4.8"→"anthropic/claude-opus", "qwen/qwq-32b"→"qwen/qwq".
function modelStem(id) {
  const [prov, ...rest] = id.split("/");
  const name = rest.join("/").replace(/:free$/, "");
  const keep = name.split("-").filter((tk) =>
    !/^v?\d+(\.\d+)*$/.test(tk) &&   // 3, 4.8, v3.1, 2.5
    !/^\d+(\.\d+)?[bkm]$/i.test(tk) && // 32b, 120b, 1.2b
    !/^a\d+[bkm]$/i.test(tk) &&        // a3b, a12b (MoE active params)
    !/^\d{6,}$/.test(tk) &&            // 20260420, 0528 (date/build)
    !/^(preview|latest)$/i.test(tk),
  );
  return `${prov}/${keep.join("-")}`;
}

function curateHivey(all) {
  let current, srcText;
  try {
    srcText = readFileSync(HIVEY_FILE, "utf8");
    const start = srcText.indexOf("{", srcText.indexOf("HIVEY_MODELS"));
    const objText = srcText.slice(start, srcText.lastIndexOf("}") + 1);
    current = new Function(`return (${objText});`)(); // our own file — handles JS object literal
  } catch (e) {
    console.log("🐝 curation: cannot read hivey-models.js —", e.message);
    return;
  }

  // Newest model per (stem, free/paid) — exclude preview/experimental builds.
  const newest = { free: new Map(), paid: new Map() };
  const byId = new Map();
  for (const m of all) {
    byId.set(m.id, m);
    if (/preview|-exp\b|experimental/i.test(m.id)) continue;
    const bucket = /:free$/.test(m.id) ? newest.free : newest.paid;
    const s = modelStem(m.id);
    const cur = bucket.get(s);
    if (!cur || (m.created || 0) > (cur.created || 0)) bucket.set(s, m);
  }
  const outPrice = (m) => (m && m.pricing && +m.pricing.completion ? +m.pricing.completion * 1e6 : 0);

  // ── Rescuing a model id that VANISHED from the catalogue ─────────────────────
  // The same-family bump above can only promote a NEWER SIBLING. When a provider
  // retires a model outright and ships no successor under the same stem, there is
  // no sibling to promote — and the old code then kept the dead id ("gone but no
  // same-family replacement"). Every request to that role answered HTTP 404, which
  // is exactly how the whole Free variant died: 3 of its 4 model ids no longer
  // existed. A dead id is not something to preserve, so we re-pick across families.
  //
  // The replacement is chosen per ROLE, because the roles are not interchangeable:
  // the image role needs a model that can OUTPUT an image, the agent role needs
  // tool-calling, and the cheap roles exist precisely to not burn a flagship.
  const ROLE_NEEDS = {
    image: { outputs: "image" },
    vision: { accepts: "image" },
    code: { prefer: /cod(e|er|ing)|devstral|laguna|seed-.*code/i },
    test: { prefer: /cod(e|er|ing)|devstral|laguna|seed-.*code/i },
    agent: { tools: true, prefer: /cod(e|er|ing)|devstral|laguna/i },
    router: { cheap: true }, utility: { cheap: true }, light: { cheap: true },
    extract: { cheap: true }, verify: { cheap: true },
    reasoning: { strong: true }, math: { strong: true },
  };

  const modalities = (m, dir) => (m.architecture && m.architecture[dir]) || [];
  const supports = (m, p) => (m.supported_parameters || []).includes(p);

  function pickReplacement(role, wantFree) {
    const need = ROLE_NEEDS[role] || {};
    const pool = all.filter((m) => {
      if (/^~/.test(m.id)) return false;                    // moving aliases: not a stable id to commit
      if (/preview|-exp\b|experimental/i.test(m.id)) return false;
      if (wantFree !== /:free$/.test(m.id)) return false;
      if (need.outputs && !modalities(m, "output_modalities").includes(need.outputs)) return false;
      if (need.accepts && !modalities(m, "input_modalities").includes(need.accepts)) return false;
      if (need.tools && !supports(m, "tools")) return false;
      // Every text role must actually be able to answer in text.
      if (!need.outputs && !modalities(m, "output_modalities").includes("text")) return false;
      return true;
    });
    if (!pool.length) return null;

    const price = (m) => outPrice(m);
    const maxCtx = Math.max(...pool.map((m) => m.context_length || 0), 1);
    const newest = Math.max(...pool.map((m) => m.created || 0), 1);
    // A code-specialised model is a poor general assistant, and vice versa. Without this
    // penalty "north-mini-code" won the router/utility/light roles purely because "mini"
    // read as small-and-cheap — a code model answering small talk in six languages.
    const CODEY = /cod(e|er|ing)|devstral|laguna|seed-.*code|starcoder/i;
    const score = (m) => {
      let s = 0;
      if (need.prefer && need.prefer.test(m.id)) s += 5;
      else if (CODEY.test(m.id)) s -= 4;
      // Context is capability you can measure — but only where the role uses it. The router
      // classifies one sentence into one word; a million-token window buys it nothing, while
      // the latency of a reasoning model buys it a visible pause before every single answer.
      s += (need.cheap ? 0.5 : 2) * ((m.context_length || 0) / maxCtx);
      s += 1.5 * ((m.created || 0) / newest);               // recency, but never the only criterion
      if (need.cheap) {
        s += SMALL.test(m.id) ? 1.5 : 0;                    // cheap roles WANT the small model
        if (/reasoning|thinking/i.test(m.id)) s -= 3;       // …and want it to answer, not deliberate
      }
      if (need.strong) s += SMALL.test(m.id) ? -1.5 : 1;
      if (!wantFree) s += need.cheap ? -0.5 * Math.min(price(m) / 5, 2) : 0.3 * Math.min(price(m) / 5, 2);
      return s;
    };
    return pool.sort((a, b) => score(b) - score(a))[0];
  }

  const merged = {};
  let changes = 0;
  const dead = [];
  for (const variant of Object.keys(current)) {
    merged[variant] = {};
    for (const role of Object.keys(current[variant])) {
      const cur = current[variant][role];
      const isFree = /:free$/.test(cur);
      const cand = (isFree ? newest.free : newest.paid).get(modelStem(cur));
      const curM = byId.get(cur);
      const newer = cand && cand.id !== cur && (cand.created || 0) > (curM ? curM.created || 0 : 0);
      // Sanity guard: don't let a bump multiply the price by >5× (avoids freak jumps).
      const sane = cand && (!curM || outPrice(cand) <= Math.max(outPrice(curM) * 5, 0.5) || outPrice(curM) === 0);
      if (newer && sane) {
        merged[variant][role] = cand.id;
        changes++;
        console.log(`🐝 ${variant}.${role}: ${cur} → ${cand.id}`);
      } else if (!curM) {
        // The id is GONE from the catalogue and no sibling replaced it.
        const rescue = pickReplacement(role, isFree);
        dead.push(`${variant}.${role} = ${cur}`);
        if (rescue) {
          merged[variant][role] = rescue.id;
          changes++;
          console.log(`💀 ${variant}.${role}: ${cur} NO LONGER EXISTS → ${rescue.id}`);
        } else {
          merged[variant][role] = cur;
          console.log(`💀 ${variant}.${role}: ${cur} NO LONGER EXISTS and nothing fits this role.`);
        }
      } else {
        merged[variant][role] = cur; // already the newest of its family
      }
    }
  }
  if (dead.length) console.log(`💀 ${dead.length} dead model id(s) found: ${dead.join(", ")}`);
  if (!changes) {
    console.log("🐝 Hivey auto-curation: every role already on the newest model of its family.");
    return dead.length;
  }
  if (CHECK_ONLY) {
    console.log(`🐝 Hivey auto-curation WOULD bump ${changes} assignment(s).`);
    return dead.length;
  }
  const header = srcText.split("// <hivey:start>")[0];
  writeFileSync(HIVEY_FILE, `${header}// <hivey:start>\nexport const HIVEY_MODELS = ${JSON.stringify(merged, null, 2)};\n// <hivey:end>\n`);
  console.log(`✓ hivey-models.js auto-curated (${changes} bump(s)).`);
  return dead.length;
}

async function main() {
  const res = await fetch(API, { headers: { "user-agent": "firefox-ai-sidebar-model-updater" } });
  if (!res.ok) throw new Error(`OpenRouter /models HTTP ${res.status}`);
  const json = await res.json();
  const all = (json.data || []).filter((m) => m && m.id);
  if (!all.length) throw new Error("OpenRouter returned an empty model list");

  // ----- Curate the chat list (text-producing models only) -----
  const chat = all.filter(isChat);
  const free = chat.filter(isFree);
  const paid = chat.filter((m) => !isFree(m));

  // Free: preferred families first, then NEWEST — so a fresh free model surfaces on its own.
  free.sort((a, b) =>
    rankBy(FREE_PREF, a.id) - rankBy(FREE_PREF, b.id) || (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id));
  const freePick = free.slice(0, FREE_CAP);

  const paidPick = pickFlagships(paid);

  const chatPairs = [];
  // 🐝 Pin the Hivey smart-routing pseudo-models at the very top — they aren't real catalogue
  // models, so they'd otherwise be stripped on every regeneration. Their LABELS are product
  // naming: keep whatever models.js currently says (Pro / Smart / Free) instead of renaming them.
  const keepLabels = labelsInBlock(
    readFileSync(MODELS_FILE, "utf8"), "<models:openrouter:start>", "<models:openrouter:end>");
  const hiveyRow = (id, fallback) => chatPairs.push([id, keepLabels.get(id) || fallback]);
  hiveyRow("hivey/smart", "✨ Pro — top models per specialty + max reasoning");
  hiveyRow("hivey/hybrid", "⚡ Smart — best quality/price (powerful + cheaper mix)");
  hiveyRow("hivey/free", "🎁 Free — rotates the best free models");
  freePick.forEach((m, i) => {
    const r = isReasoning(m.id) ? " (reasoning)" : "";
    const rec = i === 0 ? " (recommended)" : "";
    chatPairs.push([m.id, `${niceName(m)} — free${r}${rec}`]);
  });
  paidPick.forEach((m) => {
    const r = isReasoning(m.id) ? " (reasoning)" : "";
    chatPairs.push([m.id, `${niceName(m)}${r} (paid)`]);
  });

  // ----- Curate the image list -----
  // Same discipline as the paid chat list, which the image list had never been given:
  //  * NOT_DEFAULT excluded — "gemini-3-pro-image" and "gemini-3-pro-image-preview" are the same
  //    model, and with a cap of 8 each duplicate cost a real alternative its slot (three did).
  //  * the family preference names FAMILIES, never versions. The old ranking pinned
  //    "gemini-2.5-flash-image" to the top, so a 2.5-era model still headed the picker long after
  //    3.1 shipped — the exact rot the paid list's comment warns about, in the one list that had
  //    not been converted.
  const IMAGE_FAMILIES = ["gemini", "gpt-image", "flux", "dall", "grok", "imagen"];
  // "openrouter/auto*" reports an image output because it can ROUTE to an image model; it is a
  // meta-model, not something to offer in a picker of image generators.
  // Everything that can actually GENERATE an image, preview builds included — a preview is a real
  // model somebody may want, and for image models it is often where the newest capability lands
  // first. Two things are still excluded, because neither is an image generator you can pick:
  // "openrouter/auto*" (a meta-router that merely CAN route to one) and dated snapshots, which are
  // duplicates of the moving id under another name.
  const imgModels = all.filter((m) =>
    canImage(m) && !/^openrouter\//.test(m.id) && !/-20\d{6}\b|:batch\b|:online/.test(m.id));
  imgModels.sort((a, b) =>
    rankBy(IMAGE_FAMILIES, a.id) - rankBy(IMAGE_FAMILIES, b.id)
    || (SMALL.test(a.id) ? 1 : 0) - (SMALL.test(b.id) ? 1 : 0)  // a "lite" must not head its own family
    || (b.created || 0) - (a.created || 0)                       // then newest first
    || a.id.localeCompare(b.id));
  const imagePairs = imgModels.slice(0, IMAGE_CAP).map((m) => [m.id, niceName(m)]);

  // ----- Splice into models.js -----
  let src = readFileSync(MODELS_FILE, "utf8");
  const beforeChatIds = idsInBlock(src, "<models:openrouter:start>", "<models:openrouter:end>");
  const beforeImgIds = idsInBlock(src, "<models:openrouter:image:start>", "<models:openrouter:image:end>");

  const chatBody = "    models: [\n" + renderPairs(chatPairs, "      ") + "\n    ],";
  const imageBody = "    imageModels: [\n" + renderPairs(imagePairs, "      ") + "\n    ],";

  let out = src;
  out = spliceMarkers(out, "<models:openrouter:image:start>", "<models:openrouter:image:end>", imageBody);
  out = spliceMarkers(out, "<models:openrouter:start>", "<models:openrouter:end>", chatBody);

  // ----- Native provider catalogues (direct APIs, not OpenRouter) -----
  const beforeNative = [];
  const afterNative = [];
  for (const [pid, cfg] of Object.entries(NATIVE)) {
    const pairs = nativePairs(all, cfg);
    if (!pairs.length) { console.log(`(native ${pid}: no candidate — left untouched)`); continue; }
    const s = `<models:${pid}:start>`, e = `<models:${pid}:end>`;
    if (out.indexOf(s) < 0) { console.log(`(native ${pid}: markers absent — skipped)`); continue; }
    beforeNative.push(...idsInBlock(out, s, e).map((id) => `${pid}:${id}`));
    afterNative.push(...pairs.map(([id]) => `${pid}:${id}`));
    out = spliceMarkers(out, s, e, "    models: [\n" + renderPairs(pairs, "      ") + "\n    ],");
  }

  const changed = out !== src;
  const newChatIds = [...chatPairs.map((p) => p[0]), ...afterNative];
  const newImgIds = imagePairs.map((p) => p[0]);
  const beforeAll = [...beforeChatIds, ...beforeImgIds, ...beforeNative];
  const added = [...newChatIds, ...newImgIds].filter((id) => !beforeAll.includes(id));
  const removed = beforeAll.filter((id) => ![...newChatIds, ...newImgIds].includes(id));

  console.log(`OpenRouter catalogue: ${all.length} models (${free.length} free).`);
  console.log(`Curated: ${chatPairs.length} chat + ${imagePairs.length} image.`);
  if (added.length) console.log("ADDED:\n  " + added.join("\n  "));
  if (removed.length) console.log("REMOVED:\n  " + removed.join("\n  "));
  if (!added.length && !removed.length) console.log("No model changes.");

  // 🐝 Re-curate the Hivey per-role model assignments against the fresh catalogue.
  await curateHivey(all);

  if (CHECK_ONLY) {
    if (changed) { console.error("models.js is out of date (run without --check)."); process.exit(1); }
    return;
  }
  if (changed) { writeFileSync(MODELS_FILE, out); console.log("✓ models.js updated."); }
  else console.log("✓ models.js already up to date.");
}

main().catch((e) => { console.error("update-models failed:", e.message); process.exit(1); });
