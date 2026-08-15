export type ExperimentEvaluationJob = {
  id: string;
  experimentId: string;
  iterationId: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  createdAt: string;
};

export type ClaimedExperimentEvaluationJob = ExperimentEvaluationJob & {
  status: "running";
};

export interface ExperimentEvaluationJobRepository {
  request(experimentId: string): Promise<{ job: ExperimentEvaluationJob; replayed: boolean } | "not_found" | "not_ready">;
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedExperimentEvaluationJob | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  complete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, code: string, message: string): Promise<"retrying" | "failed" | "lease_lost">;
}
