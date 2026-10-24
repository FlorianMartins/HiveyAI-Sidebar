// Quick access switches of the Settings page: the settings people flip most, one tap each.
//
// Pure data + two functions so the semantics are testable without a browser: quickState() says
// whether a switch is on for a settings object, quickPatch() gives the storage patch that turns it
// on or off. Every patch writes the SAME keys the detailed controls and the sidebar use — a quick
// switch is a shortcut to an existing setting, never a setting of its own.

export const QUICK_CATS = ["assistant", "feedback", "look"];

// `key` + `def`: a plain boolean setting and its default (true = on unless explicitly false).
export const QUICK_TOGGLES = [
  { id: "anon", cat: "assistant", labelKey: "opt.qa.anon", ctl: "privacyLevel" },
  { id: "web", cat: "assistant", labelKey: "opt.qa.web", key: "webSearch", def: false, ctl: "webSearch" },
  { id: "suggest", cat: "assistant", labelKey: "opt.qa.suggest", key: "suggestNext", def: true, ctl: "suggestNext" },
  { id: "artifacts", cat: "assistant", labelKey: "opt.qa.artifacts", key: "artifacts", def: true },
  { id: "verify", cat: "assistant", labelKey: "opt.qa.verify", key: "verifyAnswers", def: false },
  { id: "compact", cat: "assistant", labelKey: "opt.qa.compact", key: "compressHistory", def: true, ctl: "compressHistory" },
  { id: "memory", cat: "assistant", labelKey: "opt.qa.memory", key: "memoryEnabled", def: false, ctl: "memoryEnabled" },
  { id: "sound", cat: "feedback", labelKey: "opt.qa.sound", key: "soundOnDone", def: false, ctl: "soundOnDone" },
  { id: "tabNotif", cat: "feedback", labelKey: "opt.qa.tabNotif", key: "tabDoneIndicator", def: true, ctl: "tabDoneIndicator" },
  { id: "smooth", cat: "feedback", labelKey: "opt.qa.smooth", key: "smoothStream", def: true, ctl: "smoothStream" },
  { id: "light", cat: "look", labelKey: "opt.qa.light", ctl: "theme" },
  { id: "neon", cat: "look", labelKey: "opt.qa.neon", key: "textOutlineOn", def: false, ctl: "textOutlineOn" },
  { id: "contour", cat: "look", labelKey: "opt.qa.contour", key: "contourOn", def: true, ctl: "contourOn" },
  { id: "replyOutline", cat: "look", labelKey: "opt.qa.replyOutline", key: "msgBorderOn", def: false, ctl: "msgBorderOn" },
  { id: "railRight", cat: "look", labelKey: "opt.qa.rail", ctl: "railSide" },
];

const byId = (id) => QUICK_TOGGLES.find((q) => q.id === id);

export function quickState(id, s) {
  s = s || {};
  const q = byId(id);
  if (!q) return false;
  if (id === "anon") return (s.privacyLevel || "balanced") !== "off";
  if (id === "light") return s.theme === "light";
  if (id === "railRight") return s.railSide === "right";
  const v = s[q.key];
  return q.def ? v !== false : v === true;
}

export function quickPatch(id, on, s) {
  s = s || {};
  const q = byId(id);
  if (!q) return {};
  if (id === "anon") {
    // Same semantics as the sidebar's cloud badge: off remembers the level, on brings it back
    // (credentials stay masked either way — "off" is "credentials only").
    const level = s.privacyLevel || "balanced";
    if (on) return level !== "off" ? {} : { privacyLevel: s.privacyLevelOn && s.privacyLevelOn !== "off" ? s.privacyLevelOn : "balanced" };
    return level === "off" ? {} : { privacyLevel: "off", privacyLevelOn: level };
  }
  if (id === "light") {
    // Light ↔ the dark theme you had, with its custom colours: switching back is lossless.
    if (on) {
      if (s.theme === "light") return {};
      return { theme: "light", themeColors: {}, themeDarkPrev: { theme: s.theme || "dark", themeColors: s.themeColors || {} } };
    }
    if (s.theme !== "light") return {};
    const prev = s.themeDarkPrev && typeof s.themeDarkPrev === "object" ? s.themeDarkPrev : {};
    const theme = prev.theme && prev.theme !== "light" ? prev.theme : "dark";
    return { theme, themeColors: prev.themeColors && typeof prev.themeColors === "object" ? prev.themeColors : {} };
  }
  if (id === "railRight") return { railSide: on ? "right" : "left" };
  return { [q.key]: !!on };
}
