import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createMcpToken, authenticateMcpToken, hashMcpToken } from "../../../application/use-cases/mcp-tokens.js";
import { McpTokenStore } from "./mcp-token-store.js";

it("persists only a hash and metadata and accepts the token after reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "vh-mcp-test-"));
  const path = join(directory, "tokens.sqlite");
  try {
    const store = new McpTokenStore(path);
    const { secret, token } = (() => {
      try { return createMcpToken(store, "owner", "Agent", 30); }
      finally { store.close(); }
    })();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare("SELECT * FROM mcp_tokens").get();
      expect(row?.token_hash).toBe(hashMcpToken(secret));
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    } finally { db.close(); }
    const reopened = new McpTokenStore(path);
    try {
      expect(authenticateMcpToken(reopened, secret)).toEqual({ ownerId: "owner", tokenId: token.id });
      expect(reopened.revoke("other", token.id)).toBe(false);
      expect(reopened.revoke("owner", token.id)).toBe(true);
      expect(authenticateMcpToken(reopened, secret)).toBeUndefined();
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
