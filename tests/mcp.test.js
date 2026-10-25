// The MCP client (src/lib/mcp.js) against a scripted server: the handshake and its session header,
// JSON and event-stream answers, pages of tools, a 401 that names where to sign in, the tool names
// a provider accepts, and which tools run without asking (« Toujours confirmer » for the rest).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  McpClient, McpAuthError, parseSse, resourceMetadataOf, resultForModel, toolDefs, isReadOnly,
  discoverAuth, registerClient, authorizeUrl, exchangeCode, pkcePair, MCP_CATALOGUE,
} from "../src/lib/mcp.js";

const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
});

/** A server answering initialize / tools/list (two pages) / tools/call, as SSE or JSON. */
function fakeServer({ sse = false, needAuth = false } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ method: body.method, session: init.headers["mcp-session-id"] || "", auth: init.headers.authorization || "" });
    if (needAuth && init.headers.authorization !== "Bearer ok") {
      return res(401, { error: "invalid_token" }, { "www-authenticate": 'Bearer realm="OAuth", resource_metadata="https://srv.test/.well-known/oauth-protected-resource/mcp"' });
    }
    if (!("id" in body)) return res(202, "");
    let result;
    if (body.method === "initialize") result = { protocolVersion: "2025-06-18", serverInfo: { name: "Fake", version: "1" }, capabilities: { tools: {} } };
    else if (body.method === "tools/list") result = body.params.cursor
      ? { tools: [{ name: "send_email", description: "Send", inputSchema: { type: "object", properties: { to: { type: "string" } } } }] }
      : { tools: [{ name: "search_emails", description: "Search", inputSchema: { type: "object", properties: {} } }], nextCursor: "p2" };
    else if (body.method === "tools/call") result = { content: [{ type: "text", text: `called ${body.params.name} ${JSON.stringify(body.params.arguments)}` }] };
    const msg = { jsonrpc: "2.0", id: body.id, result };
    const headers = { "content-type": sse ? "text/event-stream" : "application/json" };
    if (body.method === "initialize") headers["mcp-session-id"] = "sess-1";
    return res(200, sse ? `event: message\ndata: ${JSON.stringify(msg)}\n\n` : msg, headers);
  };
  return { fetchImpl, seen };
}

test("handshake once, then the session id rides on every request", async () => {
  for (const sse of [false, true]) {
    const { fetchImpl, seen } = fakeServer({ sse });
    const c = new McpClient({ url: "https://srv.test/mcp", fetchImpl });
    const tools = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["search_emails", "send_email"], "both pages read");
    const r = await c.callTool("search_emails", { q: "facture" });
    assert.equal(resultForModel(r).result, 'called search_emails {"q":"facture"}');
    assert.deepEqual(seen.map((s) => s.method), ["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call"]);
    assert.equal(seen[0].session, "");
    assert.ok(seen.slice(1).every((s) => s.session === "sess-1"), "the session header after the handshake");
    assert.equal(c.serverInfo.name, "Fake");
  }
});

test("a 401 says where to sign in", async () => {
  const { fetchImpl } = fakeServer({ needAuth: true });
  const c = new McpClient({ url: "https://srv.test/mcp", fetchImpl });
  await assert.rejects(c.listTools(), (e) => e instanceof McpAuthError && e.resourceMetadata === "https://srv.test/.well-known/oauth-protected-resource/mcp");
  const ok = new McpClient({ url: "https://srv.test/mcp", fetchImpl, getAuthHeader: async () => "Bearer ok" });
  assert.equal((await ok.listTools()).length, 2);
});

test("event-stream bodies and header values are read", () => {
  assert.deepEqual(parseSse('event: message\ndata: {"id":1}\n\n: ping\n\ndata: {"id":2}\n\n'), [{ id: 1 }, { id: 2 }]);
  assert.equal(resourceMetadataOf('Bearer resource_metadata="https://a/b", scope="x"'), "https://a/b");
  assert.equal(resourceMetadataOf("Bearer"), "");
});

test("tool results reach the model as text, errors as errors", () => {
  assert.deepEqual(resultForModel({ content: [{ type: "text", text: "a" }, { type: "image" }] }), { result: "a\n[image]" });
  assert.deepEqual(resultForModel({ isError: true, content: [{ type: "text", text: "quota" }] }), { error: "quota" });
  assert.deepEqual(resultForModel({ content: [], structuredContent: { n: 1 } }), { result: '{"n":1}' });
});

test("tool names fit providers, stay unique across servers, and map back", () => {
  const { defs, map } = toolDefs([
    { id: "gmail", name: "Gmail", tools: [{ name: "search", inputSchema: { type: "object", properties: {} } }, { name: "send.message!" }] },
    { id: "notion", name: "Notion", tools: [{ name: "search" }] },
  ]);
  for (const d of defs) assert.match(d.name, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(new Set(defs.map((d) => d.name)).size, 3);
  assert.deepEqual(map.get("notion__search"), { serverId: "notion", tool: "search", readOnly: true });
  assert.equal(map.get("gmail__send_message").tool, "send.message!");
  assert.ok(defs[0].description.startsWith("[Gmail]"));
  assert.deepEqual(defs[1].input_schema, { type: "object", properties: {} }, "a missing schema becomes an empty object");
});

test("reading runs by itself; sending, creating or deleting asks first", () => {
  for (const n of ["search_emails", "list_pages", "get_issue", "notion-search", "fetch"]) assert.equal(isReadOnly({ name: n }), true, n);
  for (const n of ["send_email", "create_page", "delete_issue", "update", "gmail_send", "archive_thread"]) assert.equal(isReadOnly({ name: n }), false, n);
  assert.equal(isReadOnly({ name: "send_email", annotations: { readOnlyHint: true } }), true, "the server's annotation wins");
  assert.equal(isReadOnly({ name: "get_and_delete", annotations: { destructiveHint: true } }), false);
});

test("sign-in: discovery, registration, the authorize URL and the code exchange", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    if (url === "https://srv.test/.well-known/oauth-protected-resource/mcp") return res(200, { resource: "https://srv.test/mcp", authorization_servers: ["https://auth.test"] });
    if (url === "https://auth.test/.well-known/oauth-authorization-server") return res(200, { authorization_endpoint: "https://auth.test/authorize", token_endpoint: "https://auth.test/token", registration_endpoint: "https://auth.test/register" });
    if (url === "https://auth.test/register") { const b = JSON.parse(init.body); assert.equal(b.token_endpoint_auth_method, "none"); return res(201, { client_id: "cid" }); }
    if (url === "https://auth.test/token") { const b = new URLSearchParams(init.body); assert.equal(b.get("code_verifier"), "ver"); assert.equal(b.get("resource"), "https://srv.test/mcp"); return res(200, { access_token: "tok", refresh_token: "ref", expires_in: 3600 }); }
    return res(404, {});
  };
  const d = await discoverAuth("https://srv.test/mcp", { fetchImpl });
  assert.equal(d.as.token_endpoint, "https://auth.test/token");
  const c = await registerClient(d.as, "https://ext.example/mcp", { fetchImpl });
  assert.equal(c.clientId, "cid");
  const { verifier, challenge } = await pkcePair();
  assert.ok(verifier.length >= 43 && challenge.length >= 43 && !/[+/=]/.test(challenge));
  const u = new URL(authorizeUrl({ as: d.as, clientId: "cid", redirectUri: "https://ext.example/mcp", challenge, state: "st", resource: d.resource }));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("resource"), "https://srv.test/mcp");
  const tok = await exchangeCode(d.as, { code: "c", verifier: "ver", redirectUri: "https://ext.example/mcp", resource: d.resource, clientId: "cid", fetchImpl });
  assert.equal(tok.accessToken, "tok");
  assert.ok(tok.expiresAt > Date.now());
});

test("a server without self-registration asks for a personal token instead", async () => {
  await assert.rejects(registerClient({ authorization_endpoint: "x" }, "https://r"), /personal token/);
});

test("the catalogue holds only https servers, each with its sign-in kind and description", () => {
  const ids = new Set();
  for (const s of MCP_CATALOGUE) {
    assert.match(s.url, /^https:\/\//);
    assert.ok(["oauth", "token", "none"].includes(s.auth), s.id);
    assert.ok(s.desc.startsWith("mcp.cat."));
    assert.ok(!ids.has(s.id)); ids.add(s.id);
  }
});
