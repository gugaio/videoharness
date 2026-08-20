import { buildApiServer } from "./server.js";
import { loadConfig } from "../config.js";
import { createFilesystemHealth } from "../store/filesystem-health.js";
import { JsonStore } from "../store/json-file.js";
import { logger } from "../infra/logger.js";
import { FilesystemInvestigationIntake } from "../investigation/adapters/filesystem-investigation-intake.js";
import { FilesystemInvestigationQuestions } from "../investigation/adapters/filesystem-investigation-questions.js";
import { FilesystemInvestigationAnalysis } from "../investigation/adapters/filesystem-investigation-analysis.js";
import { FilesystemInvestigationDeletion } from "../investigation/adapters/filesystem-investigation-deletion.js";
import { FilesystemInvestigationCleanup } from "../investigation/adapters/filesystem-investigation-cleanup.js";
import { createDeleteInvestigation } from "../investigation/application/delete-investigation.js";
import { createStartInvestigation } from "../investigation/application/start-investigation.js";
import { FilesystemInvestigationQuery } from "../investigation/adapters/filesystem-investigation-query.js";
import { createInvestigationQueries } from "../investigation/application/investigation-queries.js";
import { FilesystemPlaybackSessions } from "../investigation/adapters/filesystem-playback-session.js";
import { FilesystemArtifactStore } from "../investigation/adapters/filesystem-artifact-store.js";
import { FilesystemRecordingIntake } from "../record/adapters/filesystem-recording-intake.js";
import { createStartRecording } from "../record/application/start-recording.js";
import { FilesystemRecordingQuery } from "../record/adapters/filesystem-recording-query.js";
import { createRecordingQueries } from "../record/application/recording-queries.js";
import { FilesystemRecordingDeletion } from "../record/adapters/filesystem-recording-deletion.js";
import { createDeleteRecording } from "../record/application/delete-recording.js";
import { FilesystemPlaybackRuns } from "../record/adapters/filesystem-playback-run.js";
import { createPlaybackRun } from "../record/application/playback-runs.js";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";
import { FilesystemExperimentRepository } from "../experiment/adapters/filesystem-experiment-repository.js";
import { FilesystemExperimentEvaluationJobs } from "../experiment/adapters/filesystem-experiment-evaluation-job.js";
import { createExperimentService } from "../experiment/application/experiments.js";

const config = loadConfig();
const store = new JsonStore(config.dataDir);
const investigationQuery = new FilesystemInvestigationQuery(store);
const investigationQueries = createInvestigationQueries(investigationQuery);
const investigationQuestions = new FilesystemInvestigationQuestions(store);
const investigationAnalysis = new FilesystemInvestigationAnalysis(store);
const experimentRepository = new FilesystemExperimentRepository(store);
const experimentEvaluationJobs = new FilesystemExperimentEvaluationJobs(store);
const playbackRuns = new FilesystemPlaybackRuns(store);
const recordingStore = new FilesystemRecordingStore(config.dataDir);
const experimentService = createExperimentService({
  repository: experimentRepository,
  evaluationJobs: experimentEvaluationJobs,
  investigations: investigationQueries,
  policy: {
    maxClonesPerIteration: config.experimentMaxClonesPerIteration,
    maxIterations: config.experimentMaxIterations,
    maxClonesPerExperiment: config.experimentMaxClonesTotal,
    requireFirstIterationControl: true,
  },
  logger,
});
const server = buildApiServer({
  storage: createFilesystemHealth(config.dataDir),
  startInvestigation: createStartInvestigation(new FilesystemInvestigationIntake(store)),
  investigationQueries,
  deleteInvestigation: createDeleteInvestigation({
    queries: investigationQueries,
    repository: new FilesystemInvestigationDeletion(store),
    artifactStore: new FilesystemArtifactStore(config.dataDir),
    removeInvestigationFiles: (id) => new FilesystemInvestigationCleanup(config.dataDir).removeInvestigationFiles(id),
    removeRecordingFiles: (id) => new FilesystemInvestigationCleanup(config.dataDir).removeRecordingFiles(id),
    logger,
  }),
  startInvestigationAnalysis: investigationAnalysis.start,
  askInvestigationQuestion: investigationQuestions.ask.bind(investigationQuestions),
  playbackSessions: new FilesystemPlaybackSessions(store),
  artifactStore: new FilesystemArtifactStore(config.dataDir),
  startRecording: createStartRecording(new FilesystemRecordingIntake(store)),
  recordingQueries: createRecordingQueries(new FilesystemRecordingQuery(store)),
  deleteRecording: createDeleteRecording(new FilesystemRecordingDeletion(store), recordingStore),
  createPlaybackRun: createPlaybackRun(playbackRuns),
  playbackRuns,
  recordingStore,
  experimentService,
  experimentStreams: experimentRepository,
  version: process.env.npm_package_version ?? "0.1.0",
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
  process.exitCode = 1;
}