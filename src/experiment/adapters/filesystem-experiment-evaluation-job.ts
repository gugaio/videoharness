import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type { ClaimedExperimentEvaluationJob, ExperimentEvaluationJob, ExperimentEvaluationJobRepository } from "../ports/experiment-evaluation-job.js";

type StoredJob = {
  id: string;
  experimentId: string;
  iterationId: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  lockedBy?: string;
  lockedUntil?: string;
  heartbeatAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export class FilesystemExperimentEvaluationJobs implements ExperimentEvaluationJobRepository {
  constructor(private readonly store: JsonStore) {}

  async request(experimentId: string): Promise<{ job: ExperimentEvaluationJob; replayed: boolean } | "not_found" | "not_ready"> {
    const release = await this.store.acquireLock(`locks/experiment-${experimentId}`);
    try {
      const experiment = await this.store.readJson<{ status?: string }>("experiments", experimentId, "experiment.json");
      if (!experiment) return "not_found";
      const files = await this.store.listFiles("experiments", experimentId, "jobs");
      for (const file of files) {
        const job = await this.store.readJson<StoredJob>("experiments", experimentId, "jobs", file);
        if (job && (job.status === "pending" || job.status === "running")) return { job: toJob(job), replayed: true };
      }
      if (!["EVALUATING", "CONCLUDED", "FOLLOWUP_REQUIRED"].includes(experiment.status ?? "")) return "not_ready";
      const iterations = await this.listIterations(experimentId);
      const iteration = iterations.at(-1);
      if (!iteration) return "not_ready";
      if (await this.pendingRequestCount(iteration.id) > 0) return "not_ready";

      const now = new Date().toISOString();
      const created: StoredJob = {
        id: randomUUID(),
        experimentId,
        iterationId: iteration.id,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        createdAt: now,
      };
      await this.store.writeJson(created, "experiments", experimentId, "jobs", `${created.id}.json`);
      const experimentRow = await this.store.readJson<{ status: string }>("experiments", experimentId, "experiment.json");
      if (experimentRow) await this.store.writeJson({ ...experimentRow, status: "EVALUATING" }, "experiments", experimentId, "experiment.json");
      const iterationRow = await this.store.readJson<{ status: string }>("experiments", experimentId, "iterations", `${iteration.id}.json`);
      if (iterationRow) await this.store.writeJson({ ...iterationRow, status: "EVALUATING" }, "experiments", experimentId, "iterations", `${iteration.id}.json`);
      return { job: toJob(created), replayed: false };
    } finally {
      await release();
    }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedExperimentEvaluationJob | null> {
    const release = await this.store.acquireLock("locks/job-claim-experiment-evaluation");
    try {
      const directories = await this.store.listSubdirectories("experiments");
      const now = Date.now();
      const candidates: Array<{ experimentId: string; file: string; job: StoredJob }> = [];
      for (const experimentId of directories) {
        const files = await this.store.listFiles("experiments", experimentId, "jobs");
        for (const file of files) {
          const job = await this.store.readJson<StoredJob>("experiments", experimentId, "jobs", file);
          if (!job) continue;
          const pending = job.status === "pending";
          const expired = job.status === "running" && job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < now;
          if ((!pending && !expired) || job.attempts >= job.maxAttempts) continue;
          candidates.push({ experimentId, file, job });
        }
      }
      candidates.sort((left, right) => left.job.createdAt.localeCompare(right.job.createdAt));
      for (const candidate of candidates) {
        const jobLock = await this.store.acquireLock(`locks/job-experiment-evaluation-${candidate.job.id}`);
        try {
          const fresh = await this.store.readJson<StoredJob>("experiments", candidate.experimentId, "jobs", candidate.file);
          if (!fresh) continue;
          const stillPending = fresh.status === "pending";
          const stillExpired = fresh.status === "running" && fresh.lockedUntil !== undefined && new Date(fresh.lockedUntil).getTime() < now;
          if ((!stillPending && !stillExpired) || fresh.attempts >= fresh.maxAttempts) continue;
          const { errorCode: _previousErrorCode, errorMessage: _previousErrorMessage, ...claimBase } = fresh;
          const claimed: StoredJob = {
            ...claimBase,
            status: "running",
            attempts: fresh.attempts + 1,
            lockedBy: workerId,
            lockedUntil: new Date(now + leaseMs).toISOString(),
            heartbeatAt: new Date().toISOString(),
            startedAt: fresh.startedAt ?? new Date().toISOString(),
          };
          await this.store.writeJson(claimed, "experiments", candidate.experimentId, "jobs", candidate.file);
          return { ...toJob(claimed), status: "running" };
        } finally {
          await jobLock();
        }
      }
      return null;
    } finally {
      await release();
    }
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const found = await this.findJob(jobId);
    if (!found) return false;
    const release = await this.store.acquireLock(`locks/job-heartbeat-${jobId}`);
    try {
      const job = await this.store.readJson<StoredJob>("experiments", found.experimentId, "jobs", `${jobId}.json`);
      if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
      if (job.lockedUntil !== undefined && new Date(job.lockedUntil).getTime() < Date.now()) return false;
      await this.store.writeJson(
        { ...job, heartbeatAt: new Date().toISOString(), lockedUntil: new Date(Date.now() + leaseMs).toISOString() },
        "experiments", found.experimentId, "jobs", `${jobId}.json`,
      );
      return true;
    } finally {
      await release();
    }
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const found = await this.findJob(jobId);
    if (!found) return false;
    const release = await this.store.acquireLock(`locks/job-heartbeat-${jobId}`);
    try {
      const job = await this.store.readJson<StoredJob>("experiments", found.experimentId, "jobs", `${jobId}.json`);
      if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
      await this.store.writeJson(
        { ...job, status: "completed", completedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), lockedBy: undefined, lockedUntil: undefined },
        "experiments", found.experimentId, "jobs", `${jobId}.json`,
      );
      return true;
    } finally {
      await release();
    }
  }

  async fail(jobId: string, workerId: string, code: string, message: string): Promise<"retrying" | "failed" | "lease_lost"> {
    const found = await this.findJob(jobId);
    if (!found) return "lease_lost";
    const release = await this.store.acquireLock(`locks/job-heartbeat-${jobId}`);
    try {
      const job = await this.store.readJson<StoredJob>("experiments", found.experimentId, "jobs", `${jobId}.json`);
      if (!job || job.status !== "running" || job.lockedBy !== workerId) return "lease_lost";
      const exhausted = job.attempts >= job.maxAttempts;
      await this.store.writeJson(
        {
          ...job,
          status: exhausted ? "failed" : "pending",
          errorCode: code,
          errorMessage: message.slice(0, 1_000),
          lockedBy: undefined,
          lockedUntil: undefined,
          completedAt: exhausted ? new Date().toISOString() : undefined,
        },
        "experiments", found.experimentId, "jobs", `${jobId}.json`,
      );
      if (exhausted) {
        const experiment = await this.store.readJson<{ status: string }>("experiments", found.experimentId, "experiment.json");
        if (experiment) await this.store.writeJson(
          { ...experiment, status: experiment.status === "EVALUATING" ? "FOLLOWUP_REQUIRED" : experiment.status },
          "experiments", found.experimentId, "experiment.json",
        );
        const iteration = await this.store.readJson<{ status: string }>("experiments", found.experimentId, "iterations", `${found.iterationId}.json`);
        if (iteration) await this.store.writeJson(
          { ...iteration, status: iteration.status === "EVALUATING" ? "COMPLETED" : iteration.status },
          "experiments", found.experimentId, "iterations", `${found.iterationId}.json`,
        );
      }
      return exhausted ? "failed" : "retrying";
    } finally {
      await release();
    }
  }

  private async findJob(jobId: string): Promise<StoredJob & { experimentId: string } | null> {
    const directories = await this.store.listSubdirectories("experiments");
    for (const experimentId of directories) {
      const job = await this.store.readJson<StoredJob>("experiments", experimentId, "jobs", `${jobId}.json`);
      if (job) return { ...job, experimentId };
    }
    return null;
  }

  private async listIterations(experimentId: string): Promise<Array<{ id: string; iterationNumber: number }>> {
    const files = await this.store.listFiles("experiments", experimentId, "iterations");
    const rows: Array<{ id: string; iterationNumber: number }> = [];
    for (const file of files) {
      const row = await this.store.readJson<{ id: string; iterationNumber: number }>("experiments", experimentId, "iterations", file);
      if (row) rows.push(row);
    }
    return rows.sort((left, right) => left.iterationNumber - right.iterationNumber);
  }

  private async pendingRequestCount(iterationId: string): Promise<number> {
    const directories = await this.store.listSubdirectories("experiments");
    let pending = 0;
    for (const experimentId of directories) {
      const files = await this.store.listFiles("experiments", experimentId, "requests");
      for (const file of files) {
        const request = await this.store.readJson<{ iterationId?: string; status?: string }>("experiments", experimentId, "requests", file);
        if (request && request.iterationId === iterationId && request.status === "PENDING") pending += 1;
      }
    }
    return pending;
  }
}

function toJob(row: StoredJob): ExperimentEvaluationJob {
  return {
    id: row.id,
    experimentId: row.experimentId,
    iterationId: row.iterationId,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    createdAt: row.createdAt,
  };
}