import { loadConfig } from "../config.js";
import { createDatabaseHealth, createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const database = createDatabaseHealth(pool);
let closed = false;
let timer: ReturnType<typeof setInterval> | undefined;
let databaseStatus: "unknown" | "up" | "down" = "unknown";

async function poll(): Promise<void> {
  try {
    await database.check();
    if (databaseStatus !== "up") {
      logger.info("worker.database_ready", { workerId: config.workerId });
    }
    databaseStatus = "up";
  } catch (error) {
    if (databaseStatus !== "down") {
      logger.warn("worker.database_unavailable", {
        workerId: config.workerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    databaseStatus = "down";
  }
}

async function shutdown(signal: string): Promise<void> {
  if (closed) return;
  closed = true;
  if (timer) clearInterval(timer);
  logger.info("worker.shutdown", { workerId: config.workerId, signal });
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await poll();
timer = setInterval(() => void poll(), config.workerPollMs);
logger.info("worker.started", { workerId: config.workerId, pollMs: config.workerPollMs });
