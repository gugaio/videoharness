import type {
  InspectionCreated,
  InspectionDetail,
  InspectionHistoryItem,
} from "../../domain/inspections.js";

/** Porta do histórico do produto, isolada do mecanismo de persistência. */
export interface InspectionRepository {
  create(ownerId: string, sourceUrl: string, inspection: InspectionCreated): void;
  list(ownerId: string): InspectionHistoryItem[];
  has(ownerId: string, inspectionId: string): boolean;
  delete(ownerId: string, inspectionId: string): boolean;
  updateDetail(ownerId: string, inspection: InspectionDetail): void;
  getDetail(ownerId: string, inspectionId: string): InspectionDetail | undefined;
  getSnapshot(ownerId: string, inspectionId: string): unknown | undefined;
  saveSnapshot(ownerId: string, inspectionId: string, snapshot: unknown): void;
}
