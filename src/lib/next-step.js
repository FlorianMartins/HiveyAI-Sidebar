// The next request, suggested — as Claude Code and hivey-vscode do (core/session/nextStep.ts).
//
// Once a turn is over, ONE short follow-up the user is likely to want is asked for by a separate,
// small request (thinking off) and shown greyed in the empty composer; Tab or → makes it the next
// message. Written apart from the answer rather than inside it: a marker in the answer would stream
// onto the screen before it could be taken out, and would cost the answer its focus.

const NEXT_STEP_PROMPT = `You suggest the user's next request to an AI assistant in their web browser that has just answered.

Read the request and what the assistant answered. Reply with ONE short request the user is likely to
want next — a natural follow-up: something the answer mentioned but did not cover, the obvious next
check, comparison or action, the next piece of the same task. Write it as the user would type it:
imperative, specific, at most 15 words, no quotes, no preamble.

If nothing useful follows — the request is fully answered and nothing was left open — reply with exactly: NONE`;

const LANGS = { fr: "French", en: "English", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch" };

/** The request for a suggestion. Long answers are cut from the middle: the end says what is left. */
export function nextStepMessages(question, answer, language = "en") {
  const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max / 2)}\n[…]\n${text.slice(-max / 2)}`);
  return {
    system: NEXT_STEP_PROMPT,
    history: [{
      role: "user",
      content: `Request:\n${cut(String(question || "").trim(), 2000)}\n\nAnswer:\n${cut(String(answer || "").trim(), 4000)}\n\nWrite the suggestion in ${LANGS[language] || "English"}.`,
    }],
  };
}

/** The suggestion in a reply, or nothing. Shown in the composer, so it is kept to one line. */
export function parseNextStep(reply) {
  const line = String(reply || "").replace(/<think>[\s\S]*?<\/think>/g, "").split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return undefined;
  const clean = line
    .replace(/^(next( step)?|suggestion|prochaine (étape|demande))\s*:\s*/i, "")
    .replace(/^[-*•>\d.)\s]+/, "")
    .replace(/^["'«“`]+|["'»”`]+$/g, "")
    .trim();
  if (!clean || /^none\.?$/i.test(clean) || clean.length < 4) return undefined;
  return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
}
