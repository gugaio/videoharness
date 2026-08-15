import type { InvestigationDeletionRepository } from "../ports/investigation-deletion.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { InvestigationQueries } from "./investigation-queries.js";
import type { WorkerLogger } from "../../infra/logger.js";

export type DeleteInvestigation = (investigationId: string) => Promise<{ deleted: boolean }>;

export function createDeleteInvestigation(input: {
  queries: Pick<InvestigationQueries, "getInvestigation" | "listArtifacts">;
  repository: InvestigationDeletionRepository;
  artifactStore: ArtifactStore;
  removeInvestigationFiles: (investigationId: string) => Promise<void>;
  removeRecordingFiles: (recordingId: string) => Promise<void>;
  logger?: WorkerLogger;
}): DeleteInvestigation {
  const log = input.logger ?? noopLogger;
  return async (investigationId) => {
    const investigation = await input.queries.getInvestigation(investigationId);
    if (!investigation) return { deleted: false };
    const artifacts = (await input.queries.listArtifacts?.(investigationId)) ?? [];
    const result = await input.repository.delete(investigationId);
    if (!result.deleted) return { deleted: false };

    // Filesystem cleanup is best-effort: a missing file or a stale directory
    // must not turn a confirmed database deletion into a failed request.
    const failures: string[] = [];
    await Promise.all(artifacts.map(async (artifact) => {
      try {
        await input.artifactStore.remove(artifact.storageKey);
      } catch (error) {
        failures.push(`artifact ${artifact.logicalKey}`);
      }
    }));
    await input.removeInvestigationFiles(investigationId).catch(() => failures.push("investigation files"));
    for (const recordingId of result.recordingIds) {
      await input.removeRecordingFiles(recordingId).catch(() => failures.push(`recording ${recordingId}`));
    }
    if (failures.length > 0) {
      log.warn("investigation.deletion_partial", {
        investigationId,
        deleted: true,
        failures: failures.slice(0, 10),
      });
    }
    return { deleted: true };
  };
}

const noopLogger: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
