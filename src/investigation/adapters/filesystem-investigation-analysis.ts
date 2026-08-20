import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type {
  StartInvestigationAnalysis,
  StartInvestigationAnalysisResult,
} from "../ports/investigation-analysis.js";

type StoredInvestigation = {
  id: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export class FilesystemInvestigationAnalysis {
  constructor(private readonly store: JsonStore) {}

  readonly start: StartInvestigationAnalysis = async (
    investigationId,
    options,
  ): Promise<StartInvestigationAnalysisResult> => {
    const release = await this.store.acquireLock(`locks/investigation-${investigationId}`);
    try {
      const investigation = await this.store.readJson<StoredInvestigation>(
        "investigations", investigationId, "investigation.json",
      );
      if (!investigation) return "not_found";
      const state = investigation.state;
      if (["analysis_queued", "analyzing", "synthesizing"].includes(state) || (state === "completed" && !options?.rerun)) {
        return "already_started";
      }
      if (state !== "evidence_ready" && state !== "completed") return "not_ready";

      const jobId = randomUUID();
      const now = new Date().toISOString();
      await this.store.writeJson(
        {
          id: jobId,
          kind: "investigation-analysis",
          investigationId,
          status: "pending",
          attempts: 0,
          maxAttempts: 3,
          payload: { investigationId, rerun: state === "completed" },
          createdAt: now,
        },
        "jobs", "investigation-analysis", `${jobId}.json`,
      );
      await this.store.writeJson(
        { ...investigation, state: "analysis_queued", updatedAt: now },
        "investigations", investigationId, "investigation.json",
      );
      await this.store.appendEventUnlocked({
        aggregate: ["investigations", investigationId],
        event: {
          type: "investigation.analysis_requested",
          actor: "User",
          message: state === "completed"
            ? "Agent reanalysis was requested for the current evidence snapshot."
            : "Agent analysis was requested for the current evidence snapshot.",
          payload: { state: "analysis_queued", rerun: state === "completed" },
        },
      });
      return "started";
    } finally {
      await release();
    }
  };
}