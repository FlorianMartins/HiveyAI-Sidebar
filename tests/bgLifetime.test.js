// The background is stopped and started again (Chromium service worker, Firefox event page): what
// must survive it, and the Chromium manifest's parity with Firefox for opening the panel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensurePeriodicAlarm, bubbleMemory } from "../src/lib/bg-lifetime.js";

function fakeAlarms() {
  const all = new Map();
  let creates = 0;
  return {
    async get(name) { return all.get(name); },
    async create(name, info) { creates++; all.set(name, { name, scheduledTime: Date.now() + info.periodInMinutes * 60000, ...info }); },
    get creates() { return creates; },
  };
}

test("the page-watch alarm is created once — a worker restart no longer pushes it back", async () => {
  const alarms = fakeAlarms();
  assert.equal(await ensurePeriodicAlarm(alarms, "hiveyPageWatch", 15), true);
  const first = await alarms.get("hiveyPageWatch");
  for (let i = 0; i < 5; i++) assert.equal(await ensurePeriodicAlarm(alarms, "hiveyPageWatch", 15), false);
  assert.equal(alarms.creates, 1);
  assert.equal((await alarms.get("hiveyPageWatch")).scheduledTime, first.scheduledTime);
});

test("a changed period replaces the alarm", async () => {
  const alarms = fakeAlarms();
  await ensurePeriodicAlarm(alarms, "w", 15);
  assert.equal(await ensurePeriodicAlarm(alarms, "w", 30), true);
  assert.equal((await alarms.get("w")).periodInMinutes, 30);
});

test("no alarms API → nothing happens", async () => {
  assert.equal(await ensurePeriodicAlarm(undefined, "w", 15), false);
});

test("the bubble's last request survives a restart of the background (storage.session)", async () => {
  const data = {};
  const storage = { session: { async set(o) { Object.assign(data, o); }, async get(k) { return { [k]: data[k] }; } } };
  await bubbleMemory(storage).save({ tabId: 7, action: "translate", text: "Hello" });
  // A fresh module instance, as after the worker was stopped: memory is empty, storage is not.
  assert.deepEqual(await bubbleMemory(storage).load(), { tabId: 7, action: "translate", text: "Hello" });
  assert.equal(await bubbleMemory({ session: { async get() { return {}; } } }).load(), null);
  // Without storage.session it still works for the life of the worker.
  const m = bubbleMemory({});
  await m.save({ tabId: 1 });
  assert.deepEqual(await m.load(), { tabId: 1 });
});

test("Chromium opens the panel with Ctrl+Shift+Y, like Firefox", () => {
  const ff = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));
  const cr = JSON.parse(readFileSync(new URL("../manifest.chrome.json", import.meta.url)));
  assert.equal(ff.commands._execute_sidebar_action.suggested_key.default, "Ctrl+Shift+Y");
  assert.equal(cr.commands._execute_action.suggested_key.default, "Ctrl+Shift+Y");
});

test("the slim Firefox scrollbar rules stay out of Chromium (they override ::-webkit-scrollbar there)", () => {
  const css = readFileSync(new URL("../src/sidebar/sidebar.css", import.meta.url), "utf8").replace(/\r\n/g, "\n"); // Windows checkouts
  const block = css.indexOf("@supports (-moz-orient: inline)");
  assert.ok(block >= 0);
  const outside = css.slice(0, block) + css.slice(css.indexOf("}\n}", block) + 3);
  assert.doesNotMatch(outside, /scrollbar-(width|color)\s*:\s*thin|scrollbar-color:\s*color-mix/);
  assert.match(css, /::-webkit-scrollbar-thumb/);
});
