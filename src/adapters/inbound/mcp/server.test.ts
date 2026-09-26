import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../infrastructure/server.js";
import { McpTokenStore } from "../../outbound/sqlite/mcp-token-store.js";
import { InspectionHistoryStore } from "../../outbound/sqlite/inspection-history-store.js";
import type { IncrementalInspectionEngine } from "../../../application/ports/inspection-engine.js";
import { hashMcpToken } from "../../../application/use-cases/mcp-tokens.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === "user-a" || token === "user-b") return { sub: token };
    throw new Error("invalid JWT");
  }),
}));

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const config = {
  host: "127.0.0.1", port: 0, lensUrl: "http://lens:8000", mockUrl: "http://mock:8080",
  mockPublicUrl: "http://127.0.0.1:8081", serviceToken: "service-secret", clerkSecretKey: "test-clerk",
};

function setup(auth = true) {
  const tokens = new McpTokenStore(":memory:");
  const history = new InspectionHistoryStore(":memory:");
  const engine: IncrementalInspectionEngine = {
    createInspection: vi.fn(async () => ({ inspection_id: "insp-1", status: "queued", status_url: "/status", view_url: "/view", expires_at: "2099-01-01T00:00:00Z" })),
    getInspection: vi.fn(async () => ({ inspection_id: "insp-1", status: "completed", created_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" })),
    getSnapshot: vi.fn(async () => ({ schema_version: "1", source: { protocol: "hls" }, tracks: [] })),
    getCaptureCoverage: vi.fn(async () => ({
      inspection_id: "insp-1", observed_at: "2026-01-01T00:00:00Z", protocol: "HLS", is_live: false,
      coverage: [{ segment_ref: "seg_0123456789abcdef01234567", rep_id: "v0", group_kind: "video", index: 0, segment_sequence: 0, start_seconds: 0, duration_seconds: 4, is_init: false, status: "available" }],
      total: 1, truncated: false, warnings: [],
    })),
    createCapture: vi.fn(async () => ({ status: "queued", bytes_received: 0, consumption_known: false })),
    getCapture: vi.fn(async () => ({ status: "running", bytes_received: 0, consumption_known: false })),
    getCaptureEvidence: vi.fn(async () => ({ segments: [], timeline: [], containers: [] })),
  };
  const { clerkSecretKey, ...devConfig } = config;
  const app = buildApp(auth ? config : devConfig, { mcpTokens: tokens, inspectionRepository: history, inspectionEngine: engine });
  apps.push(app);
  return { app, tokens, history, engine };
}

async function issue(app: FastifyInstance, owner = "user-a") {
  const response = await app.inject({ method: "POST", url: "/v1/mcp/tokens", headers: { authorization: `Bearer ${owner}` }, payload: { name: "My agent", expires_in_days: 30 } });
  expect(response.statusCode).toBe(201);
  expect(response.headers["cache-control"]).toBe("no-store");
  return response.json<{ secret: string; token: { id: string; expires_at: string } }>();
}

function rpc(app: FastifyInstance, secret: string, method: string, params: object = {}) {
  return app.inject({ method: "POST", url: "/mcp", headers: {
    authorization: `Bearer ${secret}`, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18",
  }, payload: { jsonrpc: "2.0", id: 1, method, params } });
}

describe("MCP tokens and tools", () => {
  it("connects with the official MCP client over the HTTP adapter", async () => {
    const { app } = setup();
    const { secret } = await issue(app);
    const client = new Client({ name: "integration-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
      fetch: async (_url, init) => {
        const response = await app.inject({
          method: init?.method === "GET" ? "GET" : init?.method === "DELETE" ? "DELETE" : "POST",
          url: "/mcp", headers: Object.fromEntries(new Headers(init?.headers).entries()),
          ...(typeof init?.body === "string" ? { payload: init.body } : {}),
        });
        return new Response(response.statusCode === 202 ? null : response.body, {
          status: response.statusCode,
          headers: { "content-type": String(response.headers["content-type"] ?? "application/json") },
        });
      },
    });
    try {
      await client.connect(transport as Transport);
      expect((await client.listTools()).tools).toHaveLength(12);
      const result = await client.callTool({ name: "list_inspections", arguments: {} });
      expect(result.structuredContent).toMatchObject({ inspections: [], total: 0 });
    } finally { await client.close(); }
  });

  it("requires a valid human session to manage tokens", async () => {
    const { app } = setup();
    for (const method of ["GET", "POST"] as const) {
      expect((await app.inject({ method, url: "/v1/mcp/tokens" })).statusCode).toBe(401);
    }
    const { secret } = await issue(app);
    expect((await app.inject({ method: "GET", url: "/v1/mcp/tokens", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(401);
  });

  it("reveals the secret only on creation and isolates management by owner", async () => {
    const { app } = setup();
    const { secret, token } = await issue(app);
    expect(secret).toMatch(/^vh_mcp_[A-Za-z0-9_-]{43}$/);
    const list = await app.inject({ url: "/v1/mcp/tokens", headers: { authorization: "Bearer user-a" } });
    expect(list.json().tokens).toHaveLength(1);
    expect(list.body).not.toContain(secret);
    expect(list.body).not.toContain(hashMcpToken(secret));
    const other = await app.inject({ url: "/v1/mcp/tokens", headers: { authorization: "Bearer user-b" } });
    expect(other.json().tokens).toEqual([]);
    const revoke = await app.inject({ method: "DELETE", url: `/v1/mcp/tokens/${token.id}`, headers: { authorization: "Bearer user-b" } });
    expect(revoke.statusCode).toBe(404);
    expect((await rpc(app, secret, "tools/list")).statusCode).toBe(200);
  });

  it("supports protocol initialization and tool discovery", async () => {
    const { app } = setup();
    const { secret } = await issue(app);
    const init = await rpc(app, secret, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-agent", version: "1" } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe("video-harness");
    const tools = await rpc(app, secret, "tools/list");
    expect(tools.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "create_inspection", "list_inspections", "get_inspection", "get_inspection_snapshot",
      "start_investigation", "list_investigations", "get_capture_coverage", "get_timeline",
      "capture_segments", "capture_window", "get_capture", "get_evidence",
    ]);
    expect(tools.headers["cache-control"]).toBe("no-store");
  });

  it("creates, polls and reads evidence with the token owner's identity", async () => {
    const { app, history } = setup();
    const { secret } = await issue(app);
    const call = (name: string, args: object) => rpc(app, secret, "tools/call", { name, arguments: args });
    const created = await call("create_inspection", { url: "https://example.com/master.m3u8" });
    expect(created.json().result.structuredContent.inspection_id).toBe("insp-1");
    expect(history.has("user-a", "insp-1")).toBe(true);
    expect(history.has("user-b", "insp-1")).toBe(false);
    const detail = await call("get_inspection", { inspection_id: "insp-1" });
    expect(detail.json().result.structuredContent.status).toBe("completed");
    const snapshot = await call("get_inspection_snapshot", { inspection_id: "insp-1", sections: ["source"] });
    expect(snapshot.json().result.structuredContent.snapshot).toEqual({ source: { protocol: "hls" } });
    expect((await call("list_inspections", {})).json().result.structuredContent.inspections).toHaveLength(1);
  });

  it("reserves an owner-scoped budget and starts an idempotent selective capture", async () => {
    const { app, engine } = setup();
    const a = await issue(app, "user-a");
    const callA = (name: string, args: object) => rpc(app, a.secret, "tools/call", { name, arguments: args });
    await callA("create_inspection", { url: "https://example.com/master.m3u8" });
    const started = await callA("start_investigation", { inspection_id: "insp-1", budget_bytes: 5000 });
    const investigation = started.json().result.structuredContent;
    expect(investigation).toMatchObject({ inspection_id: "insp-1", budget_bytes: 5000, available_bytes: 5000 });

    const coverage = await callA("get_capture_coverage", {
      investigation_id: investigation.id,
      source_url: "https://example.com/master.m3u8",
    });
    const segmentRef = coverage.json().result.structuredContent.coverage[0].segment_ref;
    const args = {
      investigation_id: investigation.id,
      source_url: "https://example.com/master.m3u8",
      segment_refs: [segmentRef],
      max_bytes: 4000,
      idempotency_key: "agent-call-0001",
    };
    const capture = await callA("capture_segments", args);
    expect(capture.json().result.structuredContent.status).toBe("queued");
    expect(engine.createCapture).toHaveBeenCalledTimes(1);
    expect(capture.json().result.structuredContent.id).toMatch(/[0-9a-f-]{36}/);

    const repeated = await callA("capture_segments", args);
    expect(repeated.json().result.structuredContent.id).toBe(capture.json().result.structuredContent.id);
    expect(engine.createCapture).toHaveBeenCalledTimes(1);

    const b = await issue(app, "user-b");
    const denied = await rpc(app, b.secret, "tools/call", {
      name: "get_capture", arguments: { investigation_id: investigation.id, capture_id: capture.json().result.structuredContent.id },
    });
    expect(denied.json().result.content[0].text).toBe("investigation_not_found");
  });

  it("denies cross-owner evidence before contacting the engine", async () => {
    const { app, engine } = setup();
    const a = await issue(app);
    await rpc(app, a.secret, "tools/call", { name: "create_inspection", arguments: { url: "https://example.com/master.m3u8" } });
    const b = await issue(app, "user-b");
    for (const name of ["get_inspection", "get_inspection_snapshot"]) {
      const denied = await rpc(app, b.secret, "tools/call", { name, arguments: { inspection_id: "insp-1" } });
      expect(denied.json().result).toMatchObject({ isError: true, content: [{ text: "inspection_not_found" }] });
    }
    expect(engine.getInspection).not.toHaveBeenCalled();
    expect(engine.getSnapshot).not.toHaveBeenCalled();
    expect((await rpc(app, b.secret, "tools/call", { name: "list_inspections", arguments: {} })).json().result.structuredContent.inspections).toEqual([]);
  });

  it("revokes access on the next request and records last use", async () => {
    const { app, tokens } = setup();
    const { secret, token } = await issue(app);
    expect(tokens.list("user-a")[0]?.last_used_at).toBeNull();
    await rpc(app, secret, "tools/list");
    expect(tokens.list("user-a")[0]?.last_used_at).toBeTruthy();
    expect((await app.inject({ method: "DELETE", url: `/v1/mcp/tokens/${token.id}`, headers: { authorization: "Bearer user-a" } })).statusCode).toBe(200);
    expect((await rpc(app, secret, "tools/list")).statusCode).toBe(401);
  });

  it("rejects expired, invalid and service tokens, including in dev mode", async () => {
    const { app, tokens } = setup(false);
    const { secret } = await issue(app);
    expect(tokens.authenticate(hashMcpToken(secret), "2099-01-01T00:00:00Z")).toBeUndefined();
    const expired = `vh_mcp_${"a".repeat(43)}`;
    tokens.create("dev-user", { id: "expired", name: "expired", prefix: "vh_mcp_a", created_at: "2000-01-01", expires_at: "2001-01-01", last_used_at: null }, hashMcpToken(expired));
    for (const value of ["", "invalid", "service-secret", expired]) expect((await rpc(app, value, "tools/list")).statusCode).toBe(401);
    expect((await rpc(app, secret, "tools/list")).statusCode).toBe(200);
  });

  it("validates token inputs and rejects owner injection into tools", async () => {
    const { app, engine } = setup();
    for (const payload of [{ name: "" }, { name: "agent", expires_in_days: 0 }, { name: "agent", expires_in_days: 366 }, { name: "agent", ownerId: "user-b" }]) {
      expect((await app.inject({ method: "POST", url: "/v1/mcp/tokens", headers: { authorization: "Bearer user-a" }, payload })).statusCode).toBe(400);
    }
    const { secret } = await issue(app);
    const response = await rpc(app, secret, "tools/call", { name: "create_inspection", arguments: { url: "https://example.com", ownerId: "user-b" } });
    expect(response.json().result.isError).toBe(true);
    expect(engine.createInspection).not.toHaveBeenCalled();
  });

  it("rejects foreign origins and unsupported methods", async () => {
    const { app } = setup();
    const { secret } = await issue(app);
    const headers = { authorization: `Bearer ${secret}` };
    expect((await app.inject({ method: "GET", url: "/mcp", headers: { ...headers, origin: "https://attacker.example" } })).statusCode).toBe(403);
    for (const method of ["GET", "DELETE"] as const) expect((await app.inject({ method, url: "/mcp", headers })).statusCode).toBe(405);
  });

  it("bounds calls per owner across tokens", async () => {
    const { app } = setup();
    const a = await issue(app);
    const b = await issue(app);
    for (let i = 0; i < 60; i++) expect((await rpc(app, a.secret, "tools/list")).statusCode).toBe(200);
    expect((await rpc(app, b.secret, "tools/list")).statusCode).toBe(429);
  });
});
