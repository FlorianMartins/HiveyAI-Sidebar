// The Web tab frames provider sites (Claude, ChatGPT, Gemini…), which refuse to be framed: the
// rule below removes their anti-framing headers. It used to do so for EVERY frame of those sites,
// whoever framed them — so any web page could frame the user's signed-in chats in a hidden frame
// (clickjacking). It now applies only when the frame is loaded by this extension's own pages, or
// when a provider's frame navigates itself (signing in, following a link) — a third-party page
// framing them gets the sites' own refusal, as without the add-on.
//
// The extension's host is only known at run time (Firefox gives every install its own id), so the
// rule is a session rule built here; rules/frame-unblock.json keeps the list of sites and the
// headers, and its static ruleset is disabled.

export const FRAME_UNBLOCK_RULE_ID = 1001;

/** The session rule: `base` is the rule of rules/frame-unblock.json, `extHost` this add-on's host. */
export function frameUnblockRule(base, extHost) {
  const domains = base.condition.requestDomains;
  return {
    id: FRAME_UNBLOCK_RULE_ID,
    priority: base.priority || 1,
    action: base.action,
    condition: {
      resourceTypes: ["sub_frame"],
      requestDomains: domains,
      initiatorDomains: [extHost, ...domains],
    },
  };
}

/** Install (or refresh) the rule. Safe to call on every background start. */
export async function registerFrameUnblock(api) {
  const dnr = api.declarativeNetRequest;
  if (!dnr || !dnr.updateSessionRules) return false;
  const base = (await (await fetch(api.runtime.getURL("rules/frame-unblock.json"))).json())[0];
  const extHost = new URL(api.runtime.getURL("/")).host;
  const rule = frameUnblockRule(base, extHost);
  await dnr.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
  return true;
}
