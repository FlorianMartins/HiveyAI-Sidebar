// The thinking Claude signs must come back to it exactly as it wrote it, markers included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateProvider } from "../src/lib/privacy.js";

test("anonymised answers keep their reasoning_details as the model wrote them", async () => {
  let seen = null;
  const inner = {
    async runTurn(req) {
      seen = req.history;
      const marker = (String(req.history[0].content).match(/⟨[^⟩]+⟩/) || [""])[0];
      assert.ok(marker, "the e-mail left as a marker");
      const thought = `The user wrote to ${marker}.`;
      return { text: `Done for ${marker}.`, message: { role: "assistant", content: `Done for ${marker}.`, _reasoningDetails: [{ type: "reasoning.text", text: thought, signature: "sig" }] } };
    },
  };
  const p = privateProvider(inner, { level: "strict" });
  const r = await p.runTurn({ system: "", history: [{ role: "user", content: "Write to paul.durand@acme-corp.com", _attachment: true }], tools: [] });
  assert.match(r.text, /paul\.durand@acme-corp\.com/, "the answer holds the real value");
  assert.match(r.message.content, /paul\.durand@acme-corp\.com/);
  assert.match(r.message._reasoningDetails[0].text, /⟨[^⟩]+⟩/, "the signed thinking is untouched");
  assert.ok(seen);
});
