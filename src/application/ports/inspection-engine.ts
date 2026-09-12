import type { InspectionCreated, InspectionDetail } from "../../domain/inspections.js";

/** Porta para a engine de inspeção; hoje atendida pelo adapter Stream Lens. */
export interface InspectionEngine {
  createInspection(url: string): Promise<InspectionCreated>;
  getInspection(inspectionId: string): Promise<InspectionDetail>;
  getSnapshot(inspectionId: string): Promise<unknown>;
}

export class InspectionEngineError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "InspectionEngineError";
  }
}
