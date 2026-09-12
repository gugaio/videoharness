import type { InspectionEngine } from "../ports/inspection-engine.js";
import type { InspectionRepository } from "../ports/inspection-repository.js";

export async function createInspection(
  engine: InspectionEngine,
  repository: InspectionRepository,
  ownerId: string,
  sourceUrl: string,
) {
  const inspection = await engine.createInspection(sourceUrl);
  repository.create(ownerId, sourceUrl, inspection);
  return inspection;
}
