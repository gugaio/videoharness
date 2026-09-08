import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LensApiError, LensClient } from "../lens-client.js";
import type { AuthHook } from "../auth.js";

const CreateInspectionBody = z.object({
  url: z.string().trim().min(1).max(4_096),
});

export function registerInspectionRoutes(
  app: FastifyInstance,
  deps: { lens: LensClient; auth: AuthHook },
): void {
  app.post(
    "/v1/inspections",
    { preHandler: deps.auth },
    async (request, reply) => {
      const parsed = CreateInspectionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "url é obrigatória" });
      }
      try {
        const created = await deps.lens.createInspection(parsed.data.url);
        return reply.status(202).send(created);
      } catch (error) {
        return sendLensError(reply, error);
      }
    },
  );

  app.get(
    "/v1/inspections/:inspectionId",
    { preHandler: deps.auth },
    async (request, reply) => {
      const { inspectionId } = request.params as { inspectionId: string };
      try {
        const detail = await deps.lens.getInspection(inspectionId);
        return reply.send(detail);
      } catch (error) {
        return sendLensError(reply, error);
      }
    },
  );

  app.get(
    "/v1/inspections/:inspectionId/snapshot",
    { preHandler: deps.auth },
    async (request, reply) => {
      const { inspectionId } = request.params as { inspectionId: string };
      try {
        const snapshot = await deps.lens.getSnapshot(inspectionId);
        return reply.send(snapshot);
      } catch (error) {
        return sendLensError(reply, error);
      }
    },
  );
}

function sendLensError(reply: {
  status: (code: number) => { send: (body: unknown) => unknown };
}, error: unknown): unknown {
  if (isLensApiError(error)) {
    return reply.status(error.status).send({ error: error.message });
  }
  return reply.status(502).send({ error: error instanceof Error ? error.message : "erro desconhecido" });
}

function isLensApiError(error: unknown): error is LensApiError {
  return error instanceof Error && error.name === "LensApiError";
}
