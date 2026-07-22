import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { logger } from "../infra/logger.js";
import { createDatabasePool } from "./client.js";

type AppliedMigrationRow = {
  name: string;
};

function migrationsDirectory(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createDatabasePool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [72_841_019]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query<AppliedMigrationRow>("SELECT name FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const files = (await fs.readdir(migrationsDirectory()))
      .filter((file) => file.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDirectory(), file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        logger.info("database.migration_applied", { migration: file });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [72_841_019]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  runMigrations(config.databaseUrl).catch((error) => {
    logger.error("database.migration_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
