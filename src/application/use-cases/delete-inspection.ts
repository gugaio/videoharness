import type { InspectionRepository } from "../ports/inspection-repository.js";
import { InspectionNotFoundError } from "./inspection-not-found.js";

export function deleteInspection(
  repository: InspectionRepository,
  ownerId: string,
  inspectionId: string,
): void {
  if (!repository.delete(ownerId, inspectionId)) throw new InspectionNotFoundError();
}
