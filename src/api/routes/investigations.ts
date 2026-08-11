import type { FastifyInstance } from "fastify";
import { CompletePlaybackSessionRequestSchema, CreatePlaybackSessionRequestSchema, StartInvestigationRequestSchema } from "../../contracts/investigation.js";
import type { PostgresPlaybackSessions } from "../../investigation/adapters/postgres-playback-session.js";
import type { StartInvestigation } from "../../investigation/application/start-investigation.js";
import type { InvestigationQueries } from "../../investigation/application/investigation-queries.js";
import type { InvestigationEvent } from "../../investigation/domain/investigation-event.js";
import { IdempotencyConflictError } from "../../investigation/ports/investigation-intake.js";
import { ApiError } from "../errors.js";
import type { ArtifactStore } from "../../investigation/ports/artifact-store.js";

export function registerInvestigationRoutes(
  server: FastifyInstance,
  dependencies: { startInvestigation: StartInvestigation; queries: InvestigationQueries; playbackSessions?: PostgresPlaybackSessions; artifactStore?: ArtifactStore },
): void {
  server.post<{ Body: unknown }>("/v1/investigations", async (request, reply) => {
    const parsed = StartInvestigationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_REQUEST", "A valid HTTP(S) stream URL is required");
    }
    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0]?.trim() : header?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required");
    }

    try {
      const result = await dependencies.startInvestigation({
        sourceUrl: parsed.data.url,
        ...(parsed.data.problemDescription ? { problemDescription: parsed.data.problemDescription } : {}),
        idempotencyKey,
      });
      if (!result.created) reply.header("x-idempotency-replayed", "true");
      return reply.status(202).send({
        investigation: result.investigation,
        replayed: !result.created,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id", async (request) => {
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    return { investigation };
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id/report", async (request) => {
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    const report = await dependencies.queries.getReport(id);
    if (!report) throw new ApiError(404, "REPORT_NOT_READY", "Investigation report is not ready");
    return { report };
  });

  // Prompt audit is intentionally a workspace endpoint: it can contain source
  // URLs and detailed evidence packets, so it must never be used for sharing.
  server.get<{ Params: { id: string } }>("/v1/investigations/:id/ai-runs", async (request) => {
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    const report = await dependencies.queries.getReport(id);
    if (!report) throw new ApiError(404, "REPORT_NOT_READY", "AI prompt audit is available after the initial report");
    const ai = report.content.placeholder
      ? undefined
      : (report.content as { ai?: { promptAudits?: unknown[] } }).ai;
    return { runs: ai?.promptAudits ?? [] };
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id/artifacts", async (request) => {
    if (!dependencies.queries.listArtifacts) throw new ApiError(503, "ARTIFACTS_UNAVAILABLE", "Artifact listing is not configured");
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    const artifacts = await dependencies.queries.listArtifacts(id);
    return { artifacts: artifacts.map(({ storageKey: _storageKey, ...artifact }) => artifact) };
  });

  server.get<{ Params: { id: string; artifactId: string } }>("/v1/investigations/:id/artifacts/:artifactId", async (request, reply) => {
    if (!dependencies.artifactStore?.read || !dependencies.queries.getArtifact) throw new ApiError(503, "ARTIFACTS_UNAVAILABLE", "Artifact storage is not configured");
    const id = parseInvestigationId(request.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(request.params.artifactId)) throw new ApiError(400, "INVALID_ARTIFACT_ID", "Artifact ID is invalid");
    const artifact = await dependencies.queries.getArtifact(id, request.params.artifactId);
    if (!artifact) throw new ApiError(404, "ARTIFACT_NOT_FOUND", "Artifact not found");
    try {
      const content = await dependencies.artifactStore.read(artifact.storageKey);
      reply.header("Content-Disposition", `attachment; filename="${artifact.logicalKey.replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
      return reply.type(artifact.contentType ?? "application/octet-stream").send(content);
    } catch {
      throw new ApiError(404, "ARTIFACT_NOT_FOUND", "Artifact content is unavailable");
    }
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/investigations/:id/playback-sessions", async (request, reply) => {
    if (!dependencies.playbackSessions) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback validation is not configured");
    const id = parseInvestigationId(request.params.id);
    const parsed = CreatePlaybackSessionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ApiError(400, "INVALID_PLAYBACK_SESSION", "Playback duration must be between 5 and 60 seconds");
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    if (investigation.state !== "completed") throw new ApiError(409, "REPORT_NOT_READY", "Playback validation is available after the initial report");
    const session = await dependencies.playbackSessions.create(id, parsed.data.requestedDurationMs);
    return reply.status(201).send({ session, sourceUrl: investigation.sourceUrl });
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id/playback-sessions/latest", async (request) => {
    if (!dependencies.playbackSessions) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback validation is not configured");
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");
    return { session: await dependencies.playbackSessions.latest(id) };
  });

  server.post<{ Params: { id: string; sessionId: string }; Body: unknown }>("/v1/investigations/:id/playback-sessions/:sessionId/complete", async (request) => {
    if (!dependencies.playbackSessions) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback validation is not configured");
    const id = parseInvestigationId(request.params.id);
    const parsed = CompletePlaybackSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "INVALID_PLAYBACK_TELEMETRY", "Playback telemetry did not meet the safety limits");
    const session = await dependencies.playbackSessions.complete(id, request.params.sessionId, parsed.data);
    if (!session) throw new ApiError(409, "PLAYBACK_SESSION_NOT_RUNNING", "Playback session is not active");
    return { session };
  });

  server.post<{ Params: { id: string; sessionId: string }; Body: { code?: unknown; message?: unknown } }>("/v1/investigations/:id/playback-sessions/:sessionId/fail", async (request) => {
    if (!dependencies.playbackSessions) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback validation is not configured");
    const id = parseInvestigationId(request.params.id);
    const code = typeof request.body?.code === "string" ? request.body.code.slice(0, 80) : "PLAYBACK_FAILED";
    const message = typeof request.body?.message === "string" ? request.body.message.slice(0, 240) : "Browser playback did not complete";
    const session = await dependencies.playbackSessions.fail(id, request.params.sessionId, code, message);
    if (!session) throw new ApiError(409, "PLAYBACK_SESSION_NOT_RUNNING", "Playback session is not active");
    return { session };
  });

  server.get<{ Params: { id: string } }>("/v1/investigations/:id/events", async (request, reply) => {
    const id = parseInvestigationId(request.params.id);
    const investigation = await dependencies.queries.getInvestigation(id);
    if (!investigation) throw new ApiError(404, "INVESTIGATION_NOT_FOUND", "Investigation not found");

    reply.hijack();
    const response = reply.raw;
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    let closed = false;
    let polling = false;
    let cursor = parseEventCursor(request.headers["last-event-id"]);

    const writeEvents = async (): Promise<void> => {
      if (closed || polling) return;
      polling = true;
      try {
        const events = await dependencies.queries.listEventsAfter(id, cursor);
        for (const event of events) {
          if (closed) return;
          response.write(formatInvestigationSseEvent(event));
          cursor = event.id;
        }
      } finally {
        polling = false;
      }
    };

    try {
      await writeEvents();
    } catch {
      closed = true;
      response.destroy();
      return;
    }
    const pollTimer = setInterval(() => void writeEvents().catch(() => cleanup()), 750);
    const pingTimer = setInterval(() => {
      if (!closed) response.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 15_000);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(pollTimer);
      clearInterval(pingTimer);
      response.end();
    };
    request.raw.once("close", cleanup);
    request.raw.once("error", cleanup);
  });
}

function parseInvestigationId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "INVALID_INVESTIGATION_ID", "Investigation ID is invalid");
  }
  return value;
}

function parseEventCursor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^\d+$/.test(value) ? value : "0";
}

export function formatInvestigationSseEvent(event: InvestigationEvent): string {
  return `id: ${event.id}\nevent: investigation.event\ndata: ${JSON.stringify(event)}\n\n`;
}
