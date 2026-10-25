// Content script: reads the page and performs the DOM actions requested by the
// agent. Injected on every page (document_idle) and re-injected on demand by
// tools.js. Also powers the page element picker and region screenshot capture.

// Single chokepoint for HTML insertion in this content script — see src/lib/dom.js
// for the rationale. Callers pass only sanitized (miniMarkdown) or trusted HTML.
// Parsed in an inert document and moved in as nodes (no innerHTML on the page).
function setHTML(el, html) {
  if (!el) return;
  const doc = new DOMParser().parseFromString(`<body>${html == null ? "" : html}</body>`, "text/html");
  el.replaceChildren(...doc.body.childNodes);
}

(function () {
  if (window.__aiSidebarInjected) return;
  window.__aiSidebarInjected = true;

  const refMap = new Map(); // ref -> element
  let refCounter = 0;

  // --- Safety: payment / checkout guardrail --------------------------------
  // The agent may browse and fill a cart, but never transact. We refuse clicks
  // on payment/checkout controls and typing into card fields. Matching is
  // intentionally broad (EN + FR) and errs on the side of refusing.
  const PAY_WORDS = [
    "pay now", "pay ", "payment", "checkout", "check out", "place order",
    "place your order", "buy now", "buy ", "purchase", "complete purchase",
    "confirm order", "confirm and pay", "proceed to payment", "proceed to checkout",
    "subscribe", "complete order", "order now",
    // French
    "payer", "paiement", "payez", "régler", "passer commande", "passer la commande",
    "valider la commande", "valider le paiement", "confirmer la commande",
    "confirmer l'achat", "acheter", "procéder au paiement", "finaliser la commande",
    "finaliser l'achat",
  ];
  const CARD_FIELD = /(card.?number|cardnum|cc.?num|cvv|cvc|cryptogramme|num(é|e)ro.?de.?carte|expir|exp.?date|securitycode|card.?code)/i;

  function textOf(el) {
    return (
      (el.innerText || el.value || "") + " " +
      (el.getAttribute && (
        (el.getAttribute("aria-label") || "") + " " +
        (el.getAttribute("name") || "") + " " +
        (el.getAttribute("id") || "") + " " +
        (el.getAttribute("title") || "") + " " +
        (el.getAttribute("value") || "")
      ) || "")
    ).toLowerCase();
  }

  function looksLikePaymentControl(el) {
    const hay = textOf(el);
    return PAY_WORDS.some((w) => hay.includes(w));
  }

  function looksLikeCardField(el) {
    const ac = (el.getAttribute && el.getAttribute("autocomplete")) || "";
    if (/cc-(number|csc|exp)/i.test(ac)) return true;
    const hay =
      (el.getAttribute && (
        (el.getAttribute("name") || "") + " " +
        (el.getAttribute("id") || "") + " " +
        (el.getAttribute("placeholder") || "") + " " +
        (el.getAttribute("aria-label") || "")
      )) || "";
    return CARD_FIELD.test(hay);
  }

  // --- Very sensitive (non-payment) actions: ALWAYS confirmed, even in "Allow" mode.
  // Downloading, the button that commits a booking, deleting, transferring, signing up,
  // installing… The agent must get the user's OK before doing these. Payments stay hard-blocked
  // above. Only the control's own visible label is read — never its id or name, nor the whole
  // form around it: on a booking site "booking" is in every id and "Réservez votre séjour" heads
  // the search form, and searching dates and prices must stay free. What is confirmed is the
  // last step (« Réserver maintenant », « Confirmer la réservation », "Book now"…).
  // <sensitive> pure, run as is by tests/sensitiveActions.test.js
  const SENSITIVE_WORDS = [
    "download", "télécharger", "telecharger",
    "réserver maintenant", "réservez maintenant", "reserver maintenant", "je réserve", "je reserve",
    "confirmer la réservation", "confirmer ma réservation", "valider la réservation", "finaliser la réservation",
    "confirmer la reservation", "valider la reservation", "finaliser la reservation",
    "book now", "book ticket", "reserve now", "confirm booking", "complete booking", "complete your booking",
    "confirm reservation", "complete reservation",
    "delete", "supprimer", "remove account", "delete account", "supprimer le compte",
    "transfer", "transférer", "transferer", "virement", "wire",
    "sign up", "signup", "register", "create account", "s'inscrire", "inscrire", "créer un compte", "creer un compte",
    "apply now", "postuler", "submit application",
    "install", "installer",
    "send email", "send message", "envoyer le message", "envoyer un message",
    "unsubscribe", "se désabonner", "se desabonner",
    "publish", "publier", "post publicly",
  ];
  // A button that says only this commits too (« Réserver » on a room, "Book" on a seat).
  const COMMIT_LABEL = /^(r[ée]server|r[ée]servez|reserve|book|book it)$/;
  const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const SENSITIVE_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${SENSITIVE_WORDS.map(escapeRe).join("|")})(?=$|[^\\p{L}\\p{N}])`, "u");
  function sensitiveReason(label) {
    const t = String(label || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!t) return null;
    if (COMMIT_LABEL.test(t)) return t;
    const m = SENSITIVE_RE.exec(t);
    return m ? m[2] : null;
  }
  // </sensitive>
  const ownLabel = (el) => (el.innerText || "") + " " + (el.value || "") + " " +
    ((el.getAttribute && ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || ""))) || "");
  function looksLikeSensitiveControl(el) {
    // A real download link/button (download attribute or a file href).
    if (el.tagName === "A" &&
        ((el.hasAttribute && el.hasAttribute("download")) ||
         /\.(zip|exe|dmg|msi|pkg|apk|iso|deb|rpm|7z|rar|tar|gz|jar|bin|app|csv|xlsx?)(\?|#|$)/i.test((el.getAttribute && el.getAttribute("href")) || ""))) {
      return "download";
    }
    const own = sensitiveReason((el.innerText || el.value || "").trim());
    return own || sensitiveReason(ownLabel(el));
  }
  // Submitting a form does what its submit button says.
  function looksLikeSensitiveSubmit(form) {
    if (!form || !form.querySelectorAll) return null;
    for (const b of form.querySelectorAll('button:not([type="button"]):not([type="reset"]), input[type="submit"]')) {
      const reason = looksLikeSensitiveControl(b);
      if (reason) return reason;
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function labelOf(el) {
    const txt =
      (el.innerText || "").trim() ||
      (el.value || "").trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      "";
    return txt.replace(/\s+/g, " ").slice(0, 120);
  }

  function metaDescription() {
    const m =
      document.querySelector('meta[name="description"]') ||
      document.querySelector('meta[property="og:description"]');
    return (m && m.getAttribute("content")) || "";
  }

  function readPage() {
    const main = document.querySelector("main, article, [role=main]") || document.body;
    const text = (main.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 20000);
    return {
      title: document.title,
      url: location.href,
      description: metaDescription(),
      text,
    };
  }

  function readSelection() {
    return { selection: (window.getSelection() || "").toString().slice(0, 8000) };
  }

  // --- In-page translation (overlay) --------------------------------------
  // Collect the page's visible text nodes, hand them to the sidebar for translation, then swap them
  // back in place. Originals are kept so a floating toggle can flip between original / translated.
  let trNodes = null;           // [{ node, orig, lead, trail, tr }]
  let trToggle = null;          // floating toggle button
  let trShown = "translated";
  let trLabels = { orig: "↺ Original", trans: "🐝 Translated" };
  const TR_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP", "TEXTAREA", "SVG", "CANVAS", "MATH", "OPTION"]);
  function trCollect() {
    trNodes = [];
    const out = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = (n.nodeValue || "").trim();
        if (v.length < 2) return NodeFilter.FILTER_REJECT;
        // Need at least one letter (Latin / accented / Greek / CJK / etc.) — skip pure numbers/symbols.
        if (!/[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ぀-ヿ一-鿿가-힯]/.test(v)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (TR_SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (p.closest(".__hivey_tr_toggle, #__ai_agent_glow")) return NodeFilter.FILTER_REJECT;
        const cs = window.getComputedStyle(p);
        if (cs && (cs.display === "none" || cs.visibility === "hidden")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node, i = 0;
    while ((node = walker.nextNode())) {
      if (i >= 1500) break; // safety cap
      const orig = node.nodeValue;
      trNodes.push({ node, orig, lead: orig.match(/^\s*/)[0], trail: orig.match(/\s*$/)[0], tr: null });
      out.push({ i, t: orig.trim().slice(0, 1200) });
      i++;
    }
    return { items: out, title: document.title, url: location.href };
  }
  function trApply(map, labels) {
    if (labels) trLabels = labels;
    if (!trNodes) return { ok: false, error: "nothing collected" };
    let n = 0;
    for (const k in map) {
      const rec = trNodes[+k];
      if (!rec || !rec.node || !map[k]) continue;
      rec.tr = String(map[k]);
      try { rec.node.nodeValue = rec.lead + rec.tr + rec.trail; n++; } catch (_) {}
    }
    trShown = "translated";
    trMountToggle();
    return { ok: true, applied: n };
  }
  function trSet(which) {
    if (!trNodes) return;
    for (const r of trNodes) {
      if (!r.node) continue;
      try { r.node.nodeValue = which === "original" ? r.orig : (r.tr != null ? r.lead + r.tr + r.trail : r.orig); } catch (_) {}
    }
    trShown = which;
    trUpdateToggle();
  }
  function trMountToggle() {
    if (!trToggle) {
      const b = document.createElement("button");
      b.className = "__hivey_tr_toggle";
      b.type = "button";
      b.style.cssText =
        "position:fixed;z-index:2147483646;bottom:16px;right:16px;padding:8px 13px;border-radius:999px;border:0;" +
        "background:linear-gradient(135deg,#6d5efc,#22d3ee);color:#fff;font:600 12px system-ui,-apple-system,sans-serif;" +
        "box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer;user-select:none";
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); trSet(trShown === "translated" ? "original" : "translated"); });
      (document.body || document.documentElement).appendChild(b);
      trToggle = b;
    }
    trUpdateToggle();
  }
  function trUpdateToggle() {
    if (trToggle) trToggle.textContent = trShown === "translated" ? trLabels.orig : trLabels.trans;
  }
  function trReset() {
    trSet("original");
    if (trToggle) { trToggle.remove(); trToggle = null; }
    trNodes = null; trShown = "translated";
    return { ok: true };
  }

  function findElements(query) {
    refMap.clear();
    refCounter = 0;
    const q = (query || "").toLowerCase().trim();
    const selector =
      "a[href], button, input:not([type=hidden]), textarea, select, [role=button], [onclick]";
    const out = [];
    const nodes = document.querySelectorAll(selector);
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = labelOf(el);
      const hay = (label + " " + (el.getAttribute("href") || "")).toLowerCase();
      if (q && !hay.includes(q)) continue;
      const ref = "e" + ++refCounter;
      refMap.set(ref, el);
      out.push({
        ref,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || undefined,
        text: label,
        href: el.getAttribute("href") || undefined,
        // Hint so the model can avoid even proposing a payment action.
        payment: looksLikePaymentControl(el) || undefined,
      });
      if (out.length >= 60) break;
    }
    return { count: out.length, elements: out };
  }

  function clickElement(ref, guard, confirmed) {
    const el = refMap.get(ref);
    if (!el) return { error: `ref not found: ${ref} (re-run find_elements)` };
    if (guard && guard.blockPayments && looksLikePaymentControl(el)) {
      return { error: "Blocked by safety guardrail: payment/checkout action is not allowed.", blocked: true };
    }
    // Very sensitive action → ask the user to confirm (even in "Allow" mode).
    if (!confirmed) {
      const reason = looksLikeSensitiveControl(el);
      if (reason) return { confirm: true, action: reason, label: labelOf(el) };
    }
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, clicked: labelOf(el) };
  }

  function fillInput(ref, value, submit, guard, confirmed) {
    const el = refMap.get(ref);
    if (!el) return { error: `ref not found: ${ref} (re-run find_elements)` };
    if (guard && guard.blockPayments && looksLikeCardField(el)) {
      return { error: "Blocked by safety guardrail: card/payment field is not allowed.", blocked: true };
    }
    // If submitting a form that triggers a very sensitive action, confirm first.
    if (submit && !confirmed) {
      const reason = looksLikeSensitiveSubmit(el.form);
      if (reason) return { confirm: true, action: reason, label: labelOf(el) };
    }
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (submit) {
      // Refuse to submit a form that looks like a payment form.
      if (guard && guard.blockPayments && el.form && looksLikePaymentControl(el.form)) {
        return { ok: true, filled: labelOf(el), note: "Filled but submit blocked (payment form)." };
      }
      const form = el.form;
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } else {
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })
        );
      }
    }
    return { ok: true, filled: labelOf(el) };
  }

  function scrollPage(direction) {
    const h = window.innerHeight;
    if (direction === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else if (direction === "bottom")
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    else window.scrollBy({ top: direction === "up" ? -h * 0.9 : h * 0.9, behavior: "smooth" });
    return { ok: true };
  }

  // --- Set-of-Marks + click-by-coordinate (vision fallback) -----------------
  // Overlay NUMBERED badges on the visible clickable elements so a vision model can say
  // "click [7]" — returns a legend [{n,x,y,label}] (x,y = element centre, for click_at).
  const MARK_ID = "__hivey_marks__";
  function isClickable(el) {
    if (!el || el.disabled) return false;
    const tag = el.tagName.toLowerCase();
    if (["a", "button", "input", "select", "textarea", "summary"].includes(tag)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option"].includes(role)) return true;
    if (el.getAttribute("onclick") || el.tabIndex >= 0) return true;
    try { if (getComputedStyle(el).cursor === "pointer") return true; } catch (_) {}
    return false;
  }
  function markElements() {
    unmarkElements();
    const layer = document.createElement("div");
    layer.id = MARK_ID;
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const marks = [];
    const seen = new Set();
    const all = document.querySelectorAll("a,button,input,select,textarea,summary,[role],[onclick],[tabindex]");
    let n = 0;
    for (const el of all) {
      if (n >= 60) break;
      if (!isClickable(el)) continue;
      let r; try { r = el.getBoundingClientRect(); } catch (_) { continue; }
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const key = cx + "x" + cy; if (seen.has(key)) continue; seen.add(key);
      n++;
      const badge = document.createElement("div");
      badge.textContent = n;
      badge.style.cssText = "position:fixed;left:" + Math.max(0, r.left) + "px;top:" + Math.max(0, r.top) + "px;" +
        "background:#e11d48;color:#fff;font:700 11px/1.4 system-ui;padding:0 4px;border-radius:4px;" +
        "box-shadow:0 0 0 1px #fff;transform:translateY(-2px);";
      layer.appendChild(badge);
      const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.tagName).trim().slice(0, 40);
      marks.push({ n, x: cx, y: cy, label });
    }
    document.documentElement.appendChild(layer);
    return { ok: true, marks };
  }
  function unmarkElements() {
    const l = document.getElementById(MARK_ID); if (l) l.remove();
    return { ok: true };
  }
  function clickAt(x, y) {
    unmarkElements(); // never click our own overlay
    const el = document.elementFromPoint(x, y);
    if (!el) return { error: "Nothing at (" + x + "," + y + ")." };
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try { el.dispatchEvent(new MouseEvent(type, opts)); } catch (_) {}
    });
    const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.tagName || "").trim().slice(0, 40);
    return { ok: true, clicked: label || ("<" + el.tagName.toLowerCase() + ">") };
  }

  // Make a <video> START PLAYING, with sound whenever the browser allows it.
  // CRITICAL: if the video is ALREADY playing (autoplay did its job), do NOTHING — calling
  // play()/clicking the play button on a running player TOGGLES it and PAUSES it (the bug where
  // the agent "launched the video then paused it"). We only ever ACT when the player is paused.
  // When we do act and the browser blocks autoplay-with-sound, we fall back to MUTED so the video
  // at least launches, then try to bring the sound back without re-pausing it.
  // Sound needs a click ON THE PAGE. Firefox (and Chromium on a site the user rarely plays media
  // on) refuses audible playback until the page itself has been clicked, and nothing an extension
  // does counts as that click — not a click in the sidebar, not a script run from one (tested:
  // play() from the sidebar's own click handler, in the page's world or ours, is still refused, and
  // a tab-level unmute changes nothing). So when playback could only start muted (or not at all),
  // ONE clear button sits on the video: the user's click there is a real gesture on the page, the
  // sound comes on and stays on — no hunting for the player's 🔊 or the M key.
  const SOUND_BTN_ID = "__hivey_sound_btn";
  function removeSoundButton() { const el = document.getElementById(SOUND_BTN_ID); if (el) el.remove(); }
  function soundOn(v) {
    // YouTube keeps its own mute state (its 🔊 icon, the volume it remembers): go through its own
    // button so the player agrees, then make sure the element itself is audible and playing.
    const yt = document.querySelector(".ytp-mute-button");
    if (yt && v.muted) { try { yt.click(); } catch (_) {} }
    try { if (v.muted) v.muted = false; if (!v.volume) v.volume = 1; } catch (_) {}
    if (v.paused) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
  }
  function offerSoundButton(v, label) {
    removeSoundButton();
    const host = document.createElement("div");
    host.id = SOUND_BTN_ID;
    host.style.cssText = "position:fixed;z-index:2147483646;left:0;top:0;width:0;height:0;";
    const root = host.attachShadow({ mode: "closed" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label || "🔊 Play with sound";
    btn.style.cssText = "position:fixed;transform:translate(-50%,-50%);padding:14px 22px;border:0;border-radius:999px;white-space:nowrap;" +
      "font:600 17px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;cursor:pointer;" +
      "background:linear-gradient(135deg,#7c5cff,#c056f5);box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 0 3px rgba(255,255,255,.85);";
    root.appendChild(btn);
    const place = () => {
      if (!host.isConnected) return;
      let r; try { r = v.getBoundingClientRect(); } catch (_) { return; }
      const onScreen = r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < innerHeight;
      const x = onScreen ? r.left + r.width / 2 : innerWidth / 2;
      const y = onScreen ? Math.min(Math.max(r.top + r.height / 2, 40), innerHeight - 40) : innerHeight / 2;
      btn.style.left = Math.round(x) + "px"; btn.style.top = Math.round(y) + "px";
    };
    place();
    const timer = setInterval(() => { if (!host.isConnected || !v.isConnected) { clearInterval(timer); removeSoundButton(); } else place(); }, 500);
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      soundOn(v);
      clearInterval(timer); host.remove();
    });
    // The user found the player's own 🔊 (or pressed M) — the button has done its job.
    const done = () => { if (!v.muted && v.volume > 0 && !v.paused) { v.removeEventListener("volumechange", done); v.removeEventListener("playing", done); clearInterval(timer); host.remove(); } };
    v.addEventListener("volumechange", done);
    v.addEventListener("playing", done);
    (document.body || document.documentElement).appendChild(host);
  }

  async function playVideo(v, soundLabel) {
    const tryPlay = async () => {
      try {
        const p = v.play();
        // A refused play() rejects at once; one that waits for data can stay pending for as long as
        // the stream stalls — don't hang the agent on it (and never leave the user without a button).
        if (p && p.then) return await Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(!v.paused), 5000))]);
        return true;
      } catch (_) {
        return false;
      }
    };
    // ⚠️ « l'utilisateur doit couper le son et le remettre » — a video left playing muted needs two
    // clicks on the player (unmute, and the browser pauses it; play again). Where the browser only
    // allows silence, the video is left PAUSED and NOT muted instead: one click on play — the
    // player's own or the button put on the video — and it plays with sound.
    const holdForOneClick = () => {
      try { v.pause(); } catch (_) {}
      const yt = document.querySelector(".ytp-mute-button");
      if (yt && v.muted) { try { yt.click(); } catch (_) {} } // keeps YouTube's own mute state in step
      try { v.muted = false; if (!v.volume) v.volume = 1; } catch (_) {}
      offerSoundButton(v, soundLabel);
      return { ok: true, playing: false, paused: true, muted: false, soundButton: true,
        hint: "The browser allows sound only after a click on the page, so the video is paused (not muted) — one click on play (or on the ▶ button shown on the video) starts it with sound. Tell the user that in one short sentence." };
    };
    const alreadyPlaying = () => {
      if (v.muted) return holdForOneClick();
      return { ok: true, playing: true, muted: false };
    };
    // Autoplay already running → leave it alone (never toggle a playing video).
    if (!v.paused) {
      return alreadyPlaying();
    }
    // It may be ABOUT to autoplay (the page just loaded and the player hasn't started yet). Give
    // autoplay a moment to kick in BEFORE we intervene — otherwise we'd "play" a video that was
    // going to start on its own, and a second play()/toggle re-pauses it. Poll briefly.
    for (let i = 0; i < 8 && v.paused; i++) {
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!v.paused) {
      return alreadyPlaying(); // autoplay started it on its own — don't touch it
    }
    // Genuinely paused → try WITH SOUND first. ⚠️ « il lance la musique en mute par défaut »: it used
    // to mute before every play, so even a site the user had allowed to autoplay with sound (Firefox:
    // 🔒 → Autoplay → Allow Audio and Video; Chrome: a site the user often plays media on) started
    // silent. A browser that refuses sound without a click on the page rejects play() at once, or
    // pauses the video within a few seconds — then, and only then, it starts muted, and the hint
    // says the one setting that gives sound every time. No extension can unmute without a click on
    // the page: unmuting a video that started silently gets it paused by the autoplay policy.
    let audible = false;
    try { v.muted = false; } catch (_) {}
    if (await tryPlay()) {
      for (let i = 0; i < 12 && !v.paused; i++) await new Promise((r) => setTimeout(r, 250));
      audible = !v.paused && !v.muted;
    }
    if (!audible) return holdForOneClick();
    removeSoundButton();
    return { ok: true, playing: !v.paused, muted: false };
  }

  // --- Media control (play a video, toggle YouTube autoplay) ----------------
  function controlMedia(action, soundLabel) {
    try {
      const isYT = /(^|\.)youtube\.com$/.test(location.hostname) || /(^|\.)youtu\.be$/.test(location.hostname);
      // The main video = the biggest visible <video>.
      let v = null, best = -1;
      document.querySelectorAll("video").forEach((x) => {
        let r; try { r = x.getBoundingClientRect(); } catch (_) { return; }
        const a = (r.width || 0) * (r.height || 0);
        if (a > best) { best = a; v = x; }
      });
      if (action === "play") {
        // Already on a page with a player → make sure it actually plays.
        if (v) {
          return playVideo(v, soundLabel); // async: guarantees the video LAUNCHES, with sound when allowed
        }
        // No player yet (search results / home / channel). Return the FIRST video's URL so the
        // tool layer can do a real navigation (a bare .click() triggers a YouTube SPA route change
        // that destroys this content script, so playback never gets driven). The sidebar will
        // navigate to watchUrl, wait for load, then call play again.
        if (isYT) {
          const link =
            document.querySelector("ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title-link, a#video-title") ||
            document.querySelector('a[href*="/watch?v="]');
          if (link && link.href) return { ok: false, watchUrl: link.href, note: "found first video — navigating to play it" };
        }
        return { ok: false, note: "No video found on this page (navigate to a video or a YouTube results page first)." };
      }
      if (action === "pause") {
        removeSoundButton();
        if (v && v.pause) v.pause();
        return { ok: true, paused: v ? v.paused : true };
      }
      if (action === "autoplay_status" || action === "autoplay_on" || action === "autoplay_off") {
        // Locate YouTube's "Autoplay next" control across the layouts YT ships/A-B-tests.
        // The player-bar toggle is the canonical one; aria-checked is the source of truth, but on
        // some variants it sits on a child, and an older up-next paper toggle still exists for some.
        function readYTAutoplay() {
          const btn = document.querySelector(
            ".ytp-autonav-toggle-button, button.ytp-autonav-toggle-button, [data-tooltip-target-id='ytp-autonav-toggle-button']"
          );
          if (btn) {
            let ac = btn.getAttribute("aria-checked");
            if (ac !== "true" && ac !== "false") {
              const child = btn.querySelector("[aria-checked]");
              if (child) ac = child.getAttribute("aria-checked");
            }
            if (ac === "true" || ac === "false") return { found: true, on: ac === "true", el: btn, via: "player" };
            return { found: true, on: undefined, el: btn, via: "player" };
          }
          // Older / up-next rail paper toggle.
          const paper = document.querySelector(
            "ytd-compact-autoplay-renderer #toggle, tp-yt-paper-toggle-button#toggle, ytd-toggle-button-renderer #toggle"
          );
          if (paper) {
            const on =
              paper.getAttribute("aria-pressed") === "true" ||
              paper.hasAttribute("checked") ||
              paper.classList.contains("toggle-on");
            return { found: true, on, el: paper, via: "uprail" };
          }
          return { found: false };
        }

        const st = readYTAutoplay();
        if (action === "autoplay_status") {
          if (st.found && typeof st.on === "boolean") return { ok: true, autoplay: st.on, via: st.via };
          if (v) return { ok: true, autoplay: !!v.autoplay, via: "html5" };
          return { ok: false, error: "Autoplay control not found — open a YouTube watch page (the toggle only exists while a video is playing)." };
        }

        const want = action === "autoplay_on";
        if (st.found && st.el) {
          if (st.on !== want) st.el.click();
          return { ok: true, autoplay: want, via: st.via };
        }
        if (v) { v.autoplay = want; return { ok: true, autoplay: want, via: "html5" }; }
        return { error: "No autoplay control found on this page (open a YouTube watch page first)." };
      }
      return { error: "Unknown media action." };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }

  // --- Element picker ------------------------------------------------------
  // Lets the user point at any element on the page (a table, an image, a menu…) and
  // "ask the AI about it". Hover outlines the element; a single click captures it;
  // holding the left button and dragging across several elements selects them all
  // (each captured). Esc, or a pick_cancel message from the sidebar, aborts cleanly.
  let pickResolve = null;
  // Theme accent colours — passed from the sidebar so the capture/pick overlays and
  // the agent glow match the user's selected theme instead of a fixed colour.
  let ACCENT = "#8b5cf6", ACCENT2 = "#6366f1";
  function rgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
    return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : hex;
  }
  function setAccents(msg) {
    if (msg && msg.accent) ACCENT = msg.accent;
    if (msg && msg.accent2) ACCENT2 = msg.accent2;
  }
  let pickHoverBox = null;
  let pickHover = null;
  let pickPainting = false;
  let pickSelected = [];
  let pickBoxes = [];
  function mkBox(color, bg, z) {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "fixed", zIndex: z, top: 0, left: 0, width: 0, height: 0,
      border: "2px solid " + color, background: bg, borderRadius: "3px", pointerEvents: "none",
    });
    document.documentElement.appendChild(d);
    return d;
  }
  function placeBox(d, r) {
    Object.assign(d.style, { top: r.top + "px", left: r.left + "px", width: r.width + "px", height: r.height + "px" });
  }
  function addSelected(el) {
    if (!el || pickSelected.includes(el)) return;
    pickSelected.push(el);
    const b = mkBox(ACCENT, rgba(ACCENT, 0.22), 2147483646);
    placeBox(b, el.getBoundingClientRect());
    pickBoxes.push(b);
  }
  function pickMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    if (pickPainting) { addSelected(el); }
    else { pickHover = el; placeBox(pickHoverBox, el.getBoundingClientRect()); }
  }
  function pickDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    pickPainting = true;
    if (pickHoverBox) pickHoverBox.style.display = "none";
    addSelected(pickHover || document.elementFromPoint(e.clientX, e.clientY));
  }
  function pickUp(e) {
    if (!pickPainting) return;
    e.preventDefault(); e.stopPropagation();
    endPick(false);
  }
  // Full swallow for the events that fire page links/buttons/menus (click happens AFTER selection).
  function pickSwallow(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  // Pointer events: block them reaching the PAGE (modern sites like YouTube toggle play on
  // pointerdown/up, not click) WITHOUT preventDefault, so the compat mousedown/up our picker uses
  // still fire.
  function pickStopProp(e) { e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  // Events the picker listens to / swallows on the document (capture phase) — kept in one list so
  // start and end stay in sync.
  const PICK_LISTENERS = [
    ["mousemove", () => pickMove], ["mousedown", () => pickDown], ["mouseup", () => pickUp],
    ["pointerdown", () => pickStopProp], ["pointerup", () => pickStopProp],
    ["click", () => pickSwallow], ["dblclick", () => pickSwallow], ["auxclick", () => pickSwallow],
    ["contextmenu", () => pickSwallow], ["keydown", () => pickKey],
  ];
  function pickKey(e) { if (e.key === "Escape") { e.preventDefault(); endPick(true); } }
  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
    let imgSrc = "";
    if (el.tagName === "IMG") imgSrc = el.currentSrc || el.src || "";
    return { tag: el.tagName.toLowerCase(), text, imgSrc, rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
  }
  function endPick(cancelled) {
    for (const [ev, fn] of PICK_LISTENERS) document.removeEventListener(ev, fn(), true);
    document.documentElement.style.cursor = "";
    if (pickHoverBox) { pickHoverBox.remove(); pickHoverBox = null; }
    pickBoxes.forEach((b) => b.remove());
    const els = pickSelected;
    pickBoxes = []; pickSelected = []; pickPainting = false;
    const r = pickResolve; pickResolve = null;
    if (!r) return;
    if (cancelled || !els.length) { r({ cancelled: true }); return; }
    r({ elements: els.slice(0, 8).map(describeElement), dpr: window.devicePixelRatio || 1, url: location.href, title: document.title });
  }
  function startPick() {
    if (pickResolve) endPick(true); // restart cleanly
    return new Promise((resolve) => {
      pickResolve = resolve; pickSelected = []; pickBoxes = []; pickPainting = false; pickHover = null;
      pickHoverBox = mkBox(ACCENT2, rgba(ACCENT2, 0.14), 2147483647);
      document.documentElement.style.cursor = "crosshair";
      for (const [ev, fn] of PICK_LISTENERS) document.addEventListener(ev, fn(), true);
    });
  }

  // --- Region capture (screenshot tool) -----------------------------------
  // Lets the user draw a free rectangle over the page (like a screenshot selection);
  // we return the rect so the sidebar can crop the visible-tab screenshot and attach
  // that IMAGE to the context. Esc or right-click cancels.
  let regResolve = null, regBox = null, regStart = null, regDragging = false;
  function regRect(e) {
    const left = Math.min(e.clientX, regStart.x), top = Math.min(e.clientY, regStart.y);
    return { x: left, y: top, w: Math.abs(e.clientX - regStart.x), h: Math.abs(e.clientY - regStart.y) };
  }
  function regDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    regDragging = true; regStart = { x: e.clientX, y: e.clientY };
    placeBox(regBox, { left: e.clientX, top: e.clientY, width: 0, height: 0 });
  }
  function regMove(e) {
    if (!regDragging || !regStart) return;
    const r = regRect(e);
    placeBox(regBox, { left: r.x, top: r.y, width: r.w, height: r.h });
  }
  function regUp(e) {
    if (!regDragging) return;
    e.preventDefault(); e.stopPropagation();
    endRegion(false, regRect(e));
  }
  function regSwallow(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); }
  function regStopProp(e) { e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } // block page pointer handlers, keep compat mouse events
  const REG_LISTENERS = [
    ["mousedown", () => regDown], ["mousemove", () => regMove], ["mouseup", () => regUp],
    ["pointerdown", () => regStopProp], ["pointerup", () => regStopProp],
    ["click", () => regSwallow], ["dblclick", () => regSwallow], ["auxclick", () => regSwallow],
    ["contextmenu", () => regSwallow], ["keydown", () => regKey],
  ];
  function regKey(e) { if (e.key === "Escape") { e.preventDefault(); endRegion(true); } }
  function endRegion(cancelled, rect) {
    for (const [ev, fn] of REG_LISTENERS) document.removeEventListener(ev, fn(), true);
    document.documentElement.style.cursor = "";
    if (regBox) { regBox.remove(); regBox = null; }
    regDragging = false; regStart = null;
    const r = regResolve; regResolve = null;
    if (!r) return;
    if (cancelled || !rect || rect.w < 5 || rect.h < 5) { r({ cancelled: true }); return; }
    // vw/vh (CSS viewport) let the sidebar scale the rect onto a getDisplayMedia frame, whose pixel
    // size differs from CSS px. (Unused by the captureVisibleTab path, which crops via dpr.)
    r({ rect, dpr: window.devicePixelRatio || 1, vw: window.innerWidth, vh: window.innerHeight, url: location.href, title: document.title });
  }
  function startRegion() {
    if (regResolve) endRegion(true);
    return new Promise((resolve) => {
      regResolve = resolve; regDragging = false; regStart = null;
      regBox = mkBox(ACCENT2, rgba(ACCENT2, 0.14), 2147483647);
      document.documentElement.style.cursor = "crosshair";
      for (const [ev, fn] of REG_LISTENERS) document.addEventListener(ev, fn(), true);
    });
  }

  // --- Agent activity glow -------------------------------------------------
  // A soft pulsing border around the viewport (à la Perplexity) shown while the agent
  // is acting on this page. pointer-events:none so it never blocks the page.
  let glowEl = null;
  // The pulse fades a brighter glow in and out over a dimmer, still one: an OPACITY animation, which
  // the compositor runs by itself. (Animating the box-shadow repainted the whole viewport on the
  // page's main thread every frame — on a busy page like YouTube, the frame stuttered.)
  // The full-viewport element is CLIPPED to a ~52px border frame so its centre is empty. Otherwise
  // it counts as covering the page for IntersectionObserver v2 (trackVisibility) — which is how
  // YouTube decides a player is "obscured" and refuses to autoplay. With the centre clipped out,
  // the video is no longer considered covered and autoplay works during an agent run.
  // Same drawing as agent-frame.js (document_start).
  function glowCss(id, a, a2) {
    return `@keyframes aiAgentGlow{0%,100%{opacity:0}50%{opacity:1}}` +
      `#${id}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;` +
      "clip-path:polygon(0 0,0 100%,52px 100%,52px 52px,calc(100% - 52px) 52px,calc(100% - 52px) calc(100% - 52px),52px calc(100% - 52px),52px 100%,100% 100%,100% 0)}" +
      `#${id}>ai-glow-layer{all:initial;display:block;position:absolute;inset:0;border-radius:2px;pointer-events:none;box-shadow:inset 0 0 16px 3px ${rgba(a, 0.55)},inset 0 0 4px 1px ${rgba(a2, 0.85)}}` +
      `#${id}>ai-glow-layer+ai-glow-layer{box-shadow:inset 0 0 36px 9px ${rgba(a, 0.85)},inset 0 0 9px 2px ${rgba(a2, 1)};opacity:0;will-change:opacity;animation:aiAgentGlow 1.8s ease-in-out infinite}`;
  }
  function setAgentGlow(on) {
    if (on) {
      // The document_start frame script (agent-frame.js) may have already drawn the frame for an
      // earlier-firing navigation — adopt that element instead of creating a duplicate.
      const existing = document.getElementById("__ai_agent_glow");
      if (existing) { glowEl = existing; return; }
      if (glowEl && document.documentElement.contains(glowEl)) return;
      // Rebuild the style each time so the glow tracks the current theme accent.
      let st = document.getElementById("__ai_agent_glow_style");
      if (!st) { st = document.createElement("style"); st.id = "__ai_agent_glow_style"; (document.head || document.documentElement).appendChild(st); }
      st.textContent = glowCss("__ai_agent_glow", ACCENT, ACCENT2);
      glowEl = document.createElement("div");
      glowEl.id = "__ai_agent_glow";
      glowEl.append(document.createElement("ai-glow-layer"), document.createElement("ai-glow-layer"));
      document.documentElement.appendChild(glowEl);
    } else if (glowEl) {
      glowEl.remove();
      glowEl = null;
    }
  }

  // ---- On-page action bubble -----------------------------------------------
  // A floating result bubble rendered IN THE PAGE (Shadow DOM, isolated from the
  // site's CSS) at the right-click position. The sidebar runs the model and relays
  // the text here via messages; the bubble is independent of the sidebar UI.
  let lastCtxPos = { x: 80, y: 80 };
  document.addEventListener("contextmenu", (e) => { lastCtxPos = { x: e.clientX, y: e.clientY }; }, true);

  // Minimal, XSS-safe Markdown -> HTML for the on-page bubble's final render.
  // The text is escaped first, then a small whitelist of formatting is layered
  // back in. Used when the background (which has no DOM) streams raw markdown.
  function miniMarkdown(src) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = (s) => {
      let r = esc(s);
      r = r.replace(/`([^`]+)`/g, (_m, c) => "<code>" + c + "</code>");
      r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      r = r.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
      r = r.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
      r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_m, txt, url) => '<a href="' + url.replace(/"/g, "%22") + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>");
      return r;
    };
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    let out = "", listOpen = false, inCode = false, codeBuf = "";
    const closeList = () => { if (listOpen) { out += "</ul>"; listOpen = false; } };
    for (const line of lines) {
      if (/^```/.test(line)) {
        if (inCode) { out += "<pre><code>" + esc(codeBuf) + "</code></pre>"; codeBuf = ""; inCode = false; }
        else { closeList(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf += (codeBuf ? "\n" : "") + line; continue; }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { closeList(); const n = h[1].length; out += "<h" + n + ">" + inline(h[2]) + "</h" + n + ">"; continue; }
      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) { if (!listOpen) { out += "<ul>"; listOpen = true; } out += "<li>" + inline(li[1]) + "</li>"; continue; }
      if (!line.trim()) { closeList(); continue; }
      closeList();
      out += "<p>" + inline(line) + "</p>";
    }
    if (inCode) out += "<pre><code>" + esc(codeBuf) + "</code></pre>";
    closeList();
    return out;
  }
  let pageBubble = null;
  function closePageBubble() {
    if (!pageBubble) return;
    try { pageBubble.cleanup(); } catch (_) {}
    try { pageBubble.host.remove(); } catch (_) {}
    pageBubble = null;
  }
  function buildPageBubble(opts) {
    closePageBubble();
    const A = (opts && opts.accent) || ACCENT;
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent =
      ".card{position:fixed;width:380px;max-width:92vw;max-height:62vh;display:flex;flex-direction:column;" +
      "font:13px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#f4f2fc;background:#141317;border:1px solid #2a2836;" +
      "border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.55);overflow:hidden}" +
      ".head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #242232;cursor:move;user-select:none}" +
      ".title{font-weight:600;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".acts{margin-left:auto;display:flex;align-items:center;gap:5px;flex:0 0 auto}" +
      "select{font:inherit;font-size:12px;padding:3px 6px;border-radius:7px;background:#221f2e;color:#f4f2fc;border:1px solid #2a2836}" +
      "button{all:unset;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:#9b98ad}" +
      "button:hover{background:#221f2e;color:#fff}" +
      ".src{font-size:11px;color:#9b98ad;padding:7px 10px;border-bottom:1px solid #242232;max-height:64px;overflow:auto;white-space:pre-wrap;background:#0d0c10}" +
      ".body{padding:10px 12px;overflow:auto;flex:1;min-height:46px;white-space:pre-wrap}" +
      ".body.done{white-space:normal}" +
      ".body.loading{color:#9b98ad}" +
      ".note{font-size:10px;color:#9b98ad;padding:5px 10px;border-top:1px solid #242232;text-align:center}" +
      ".body a{color:" + A + "}.body h1,.body h2,.body h3{color:" + A + ";margin:10px 0 5px}.body strong,.body b{color:" + A + "}" +
      ".body ul,.body ol{padding-left:20px;margin:7px 0}.body p{margin:8px 0}.body pre{white-space:pre-wrap;background:#0d0c10;padding:8px;border-radius:8px;overflow:auto}" +
      "svg{display:block}";
    shadow.appendChild(style);
    const card = document.createElement("div"); card.className = "card";
    const head = document.createElement("div"); head.className = "head";
    const title = document.createElement("span"); title.className = "title"; title.textContent = (opts && opts.title) || "";
    const acts = document.createElement("div"); acts.className = "acts";
    let langSel = null, presetSel = null;
    const sendRerun = () => browser.runtime.sendMessage({ type: "bubble_rerun", lang: langSel ? langSel.value : null, preset: presetSel ? presetSel.value : null });
    if (opts && opts.langs && opts.langs.length) {
      langSel = document.createElement("select");
      for (const l of opts.langs) { const o = document.createElement("option"); o.value = l.value; o.textContent = l.label; langSel.appendChild(o); }
      langSel.value = opts.currentLang || opts.langs[0].value;
      langSel.addEventListener("change", sendRerun);
      acts.appendChild(langSel);
    }
    if (opts && opts.presets && opts.presets.length) {
      presetSel = document.createElement("select");
      for (const p of opts.presets) { const o = document.createElement("option"); o.value = p.value; o.textContent = p.label; presetSel.appendChild(o); }
      presetSel.value = opts.currentPreset || opts.presets[0].value;
      presetSel.addEventListener("change", sendRerun);
      acts.appendChild(presetSel);
    }
    const copyBtn = document.createElement("button"); copyBtn.title = (opts && opts.copyLabel) || "Copy";
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener("click", () => { try { navigator.clipboard.writeText(pageBubble ? pageBubble.raw : ""); } catch (_) {} });
    const closeBtn = document.createElement("button"); closeBtn.title = (opts && opts.closeLabel) || "Close";
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    closeBtn.addEventListener("click", closePageBubble);
    acts.appendChild(copyBtn); acts.appendChild(closeBtn);
    head.appendChild(title); head.appendChild(acts);
    const src = document.createElement("div"); src.className = "src"; src.textContent = (opts && opts.source) || "";
    const body = document.createElement("div"); body.className = "body loading"; body.textContent = "…";
    const note = document.createElement("div"); note.className = "note"; note.textContent = (opts && opts.note) || "";
    card.appendChild(head); card.appendChild(src); card.appendChild(body); card.appendChild(note);
    shadow.appendChild(card);
    (document.body || document.documentElement).appendChild(host);
    // Keep the card FULLY inside the viewport. Because the body streams in and the card grows
    // AFTER the first paint, re-clamp on every content update (and on resize) — otherwise a
    // selection near the bottom edge would let the growing card spill below the screen.
    const m = 8;
    let _userMoved = false; // once dragged, respect the user's position
    const clamp = () => {
      if (_userMoved) return;
      const cw = card.offsetWidth || 380;
      const ch = card.offsetHeight || 220;
      const maxX = Math.max(m, window.innerWidth - cw - m);
      const maxY = Math.max(m, window.innerHeight - ch - m);
      const x = Math.min(Math.max(m, lastCtxPos.x), maxX);
      const y = Math.min(Math.max(m, lastCtxPos.y + 10), maxY);
      card.style.left = x + "px"; card.style.top = y + "px";
    };
    clamp();
    requestAnimationFrame(clamp); // re-measure after layout settles
    window.addEventListener("resize", clamp);
    // Drag by the header.
    let ox = 0, oy = 0;
    const onMove = (e) => {
      let nx = e.clientX - ox, ny = e.clientY - oy;
      nx = Math.max(2, Math.min(window.innerWidth - (card.offsetWidth || 60), nx));
      ny = Math.max(2, Math.min(window.innerHeight - (card.offsetHeight || 30), ny));
      card.style.left = nx + "px"; card.style.top = ny + "px";
    };
    const stop = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", stop); };
    head.addEventListener("mousedown", (e) => {
      if (e.target.closest("button, select")) return;
      _userMoved = true; // user takes over positioning → stop auto-clamping
      const r = card.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top; e.preventDefault();
      document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", stop);
    });
    // Close on outside click / Esc.
    const onDocDown = (e) => { if (!host.contains(e.target)) closePageBubble(); };
    const onKey = (e) => { if (e.key === "Escape") closePageBubble(); };
    setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    pageBubble = {
      host, body, raw: "", reclamp: clamp,
      cleanup: () => { document.removeEventListener("mousedown", onDocDown, true); document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", clamp); stop(); },
    };
  }

  browser.runtime.onMessage.addListener((msg) => {
    switch (msg && msg.type) {
      case "bubble_open":
        setAccents(msg);
        buildPageBubble(msg);
        return Promise.resolve({ ok: true });
      case "bubble_reset":
        if (pageBubble) { pageBubble.raw = ""; pageBubble.body.className = "body loading"; pageBubble.body.textContent = "…"; }
        return Promise.resolve({ ok: true });
      case "bubble_delta":
        if (pageBubble) { pageBubble.raw += msg.text || ""; pageBubble.body.className = "body"; pageBubble.body.textContent = pageBubble.raw; pageBubble.body.scrollTop = pageBubble.body.scrollHeight; pageBubble.reclamp && pageBubble.reclamp(); }
        return Promise.resolve({ ok: true });
      case "bubble_done":
        if (pageBubble) {
          pageBubble.raw = msg.raw || pageBubble.raw;
          pageBubble.body.className = "body done";
          // Prefer a pre-rendered html if one is supplied; otherwise render the
          // markdown safely here (the background service worker has no DOM).
          if (msg.html) { setHTML(pageBubble.body, msg.html); }
          else { setHTML(pageBubble.body, miniMarkdown(pageBubble.raw)); }
          pageBubble.reclamp && pageBubble.reclamp(); // keep it on-screen after it grows
        }
        return Promise.resolve({ ok: true });
      case "bubble_error":
        if (pageBubble) { pageBubble.body.className = "body"; pageBubble.body.textContent = msg.error || "Error"; }
        return Promise.resolve({ ok: true });
      case "bubble_close":
        closePageBubble();
        return Promise.resolve({ ok: true });
      case "agent_glow":
        setAccents(msg);
        setAgentGlow(!!msg.on);
        return Promise.resolve({ ok: true });
      case "read_page":
        return Promise.resolve(readPage());
      case "read_selection":
        return Promise.resolve(readSelection());
      case "tr_collect":
        return Promise.resolve(trCollect());
      case "tr_apply":
        return Promise.resolve(trApply(msg.map || {}, msg.labels));
      case "tr_reset":
        return Promise.resolve(trReset());
      case "pick_element":
        setAccents(msg);
        return startPick();
      case "pick_cancel":
        if (pickResolve) endPick(true);
        return Promise.resolve({ ok: true });
      case "capture_region":
        setAccents(msg);
        return startRegion();
      case "region_cancel":
        if (regResolve) endRegion(true);
        return Promise.resolve({ ok: true });
      case "find_elements":
        return Promise.resolve(findElements(msg.query));
      case "click_element":
        return Promise.resolve(clickElement(msg.ref, msg.guard, msg.confirmed));
      case "fill_input":
        return Promise.resolve(fillInput(msg.ref, msg.value, msg.submit, msg.guard, msg.confirmed));
      case "scroll_page":
        return Promise.resolve(scrollPage(msg.direction));
      case "control_media":
        return Promise.resolve(controlMedia(msg.action, msg.soundLabel));
      case "mark_elements":
        return Promise.resolve(markElements());
      case "unmark_elements":
        return Promise.resolve(unmarkElements());
      case "click_at":
        return Promise.resolve(clickAt(msg.x, msg.y));
      case "ping":
        return Promise.resolve({ ok: true });
    }
    return false;
  });

  // --- SPA navigation notifier ---------------------------------------------
  // Tell the sidebar when the URL changes via the History API (pushState /
  // popstate), which does not always fire tabs.onUpdated. Classic navigations
  // (new site, subdomain) are caught by the sidebar via tab events instead.
  let lastUrl = location.href;
  const notifyNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    try {
      browser.runtime.sendMessage({ type: "page_changed", url: location.href });
    } catch (_) {}
  };
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      setTimeout(notifyNav, 50);
      return r;
    };
  }
  window.addEventListener("popstate", () => setTimeout(notifyNav, 50));

})();
