// Export a saved conversation as Markdown (download) or PDF (print window). Local-only, no upload.

function convTitle(conv) {
  return (conv.customTitle || conv.title || "Conversation").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function conversationToMarkdown(conv) {
  const lines = [`# ${convTitle(conv)}`, ""];
  if (conv.updatedAt) lines.push(`_${new Date(conv.updatedAt).toLocaleString()}_`, "");
  for (const m of conv.transcript || []) {
    const who = m.role === "user" ? "🧑 **You**" : "🐝 **Assistant**";
    lines.push(who, "", (m.text || "").trim(), "");
    if (m.sources && m.sources.length) lines.push(...m.sources.map((s) => `[${s.n}] ${s.title ? `${s.title} — ` : ""}${s.url}`), "");
  }
  return lines.join("\n");
}

export function downloadMarkdown(conv) {
  const md = conversationToMarkdown(conv);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${convTitle(conv).replace(/\W+/g, "-").toLowerCase() || "conversation"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Open a self-contained printable window (user chooses "Save as PDF").
// Open a print-friendly view of a conversation in a new window.
//
// Built entirely with DOM APIs — no `document.write`, no HTML string, no inline
// <script>. Message text goes in via `textContent`, so it is impossible for a
// conversation to inject markup, and no manual escaping is needed. Line breaks
// are preserved by `white-space: pre-wrap` instead of <br> substitution.
const PRINT_CSS = `
  body{font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;max-width:760px}
  h1{margin:0 0 2px} .date{color:#777;margin-bottom:18px;font-size:12px}
  .msg{margin:0 0 14px;padding:10px 12px;border-radius:10px}
  .msg.user{background:#eef2ff}.msg.assistant{background:#f6f6f8}
  .who{font-weight:700;font-size:11px;text-transform:uppercase;color:#666;margin-bottom:4px}
  .body{white-space:pre-wrap;word-wrap:break-word}
`;

export function printConversation(conv) {
  const w = window.open("", "_blank");
  if (!w) return;
  const d = w.document;
  const title = convTitle(conv);

  const el = (tag, cls, text) => {
    const n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  d.title = title;
  const style = d.createElement("style");
  style.textContent = PRINT_CSS;
  d.head.appendChild(style);

  const frag = d.createDocumentFragment();
  frag.appendChild(el("h1", null, title));
  frag.appendChild(el("div", "date", conv.updatedAt ? new Date(conv.updatedAt).toLocaleString() : ""));

  const transcript = conv.transcript || [];
  if (!transcript.length) {
    frag.appendChild(el("p", null, "(empty)"));
  } else {
    for (const m of transcript) {
      const row = el("div", "msg " + (m.role === "user" ? "user" : "assistant"));
      row.appendChild(el("div", "who", m.role === "user" ? "You" : "Assistant"));
      row.appendChild(el("div", "body", (m.text || "").trim()));
      frag.appendChild(row);
    }
  }
  d.body.replaceChildren(frag);

  // Print from here rather than from an injected inline script (which the
  // extension CSP would block anyway).
  w.setTimeout(() => { try { w.print(); } catch (_) {} }, 200);
}
