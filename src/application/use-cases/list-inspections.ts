import type { InspectionRepository } from "../ports/inspection-repository.js";

export function listInspections(repository: InspectionRepository, ownerId: string) {
  return repository.list(ownerId);
}
