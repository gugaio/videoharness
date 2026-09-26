import type { InspectionCreated, InspectionDetail } from "../../domain/inspections.js";

/** Porta para a engine de inspeção; hoje atendida pelo adapter Stream Lens. */
export interface InspectionEngine {
  createInspection(url: string): Promise<InspectionCreated>;
  getInspection(inspectionId: string): Promise<InspectionDetail>;
  getSnapshot(inspectionId: string): Promise<unknown>;
}

export type CaptureCoverage = {
  inspection_id: string;
  observed_at: string;
  protocol: string;
  is_live: boolean;
  coverage: Array<{
    segment_ref: string;
    rep_id: string;
    group_kind: string;
    index: number;
    segment_sequence?: number | null;
    start_seconds?: number | null;
    duration_seconds?: number | null;
    is_init: boolean;
    status: string;
  }>;
  total: number;
  truncated: boolean;
  warnings: string[];
};

export type LensCaptureRequest = {
  source_url: string;
  segment_refs?: string[];
  representation_ids?: string[];
  start_seconds?: number;
  duration_seconds?: number;
  max_bytes: number;
  max_segments: number;
};

export interface IncrementalInspectionEngine extends InspectionEngine {
  getCaptureCoverage(inspectionId: string, sourceUrl: string): Promise<CaptureCoverage>;
  createCapture(inspectionId: string, captureId: string, input: LensCaptureRequest): Promise<Record<string, unknown>>;
  getCapture(inspectionId: string, captureId: string): Promise<Record<string, unknown>>;
  getCaptureEvidence(inspectionId: string, captureId: string): Promise<Record<string, unknown>>;
}

export class InspectionEngineError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "InspectionEngineError";
  }
}
