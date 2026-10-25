// control_media play with a query: a NEW song is searched even when the agent's tab still holds the
// previous one, paused (« il remet play sur l'ancienne musique mais ne va pas chercher la nouvelle »).
import { test } from "node:test";
import assert from "node:assert/strict";

const tab = { id: 7, url: "", status: "complete" };
const played = [];
globalThis.browser = {
  tabs: {
    query: async () => [tab],
    get: async () => tab,
    update: async (_id, { url }) => { tab.url = url; return tab; },
    onUpdated: { addListener() {}, removeListener() {} },
    sendMessage: async (_id, msg) => {
      if (msg.type !== "control_media") return {};
      const u = new URL(tab.url);
      if (u.pathname === "/results") return { ok: false, watchUrl: "https://www.youtube.com/watch?v=" + u.searchParams.get("search_query").replace(/\W/g, "") };
      if (u.pathname === "/watch") { played.push(u.searchParams.get("v")); return { ok: true, playing: true }; }
      return { ok: false };
    },
  },
  scripting: { executeScript: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
const { executeTool } = await import("../src/lib/tools.js");

test("a new song is searched instead of resuming the paused one in the tab", async () => {
  tab.url = "about:blank";
  await executeTool("control_media", { action: "play", query: "premiere" });
  assert.equal(tab.url.split("&")[0], "https://www.youtube.com/watch?v=premiere");
  // The user pauses it, then asks for another song: the old one must not be restarted.
  played.length = 0;
  await executeTool("control_media", { action: "play", query: "seconde" });
  assert.equal(tab.url.split("&")[0], "https://www.youtube.com/watch?v=seconde");
  assert.deepEqual([...new Set(played)], ["seconde"]);
});

test("play again with the same query resumes the video it opened, without a new search", async () => {
  played.length = 0;
  const before = tab.url;
  await executeTool("control_media", { action: "play", query: "seconde" });
  assert.equal(tab.url, before);
  assert.deepEqual(played, ["seconde"]);
});

test("play without a query drives the media already in the tab", async () => {
  played.length = 0;
  await executeTool("control_media", { action: "play" });
  assert.deepEqual(played, ["seconde"]);
});
