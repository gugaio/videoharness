import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InspectionEngineError, type InspectionEngine } from "../../../../application/ports/inspection-engine.js";
import type { InspectionRepository } from "../../../../application/ports/inspection-repository.js";
import { createInspection } from "../../../../application/use-cases/create-inspection.js";
import { deleteInspection } from "../../../../application/use-cases/delete-inspection.js";
import { getInspection } from "../../../../application/use-cases/get-inspection.js";
import { getInspectionSnapshot } from "../../../../application/use-cases/get-inspection-snapshot.js";
import { InspectionNotFoundError } from "../../../../application/use-cases/inspection-not-found.js";
import { listInspections } from "../../../../application/use-cases/list-inspections.js";
import type { AuthHook } from "../auth.js";

const CreateInspectionBody = z.object({
  url: z.string().trim().min(1).max(4_096),
});

export function registerInspectionRoutes(
  app: FastifyInstance,
  deps: { engine: InspectionEngine; auth: AuthHook; repository: InspectionRepository },
): void {
  app.get(
    "/v1/inspections",
    { preHandler: deps.auth },
    async (request) => ({ inspections: listInspections(deps.repository, request.vhOwnerId) }),
  );

  app.post(
    "/v1/inspections",
    { preHandler: deps.auth },
    async (request, reply) => {
      const parsed = CreateInspectionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "url é obrigatória" });
      }
      try {
        const created = await createInspection(deps.engine, deps.repository, request.vhOwnerId, parsed.data.url);
        return reply.status(202).send(created);
      } catch (error) {
        return sendInspectionError(reply, error);
      }
    },
  );

  app.get(
    "/v1/inspections/:inspectionId",
    { preHandler: deps.auth },
    async (request, reply) => {
      const { inspectionId } = request.params as { inspectionId: string };
      try {
        const detail = await getInspection(deps.engine, deps.repository, request.vhOwnerId, inspectionId);
        return reply.send(detail);
      } catch (error) {
        return sendInspectionError(reply, error);
      }
    },
  );

  app.delete(
    "/v1/inspections/:inspectionId",
    { preHandler: deps.auth },
    async (request, reply) => {
      const { inspectionId } = request.params as { inspectionId: string };
      try {
        deleteInspection(deps.repository, request.vhOwnerId, inspectionId);
        return reply.send({ ok: true });
      } catch (error) {
        return sendInspectionError(reply, error);
      }
    },
  );

  app.get(
    "/v1/inspections/:inspectionId/snapshot",
    { preHandler: deps.auth },
    async (request, reply) => {
      const { inspectionId } = request.params as { inspectionId: string };
      try {
        const snapshot = await getInspectionSnapshot(deps.engine, deps.repository, request.vhOwnerId, inspectionId);
        return reply.send(snapshot);
      } catch (error) {
        return sendInspectionError(reply, error);
      }
    },
  );
}

function sendInspectionError(reply: {
  status: (code: number) => { send: (body: unknown) => unknown };
}, error: unknown): unknown {
  if (error instanceof InspectionNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof InspectionEngineError) {
    return reply.status(error.status).send({ error: error.message });
  }
  return reply.status(502).send({ error: error instanceof Error ? error.message : "erro desconhecido" });
}
