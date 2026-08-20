import { loadConfig } from "../config.js";
import { JsonStore } from "../store/json-file.js";
import { logger } from "../infra/logger.js";
import { FilesystemArtifactStore } from "../investigation/adapters/filesystem-artifact-store.js";
import { FfprobeMediaProbe } from "../investigation/adapters/ffprobe-media-probe.js";
import { FilesystemLabWorkspace } from "../investigation/adapters/filesystem-lab-workspace.js";
import { HttpMediaSampleCollector } from "../investigation/adapters/http-media-sample-collector.js";
import { PiInvestigationAI } from "../investigation/adapters/pi-investigation-ai.js";
import { FilesystemShellRunRecorder } from "../investigation/adapters/filesystem-shell-run-recorder.js";
import { UnixSocketInvestigationLab } from "../investigation/adapters/unix-socket-investigation-lab.js";
import { HttpManifestCollector } from "../investigation/adapters/http-manifest-collector.js";
import { FilesystemInvestigationJobRepository } from "../investigation/adapters/filesystem-investigation-job.js";
import { FilesystemPlaybackCorrelation } from "../investigation/adapters/filesystem-playback-correlation.js";
import { createInvestigationWorker } from "../investigation/application/run-investigation.js";
import { createInvestigationAnalysisWorker } from "../investigation/application/run-investigation-analysis.js";
import { runNextPlaybackReview } from "../investigation/application/run-playback-review.js";
import { SafeHttpClient } from "../stream-tools/safe-http-client.js";
import { FilesystemRecordingJobRepository } from "../record/adapters/filesystem-recording-job.js";
import { FilesystemPlaybackRuns } from "../record/adapters/filesystem-playback-run.js";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";
import { HlsVodMaterializer } from "../record/adapters/hls-vod-materializer.js";
import { DashVodMaterializer } from "../record/adapters/dash-vod-materializer.js";
import { ProtocolRecordingMaterializer } from "../record/adapters/recording-materializer.js";
import { createRecordingWorker } from "../record/application/run-recording.js";
import { FfmpegAbrDecodeTester } from "../abr/adapters/ffmpeg-abr-decode-tester.js";
import { FilesystemExperimentRepository } from "../experiment/adapters/filesystem-experiment-repository.js";
import { ExperimentRecordingObserver } from "../experiment/adapters/experiment-recording-observer.js";
import { FilesystemExperimentEvaluationJobs } from "../experiment/adapters/filesystem-experiment-evaluation-job.js";
import { PiExperimentAnalysisTeam } from "../experiment/adapters/pi-experiment-analysis.js";
import { createExperimentEvaluationWorker } from "../experiment/application/run-experiment-evaluation.js";
import { FilesystemInvestigationQuery } from "../investigation/adapters/filesystem-investigation-query.js";
import { createInvestigationQueries } from "../investigation/application/investigation-queries.js";

const config = loadConfig();
const store = new JsonStore(config.dataDir);
const repository = new FilesystemInvestigationJobRepository(store);
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
}), { maxTotalBytes: config.mediaSampleMaxTotalBytes, maxSeconds: config.mediaSampleMaxSeconds, mode: config.mediaSampleMode });
const mediaProbe = new FfprobeMediaProbe({ dataDirectory: config.dataDir, timeoutMs: config.ffprobeTimeoutMs });
const abrDecodeTester = new FfmpegAbrDecodeTester({ dataDirectory: config.dataDir, timeoutMs: 60_000 });
const labWorkspace = new FilesystemLabWorkspace(config.dataDir);
const lab = config.labSocketPath && config.labToken
  ? new UnixSocketInvestigationLab({ socketPath: config.labSocketPath, token: config.labToken, timeoutMs: config.labCommandTimeoutMs })
  : undefined;
const shellRunRecorder = new FilesystemShellRunRecorder(store);
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
  abrDecodeTester,
  labWorkspace,
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
  logger,
});
const playbackRuns = new FilesystemPlaybackRuns(store);
const analysisWorker = createInvestigationAnalysisWorker({
  repository,
  ai,
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
  playbackCorrelation: new FilesystemPlaybackCorrelation(store, playbackRuns),
  logger,
});
const recordingStore = new FilesystemRecordingStore(config.dataDir);
const experimentRepository = new FilesystemExperimentRepository(store);
const experimentEvaluationWorker = createExperimentEvaluationWorker({
  jobs: new FilesystemExperimentEvaluationJobs(store),
  experiments: experimentRepository,
  investigations: createInvestigationQueries(new FilesystemInvestigationQuery(store)),
  analysisTeam: new PiExperimentAnalysisTeam({
    ...(config.aiApiKey ? { apiKey: config.aiApiKey } : {}),
    provider: config.aiProvider,
    apiUrl: config.aiApiUrl,
    model: config.aiModel,
    timeoutMs: config.aiTimeoutMs,
  }),
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
  logger,
});
const recordingWorker = createRecordingWorker({
  repository: new FilesystemRecordingJobRepository(store),
  store: recordingStore,
  materializer: new ProtocolRecordingMaterializer(new HlsVodMaterializer(new SafeHttpClient({
    timeoutMs: config.recordRequestTimeoutMs,
    maxBytes: config.recordSegmentMaxBytes,
    ...localDevelopmentAlias,
  }), { maxVariants: config.recordMaxVariants, maxTotalBytes: config.recordMaxTotalBytes }), new DashVodMaterializer(new SafeHttpClient({
    timeoutMs: config.recordRequestTimeoutMs,
    maxBytes: config.recordSegmentMaxBytes,
    ...localDevelopmentAlias,
  }), { maxVariants: config.recordMaxVariants, maxTotalBytes: config.recordMaxTotalBytes })),
  workerId: config.workerId,
  leaseMs: config.workerLeaseMs,
  observer: new ExperimentRecordingObserver(experimentRepository, recordingStore, logger),
  logger,
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
  recordRequestTimeoutMs: config.recordRequestTimeoutMs,
  recordMaxTotalBytes: config.recordMaxTotalBytes,
  recordMaxVariants: config.recordMaxVariants,
  experimentMaxClonesPerIteration: config.experimentMaxClonesPerIteration,
  experimentMaxIterations: config.experimentMaxIterations,
  experimentMaxClonesTotal: config.experimentMaxClonesTotal,
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
      || await analysisWorker.runNext()
      || await recordingWorker.runNext()
      || await experimentEvaluationWorker.runNext()
      || await runNextPlaybackReview({ store, workerId: config.workerId, leaseMs: config.workerLeaseMs, ai, logger });
    if (!processed) await delay(config.workerPollMs);
  } catch (error) {
    logger.warn("worker.poll_failed", {
      workerId: config.workerId,
      message: error instanceof Error ? error.message : String(error),
    });
    await delay(config.workerPollMs);
  }
}

logger.info("worker.stopped", { workerId: config.workerId });

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}