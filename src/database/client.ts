import pg from "pg";

const { Pool } = pg;

export type DatabaseHealth = {
  check(): Promise<void>;
};

export function createDatabasePool(databaseUrl: string): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

export function createDatabaseHealth(pool: pg.Pool): DatabaseHealth {
  return {
    async check(): Promise<void> {
      await pool.query("SELECT 1");
    },
  };
}
