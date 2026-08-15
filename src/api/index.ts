import { buildApiServer } from "./server.js";
import { loadConfig } from "../config.js";
import { createDatabaseHealth, createDatabasePool } from "../database/client.js";
import { logger } from "../infra/logger.js";
import { PostgresInvestigationIntake } from "../investigation/adapters/postgres-investigation-intake.js";
import { PostgresInvestigationQuestions } from "../investigation/adapters/postgres-investigation-questions.js";
import { PostgresInvestigationAnalysis } from "../investigation/adapters/postgres-investigation-analysis.js";
import { PostgresInvestigationDeletion } from "../investigation/adapters/postgres-investigation-deletion.js";
import { FilesystemInvestigationCleanup } from "../investigation/adapters/filesystem-investigation-cleanup.js";
import { createDeleteInvestigation } from "../investigation/application/delete-investigation.js";
import { createStartInvestigation } from "../investigation/application/start-investigation.js";
import { PostgresInvestigationQuery } from "../investigation/adapters/postgres-investigation-query.js";
import { createInvestigationQueries } from "../investigation/application/investigation-queries.js";
import { PostgresPlaybackSessions } from "../investigation/adapters/postgres-playback-session.js";
import { FilesystemArtifactStore } from "../investigation/adapters/filesystem-artifact-store.js";
import { PostgresRecordingIntake } from "../record/adapters/postgres-recording-intake.js";
import { createStartRecording } from "../record/application/start-recording.js";
import { PostgresRecordingQuery } from "../record/adapters/postgres-recording-query.js";
import { createRecordingQueries } from "../record/application/recording-queries.js";
import { PostgresPlaybackRuns } from "../record/adapters/postgres-playback-run.js";
import { createPlaybackRun } from "../record/application/playback-runs.js";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";
import { PostgresExperimentRepository } from "../experiment/adapters/postgres-experiment-repository.js";
import { PostgresExperimentEvaluationJobs } from "../experiment/adapters/postgres-experiment-evaluation-job.js";
import { createExperimentService } from "../experiment/application/experiments.js";

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const investigationQuery = new PostgresInvestigationQuery(pool);
const investigationQueries = createInvestigationQueries(investigationQuery);
const investigationQuestions = new PostgresInvestigationQuestions(pool);
const investigationAnalysis = new PostgresInvestigationAnalysis(pool);
const experimentRepository = new PostgresExperimentRepository(pool);
const experimentEvaluationJobs = new PostgresExperimentEvaluationJobs(pool);
const playbackRuns = new PostgresPlaybackRuns(pool);
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
  database: createDatabaseHealth(pool),
  startInvestigation: createStartInvestigation(new PostgresInvestigationIntake(pool)),
  investigationQueries,
  deleteInvestigation: createDeleteInvestigation({
    queries: investigationQueries,
    repository: new PostgresInvestigationDeletion(pool),
    artifactStore: new FilesystemArtifactStore(config.dataDir),
    removeInvestigationFiles: (id) => new FilesystemInvestigationCleanup(config.dataDir).removeInvestigationFiles(id),
    removeRecordingFiles: (id) => new FilesystemInvestigationCleanup(config.dataDir).removeRecordingFiles(id),
    logger,
  }),
  startInvestigationAnalysis: investigationAnalysis.start,
  askInvestigationQuestion: investigationQuestions.ask.bind(investigationQuestions),
  playbackSessions: new PostgresPlaybackSessions(pool),
  artifactStore: new FilesystemArtifactStore(config.dataDir),
  startRecording: createStartRecording(new PostgresRecordingIntake(pool)),
  recordingQueries: createRecordingQueries(new PostgresRecordingQuery(pool)),
  createPlaybackRun: createPlaybackRun(playbackRuns),
  playbackRuns,
  recordingStore: new FilesystemRecordingStore(config.dataDir),
  experimentService,
  experimentStreams: experimentRepository,
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
