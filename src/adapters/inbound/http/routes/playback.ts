import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { StreamMockEngine } from "../../../../application/ports/stream-mock.js";
import type { AuthHook } from "../auth.js";
import { sendStreamError } from "./streams.js";

const CreateSessionBody = z.object({
  source: z.string().trim().min(1).max(4_096).optional(),
  stream_id: z.string().trim().min(1).optional(),
  preset: z.string().trim().min(1).optional(),
  format: z.enum(["hls", "dash"]).optional(),
  live: z.boolean().optional(),
  content_id: z.string().trim().min(1).max(64).optional(),
  duration_seconds: z.number().min(1).max(300).optional(),
});

const SessionsQuery = z.object({
  stream: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  preset: z.string().trim().min(1).optional(),
});

export function registerPlaybackRoutes(
  app: FastifyInstance,
  deps: { engine: StreamMockEngine; auth: AuthHook },
): void {
  app.post("/v1/playback/sessions", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = CreateSessionBody.safeParse(request.body);
    if (!parsed.success || (!parsed.data.source && !parsed.data.stream_id)) {
      return reply.status(400).send({ error: "source ou stream_id é obrigatório" });
    }
    const input = parsed.data;
    // O browser envia os eventos direto ao mock (capability/ingest URL); a
    // origem permitida precisa ser a do frontend, não a do orquestrador.
    const origin = request.headers.origin;
    try {
      const created = await deps.engine.createPlaybackSession(request.vhOwnerId, {
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.stream_id !== undefined ? { streamId: input.stream_id } : {}),
        ...(input.preset !== undefined ? { preset: input.preset } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.live !== undefined ? { live: input.live } : {}),
        ...(input.content_id !== undefined ? { contentId: input.content_id } : {}),
        ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
        ...(origin ? { allowedOrigin: origin } : {}),
      });
      return reply.status(201).send(created);
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/playback/sessions", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = SessionsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "query inválida" });
    }
    try {
      const sessions = await deps.engine.listPlaybackSessions(request.vhOwnerId, {
        ...(parsed.data.stream ? { streamId: parsed.data.stream } : {}),
        ...(parsed.data.source ? { source: parsed.data.source } : {}),
        ...(parsed.data.preset ? { preset: parsed.data.preset } : {}),
      });
      return reply.send({ sessions });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/playback/sessions/:sessionId/timeline", { preHandler: deps.auth }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    try {
      return reply.send(await deps.engine.getPlaybackTimeline(request.vhOwnerId, sessionId));
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });
}
