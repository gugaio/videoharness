import { loadConfig } from "../config.js";
import { createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";
import { PostgresInvestigationJobRepository } from "../investigation/adapters/postgres-investigation-job.js";
import { createInvestigationWorker } from "../investigation/application/run-investigation.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const repository = new PostgresInvestigationJobRepository(pool);
const worker = createInvestigationWorker({
  repository,
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
});
let shutdownRequested = false;

function requestShutdown(signal: string): void {
  if (shutdownRequested) return;
  shutdownRequested = true;
  logger.info("worker.shutdown_requested", { workerId: config.workerId, signal });
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

logger.info("worker.started", {
  workerId: config.workerId,
  pollMs: config.workerPollMs,
  leaseMs: config.workerLeaseMs,
});

while (!shutdownRequested) {
  try {
    const processed = await worker.runNext();
    if (!processed) await delay(config.workerPollMs);
  } catch (error) {
    logger.warn("worker.poll_failed", {
      workerId: config.workerId,
      message: error instanceof Error ? error.message : String(error),
    });
    await delay(config.workerPollMs);
  }
}

await pool.end();
logger.info("worker.stopped", { workerId: config.workerId });

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
