import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  StreamMockError,
  StreamNotFoundError,
  type StreamMockEngine,
} from "../../../../application/ports/stream-mock.js";
import type { ProxyRequestFilters } from "../../../../domain/streams.js";
import type { AuthHook } from "../auth.js";

const CreateStreamBody = z.object({
  url: z.string().trim().min(1).max(4_096),
  label: z.string().trim().max(120).optional(),
  duration_seconds: z.number().min(1).max(300).optional(),
  mode: z.enum(["clone", "proxy"]).optional(),
  format: z.enum(["hls", "dash"]).optional(),
  protection_mode: z.enum(["clear", "clearkey"]).optional(),
  track_selection: z.enum(["highest", "all"]).optional(),
});

const PresetBody = z.object({
  preset: z.string().trim().min(1),
});

const ControlLiveBody = z.object({
  action: z.enum(["start", "pause", "resume", "restart", "stop"]),
  window_segments: z.number().int().min(1).max(20).optional(),
  loop: z.boolean().optional(),
});

const ProxyPlaybackBody = z.object({
  url: z.string().trim().min(1).max(4_096),
  preset: z.string().trim().min(1).optional(),
  format: z.enum(["hls", "dash"]).optional(),
});

const WorkspaceRequestsQuery = z.object({
  mode: z.enum(["proxy", "clone"]).optional(),
  stream: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  preset: z.string().trim().min(1).optional(),
});

function toFilters(query: z.infer<typeof WorkspaceRequestsQuery>): ProxyRequestFilters {
  return {
    mode: query.mode ?? "proxy",
    ...(query.stream ? { streamId: query.stream } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.preset ? { preset: query.preset } : {}),
  };
}

export function registerStreamRoutes(
  app: FastifyInstance,
  deps: { engine: StreamMockEngine; auth: AuthHook },
): void {
  app.get("/v1/streams", { preHandler: deps.auth }, async (request, reply) => {
    try {
      return reply.send({ streams: await deps.engine.listStreams(request.vhOwnerId) });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.post("/v1/streams", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = CreateStreamBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "corpo inválido" });
    }
    const input = parsed.data;
    try {
      const stream = await deps.engine.createStream(request.vhOwnerId, {
        url: input.url,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.protection_mode !== undefined ? { protectionMode: input.protection_mode } : {}),
        ...(input.track_selection !== undefined ? { trackSelection: input.track_selection } : {}),
      });
      return reply.status(202).send({ stream });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.post("/v1/streams/proxy", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = ProxyPlaybackBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "corpo inválido" });
    }
    const input = parsed.data;
    try {
      const playback = await deps.engine.createProxyPlayback(request.vhOwnerId, {
        url: input.url,
        ...(input.preset !== undefined ? { preset: input.preset } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
      });
      return reply.send(playback);
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/streams/:streamId", { preHandler: deps.auth }, async (request, reply) => {
    const { streamId } = request.params as { streamId: string };
    try {
      return reply.send({ stream: await deps.engine.getStream(request.vhOwnerId, streamId) });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.delete("/v1/streams/:streamId", { preHandler: deps.auth }, async (request, reply) => {
    const { streamId } = request.params as { streamId: string };
    try {
      await deps.engine.deleteStream(request.vhOwnerId, streamId);
      return reply.send({ ok: true });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.post("/v1/streams/:streamId/preset", { preHandler: deps.auth }, async (request, reply) => {
    const { streamId } = request.params as { streamId: string };
    const parsed = PresetBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "preset é obrigatório" });
    }
    try {
      const stream = await deps.engine.setPreset(request.vhOwnerId, streamId, parsed.data.preset);
      return reply.send({ stream });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/streams/:streamId/live", { preHandler: deps.auth }, async (request, reply) => {
    const { streamId } = request.params as { streamId: string };
    try {
      return reply.send({ live: await deps.engine.getLive(request.vhOwnerId, streamId) });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.post("/v1/streams/:streamId/live", { preHandler: deps.auth }, async (request, reply) => {
    const { streamId } = request.params as { streamId: string };
    const parsed = ControlLiveBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "action inválida" });
    }
    const input = parsed.data;
    try {
      const live = await deps.engine.controlLive(request.vhOwnerId, streamId, {
        action: input.action,
        ...(input.window_segments !== undefined ? { windowSegments: input.window_segments } : {}),
        ...(input.loop !== undefined ? { loop: input.loop } : {}),
      });
      return reply.send({ live });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/workspace", { preHandler: deps.auth }, async (request, reply) => {
    try {
      return reply.send(await deps.engine.getWorkspace(request.vhOwnerId));
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.get("/v1/workspace/requests", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = WorkspaceRequestsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "query inválida" });
    }
    try {
      return reply.send(await deps.engine.listWorkspaceRequests(request.vhOwnerId, toFilters(parsed.data)));
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });

  app.delete("/v1/workspace/requests", { preHandler: deps.auth }, async (request, reply) => {
    const parsed = WorkspaceRequestsQuery.safeParse(request.query);
    if (!parsed.success || (!parsed.data.stream && !parsed.data.source)) {
      return reply.status(400).send({ error: "um stream ou source é obrigatório para limpar a atividade" });
    }
    try {
      await deps.engine.clearWorkspaceRequests(request.vhOwnerId, toFilters(parsed.data));
      return reply.send({ ok: true });
    } catch (error) {
      return sendStreamError(reply, error);
    }
  });
}

export function sendStreamError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof StreamNotFoundError) {
    return reply.status(404).send({ error: error.message });
  }
  if (error instanceof StreamMockError) {
    return reply.status(error.status).send({ error: error.message });
  }
  return reply.status(502).send({ error: error instanceof Error ? error.message : "erro desconhecido" });
}
