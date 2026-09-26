import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { McpToken, McpTokenRepository } from "../../../application/ports/mcp-token-repository.js";

export class McpTokenStore implements McpTokenRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
        prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS mcp_tokens_owner ON mcp_tokens(owner_id);
    `);
  }

  create(ownerId: string, token: McpToken, hash: string): void {
    this.db.prepare(`INSERT INTO mcp_tokens
      (id, owner_id, name, prefix, token_hash, created_at, expires_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(token.id, ownerId, token.name, token.prefix, hash, token.created_at, token.expires_at);
  }

  list(ownerId: string): McpToken[] {
    return this.db.prepare(`SELECT id, name, prefix, created_at, expires_at, last_used_at
      FROM mcp_tokens WHERE owner_id = ? ORDER BY created_at DESC`).all(ownerId) as McpToken[];
  }

  revoke(ownerId: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM mcp_tokens WHERE owner_id = ? AND id = ?").run(ownerId, id).changes) > 0;
  }

  authenticate(hash: string, now: string) {
    const row = this.db.prepare(`UPDATE mcp_tokens SET last_used_at = ?
      WHERE token_hash = ? AND expires_at > ? RETURNING owner_id, id`).get(now, hash, now) as
      { owner_id: string; id: string } | undefined;
    return row ? { ownerId: row.owner_id, tokenId: row.id } : undefined;
  }

  close(): void { this.db.close(); }
}
