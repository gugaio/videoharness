import { loadConfig } from "../config.js";
import { createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";
import { FilesystemArtifactStore } from "../investigation/adapters/filesystem-artifact-store.js";
import { FfprobeMediaProbe } from "../investigation/adapters/ffprobe-media-probe.js";
import { HttpMediaSampleCollector } from "../investigation/adapters/http-media-sample-collector.js";
import { HttpManifestCollector } from "../investigation/adapters/http-manifest-collector.js";
import { PostgresInvestigationJobRepository } from "../investigation/adapters/postgres-investigation-job.js";
import { createInvestigationWorker } from "../investigation/application/run-investigation.js";
import { SafeHttpClient } from "../stream-tools/safe-http-client.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const repository = new PostgresInvestigationJobRepository(pool);
const artifactStore = new FilesystemArtifactStore(config.dataDir);
const collector = new HttpManifestCollector(new SafeHttpClient({
  timeoutMs: config.streamTimeoutMs,
  maxBytes: config.manifestMaxBytes,
}));
const mediaCollector = new HttpMediaSampleCollector(new SafeHttpClient({
  timeoutMs: config.streamTimeoutMs,
  maxBytes: config.mediaSampleMaxBytes,
}), { maxTotalBytes: config.mediaSampleMaxTotalBytes });
const mediaProbe = new FfprobeMediaProbe({ dataDirectory: config.dataDir, timeoutMs: config.ffprobeTimeoutMs });
const worker = createInvestigationWorker({
  repository,
  artifactStore,
  collector,
  mediaCollector,
  mediaProbe,
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
  streamTimeoutMs: config.streamTimeoutMs,
  manifestMaxBytes: config.manifestMaxBytes,
  mediaSampleMaxBytes: config.mediaSampleMaxBytes,
  mediaSampleMaxTotalBytes: config.mediaSampleMaxTotalBytes,
  ffprobeTimeoutMs: config.ffprobeTimeoutMs,
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
