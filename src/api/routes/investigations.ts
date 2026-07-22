import type { FastifyInstance } from "fastify";
import { StartInvestigationRequestSchema } from "../../contracts/investigation.js";
import type { StartInvestigation } from "../../investigation/application/start-investigation.js";
import type { InvestigationQueries } from "../../investigation/application/investigation-queries.js";
import type { InvestigationEvent } from "../../investigation/domain/investigation-event.js";
import { IdempotencyConflictError } from "../../investigation/ports/investigation-intake.js";
import { ApiError } from "../errors.js";

export function registerInvestigationRoutes(
  server: FastifyInstance,
  dependencies: { startInvestigation: StartInvestigation; queries: InvestigationQueries },
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
