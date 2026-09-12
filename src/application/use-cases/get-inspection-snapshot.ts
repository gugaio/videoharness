import type { InspectionEngine } from "../ports/inspection-engine.js";
import type { InspectionRepository } from "../ports/inspection-repository.js";
import { InspectionNotFoundError } from "./inspection-not-found.js";

export async function getInspectionSnapshot(
  engine: InspectionEngine,
  repository: InspectionRepository,
  ownerId: string,
  inspectionId: string,
): Promise<unknown> {
  if (!repository.has(ownerId, inspectionId)) throw new InspectionNotFoundError();
  const archivedSnapshot = repository.getSnapshot(ownerId, inspectionId);
  if (archivedSnapshot !== undefined) return archivedSnapshot;
  const snapshot = await engine.getSnapshot(inspectionId);
  repository.saveSnapshot(ownerId, inspectionId, snapshot);
  return snapshot;
}
