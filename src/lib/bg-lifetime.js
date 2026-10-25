// The background does not live for ever. On Chromium it is a service worker, stopped after ~30 s
// without events and started again on the next one; Firefox suspends its event page the same way.
// Everything kept in a module variable is gone after that, and the module body runs again at every
// start. Two helpers for what must survive it.

/**
 * A periodic alarm, created only when it is missing (or its period changed). alarms.create() with
 * an existing name REPLACES the alarm and restarts its countdown — called at every start of the
 * worker, which wakes up far more often than every 15 minutes (each page load asks it something),
 * it pushed the alarm back each time and the page watch never ran.
 */
export async function ensurePeriodicAlarm(alarms, name, periodInMinutes) {
  if (!alarms || !alarms.create) return false;
  let existing = null;
  try { existing = alarms.get ? await alarms.get(name) : null; } catch (_) {}
  if (existing && existing.periodInMinutes === periodInMinutes) return false;
  await alarms.create(name, { periodInMinutes });
  return true;
}

/**
 * The on-page bubble's last request (tab, action, text), kept in storage.session so a language /
 * style change in the bubble still re-runs it after the worker was stopped in between (it used to
 * do nothing at all). storage.session lives as long as the browser session and stays in memory.
 */
const BUBBLE_KEY = "hiveyLastBubble";
export function bubbleMemory(storage) {
  let mem = null;
  const area = storage && storage.session;
  return {
    async save(b) {
      mem = b;
      try { if (area) await area.set({ [BUBBLE_KEY]: b }); } catch (_) {}
    },
    async load() {
      if (mem) return mem;
      try { if (area) mem = (await area.get(BUBBLE_KEY))[BUBBLE_KEY] || null; } catch (_) {}
      return mem;
    },
  };
}
