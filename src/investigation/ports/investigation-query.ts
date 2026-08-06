import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { InvestigationReport } from "../domain/investigation-report.js";
import type { Investigation } from "../domain/investigation.js";

export type InvestigationArtifact = { id: string; logicalKey: string; kind: string; storageKey: string; contentType?: string; sizeBytes?: number; createdAt: string };

export interface InvestigationQueryRepository {
  findById(id: string): Promise<Investigation | null>;
  listEventsAfter(investigationId: string, afterEventId: string, limit: number): Promise<InvestigationEvent[]>;
  findReport(investigationId: string): Promise<InvestigationReport | null>;
  listArtifacts(investigationId: string): Promise<InvestigationArtifact[]>;
  findArtifact(investigationId: string, artifactId: string): Promise<InvestigationArtifact | null>;
}
