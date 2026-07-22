import type { FastifyInstance } from "fastify";
import { StartInvestigationRequestSchema } from "../../contracts/investigation.js";
import type { StartInvestigation } from "../../investigation/application/start-investigation.js";
import { IdempotencyConflictError } from "../../investigation/ports/investigation-intake.js";
import { ApiError } from "../errors.js";

export function registerInvestigationRoutes(server: FastifyInstance, startInvestigation: StartInvestigation): void {
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
      const result = await startInvestigation({
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
}
