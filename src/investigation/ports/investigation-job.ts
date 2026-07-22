import type {
  ClaimedInvestigationJob,
  InvestigationLifecycleEvent,
  InvestigationTransition,
} from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";

export type JobFailureDisposition = "retrying" | "failed" | "lease_lost";

export interface InvestigationJobRepository {
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedInvestigationJob | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  transition(
    jobId: string,
    workerId: string,
    leaseMs: number,
    transition: InvestigationTransition,
  ): Promise<void>;
  complete(
    jobId: string,
    workerId: string,
    reportId: string,
    report: InvestigationReportContent,
    event: InvestigationLifecycleEvent,
  ): Promise<void>;
  fail(jobId: string, workerId: string, errorCode: string, errorMessage: string): Promise<JobFailureDisposition>;
}
