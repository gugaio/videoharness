import { isTerminalInspectionStatus } from "../../domain/inspections.js";
import type { InspectionEngine } from "../ports/inspection-engine.js";
import type { InspectionRepository } from "../ports/inspection-repository.js";
import { InspectionNotFoundError } from "./inspection-not-found.js";

export async function getInspection(
  engine: InspectionEngine,
  repository: InspectionRepository,
  ownerId: string,
  inspectionId: string,
) {
  if (!repository.has(ownerId, inspectionId)) throw new InspectionNotFoundError();
  try {
    const detail = await engine.getInspection(inspectionId);
    repository.updateDetail(ownerId, detail);
    if (isTerminalInspectionStatus(detail.status) && repository.getSnapshot(ownerId, inspectionId) === undefined) {
      try {
        repository.saveSnapshot(ownerId, inspectionId, await engine.getSnapshot(inspectionId));
      } catch {
        // O detalhe continua válido; a próxima consulta tenta arquivar novamente.
      }
    }
    return detail;
  } catch (error) {
    const archivedDetail = repository.getDetail(ownerId, inspectionId);
    if (archivedDetail && isTerminalInspectionStatus(archivedDetail.status)) return archivedDetail;
    throw error;
  }
}
