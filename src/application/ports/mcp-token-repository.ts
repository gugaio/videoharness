export type McpToken = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

export interface McpTokenRepository {
  create(ownerId: string, token: McpToken, hash: string): void;
  list(ownerId: string): McpToken[];
  revoke(ownerId: string, id: string): boolean;
  authenticate(hash: string, now: string): { ownerId: string; tokenId: string } | undefined;
}
