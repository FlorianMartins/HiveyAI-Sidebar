// Keyboard shortcuts: what a key press becomes, what the sidebar runs, what the settings page warns
// about. The sidebar and the settings page share these functions, so a combo recorded on one side
// is the combo matched on the other.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHORTCUT_ACTIONS, defaultShortcuts, comboFromEvent, normalizeCombo, isBindable,
  actionForCombo, isReservedCombo, findConflicts, comboKeys, isMacPlatform,
} from "../src/lib/shortcuts.js";

const ev = (key, code, mods = {}) => ({ key, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

test("Ctrl+Shift+1 is \"Ctrl+Shift+1\" whatever the layout prints for Shift+1", () => {
  // US QWERTY: Shift+1 prints "!" — the old recorder stored "Ctrl+Shift+!" and the default
  // Ctrl+Shift+1 never fired. AZERTY: Shift+& prints "1".
  assert.equal(comboFromEvent(ev("!", "Digit1", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+1");
  assert.equal(comboFromEvent(ev("1", "Digit1", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+1");
  assert.equal(comboFromEvent(ev("#", "Digit3", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+3");
});

test("a letter is the letter typed, or the physical key when the layout types something else", () => {
  assert.equal(comboFromEvent(ev("y", "KeyZ", { ctrlKey: true })), "Ctrl+Y"); // QWERTZ: the letter wins
  assert.equal(comboFromEvent(ev("˜", "KeyN", { altKey: true })), "Alt+N"); // Mac: Alt+N types a dead tilde
  assert.equal(comboFromEvent(ev("т", "KeyN", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+N"); // Cyrillic
  assert.equal(comboFromEvent(ev(" ", "Space", { ctrlKey: true })), "Ctrl+Space");
});

test("a modifier alone is not a combo, and plain typing is never bindable", () => {
  assert.equal(comboFromEvent(ev("Control", "ControlLeft", { ctrlKey: true })), "");
  assert.equal(comboFromEvent(ev("Shift", "ShiftLeft", { shiftKey: true })), "");
  assert.equal(isBindable("Shift+A"), false);
  assert.equal(isBindable("A"), false);
  assert.equal(isBindable("Ctrl+A"), true);
  assert.equal(isBindable("Meta+Shift+K"), true);
});

test("stored combos from older builds still match", () => {
  assert.equal(normalizeCombo("Ctrl+Shift+!"), "Ctrl+Shift+1");
  assert.equal(normalizeCombo("Shift+Ctrl+a"), "Ctrl+Shift+A");
  assert.equal(normalizeCombo("Ctrl++"), "Ctrl++");
  assert.equal(normalizeCombo(""), "");
  assert.equal(normalizeCombo(undefined), "");
  const map = { ...defaultShortcuts(), modeChat: "Ctrl+Shift+!" };
  assert.equal(actionForCombo(map, "Ctrl+Shift+1"), "modeChat");
});

test("the sidebar runs the action of the pressed combo, and nothing for a disabled one", () => {
  const map = { ...defaultShortcuts(), toggleHistory: "Alt+Shift+J", newChat: "" };
  assert.equal(actionForCombo(map, "Alt+Shift+J"), "toggleHistory");
  assert.equal(actionForCombo(map, "Ctrl+Shift+H"), null); // the old combo no longer fires
  assert.equal(actionForCombo(map, "Ctrl+Shift+O"), null); // disabled
  assert.equal(actionForCombo(map, ""), null);
});

test("no default is a combo the browser keeps for itself, and no two defaults collide", () => {
  for (const a of SHORTCUT_ACTIONS) {
    assert.equal(isReservedCombo(a.def), false, `${a.id}: ${a.def} never reaches the page`);
    assert.equal(isBindable(a.def), true, a.id);
  }
  assert.deepEqual(findConflicts(defaultShortcuts()), {});
});

test("reserved combos are flagged, Ctrl and ⌘ alike", () => {
  for (const c of ["Ctrl+Shift+W", "Ctrl+W", "Ctrl+T", "Ctrl+Shift+N", "Ctrl+Shift+P", "Meta+Shift+W", "Meta+Q"]) {
    assert.equal(isReservedCombo(c), true, c);
  }
  assert.equal(isReservedCombo("Ctrl+Shift+E"), false);
});

test("two actions on one combo are reported both ways", () => {
  const map = { ...defaultShortcuts(), toggleWeb: "Ctrl+Shift+2" };
  assert.deepEqual(findConflicts(map), { toggleWeb: "modeTranslate", modeTranslate: "toggleWeb" });
});

test("keys are drawn as the keyboard labels them", () => {
  assert.deepEqual(comboKeys("Ctrl+Shift+O", false), ["Ctrl", "Shift", "O"]);
  assert.deepEqual(comboKeys("Ctrl+Shift+O", true), ["⌃", "⇧", "O"]);
  assert.deepEqual(comboKeys("Meta+Alt+K", true), ["⌘", "⌥", "K"]);
  assert.deepEqual(comboKeys("Meta+Alt+K", false), ["Win", "Alt", "K"]);
  assert.deepEqual(comboKeys("Ctrl+Shift+!", false), ["Ctrl", "Shift", "1"]);
  assert.deepEqual(comboKeys("Ctrl++", false), ["Ctrl", "+"]);
  assert.deepEqual(comboKeys("", false), []);
  assert.equal(isMacPlatform({ platform: "MacIntel" }), true);
  assert.equal(isMacPlatform({ userAgentData: { platform: "Windows" }, platform: "Win32" }), false);
});
