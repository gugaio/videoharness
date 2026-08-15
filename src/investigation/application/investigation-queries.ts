import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { InvestigationReport } from "../domain/investigation-report.js";
import type { Investigation } from "../domain/investigation.js";
import type { InvestigationQueryRepository } from "../ports/investigation-query.js";
import type { InvestigationArtifact } from "../ports/investigation-query.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { AiPromptAudit } from "../../agents/domain/types.js";

export type InvestigationQueries = {
  getInvestigation(id: string): Promise<Investigation | null>;
  listInvestigations(limit?: number): Promise<Investigation[]>;
  listEventsAfter(investigationId: string, afterEventId: string): Promise<InvestigationEvent[]>;
  getReport(investigationId: string): Promise<InvestigationReport | null>;
  getEvidence?(investigationId: string): Promise<EvidenceBundleV2 | EvidenceBundleV3 | null>;
  listAgentRuns?(investigationId: string): Promise<AiPromptAudit[]>;
  listArtifacts?(investigationId: string): Promise<InvestigationArtifact[]>;
  getArtifact?(investigationId: string, artifactId: string): Promise<InvestigationArtifact | null>;
};

export function createInvestigationQueries(repository: InvestigationQueryRepository): InvestigationQueries {
  return {
    getInvestigation: (id) => repository.findById(id),
    listInvestigations: (limit) => repository.list(limit),
    listEventsAfter: (investigationId, afterEventId) =>
      repository.listEventsAfter(investigationId, afterEventId, 200),
    getReport: (investigationId) => repository.findReport(investigationId),
    getEvidence: (investigationId) => repository.findEvidence(investigationId),
    listAgentRuns: (investigationId) => repository.listAgentRuns(investigationId),
    listArtifacts: (investigationId) => repository.listArtifacts(investigationId),
    getArtifact: (investigationId, artifactId) => repository.findArtifact(investigationId, artifactId),
  };
}
