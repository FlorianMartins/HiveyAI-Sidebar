// The Web tab embeds provider sites. Three lists have to agree for a provider to work: the rule
// that strips its anti-framing headers, the bridge content script that runs inside the frame (and
// tells the sidebar the page really loaded), and the guard that keeps the agent away from those
// signed-in tabs. Copilot broke when copilot.microsoft.com started redirecting to copilot.com and
// only one of the three knew the new host — the frame showed « Firefox ne peut pas ouvrir cette
// page ». These tests make that drift fail here instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isWebChatUrl } from "../src/lib/memory-policy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));

const RULE_DOMAINS = json("rules/frame-unblock.json")[0].condition.requestDomains;
const bridgeMatches = (manifest) =>
  json(manifest).content_scripts.find((c) => c.js.some((j) => j.endsWith("webchat-bridge.js"))).matches;
// The URLs the Web tab's provider menu opens.
const MENU_URLS = [...readFileSync(join(ROOT, "src/sidebar/sidebar.html"), "utf8").matchAll(/class="wc-opt"[^>]*data-url="([^"]+)"/g)].map((m) => m[1]);
const covered = (host, domains) => domains.some((d) => host === d || host.endsWith("." + d));

test("every provider in the Web menu can be framed, bridged and is off limits to the agent", () => {
  assert.ok(MENU_URLS.length >= 10, "the provider menu was found");
  for (const u of MENU_URLS) {
    const host = new URL(u).hostname;
    assert.ok(covered(host, RULE_DOMAINS), `${host}: its anti-framing headers are stripped`);
    for (const m of ["manifest.json", "manifest.chrome.json"]) {
      const hosts = bridgeMatches(m).map((p) => new URL(p.replace("*.", "")).hostname);
      assert.ok(covered(host, hosts), `${host}: the bridge runs inside the frame (${m})`);
    }
    assert.equal(isWebChatUrl(u), true, `${host}: the agent may not act on it`);
  }
});

test("Copilot's new home (copilot.com) is framed, bridged and guarded like copilot.microsoft.com", () => {
  assert.ok(covered("copilot.com", RULE_DOMAINS));
  for (const m of ["manifest.json", "manifest.chrome.json"]) assert.ok(bridgeMatches(m).includes("https://copilot.com/*"), m);
  assert.equal(isWebChatUrl("https://copilot.com/chats/abc"), true);
});

test("every bridged host is also unblocked — a bridge in a frame the browser refuses is useless", () => {
  for (const m of ["manifest.json", "manifest.chrome.json"]) {
    for (const p of bridgeMatches(m)) {
      const host = new URL(p.replace("*.", "")).hostname;
      assert.ok(covered(host, RULE_DOMAINS), `${host} (${m})`);
    }
  }
});
