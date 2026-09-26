import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { McpTokenRepository } from "../../../../application/ports/mcp-token-repository.js";
import { createMcpToken } from "../../../../application/use-cases/mcp-tokens.js";
import type { AuthHook } from "../auth.js";

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  expires_in_days: z.number().int().min(1).max(365).default(90),
}).strict();

export function registerMcpTokenRoutes(app: FastifyInstance, deps: { auth: AuthHook; tokens: McpTokenRepository }) {
  app.get("/v1/mcp/tokens", { preHandler: deps.auth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { tokens: deps.tokens.list(request.vhOwnerId) };
  });
  app.post("/v1/mcp/tokens", { preHandler: deps.auth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = Input.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_token_input" });
    if (deps.tokens.list(request.vhOwnerId).length >= 20) {
      return reply.code(409).send({ error: "token_limit_reached" });
    }
    return reply.code(201).send(createMcpToken(deps.tokens, request.vhOwnerId, parsed.data.name, parsed.data.expires_in_days));
  });
  app.delete("/v1/mcp/tokens/:id", { preHandler: deps.auth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_token_id" });
    if (!deps.tokens.revoke(request.vhOwnerId, parsed.data.id)) return reply.code(404).send({ error: "token_not_found" });
    return { ok: true };
  });
}
