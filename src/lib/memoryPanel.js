// 🧠 The memory panel — what was recalled, where it went, and what it cost.
//
// WHY THIS IS THE MOST IMPORTANT PIECE OF THE FEATURE
// --------------------------------------------------
// Without it, memory is a black box that talks to the user ABOUT the user without them knowing
// what it is based on. Everything else here — provenance rules, capability gates, the audit log —
// protects them from what memory might do. This is the only part that lets them SEE it.
//
// So the text is shown verbatim: not a summary of the summary, which would defeat the only
// purpose the panel has. Provenance and date come with it, because an unrecognised memory is a
// security signal and the user is the only person who can recognise one. And the token cost is
// shown, because they are BYOK — a feature that spends their money owes them the number.
//
// Collapsed by default and rendered lazily: a long conversation can accumulate dozens of these,
// and building all of them eagerly would make the very feature that is supposed to be invisible
// the reason the chat feels heavy.

import { panelRow, actionsFor, recallCost, destinationOf, statusSteps } from "./memoryUi.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * The one-line status, updated in place.
 *
 * Sequential rather than a spinner: two seconds that are announced read very differently from two
 * seconds that are merely endured. And the sending line names the destination, because that is
 * the fact the user is actually deciding about.
 */
export function createStatusLine({ host, t, name }) {
  const line = el("div", "mem-status");
  host.append(line);
  return {
    node: line,
    update({ phase, count, destination }) {
      const step = statusSteps({ phase, name, count, destination, t });
      if (!step) return;
      line.textContent = step.text;
      line.dataset.phase = phase;
    },
    remove() { line.remove(); },
  };
}

/**
 * The expandable panel for one recall.
 *
 * @param episodes  the memories actually sent, already rehydrated
 * @param sent      whether the request has already gone out — this changes what can honestly be
 *                  offered, and the panel must not pretend otherwise
 */
export function createMemoryPanel({ host, t, episodes, blockText, destination, sent = false, onDelete, onExclude, onRegenerate }) {
  const wrap = el("details", "mem-panel");
  const summary = el("summary", "mem-panel-head");

  const label = el("span", "mem-panel-title", t("mem.panel.title", { count: String(episodes.length) }));
  const cost = el("span", "mem-panel-cost", t("mem.panel.cost", { tokens: String(recallCost(blockText)) }));
  const dest = el("span", "mem-panel-dest",
    destination?.local ? t("mem.panel.local") : t("mem.panel.sentTo", { provider: destination?.label || "" }));
  summary.append(label, dest, cost);
  wrap.append(summary);

  let built = false;
  // Lazily built: dozens of these in a long conversation would cost real layout work for panels
  // nobody opened.
  wrap.addEventListener("toggle", () => {
    if (!wrap.open || built) return;
    built = true;
    const body = el("div", "mem-panel-body");
    for (const e of episodes) {
      const row = panelRow(e);
      const item = el("div", "mem-row");
      if (row.excluded) item.classList.add("mem-row-off");

      // Verbatim. Paraphrasing here would defeat the only purpose the panel has.
      item.append(el("div", "mem-row-text", row.text));

      const meta = el("div", "mem-row-meta");
      meta.append(el("span", "mem-prov", t("mem.panel.provenance", { provenance: row.provenance })));
      meta.append(el("span", "mem-date", row.date));
      meta.append(el("span", "mem-tok", `${row.tokens}t`));
      item.append(meta);

      const acts = el("div", "mem-row-acts");
      const can = actionsFor({ sent });
      if (can.canExclude) {
        // "Not now" is not "never". Without this, people delete perfectly good memories to keep
        // them out of one conversation — a permanent loss for a momentary reason.
        const ex = el("button", "mem-act", t("mem.panel.excludeTurn"));
        ex.addEventListener("click", () => {
          item.classList.toggle("mem-row-off");
          onExclude?.(row.id, item.classList.contains("mem-row-off"));
        });
        acts.append(ex);
      }
      const del = el("button", "mem-act mem-act-del", t("mem.panel.delete"));
      del.addEventListener("click", async () => {
        if (!confirm(t("mem.panel.deleteConfirm"))) return;
        await onDelete?.(row.id);
        item.classList.add("mem-row-gone");
        del.disabled = true;
      });
      acts.append(del);
      item.append(acts);
      body.append(item);
    }

    if (actionsFor({ sent }).offerRegenerate) {
      // Honest about what cannot be undone. The request has already left; deleting a memory now
      // changes the next answer, not this one. Offering "undo" here would be a lie the user only
      // discovers later.
      const note = el("p", "mem-panel-note", t("mem.panel.alreadySent"));
      body.append(note);
      const again = el("button", "mem-act mem-act-again", t("mem.panel.regenerate"));
      again.addEventListener("click", () => onRegenerate?.());
      body.append(again);
    }
    wrap.append(body);
  });

  host.append(wrap);
  return { node: wrap, open() { wrap.open = true; } };
}

export { destinationOf };
