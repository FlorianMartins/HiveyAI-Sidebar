// 🐝 Agent control frame — drawn at document_start so the "the AI is controlling this tab" border
// appears from the FIRST paint of every navigation, with no gap while the page loads (the main
// content.js runs at document_idle, too late to cover the loading phase). It asks the background
// whether THIS tab is under agent control right now; content.js then owns toggling it off when the
// run ends. Both share the same element id (#__ai_agent_glow), so there's never a duplicate.
(() => {
  if (window.top !== window) {
    return; // top frame only
  }

  const ID = "__ai_agent_glow";
  const SID = "__ai_agent_glow_style";
  const api = typeof browser !== "undefined" && browser.runtime ? browser : typeof chrome !== "undefined" ? chrome : null;

  if (!api) {
    return;
  }

  const rgba = (hex, a) => {
    const h = String(hex || "").replace("#", "");
    const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r || 139},${g || 92},${b || 246},${a})`;
  };

  function draw(accent, accent2) {
    if (document.getElementById(ID)) {
      return; // already drawn (content.js or an earlier run)
    }

    let st = document.getElementById(SID);

    if (!st) {
      st = document.createElement("style");
      st.id = SID;
      (document.head || document.documentElement).appendChild(st);
    }

    // Same drawing as content.js (glowCss): a brighter glow fading in and out over a dimmer one —
    // an opacity animation the compositor runs by itself — in a full-viewport element CLIPPED to a
    // ~52px border frame (centre empty) so YouTube's IntersectionObserver doesn't think the player
    // is obscured and refuse to autoplay.
    st.textContent =
      `@keyframes aiAgentGlow{0%,100%{opacity:0}50%{opacity:1}}` +
      `#${ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;` +
      "clip-path:polygon(0 0,0 100%,52px 100%,52px 52px,calc(100% - 52px) 52px,calc(100% - 52px) calc(100% - 52px),52px calc(100% - 52px),52px 100%,100% 100%,100% 0)}" +
      `#${ID}>ai-glow-layer{all:initial;display:block;position:absolute;inset:0;border-radius:2px;pointer-events:none;box-shadow:inset 0 0 16px 3px ${rgba(accent, 0.55)},inset 0 0 4px 1px ${rgba(accent2, 0.85)}}` +
      `#${ID}>ai-glow-layer+ai-glow-layer{box-shadow:inset 0 0 36px 9px ${rgba(accent, 0.85)},inset 0 0 9px 2px ${rgba(accent2, 1)};opacity:0;will-change:opacity;animation:aiAgentGlow 1.8s ease-in-out infinite}`;

    const el = document.createElement("div");
    el.id = ID;
    el.append(document.createElement("ai-glow-layer"), document.createElement("ai-glow-layer"));
    document.documentElement.appendChild(el);
  }

  // Ask the background whether this tab is glowed RIGHT NOW; draw immediately if so.
  try {
    const p = api.runtime.sendMessage({ type: "agent_glow_query" }, (res) => {
      if (api.runtime.lastError) {
        return;
      }

      if (res && res.on) {
        draw(res.accent || "#8b5cf6", res.accent2 || "#6366f1");
      }
    });

    // Firefox returns a promise from sendMessage (callback may be ignored) — handle both.
    if (p && typeof p.then === "function") {
      p.then((res) => {
        if (res && res.on) {
          draw(res.accent || "#8b5cf6", res.accent2 || "#6366f1");
        }
      }).catch(() => {});
    }
  } catch (_) {
    // background not ready / page not eligible — nothing to draw
  }
})();
