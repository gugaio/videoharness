import { loadConfig } from "../config.js";
import { createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";
import { FilesystemArtifactStore } from "../investigation/adapters/filesystem-artifact-store.js";
import { FfprobeMediaProbe } from "../investigation/adapters/ffprobe-media-probe.js";
import { FilesystemLabWorkspace } from "../investigation/adapters/filesystem-lab-workspace.js";
import { HttpMediaSampleCollector } from "../investigation/adapters/http-media-sample-collector.js";
import { PiInvestigationAI } from "../investigation/adapters/pi-investigation-ai.js";
import { PostgresShellRunRecorder } from "../investigation/adapters/postgres-shell-run-recorder.js";
import { UnixSocketInvestigationLab } from "../investigation/adapters/unix-socket-investigation-lab.js";
import { HttpManifestCollector } from "../investigation/adapters/http-manifest-collector.js";
import { PostgresInvestigationJobRepository } from "../investigation/adapters/postgres-investigation-job.js";
import { createInvestigationWorker } from "../investigation/application/run-investigation.js";
import { runNextPlaybackReview } from "../investigation/application/run-playback-review.js";
import { SafeHttpClient } from "../stream-tools/safe-http-client.js";
import { PostgresRecordingJobRepository } from "../record/adapters/postgres-recording-job.js";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";
import { HlsVodMaterializer } from "../record/adapters/hls-vod-materializer.js";
import { DashVodMaterializer } from "../record/adapters/dash-vod-materializer.js";
import { ProtocolRecordingMaterializer } from "../record/adapters/recording-materializer.js";
import { createRecordingWorker } from "../record/application/run-recording.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const repository = new PostgresInvestigationJobRepository(pool);
const artifactStore = new FilesystemArtifactStore(config.dataDir);
const localDevelopmentAlias = config.streamLocalhostAlias
  ? { allowedPrivateHostnameAliases: { localhost: config.streamLocalhostAlias } }
  : {};
const collector = new HttpManifestCollector(new SafeHttpClient({
  timeoutMs: config.streamTimeoutMs,
  maxBytes: config.manifestMaxBytes,
  ...localDevelopmentAlias,
}));
const mediaCollector = new HttpMediaSampleCollector(new SafeHttpClient({
  timeoutMs: config.streamTimeoutMs,
  maxBytes: config.mediaSampleMaxBytes,
  ...localDevelopmentAlias,
}), { maxTotalBytes: config.mediaSampleMaxTotalBytes, mode: config.mediaSampleMode });
const mediaProbe = new FfprobeMediaProbe({ dataDirectory: config.dataDir, timeoutMs: config.ffprobeTimeoutMs });
const labWorkspace = new FilesystemLabWorkspace(config.dataDir);
const lab = config.labSocketPath && config.labToken
  ? new UnixSocketInvestigationLab({ socketPath: config.labSocketPath, token: config.labToken, timeoutMs: config.labCommandTimeoutMs })
  : undefined;
const shellRunRecorder = new PostgresShellRunRecorder(pool);
const ai = new PiInvestigationAI({
  ...(config.aiApiKey ? { apiKey: config.aiApiKey } : {}),
  provider: config.aiProvider,
  apiUrl: config.aiApiUrl,
  model: config.aiModel,
  timeoutMs: config.aiTimeoutMs,
  ...(lab ? { lab } : {}),
  ...(lab ? { shellRunRecorder } : {}),
});
const worker = createInvestigationWorker({
  repository,
  artifactStore,
  collector,
  mediaCollector,
  mediaProbe,
  labWorkspace,
  ai,
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
});
const recordingWorker = createRecordingWorker({
  repository: new PostgresRecordingJobRepository(pool),
  store: new FilesystemRecordingStore(config.dataDir),
  materializer: new ProtocolRecordingMaterializer(new HlsVodMaterializer(new SafeHttpClient({
    timeoutMs: config.streamTimeoutMs,
    maxBytes: config.recordSegmentMaxBytes,
    ...localDevelopmentAlias,
  }), { maxVariants: config.recordMaxVariants, maxTotalBytes: config.recordMaxTotalBytes }), new DashVodMaterializer(new SafeHttpClient({
    timeoutMs: config.streamTimeoutMs,
    maxBytes: config.recordSegmentMaxBytes,
    ...localDevelopmentAlias,
  }), { maxVariants: config.recordMaxVariants, maxTotalBytes: config.recordMaxTotalBytes })),
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
  localhostAliasEnabled: Boolean(config.streamLocalhostAlias),
  manifestMaxBytes: config.manifestMaxBytes,
  mediaSampleMaxBytes: config.mediaSampleMaxBytes,
  mediaSampleMaxTotalBytes: config.mediaSampleMaxTotalBytes,
  mediaSampleMode: config.mediaSampleMode,
  recordSegmentMaxBytes: config.recordSegmentMaxBytes,
  recordMaxTotalBytes: config.recordMaxTotalBytes,
  recordMaxVariants: config.recordMaxVariants,
  ffprobeTimeoutMs: config.ffprobeTimeoutMs,
  labEnabled: Boolean(lab),
  aiEnabled: Boolean(config.aiApiKey),
  aiProvider: config.aiProvider,
  aiApiUrl: config.aiApiUrl,
  aiModel: config.aiModel,
});

while (!shutdownRequested) {
  try {
    const processed = await worker.runNext()
      || await recordingWorker.runNext()
      || await runNextPlaybackReview({ pool, workerId: config.workerId, leaseMs: config.workerLeaseMs, ai });
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
