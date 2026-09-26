import { createHash, randomUUID } from "node:crypto";
import type {
  IncrementalInspectionEngine,
  LensCaptureRequest,
} from "../ports/inspection-engine.js";
import type { InspectionRepository } from "../ports/inspection-repository.js";
import {
  InvestigationBudgetError,
  InvestigationIdempotencyError,
  type InvestigationRepository,
} from "../ports/investigation-repository.js";
import { InspectionNotFoundError } from "./inspection-not-found.js";
import { getInspectionSnapshot } from "./get-inspection-snapshot.js";

export const MAX_INVESTIGATION_BUDGET_BYTES = 100_000_000;
export const MAX_CAPTURE_REQUEST_BYTES = 25_000_000;
const MAX_CAPTURE_SEGMENTS = 16;

export type CaptureSelectionInput =
  | { segment_refs: string[]; representation_ids?: string[] }
  | { representation_ids: string[]; start_seconds: number; duration_seconds: number };

export class InvestigationNotFoundError extends Error {
  constructor() { super("investigation_not_found"); this.name = "InvestigationNotFoundError"; }
}

export class InvestigationConflictError extends Error {
  constructor(message: string) { super(message); this.name = "InvestigationConflictError"; }
}

type Deps = {
  engine: IncrementalInspectionEngine;
  inspections: InspectionRepository;
  investigations: InvestigationRepository;
};

export function listInvestigations(repository: InvestigationRepository, ownerId: string) {
  return repository.list(ownerId).map((investigation) => ({
    ...investigation,
    available_bytes: investigation.budget_bytes - investigation.reserved_bytes - investigation.consumed_bytes,
    captures: repository.listCaptures(ownerId, investigation.id).map((capture) => ({
      id: capture.id,
      status: capture.status,
      requested_bytes: capture.requested_bytes,
      bytes_received: capture.bytes_received,
      created_at: capture.created_at,
      updated_at: capture.updated_at,
      consumption_known: capture.consumption_known,
    })),
  }));
}

export async function startInvestigation(
  deps: Deps,
  ownerId: string,
  inspectionId: string,
  requestedBudgetBytes = 50_000_000,
) {
  if (!Number.isInteger(requestedBudgetBytes) || requestedBudgetBytes < 1_024 || requestedBudgetBytes > MAX_INVESTIGATION_BUDGET_BYTES) {
    throw new RangeError("budget_bytes must be between 1024 and 100000000");
  }
  if (!deps.inspections.has(ownerId, inspectionId)) throw new InspectionNotFoundError();
  const detail = await deps.engine.getInspection(inspectionId);
  if (detail.status !== "completed" && detail.status !== "partial") {
    throw new InvestigationConflictError("baseline_not_ready");
  }
  await getInspectionSnapshot(deps.engine, deps.inspections, ownerId, inspectionId);
  const investigation = deps.investigations.create(ownerId, randomUUID(), inspectionId, requestedBudgetBytes);
  return {
    ...investigation,
    available_bytes: investigation.budget_bytes - investigation.reserved_bytes - investigation.consumed_bytes,
  };
}

function requireInvestigation(repository: InvestigationRepository, ownerId: string, investigationId: string) {
  const investigation = repository.get(ownerId, investigationId);
  if (!investigation) throw new InvestigationNotFoundError();
  return investigation;
}

export async function getCaptureCoverage(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  sourceUrl: string,
  offset = 0,
  limit = 100,
) {
  const investigation = requireInvestigation(deps.investigations, ownerId, investigationId);
  const coverage = await deps.engine.getCaptureCoverage(investigation.inspection_id, sourceUrl);
  return {
    ...coverage,
    coverage: coverage.coverage.slice(offset, offset + limit),
    offset,
    limit,
    next_offset: offset + limit < coverage.total ? offset + limit : null,
  };
}

export async function getInvestigationTimeline(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  input: { rep_id?: string; start_seconds?: number; end_seconds?: number; offset?: number; limit?: number } = {},
) {
  const investigation = requireInvestigation(deps.investigations, ownerId, investigationId);
  const snapshot = await getInspectionSnapshot(deps.engine, deps.inspections, ownerId, investigation.inspection_id);
  const body = snapshot as { timeline?: unknown[]; capture?: { coverage?: unknown[] } };
  const start = input.start_seconds ?? 0;
  const end = input.end_seconds ?? Number.MAX_SAFE_INTEGER;
  const timelines = Array.isArray(body.timeline) ? body.timeline.filter((entry): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null &&
      (input.rep_id === undefined || (entry as Record<string, unknown>).rep_id === input.rep_id),
  ).map((entry) => ({
    ...entry,
    entries: Array.isArray(entry.entries) ? entry.entries.filter((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const row = item as Record<string, unknown>;
      const itemStart = typeof row.start_seconds === "number" ? row.start_seconds : null;
      const duration = typeof row.duration_seconds === "number" ? row.duration_seconds : null;
      return itemStart === null || (itemStart < end && itemStart + (duration ?? 0) > start);
    }) : [],
  })) : [];
  const coverage = Array.isArray(body.capture?.coverage) ? body.capture?.coverage : [];
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  const page = coverage.slice(offset, offset + limit);
  return {
    inspection_id: investigation.inspection_id,
    timeline: timelines,
    coverage: page,
    total_coverage: coverage.length,
    next_offset: offset + limit < coverage.length ? offset + limit : null,
  };
}

export async function startCapture(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  input: {
    source_url: string;
    selection: CaptureSelectionInput;
    max_bytes?: number;
    idempotency_key: string;
  },
) {
  const investigation = requireInvestigation(deps.investigations, ownerId, investigationId);
  const requestedBytes = input.max_bytes ?? Math.min(MAX_CAPTURE_REQUEST_BYTES, investigation.budget_bytes);
  if (!Number.isInteger(requestedBytes) || requestedBytes < 1_024 || requestedBytes > MAX_CAPTURE_REQUEST_BYTES) {
    throw new RangeError("max_bytes must be between 1024 and 25000000");
  }
  if (input.idempotency_key.length < 8 || input.idempotency_key.length > 128) {
    throw new RangeError("idempotency_key must contain 8 to 128 characters");
  }
  validateSelection(input.selection);

  const lensRequest: LensCaptureRequest = {
    source_url: input.source_url,
    max_bytes: requestedBytes,
    max_segments: MAX_CAPTURE_SEGMENTS,
    ...(input.selection.representation_ids ? { representation_ids: input.selection.representation_ids } : {}),
    ...( "segment_refs" in input.selection ? { segment_refs: input.selection.segment_refs } : {}),
    ...("start_seconds" in input.selection ? {
      start_seconds: input.selection.start_seconds,
      duration_seconds: input.selection.duration_seconds,
    } : {}),
  };
  const safeRequest: Record<string, unknown> = {
    selection: input.selection,
    max_bytes: requestedBytes,
    max_segments: MAX_CAPTURE_SEGMENTS,
    source_url_sha256: sha256(input.source_url),
  };
  const requestHash = sha256(JSON.stringify(safeRequest));
  const reservation = deps.investigations.reserveCapture(
    ownerId,
    investigationId,
    randomUUID(),
    sha256(input.idempotency_key),
    requestHash,
    requestedBytes,
    safeRequest,
  );
  let capture = reservation.capture;
  if (!reservation.created && capture.status !== "submitting" && capture.status !== "unknown") return captureSummary(capture);
  try {
    const state = await deps.engine.createCapture(
      investigation.inspection_id,
      capture.id,
      lensRequest,
    );
    capture = deps.investigations.updateCapture(ownerId, investigationId, capture.id, state) ?? capture;
    return captureSummary(capture);
  } catch (error) {
    if (isClientRejection(error)) {
      deps.investigations.updateCapture(ownerId, investigationId, capture.id, {
        status: "failed",
        error: "capture_rejected",
        bytes_received: 0,
        consumption_known: true,
      });
    }
    throw error;
  }
}

export async function getCapture(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  captureId: string,
) {
  const investigation = requireInvestigation(deps.investigations, ownerId, investigationId);
  const existing = deps.investigations.getCapture(ownerId, investigationId, captureId);
  if (!existing) throw new InvestigationNotFoundError();
  if (existing.status === "submitting" || existing.status === "unknown") {
    try {
      const state = await deps.engine.getCapture(investigation.inspection_id, captureId);
      const updated = deps.investigations.updateCapture(ownerId, investigationId, captureId, state) ?? existing;
      return captureSummary(await archiveTerminalEvidence(deps, ownerId, investigationId, investigation.inspection_id, captureId, updated));
    } catch {
      return captureSummary(existing);
    }
  }
  try {
    const state = await deps.engine.getCapture(investigation.inspection_id, captureId);
    const updated = deps.investigations.updateCapture(ownerId, investigationId, captureId, state) ?? existing;
    return captureSummary(await archiveTerminalEvidence(deps, ownerId, investigationId, investigation.inspection_id, captureId, updated));
  } catch {
    return captureSummary(existing);
  }
}

async function archiveTerminalEvidence(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  inspectionId: string,
  captureId: string,
  capture: NonNullable<ReturnType<InvestigationRepository["getCapture"]>>,
) {
  if (capture.evidence !== null || !capture.consumption_known || (capture.status !== "completed" && capture.status !== "partial")) {
    return capture;
  }
  try {
    const evidence = await deps.engine.getCaptureEvidence(inspectionId, captureId);
    return deps.investigations.updateCapture(ownerId, investigationId, captureId, {
      ...(capture.lens_status ?? {}),
      evidence,
    }) ?? capture;
  } catch {
    return capture;
  }
}

function captureSummary(capture: NonNullable<ReturnType<InvestigationRepository["getCapture"]>>) {
  return {
    id: capture.id,
    investigation_id: capture.investigation_id,
    status: capture.status,
    requested_bytes: capture.requested_bytes,
    bytes_received: capture.bytes_received,
    consumption_known: capture.consumption_known,
    created_at: capture.created_at,
    updated_at: capture.updated_at,
    ...(capture.lens_status ? { lens_status: capture.lens_status } : {}),
    evidence_available: capture.evidence !== null,
  };
}

export async function getEvidence(
  deps: Deps,
  ownerId: string,
  investigationId: string,
  captureId: string,
) {
  const investigation = requireInvestigation(deps.investigations, ownerId, investigationId);
  let capture = deps.investigations.getCapture(ownerId, investigationId, captureId);
  if (!capture) throw new InvestigationNotFoundError();
  if (capture.evidence === null) {
    if (!capture.consumption_known || (capture.status !== "completed" && capture.status !== "partial")) {
      throw new InvestigationConflictError("evidence_not_ready");
    }
    const evidence = await deps.engine.getCaptureEvidence(investigation.inspection_id, captureId);
    const state = { ...(capture.lens_status ?? {}), evidence };
    capture = deps.investigations.updateCapture(ownerId, investigationId, captureId, state) ?? capture;
  }
  if (capture.evidence === null) throw new InvestigationConflictError("evidence_not_ready");
  return {
    inspection_id: investigation.inspection_id,
    capture_id: captureId,
    captured_at: capture.lens_status?.finished_at ?? capture.updated_at,
    evidence: capture.evidence,
  };
}

function validateSelection(selection: CaptureSelectionInput): void {
  if ("segment_refs" in selection) {
    if (selection.segment_refs.length < 1 || selection.segment_refs.length > MAX_CAPTURE_SEGMENTS) {
      throw new RangeError(`segment_refs must contain 1 to ${MAX_CAPTURE_SEGMENTS} items`);
    }
    if (new Set(selection.segment_refs).size !== selection.segment_refs.length) {
      throw new RangeError("segment_refs must be unique");
    }
    for (const ref of selection.segment_refs) {
      if (!/^seg_[a-f0-9]{24}$/.test(ref)) throw new RangeError("invalid_segment_ref");
    }
  } else {
    if (selection.representation_ids.length < 1 || selection.representation_ids.length > 8) {
      throw new RangeError("representation_ids must contain 1 to 8 items");
    }
    if (!Number.isFinite(selection.start_seconds) || selection.start_seconds < 0) {
      throw new RangeError("invalid_start_seconds");
    }
    if (!Number.isFinite(selection.duration_seconds) || selection.duration_seconds <= 0 || selection.duration_seconds > 60) {
      throw new RangeError("duration_seconds must be between 0 and 60");
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isClientRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error &&
    typeof error.status === "number" && error.status >= 400 && error.status < 500;
}
