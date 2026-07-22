import { buildApiServer } from "./server.js";
import { loadConfig } from "../config.js";
import { createDatabaseHealth, createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";
import { PostgresInvestigationIntake } from "../investigation/adapters/postgres-investigation-intake.js";
import { createStartInvestigation } from "../investigation/application/start-investigation.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const server = buildApiServer({
  database: createDatabaseHealth(pool),
  startInvestigation: createStartInvestigation(new PostgresInvestigationIntake(pool)),
  version: process.env.npm_package_version ?? "0.1.0",
});

server.addHook("onClose", async () => {
  await pool.end();
});

async function shutdown(signal: string): Promise<void> {
  logger.info("api.shutdown", { signal });
  await server.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.listen({ host: config.host, port: config.port });
  logger.info("api.started", { host: config.host, port: config.port });
} catch (error) {
  logger.error("api.start_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  await pool.end();
  process.exitCode = 1;
}
