// Carried over from hivey-vscode (src/core/redaction/types.ts) — the same rules, the same reasons.
// What the redaction pipeline knows about a piece of text before it may leave the machine.
export const DEFAULT_POLICY = {
  level: "strict",
  customTerms: [],
  blockOnSecret: true,
};
/** Which kinds a level acts on. `off` still catches secrets: that one is not a preference. */
export function kindsFor(level) {
  switch (level) {
    case "strict":
      return new Set(["secret", "identity", "business", "infra", "path", "term"]);
    case "balanced":
      return new Set(["secret", "identity", "business", "term"]);
    case "off":
      return new Set(["secret"]);
  }
}
