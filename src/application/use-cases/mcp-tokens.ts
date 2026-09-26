import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpToken, McpTokenRepository } from "../ports/mcp-token-repository.js";

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createMcpToken(repository: McpTokenRepository, ownerId: string, name: string, expiresInDays: number) {
  const secret = `vh_mcp_${randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  const token: McpToken = {
    id: randomUUID(), name, prefix: secret.slice(0, 15),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + expiresInDays * 86_400_000).toISOString(),
    last_used_at: null,
  };
  repository.create(ownerId, token, hashMcpToken(secret));
  return { token, secret };
}

export function authenticateMcpToken(repository: McpTokenRepository, secret: string) {
  if (!/^vh_mcp_[A-Za-z0-9_-]{43}$/.test(secret)) return undefined;
  return repository.authenticate(hashMcpToken(secret), new Date().toISOString());
}
