import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IncrementalInspectionEngine } from "../../../../application/ports/inspection-engine.js";
import type { InspectionRepository } from "../../../../application/ports/inspection-repository.js";
import {
  InvestigationBudgetError,
  InvestigationIdempotencyError,
  type InvestigationRepository,
} from "../../../../application/ports/investigation-repository.js";
import {
  getCapture,
  getCaptureCoverage,
  getEvidence,
  getInvestigationTimeline,
  InvestigationConflictError,
  InvestigationNotFoundError,
  listInvestigations,
  startCapture,
  startInvestigation,
} from "../../../../application/use-cases/investigations.js";
import { InspectionEngineError } from "../../../../application/ports/inspection-engine.js";
import type { AuthHook } from "../auth.js";
import { InspectionNotFoundError } from "../../../../application/use-cases/inspection-not-found.js";

const CreateSchema = z.object({
  inspection_id: z.string().min(1).max(200),
  budget_bytes: z.number().int().min(1_024).max(100_000_000).default(50_000_000),
}).strict();

const CoverageSchema = z.object({
  source_url: z.string().trim().url().max(4_096),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

const CaptureSchema = z.object({
  source_url: z.string().trim().url().max(4_096),
  segment_refs: z.array(z.string().min(1).max(100)).min(1).max(16).optional(),
  representation_ids: z.array(z.string().min(1).max(200)).min(1).max(8).optional(),
  start_seconds: z.number().finite().min(0).max(86_400).optional(),
  duration_seconds: z.number().finite().gt(0).max(60).optional(),
  max_bytes: z.number().int().min(1_024).max(25_000_000).default(25_000_000),
  idempotency_key: z.string().min(8).max(128),
}).strict().superRefine((value, context) => {
  const refs = value.segment_refs !== undefined;
  const window = value.start_seconds !== undefined || value.duration_seconds !== undefined;
  if (refs === window) context.addIssue({ code: "custom", message: "use segment_refs or a time window" });
  if (window && (value.start_seconds === undefined || value.duration_seconds === undefined || value.representation_ids === undefined)) {
    context.addIssue({ code: "custom", message: "a time window requires start_seconds, duration_seconds, and representation_ids" });
  }
  if (refs && value.segment_refs && new Set(value.segment_refs).size !== value.segment_refs.length) {
    context.addIssue({ code: "custom", message: "segment_refs must be unique" });
  }
});

type Deps = {
  engine: IncrementalInspectionEngine;
  inspections: InspectionRepository;
  investigations: InvestigationRepository;
  auth: AuthHook;
};

export function registerInvestigationRoutes(app: FastifyInstance, deps: Deps): void {
  app.get("/v1/investigations", { preHandler: deps.auth }, async (request) => ({
    investigations: listInvestigations(deps.investigations, request.vhOwnerId),
  }));

  app.post("/v1/investigations", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_investigation_request" });
    try {
      const investigation = await startInvestigation(
        deps,
        request.vhOwnerId,
        parsed.data.inspection_id,
        parsed.data.budget_bytes,
      );
      return reply.code(201).send(investigation);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/investigations/:investigationId", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId } = request.params as { investigationId: string };
    const investigation = deps.investigations.get(request.vhOwnerId, investigationId);
    if (!investigation) return reply.code(404).send({ error: "investigation_not_found" });
    const detail = listInvestigations(deps.investigations, request.vhOwnerId)
      .find((item) => item.id === investigationId);
    return detail ?? investigation;
  });

  app.post("/v1/investigations/:investigationId/coverage", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId } = request.params as { investigationId: string };
    const parsed = CoverageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_coverage_request" });
    try {
      return await getCaptureCoverage(deps, request.vhOwnerId, investigationId,
        parsed.data.source_url, parsed.data.offset, parsed.data.limit);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/investigations/:investigationId/timeline", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId } = request.params as { investigationId: string };
    const parsed = z.object({
      rep_id: z.string().max(200).optional(),
      start_seconds: z.coerce.number().min(0).optional(),
      end_seconds: z.coerce.number().min(0).optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_timeline_request" });
    try {
      const { rep_id, start_seconds, end_seconds, offset, limit } = parsed.data;
      const options: { rep_id?: string; start_seconds?: number; end_seconds?: number; offset: number; limit: number } = { offset, limit };
      if (rep_id !== undefined) options.rep_id = rep_id;
      if (start_seconds !== undefined) options.start_seconds = start_seconds;
      if (end_seconds !== undefined) options.end_seconds = end_seconds;
      return await getInvestigationTimeline(deps, request.vhOwnerId, investigationId, options);
    }
    catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/investigations/:investigationId/captures", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId } = request.params as { investigationId: string };
    const parsed = CaptureSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_capture_request" });
    const value = parsed.data;
    const selection = value.segment_refs
      ? { segment_refs: value.segment_refs, ...(value.representation_ids ? { representation_ids: value.representation_ids } : {}) }
      : { representation_ids: value.representation_ids ?? [], start_seconds: value.start_seconds ?? 0, duration_seconds: value.duration_seconds ?? 0 };
    try {
      const capture = await startCapture(deps, request.vhOwnerId, investigationId, {
        source_url: value.source_url,
        selection,
        max_bytes: value.max_bytes,
        idempotency_key: value.idempotency_key,
      });
      return reply.code(capture.status === "submitting" ? 202 : 200).send(capture);
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/investigations/:investigationId/captures/:captureId", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId, captureId } = request.params as { investigationId: string; captureId: string };
    try { return await getCapture(deps, request.vhOwnerId, investigationId, captureId); }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/v1/investigations/:investigationId/captures/:captureId/evidence", { preHandler: deps.auth }, async (request, reply) => {
    const { investigationId, captureId } = request.params as { investigationId: string; captureId: string };
    try { return await getEvidence(deps, request.vhOwnerId, investigationId, captureId); }
    catch (error) { return sendError(reply, error); }
  });
}

function sendError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof InspectionNotFoundError || error instanceof InvestigationNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof InvestigationBudgetError) return reply.code(429).send({ error: error.message });
  if (error instanceof InvestigationIdempotencyError || error instanceof InvestigationConflictError) {
    return reply.code(409).send({ error: error.message });
  }
  if (error instanceof RangeError) return reply.code(400).send({ error: error.message });
  if (error instanceof InspectionEngineError) return reply.code(error.status >= 400 && error.status < 500 ? error.status : 502).send({ error: "inspection_engine_error" });
  return reply.code(502).send({ error: error instanceof Error ? error.message : "unknown_error" });
}
