// Hivey Browser's local engine, as this extension sees it.
//
// The browser owns the engine: it downloads the model, starts and stops the process, suspends it during
// a game. Three keys of `storage.local` are the whole contract (nothing here talks to a process):
//
//   hiveyAi         written ONLY by the browser: { state, progress, error, baseUrl, key, game, modelName, modelGb }
//   hiveyAiRequest  written here: { action: "download" | "start", ts }
//   hiveyAiBusy     written here: true while a model computes a turn, for the light around the address bar
//
// `hiveyAi` absent means this is not Hivey Browser, and none of this runs.

export const ENGINE_STATES = ["no-model", "downloading", "off", "starting", "running", "failed"];

/** How long the browser has to react to a request, at all. Any change of `hiveyAi` is a reaction. */
export const NO_REACTION_MS = 60000;

/** A running engine, or null. Running without an address is not running. */
export function runningEndpoint(ai) {
  return ai && ai.state === "running" && ai.baseUrl ? { baseUrl: ai.baseUrl, key: ai.key || "" } : null;
}

/**
 * What a turn has to do about the engine now:
 *   "ready"     it runs, go;
 *   "ask"       no model yet: the user must click Download (1 GB or more; never without that click);
 *   "wait"      downloading or starting: the browser is on it, watch `hiveyAi`;
 *   "start"     off, or failed earlier: ask the browser to start it.
 */
export function engineNext(ai) {
  if (runningEndpoint(ai)) return "ready";
  const state = ai && ai.state;
  if (state === "no-model") return "ask";
  if (state === "downloading" || state === "starting") return "wait";
  return "start";
}

/** Whole percent of a download, from the browser's 0..1. */
export function progressPercent(progress) {
  const p = Number(progress);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p * 100))) : 0;
}

/** Size of a model, the way the card says it: « 1,1 Go » is the UI's business, the number is ours. */
export function modelSizeGb(ai) {
  const n = Number(ai && ai.modelGb);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const abortError = () => {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
};

/**
 * The gate every local request goes through. Resolves with `{ baseUrl, key }` when the engine runs,
 * starting it if needed and waiting as long as it takes: a download takes minutes, and a process the
 * browser suspended for a game comes back when the game ends.
 *
 * `getAi()` reads the browser's latest state, `request(action)` writes `hiveyAiRequest`, `subscribe(fn)`
 * calls `fn` on every change of `hiveyAi` and returns its unsubscribe, `onState(ai)` shows the state to
 * the user (null when there is nothing left to show). Rejects when the engine failed after being asked
 * to start, when the browser does not react to a request at all, and when the signal aborts.
 */
export function createEngineGate({ getAi, request, subscribe, onState = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, noReactionMs = NO_REACTION_MS }) {
  let pending = null; // several requests of one turn share one wait, and one « start »
  let cancelWait = null;
  let waiters = 0; // when Stop leaves nobody waiting, nothing is started for nobody

  const wait = () => new Promise((resolve, reject) => {
    let asked = false; // a « start » of ours is in flight
    let before = getAi() && getAi().state;
    let reactionTimer = null;
    const stopTimer = () => { if (reactionTimer != null) clearTimer(reactionTimer); reactionTimer = null; };
    let unsubscribe = () => {};
    const finish = (fn, v) => { stopTimer(); unsubscribe(); fn(v); };
    cancelWait = () => { onState(null); finish(reject, abortError()); };
    const step = (changed) => {
      const ai = getAi();
      if (changed) stopTimer();
      const next = engineNext(ai);
      const was = before;
      before = ai && ai.state;
      if (next === "ready") { onState(null); finish(resolve, runningEndpoint(ai)); return; }
      // A start of ours that failed, or a download that did: the browser's own words, to the user.
      if (changed && ai && ai.state === "failed" && (asked || was === "downloading")) {
        onState(ai);
        const err = new Error((ai && ai.error) || "The local model could not start.");
        err.code = "engine_failed";
        finish(reject, err);
        return;
      }
      onState(ai);
      if (next === "start" && !asked) {
        asked = true;
        request("start");
        // A process suspended for a game may keep the browser from answering: no clock while it lasts.
        if (!(ai && ai.game)) {
          reactionTimer = setTimer(() => {
            const err = new Error("The browser did not start the local model.");
            err.code = "engine_no_reaction";
            finish(reject, err);
          }, noReactionMs);
        }
      } else if (next === "start" && asked && changed && ai && ai.state === "off") {
        asked = false; // the browser went back to « off » after our request: ask once more
        step(false);
      }
    };
    unsubscribe = subscribe(() => step(true));
    step(false);
  });

  return (signal) => {
    if (signal && signal.aborted) return Promise.reject(abortError());
    const ready = runningEndpoint(getAi());
    if (ready) return Promise.resolve(ready);
    if (pending) onState(getAi()); // a new turn joining the wait shows the state again
    else {
      waiters = 0;
      pending = wait().finally(() => { pending = null; cancelWait = null; });
      pending.catch(() => {});
    }
    waiters++;
    if (!signal) return pending;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(abortError());
        if (--waiters === 0 && cancelWait) cancelWait();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then(
        (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
        (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
      );
    });
  };
}
